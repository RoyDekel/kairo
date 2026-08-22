# KAIRO Backlog

> Maintained by the `product-manager` agent. Ranked — top of the file is next.
> Items are the input contract for the `feature-dev` agent.

## Item template

```markdown
## [KAI-000] Title
**Status**: proposed | approved | in progress | shipped | rejected
**User**: who, specifically, and what they're trying to do
**Problem**: what's broken or missing today, and the evidence
**Why now**: why this over the other things in the backlog
**Solution**: what we're building, in behaviour terms not implementation terms
**Acceptance criteria**:
- [ ] observable, testable statements
**Success metric**: the one number that moves, and by how much
**Cost**: additional external API calls per user action; cache implications
**Out of scope**: what this explicitly does not include
**Risks / open questions**:
```

---

## [KAI-003] P2 — Wire the live Chronos-2 HF endpoint into Render + verify
**Status**: shipped (2026-08-22, config-only — no PR, nothing merged to `main`; verified live
in prod). All `forecast_cache` rows confirmed carrying `reason = huggingface_chronos_forecast`.
**Spec**: full spec at `docs/product/specs/p2-hf-endpoint-rollout.md` — that file is the
verification contract; this entry is the backlog pointer.
**User**: every KAIRO user who gets a Tier 3 forecast on a featured route — they currently
get `seasonal_naive_forecast`; this makes it `huggingface_chronos_forecast` with a real
quantile-based confidence score instead of the seasonal engine's own residual estimate.
**Problem**: the code side of P2 already shipped — `forecastService.js` calls
`HF_ENDPOINT_URL` when set (Phase 0/1, commit `f47e26f`), the nightly batch picks it up with
no further change (P1, KAI-002), and `FORECAST_LIVE_HF_ENABLED` gates the request-path call
(PR #11). A Dedicated Inference Endpoint for `roydekel/chronos-2-kairo` (custom `handler.py`
matching the exact request/response contract `forecastService.js` parses) is already running
on the HF side. **Nothing left to build — this is wiring the two together and verifying it,
in Render.**
**Why now**: the cost blocker that kept P2 in "Later" is resolved (decisions.md, 2026-08-22).
Every day this sits unwired is a day the endpoint bills per-hour with zero KAIRO traffic
using it.
**Solution**: set `HF_ENDPOINT_URL` + `HF_API_KEY` in Render's environment, confirm the
nightly batch resolves routes with `reason: huggingface_chronos_forecast` instead of
`seasonal_naive_forecast`, and make an explicit call on `FORECAST_LIVE_HF_ENABLED` now that
per-hour cost is real money rather than a hypothetical.
**Acceptance criteria**: see the 6 numbered criteria in the spec (§3). Headline checks:
- [x] Manual smoke call against the endpoint (2026-08-22) returned HTTP 200 in 751ms with
      `{ "quantiles": { "0.1": [...7], "0.5": [...7], "0.9": [...7] } }` — matches
      `handler.py`'s contract exactly. **Open question this raised**: 751ms is fast for a
      cold CPU start of a 120M-param model — the endpoint may already be configured
      always-on rather than scale-to-zero. Confirm in the HF dashboard before setting
      `FORECAST_LIVE_HF_ENABLED` (see spec §2.3).
- [x] Render has `HF_ENDPOINT_URL` and `HF_API_KEY` set.
- [x] Verified in Supabase (2026-08-22): **every** `forecast_cache` row carries
      `reason = 'huggingface_chronos_forecast'` — the seasonal-naive fallback is not firing
      on any currently-cached featured route.
- [x] `FORECAST_LIVE_HF_ENABLED=false` set in Render, deliberately — the endpoint is
      confirmed scale-to-zero. Reasoning recorded in decisions.md, 2026-08-22.
**Success metric**: fraction of Tier-3 `forecast_cache` rows with
`reason = huggingface_chronos_forecast` vs. `seasonal_naive_forecast` (target: all featured
routes with ≥30 observations, i.e. the seasonal-naive fallback should stop firing except on
a genuine HF call failure).
**Cost**: the endpoint itself is external, pre-approved spend (decisions.md, 2026-08-22) — no
new metered call added by this item. Confirms whether the live path (`FORECAST_LIVE_HF_ENABLED`)
adds request-triggered cost on top of the nightly batch's roughly-one-call-per-route-per-day.
**Out of scope**: the events covariate (P3), the LLM narrative (P4), any change to
`forecastRoute`'s engine math or the HF request/response contract, fine-tuning Chronos-2 on
KAIRO's own data.
**Risks / open questions**:
- **A wrong response shape silently falls back to seasonal-naive** (`forecastService.js`
  rejects a response with no usable quantiles rather than erroring) — the failure mode is
  quiet, not loud. The smoke-test criterion above exists specifically to catch a
  `handler.py`/endpoint mismatch before relying on the nightly batch to surface it days later.
- **Scale-to-zero cold start vs. request-path timeout**: the live path's `AbortController`
  cuts an HF call off at 4s (`forecastService.js:329`). If the endpoint is configured
  scale-to-zero rather than always-on, the *first* live request after idle will still time out
  and fall back — confirm the endpoint's scaling config matches the cost/latency tradeoff
  decided in decisions.md before enabling `FORECAST_LIVE_HF_ENABLED=true`.
- **Touches HF credentials and the live forecast path — ships as config change reviewed by
  Roy, not an agent self-merge**, per the same stop-list logic as KAI-002.

## [KAI-002] P1 — Nightly batch forecast + `forecast_cache` table
**Status**: shipped (PR #7, live 2026-08-09; both flags enabled in prod) — **cache confirmed
serving hits in prod**; remaining work is measuring the real hit rate, see the last open question.
**Spec**: full spec at `docs/product/specs/p1-nightly-batch-forecast.md` — that file is the
build contract; this entry is the backlog pointer.
**User**: every KAIRO user who searches a featured-hub route and waits on the "Should I
Book?" verdict — and, second, whoever eventually turns on the Chronos endpoint, who today
cannot because a live HF call times out on the request path.
**Problem**: `forecastService.forecastRoute` runs inside the `/api/flights` request
(server.js:669) — a ~1,000-row read, a daily-index rebuild, and (once `HF_ENDPOINT_URL` is
set) a 4s-timeout Chronos call. On Render's free tier a scale-to-zero HF endpoint
cold-starts slower than 4s, so live calls abort into seasonal-naive on nearly every request.
Precompute is the prerequisite that makes the endpoint usable at all.
**Why now**: it is the gate for the entire forecasting arc — P2 (Chronos), P3 (events
covariate) and P4 (LLM narrative) all sit behind it (see `roadmap.md`). It also pays off
immediately on the current seasonal-naive engine by taking forecast compute off the request
path, so it is not blocked on any external spend.
**Solution**: a nightly `node-cron` job (mirroring `fareCollector`) precomputes verdicts for
the featured routes and upserts them into a Supabase `forecast_cache` table; `/api/flights`
serves the cached verdict when it is time-fresh and still price-relevant, else falls back to
live compute. Writer and reader gated by independent flags, both default off.
**Acceptance criteria**: the 13 numbered criteria in the spec (§6). Headline checks:
- [ ] `supabase/forecast_cache.sql` — PK `(route, currency)`, RLS enabled, no policy.
- [ ] Batch upserts one row per featured route using the latest observation as `currentPrice`;
      writes null-verdict tiers, skips no-observation routes, does not cache transient errors.
- [ ] Read path serves a fresh, price-relevant cached verdict without calling `forecastRoute`,
      and falls back to live on miss / staleness / drift / read error — never failing the response.
**Success metric**: p95 `/api/flights` latency on featured routes (measurable drop once reads
are on; no 4s tail once HF is enabled) + featured-route cache-hit rate (target ≥80%).
**Cost**: net **reduction** in per-request cost — no live provider call added; batch reads the
latest `fare_observations` row rather than issuing a fresh quote. One nightly write per
featured route. Requires `SUPABASE_SERVICE_KEY`.
**Out of scope**: standing up the Chronos endpoint (P2), the events covariate (P3), the LLM
narrative (P4), discovery verdict chips, an automated purge cron.
**Risks / open questions**:
- **Price-staleness is the real risk, bounded by the read-path drift gate** (default 8%). See
  decisions.md, 2026-08-09.
- The nightly cron only fires while the process is awake — same Render free-tier fragility as
  the collector; requires `KEEPALIVE_ENABLED` + an external pinger. Read path falls back to
  live compute if the batch sleeps through its slot.
- **Touches the verdict-serving path — on the `ship-change` stop-list. Ships as a PR for Roy,
  not an agent self-merge.**
- **OPEN — measure the real cache-hit rate (post-launch).** RESOLVED that the cache works:
  prod logs on 2026-08-09 show repeated `[api/flights] Forecast cache hit` on `TLV→KRK` and
  `TLV→CDG`, each skipping live compute. The earlier "never hits" symptom was deploy/warm-up
  timing, not the drift gate — those searches passed the 8% gate, so the guardrail is admitting
  real traffic rather than blocking it. The earlier drift-heavy hypothesis was too pessimistic
  for the routes users actually search. **Remaining work is measurement, not a fix**: over a
  representative window, compare `cache hit` lines against `[forecastCache] MISS … drift` /
  `… stale` lines (miss-reason logging shipped in PR #8) to establish the true hit rate against
  the ≥80% target. `FORECAST_PRICE_DRIFT_TOLERANCE` stays at 8% unless drift-misses turn out to
  dominate on off-sample dates — only then consider (a) widening it, or (b) also serving the
  discovery/estimates path, where route-level prices sit closer to the sampled fare and the hit
  rate would be structurally higher.

## [KAI-001] Remove the 11 setState-in-effect cascading renders
**Status**: proposed
**User**: every KAIRO user, on the two screens they spend the most time on — the search
results list and the "Should I Book?" dashboard. Also the next engineer to touch App.jsx.
**Problem**: 11 call sites call `setState` synchronously inside a `useEffect` body. Each one
makes React render, run the effect, set state, and render again — a second full render pass
that produced nothing new. React's own `react-hooks/set-state-in-effect` rule flags all 11.
The sites, from `npx eslint .`:

| File | Line | What it re-renders for |
|---|---|---|
| `src/App.jsx` | 423 | syncs `activeFlight`/`selectedDate` to the outbound-vs-return toggle |
| `src/App.jsx` | 450 | resets the simulator when the route changes |
| `src/App.jsx` | 460 | clears live telemetry when simulation stops |
| `src/App.jsx` | 520 | flips `isSimulating` off when progress hits 1 |
| `src/App.jsx` | 543 | pushes a notification when an alert fires |
| `src/components/AlternativeFlights.jsx` | 170 | resets pagination to page 1 on filter/sort change |
| `src/components/AlternativeFlights.jsx` | 178 | re-hydrates 10 local form fields from `searchParams` |
| `src/components/AlertsManager.jsx` | 87 | swaps the channel target between Telegram and email |
| `src/components/AirportAutocomplete.jsx` | 14 | rewrites the input label on blur |
| `src/components/CustomDatePicker.jsx` | 50 | moves the visible month to match the selected date |
| `src/contexts/AuthProvider.jsx` | 22 | clears `loading` when Supabase is unconfigured |

**Why now**: it is the last thing standing between this repo and a lint gate that can stay at
`error`. It was downgraded to `warn` on 2026-08-08 to unblock CI (see decisions.md), and a
warn-level rule decays — new instances will land unnoticed. Two of these sites are also the
most expensive components in the app: `AlternativeFlights.jsx` re-renders a full results
list, and `App.jsx` re-renders the Leaflet map and the Chart.js canvas beneath it. A wasted
pass there is a visible frame drop on a mid-range phone, which is most of the traffic.

**Solution**: eliminate the double render at each site, using whichever of these fits:
- Derive during render instead of storing (the pagination reset, the autocomplete label).
- Key the component on the identity that should reset it, so React remounts instead of the
  effect resetting state by hand (the simulator reset, the form re-hydration).
- Move the call into the event handler that actually caused it (the channel swap, the
  notification push).
- Compute the initial value in the `useState` initialiser (the Supabase `loading` flag).

**Acceptance criteria**:
- [ ] `npx eslint .` reports 0 `react-hooks/set-state-in-effect` warnings.
- [ ] `react-hooks/set-state-in-effect` is back to `error` in `eslint.config.js`, and the
      downgrade comment is deleted rather than edited.
- [ ] `npm test` passes with no test modified to accommodate a render-count change.
- [ ] Manually verified unchanged: outbound/return toggle, simulator run to completion,
      alert firing into the notification tray, and the "When to Go" → "Search & Compare"
      handoff that re-hydrates the search form.

**Success metric**: renders per interaction on the search results list, measured with the
React DevTools profiler. Target: no interaction triggers two committed renders where one
would do. Secondary: 11 → 0 warnings.

**Cost**: none. No new external API calls, no cache behaviour change — this is render-path
only and touches no provider, quote cache or budget code.

**Out of scope**: the 6 pre-existing `react-hooks/exhaustive-deps` warnings. Related, and
some of the fixes here will touch the same effects, but they are a separate correctness
question and bundling them would make a regression untraceable.

**Risks / open questions**:
- **Do these one at a time, not as a sweep.** Each site needs a different fix, and the
  failure mode is subtle: a component that resets when it shouldn't, or stops resetting when
  it should. A single PR changing all 11 has no safe bisect.
- `App.jsx:543` pushes a notification from an effect. Moving it to an event handler needs
  care — the alert-evaluation path is the trigger, and it must not fire twice under React
  StrictMode's double-invoked effects.
- `AlternativeFlights.jsx:178` re-hydrates a *draft* form. The comment above it explains
  that local edits are intentionally uncommitted until Search is pressed. Any fix must keep
  that property, which rules out simply deriving the fields from `searchParams`.
- `AuthProvider.jsx:22` is auth code and sits on the `ship-change` stop-list. That one site
  needs Roy's review even if the other ten are agent-merged.
