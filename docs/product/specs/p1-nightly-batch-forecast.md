# P1 — Nightly batch forecast + `forecast_cache` table

**Status**: proposed (ships as a PR for Roy — see Rollout)
**Owner**: product-manager → feature-dev
**Depends on**: `fare_observations` populated by the collector (already live); `SUPABASE_SERVICE_KEY` set
**Blocks**: P2 (Chronos HF endpoint), P3 (events covariate), P4 (LLM narrative)

---

## 1. Problem & goal

`server/services/forecastService.js#forecastRoute` runs **on demand, inside the
`/api/flights` request** (server.js:669). Two consequences. First, UI latency is bolted to
forecast compute: a ~1,000-row history read, the daily-index rebuild, and — once
`HF_ENDPOINT_URL` is set — a synchronous call to the Chronos-2 endpoint with a 4-second
timeout (forecastService.js:293–400). Second, on Render's free tier a scale-to-zero HF
endpoint cold-starts *slower* than 4s, so a deployed endpoint would abort and fall back to
seasonal-naive on nearly every request. The endpoint is unusable without precompute.

**Goal.** A nightly job precomputes verdicts for the featured-hub routes and writes them to
a Supabase `forecast_cache` table. `/api/flights` reads the cached verdict when it is fresh
and still price-relevant, instead of computing live. The feature must deliver value **today
with the seasonal-naive engine** (no Chronos required) — it removes per-request forecast
latency immediately — and must **benefit automatically** the moment `HF_ENDPOINT_URL` is
set, because the batch runs the endpoint off the request path where a slow cold start is
harmless.

---

## 2. Data model — `forecast_cache`

### Decision: full payload JSONB **plus** lifted scalar columns

The `forecastRoute` return shape is **tier-dependent** — Tier 1/2 omit `forecastMedian`,
`predictionInterval`, `expectedSavings` and carry `confidenceScore: null`; Tier 3 carries
them all. The read path in server.js hands the `forecast` object **straight into**
`computeEventDrivenInsights` unchanged. So:

- **Store the whole object as `payload jsonb`.** The read becomes a pass-through — no field
  mapping to drift, and a future tier field is carried for free without a migration.
- **Lift a handful of scalars into columns** for the things SQL and the read path must do
  *without parsing JSON*: staleness (`computed_at`), price-drift gating
  (`computed_current_price`), operability (`verdict`, `reason`, `confidence_score`,
  `sample_size`, `distinct_days` — you can eyeball the table and see which routes have a
  live verdict), and provider observability (`provider`).

Primary key is `(route, currency)` — one live verdict per route per stored currency. The
batch **upserts** (`on conflict (route, currency) do update`), so a re-run refreshes in
place rather than accumulating rows. Provider is stored, not keyed: only one
`FORECAST_PROVIDER` is active at a time, and a provider switch should *overwrite* the stale
row, not shadow it.

### `supabase/forecast_cache.sql` (migration sketch)

```sql
-- Precomputed BUY/WAIT verdicts for the featured-hub routes, written nightly by
-- server/jobs/forecastBatch.js so /api/flights does not compute a forecast on the request
-- path.
--
-- Run once in the Supabase SQL editor.
--
-- Why this table exists: forecastRoute() runs a ~1,000-row read, a daily-index rebuild, and
-- (once HF_ENDPOINT_URL is set) a 4s-timeout call to a Chronos endpoint — all inside the
-- user's /api/flights request. On Render's free tier the HF endpoint cold-starts slower
-- than 4s, so live calls would abort into seasonal-naive on nearly every request. Computing
-- off the request path, nightly, is the only way the endpoint is usable at all.
--
-- One row per (route, currency). The payload is the full forecastRoute() return object,
-- stored verbatim so the read path can hand it downstream unchanged. The scalar columns are
-- lifted out of that payload for staleness, price-drift gating, and operability.

create table if not exists public.forecast_cache (
  route                  text        not null,          -- 'TLV-CDG'
  currency               text        not null default 'USD',
  provider               text,                          -- FORECAST_PROVIDER lock in effect, for observability
  verdict                text,                          -- 'BUY_NOW' | 'WAIT' | null (insufficient-history tiers)
  reason                 text        not null,          -- forecastRoute reason: seasonal_naive_forecast, basic_statistics, ...
  confidence_score       integer,                       -- null on tiers 1/2, by design
  computed_current_price numeric,                       -- the assumed price the verdict was computed against (latest observation)
  sample_size            integer,
  distinct_days          integer,
  payload                jsonb       not null,          -- the whole forecastRoute() return object
  computed_at            timestamptz not null default now(),
  primary key (route, currency)
);

-- Housekeeping / staleness sweeps read by recency.
create index if not exists forecast_cache_computed_at_idx
  on public.forecast_cache (computed_at);

-- Written only by the server using the service key, which bypasses RLS. Enabling RLS with
-- no policy denies every anon/authenticated client while leaving the server unaffected —
-- browsers must never read or write this cache directly.
alter table public.forecast_cache enable row level security;

-- Optional housekeeping: drop verdicts no batch has refreshed in a fortnight (a route
-- dropped from the featured set).
--   delete from public.forecast_cache where computed_at < now() - interval '14 days';
```

---

## 3. Batch job — `server/jobs/forecastBatch.js`

Mirror `fareCollector.js` beat for beat: a `node-cron` job **inside the web process**,
gated by an env flag, with a resume cursor and yield logging. All table access goes through
a new service (§3.4), keeping the job free of inline Supabase per hard rule 6.

### 3.1 Route universe

Same universe as the collector, so every batched route actually has observations to forecast
from:

- **origins**: `FORECAST_BATCH_HOME_AIRPORTS` → falls back to `COLLECTOR_HOME_AIRPORTS` → `TLV`
- **destinations**: `FORECAST_BATCH_DESTINATIONS` → falls back to `COLLECTOR_DESTINATIONS` →
  `VITE_FEATURED_HUBS`
- Skip `origin === destination`. Iterate `home × destination` (no horizon fan-out — a
  forecast is per route, not per departure date).

At the default 10 destinations this is ~10 tasks — trivially fast — but keep the collector's
`cursorIndex` + `maxTasksPerSweep` (env `FORECAST_BATCH_MAX_TASKS`, default `0` = whole list)
so an interrupted run on a restarting host resumes rather than restarts.

### 3.2 "Current price" — decision: **latest real observation**, not a fresh quote

The batch has no live quote. It must **not** issue a live provider search per route: that
multiplies the exact metered API calls this feature exists to avoid, and re-couples the
batch to provider rate limits. Instead, for each route+currency read the **most recent
`fare_observations` row** (`select roundtrip_price, provider order by observed_at desc limit
1`, honouring the `FORECAST_PROVIDER`/`FLIGHT_PROVIDER` lock the way `forecastRoute` does).
`currentPrice` in `forecastRoute` only feeds `pricePercentile`, the BUY/WAIT rule, and
`expectedSavings` — the latest observed fare is the honest, zero-cost stand-in, and the
read-path drift gate (§4) protects against it having gone stale.

- **No observation for the route** → **skip, write nothing, log it**, continue. A route with
  no history can only tier to `insufficient_history`; there is nothing to serve and the read
  path's live fallback will say so.

### 3.3 Calling the engine & handling tiers

For each route with a latest price `p`:

```
const forecast = await forecastService.forecastRoute(origin, destination, p, currency);
```

Reuse `forecastRoute` **as-is** — do not touch the engine math.

- **Write every non-transient result**, including the null-verdict tiers
  (`insufficient_history`, `basic_statistics`). Caching an honest "not enough history yet"
  lets the read path serve it without a live DB round-trip, and the UI already renders it.
- **Do not write** when `reason ∈ { error, database_error, no_database }` — those are
  transient/infra failures; caching one would pin a "broken" state for a whole staleness
  window. Log and move on.
- On write, populate `computed_current_price = p`, lift `verdict/reason/confidence_score/
  sample_size/distinct_days`, set `provider` to the effective lock (or the observation's
  provider), and store the whole object as `payload`.

### 3.4 New service — `server/services/forecastCache.js`

A `ForecastCache` class taking `{ supabase }` (like `FareHistory`), plus a singleton wired
to `getServerSupabase()`. Localises all `forecast_cache` access and makes both the write and
read unit-testable against the existing Supabase builder stub.

- `put(route, currency, forecast, { computedCurrentPrice, provider })` → upsert one row.
- `latestObservedPrice(route, currency)` → the §3.2 lookup (or lives in the batch; either is
  fine — keep it out of the engine).
- `get(route, currency, livePrice, { staleHours, driftTolerance })` → returns the cached
  `payload` **only if** the row passes both gates in §4, else `null`. Never throws to the
  caller — a read failure returns `null` and the caller falls back to live compute.

### 3.5 Scheduling

```js
export function startForecastBatch(batch = new ForecastBatch()) {
  if (process.env.FORECAST_BATCH_ENABLED !== 'true') return null;
  const cron = process.env.FORECAST_BATCH_CRON || '0 2 * * *';   // 02:00 UTC nightly
  setTimeout(() => batch.run().catch(...), Number(process.env.FORECAST_BATCH_BOOT_DELAY_MS || 15000));
  return cron.schedule(cron, () => batch.run().catch(...));
}
```

`server.js` calls `startForecastBatch()` on boot, next to `startFareCollector()`. The
boot-delay run means a fresh deploy repopulates the cache without waiting for 02:00.

**Render free-tier caveat (call this out in the job's header comment).** A nightly cron only
fires while the process is **awake**. Render spins the web service down after ~15 min idle
and the timer dies with it — exactly the constraint documented for `COLLECTOR_CRON`. This
job is subject to the same precondition: it is only reliable with `KEEPALIVE_ENABLED=true`
**and** an external pinger on `/api/health`. The boot-delay run is the partial mitigation —
every wake repopulates.

### 3.6 Logging

One summary line per run, in the collector's style:
`[forecastBatch] Run done: 8 written (3 BUY, 2 WAIT, 3 null), 2 skipped (no observation) of 10 routes`.

---

## 4. Read path — `/api/flights` and staleness

Guarded by its own flag, **independent** of the writer (so the batch can populate before
reads flip on — the same independence pattern as `ESTIMATES_USE_REAL_PROVIDER` vs
`FLI_ENABLED`).

At server.js:669, before the live call:

```js
let forecast = null;
if (process.env.FORECAST_CACHE_READ_ENABLED === 'true') {
  forecast = await forecastCache.get(route, currency, currentRoundtripPrice, {
    staleHours: Number(process.env.FORECAST_STALE_HOURS || 26),
    driftTolerance: Number(process.env.FORECAST_PRICE_DRIFT_TOLERANCE || 0.08)
  });
}
if (!forecast) {
  forecast = await forecastService.forecastRoute(origin, destination, currentRoundtripPrice, FARE_CURRENCY);
}
```

`forecastCache.get` returns the cached `payload` **only if all** hold, else `null`:

1. **Row exists** for `(route, currency)`.
2. **Time-fresh**: `now - computed_at ≤ staleHours`. Default **26h** so a 02:00 nightly run
   always leaves a <26h row before the next; a longer gap means the batch didn't run
   (asleep) and live compute is the honest fallback.
3. **Price still relevant**: `computed_current_price` is present and
   `|livePrice - computed_current_price| / computed_current_price ≤ driftTolerance`
   (default **0.08**). The cached verdict was computed against the last observed fare; if the
   user's live fare has drifted more than the tolerance, the BUY/WAIT could have flipped, so
   we recompute live rather than serve a price-stale verdict. **This gate is the trust
   guardrail — do not remove it.**

Any miss / staleness / drift / read error → fall through to the existing live
`forecastRoute`. The response must **never** fail because of the cache.

**Discovery / estimates is out of scope for the read path.** That path uses
`fareHistory.statsForRoutes`, not `forecastRoute`, so it gains nothing here. A verdict chip
on the discovery cards sourced from `forecast_cache` is a clean follow-up, not part of this
build.

---

## 5. Environment variables (`.env.example`, house style)

Add a `--- P1: Nightly Batch Forecast ---` block:

```bash
# --- P1: Nightly Batch Forecast + forecast_cache ---
#
# Precomputes BUY/WAIT verdicts for the featured routes off the request path, so
# /api/flights does not run forecastService (and, once HF_ENDPOINT_URL is set, a 4s HF call)
# inside the user's request. Writer and reader are separate flags on purpose: populate the
# cache first, confirm the rows, THEN turn reads on.
#
# Create the table first: supabase/forecast_cache.sql. Requires SUPABASE_SERVICE_KEY.
#
# LIKE THE COLLECTOR, this nightly cron only fires while the process is awake. Render's free
# tier spins down after ~15 min idle; this job is only reliable with KEEPALIVE_ENABLED=true
# AND an external pinger on /api/health. The boot-delay run repopulates on every wake.
FORECAST_BATCH_ENABLED=false
FORECAST_BATCH_CRON=0 2 * * *
FORECAST_BATCH_BOOT_DELAY_MS=15000
FORECAST_BATCH_MAX_TASKS=0

# Route universe. Unset, these fall back to the collector's list, then VITE_FEATURED_HUBS —
# forecasting the same routes the collector observes, so every batched route has history.
FORECAST_BATCH_HOME_AIRPORTS=
FORECAST_BATCH_DESTINATIONS=

# Read path. Independent of the writer above. Leave false until the table has rows.
FORECAST_CACHE_READ_ENABLED=false
#
# A cached verdict older than this (hours) is treated as stale and recomputed live. Default
# 26h keeps a nightly 02:00 run always fresh; a longer gap means the batch didn't run.
FORECAST_STALE_HOURS=26
#
# The cached verdict was computed against the last OBSERVED fare. If the user's LIVE fare has
# drifted more than this fraction from it, the BUY/WAIT could have flipped, so it is
# recomputed live instead of served. This is the trust guardrail. Default 0.08 (8%).
FORECAST_PRICE_DRIFT_TOLERANCE=0.08
```

---

## 6. Acceptance criteria

1. `supabase/forecast_cache.sql` creates `public.forecast_cache` with primary key
   `(route, currency)`, the `computed_at` index, and RLS enabled with no policy.
2. `startForecastBatch()` returns `null` and schedules no cron when `FORECAST_BATCH_ENABLED`
   is unset or `!= 'true'`.
3. With `FORECAST_BATCH_ENABLED=true`, a cron is scheduled on `FORECAST_BATCH_CRON` and an
   initial run fires after `FORECAST_BATCH_BOOT_DELAY_MS`.
4. The batch iterates `home × destination` from the P1 env vars (with collector /
   `VITE_FEATURED_HUBS` fallbacks), skipping `origin === destination`.
5. For a route with ≥1 observation, the batch reads the latest observed price, calls
   `forecastRoute` with it, and upserts exactly one row whose `payload` deep-equals the
   `forecastRoute` return object and whose lifted columns (`verdict`, `reason`,
   `confidence_score`, `computed_current_price`, `sample_size`, `distinct_days`, `provider`,
   `computed_at`) match it.
6. For a route with no observation, the batch writes nothing, logs a skip, and continues.
7. The batch does not write when `forecastRoute` returns
   `reason ∈ { error, database_error, no_database }`.
8. Two consecutive runs leave exactly one row per `(route, currency)` (upsert, not append).
9. With `FORECAST_CACHE_READ_ENABLED != 'true'`, `/api/flights` always calls live
   `forecastRoute` (behaviour unchanged).
10. With reads enabled, a fresh row (within `FORECAST_STALE_HOURS`) whose
    `computed_current_price` is within `FORECAST_PRICE_DRIFT_TOLERANCE` of the live price is
    served from `payload` **without** `forecastRoute` being invoked.
11. `/api/flights` falls back to live `forecastRoute` when any of: no row, `computed_at`
    older than `FORECAST_STALE_HOURS`, price drift exceeds tolerance, or the cache read
    errors.
12. A `forecast_cache` read error never fails `/api/flights` — the response is still `200`
    with a `forecast`.
13. Each batch run logs one summary line: routes processed, verdicts written (by
    BUY/WAIT/null), and skips.

---

## 7. Test plan (Vitest)

Reuse the Supabase builder stub from `forecastTiering.test.js` (extend it with `.insert` /
`.upsert` / `.order().limit()` seams and an `onConflict` no-op). Server-job tests live under
`src/utils/__tests__/` per existing convention (`fareCollector.test.js`,
`alertEvaluator.test.js`).

- **`src/utils/__tests__/forecastBatch.test.js`**
  - *scheduling gate* — AC 2, 3 (mirror `startFareCollector` tests).
  - *route iteration & current-price selection* — AC 4, 5: latest observation is chosen and
    passed as `currentPrice`; provider lock respected.
  - *write / skip rules* — AC 6, 7: no-observation skip; transient-reason no-write; null-tier
    IS written.
  - *upsert idempotency* — AC 8.
  - *run summary logging* — AC 13.
- **`src/utils/__tests__/forecastCache.test.js`** (the `ForecastCache` service)
  - *freshness gate* — serves within `staleHours`, returns `null` beyond it (AC 10, 11).
  - *price-drift gate* — serves within tolerance, `null` beyond (AC 10, 11); the trust
    guardrail gets its own named test.
  - *fallback on miss / read error* — returns `null`, never throws (AC 11, 12).
  - *put shape* — `payload` round-trips and lifted columns are populated (AC 5).
- **Read-path wiring** — a focused test that with reads enabled + a hit, `forecastRoute` is
  not called, and with a miss it is (AC 9, 10, 11). Extract the guard into the
  `forecastCache.get` seam so this needs no live Express.

`npm test` + `npm run lint` + `npm run build` all green is the definition of done.

---

## 8. Rollout

- **Both flags default `false`.** Shipping the code changes nothing until Roy enables it.
- **PR, not a self-merge.** This touches the verdict-serving path and the forecast engine's
  neighbourhood — both on the `ship-change` stop-list. `feature-dev` opens the PR and stops;
  Roy reviews and merges. (The batch reuses `forecastRoute` unmodified, which keeps the diff
  off the engine's core math, but the read-path change still gates on Roy.)
- **Live verification sequence** (post-merge, on Render):
  1. Confirm `SUPABASE_SERVICE_KEY` is set; run `supabase/forecast_cache.sql` in the SQL
     editor.
  2. Set `FORECAST_BATCH_ENABLED=true` (keep reads off). Confirm the boot-delay run logs its
     summary line; inspect `forecast_cache` in Supabase for one row per featured route.
  3. Confirm `KEEPALIVE_ENABLED=true` and an external `/api/health` pinger exist — otherwise
     the nightly cron won't fire.
  4. Set `FORECAST_CACHE_READ_ENABLED=true`. Search a featured route in the live app; confirm
     `/api/flights` logs a cache hit and the forecast still renders, then confirm a
     non-featured route still returns a live forecast.
- A merge is a production deploy: not done until `deploy.yml` is green and the change is
  confirmed at https://roydekel.github.io/kairo/.

---

## 9. Explicitly out of scope

- **Standing up the Chronos-2 HF endpoint** — that is **P2**. This feature only makes the
  endpoint *usable* by moving its call off the request path; it does not provision it. When
  `HF_ENDPOINT_URL` is set, the batch picks it up with no further code change.
- **The events-covariate loop** (feeding fixture/concert demand into the forecast) — **P3**.
- **LLM verdict narrative** — **P4**.
- **Discovery / "When to Go" verdict chips** from `forecast_cache` — a clean follow-up; the
  discovery path uses `statsForRoutes`, not `forecastRoute`, and gains nothing here.
- **Splitting the verdict into cached-model + live-price-recompute** — the drift gate is the
  MVP's bounded approximation. Exact per-request recomputation of `pricePercentile` /
  recommendation against the live price (without re-reading history) is a later refinement;
  it would require care not to create a second source of truth for the decision rule.
- **A dedicated staleness/backfill sweep** — the `computed_at` index and the commented
  housekeeping `delete` are provided; an automated purge cron is not built.

---

## Risks / open questions

- **Price-staleness is the real risk, and it is bounded, not eliminated.** Within an 8% band
  a tight-distribution route's percentile could still flip. The gate keeps the error small
  and, when it's large, forces a live recompute. If post-launch we see cache-served verdicts
  disagreeing with live, tighten `FORECAST_PRICE_DRIFT_TOLERANCE` before adding complexity.
- **The nightly cron depends on the process being awake** — the same fragility as the
  collector. If Render sleeps through 02:00, the read path falls back to live compute
  (correct, just slower). The boot-delay run is the mitigation; monitor the batch summary
  line to confirm it's actually running.
- **Provider switch**: if `FORECAST_PROVIDER` changes, the next batch overwrites each row.
  Between the switch and the next run, a served verdict reflects the old provider. Acceptable
  within one staleness window; noted for awareness.
- **Success metric to instrument at launch**: p95 `/api/flights` latency for featured routes
  (target: measurable drop once reads are on, and no 4s tail once HF is enabled), plus
  cache-hit rate on featured routes (target ≥80% of featured-route searches served from
  cache). No metric, no claim that it worked.
```