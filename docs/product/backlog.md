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

## [KAI-004] Fix the `forecast_cache` price-drift gate (root cause of the ~8% hit rate)
**Status**: shipped (PR #15, merged 2026-08-22) — drift gate dropped, replaced with a 5x
data-integrity sanity bound; `insightsEngine.test.js` added pinning the live-recompute
invariant the fix's safety case depends on. Re-measured 2026-09-05 (see Risks / open
questions): 78.6% hit rate, just under the ≥80% target — fix confirmed working, target not
formally hit yet on the available sample.
**Spec**: full spec at `docs/product/specs/kai-004-forecast-cache-drift-gate-fix.md` — that
file is the build contract; this entry is the backlog pointer.
**User**: every KAIRO user who searches a featured-hub route — today they pay the full
per-request forecast-compute cost (~1,000-row read, daily-index rebuild) on ~92% of searches
because a cache built to protect them turns out to be protecting against a risk that doesn't
reach them.
**Problem**: the 2026-08-22 hit-rate measurement (recorded under KAI-002 above) found 4 cache
hits vs. 45 drift-gated misses. Tracing what the price-drift gate (`FORECAST_PRICE_DRIFT_
TOLERANCE=0.08`, "the trust guardrail", `decisions.md` 2026-08-09) actually protects showed it
is redundant: `server.js` never sends the raw cached `forecast` object to the client — it only
ever feeds `computeEventDrivenInsights` (`server/services/insightsEngine.js`), which **already
recomputes `recommendation`, `pricePercentile`, and `expectedSavings` from the live per-flight
price** whenever `forecast.prices` is present (i.e. on every cached tier that isn't the
early-returned insufficient-history one). The only fields that pass through the cache
unrecomputed — `confidenceScore`, `low90Day`/`high90Day`/`avg90Day`, `sampleSize`,
`priceHistory` — are properties of the 90-day window and the model's own uncertainty band,
not of the specific price the cache was computed against. The gate has been rejecting reads
to prevent a failure mode that was already prevented one layer downstream, at the cost of
defeating P1's purpose on exactly the routes (like `TLV-KRK`, 5.5x seasonal spread) it fires
hardest on.
**Why now**: it's the direct, root-caused follow-up to the measurement just taken — the
diagnosis and fix are fresh in context, and every day this sits open is more request-path
forecast compute than P1 was built to eliminate.
**Solution**: drop the price-point drift comparison from `ForecastCache.get()`; gate on
`staleHours` only (the genuinely time-sensitive part). Replace it with a much looser
data-integrity sanity check (default 5x, not 8%) that catches a genuinely corrupt/mismatched
row rather than normal seasonal spread. Add the regression test that doesn't exist yet
(`insightsEngine.test.js`) locking in the recompute invariant this fix's safety argument
depends on. Full detail in the spec.
**Acceptance criteria**: the 6 numbered criteria in the spec (§4). Headline checks:
- [x] `ForecastCache.get()` no longer rejects a fresh row on an 8%-scale price difference.
- [x] A genuinely bad row (live price 20x cached) is still rejected by the new sanity check.
- [x] `insightsEngine.test.js` exists, proving `recommendation`/`pricePercentile`/
      `expectedSavings` are always derived from the live price, never the cached object's own.
- [x] Staleness gating (`FORECAST_STALE_HOURS`) behavior is unchanged (regression, not new).
**Success metric**: re-measured `forecast_cache` hit rate on featured routes, same method as
the 2026-08-22 measurement (Render logs, `Forecast cache hit` vs `forecastCache MISS`).
Target: the KAI-002/P1 spec's original ≥80%, with remaining misses being staleness or
genuine sanity-check rejections, not drift.
**Cost**: net reduction — fewer live `forecastRoute` calls means fewer ~1,000-row Supabase
reads on the request path. No new external API calls.
**Out of scope**: `forecastBatch.js`'s "latest observation" price-selection logic (still the
right zero-cost stand-in per the 2026-08-09 decision — this fix makes its imprecision
harmless rather than replacing it), any change to `forecastService.js`'s tiering/engine math,
any change to `insightsEngine.js`'s existing recompute logic (only adding test coverage for
it, not modifying it), the events covariate (P3), the LLM narrative (P4).
**Risks / open questions**:
- **The 5x sanity default is a starting guess**, same as the original 8% was. Tune from
  measured data post-ship rather than assuming it's right.
- **This makes `insightsEngine.js`'s live-recompute behavior load-bearing** in a way nothing
  previously enforced — which is exactly why `insightsEngine.test.js` is an acceptance
  criterion, not optional follow-up. A future change that stops recomputing
  `recommendation` live from the real price would silently reopen the confidently-wrong-
  verdict risk this whole fix's safety case rests on not existing.
- **Touches `forecastCache.js` — "any cache in `server/services/`" on the `ship-change`
  stop-list. Ships as a PR for Roy, not an agent self-merge.**
- **MEASURED (2026-09-05) — 78.6% hit rate (11 hits / 3 misses = 14 reads), Render logs
  2026-08-23 through 2026-09-05 (`flight-tracker-backend`, via the Render MCP connector),
  `[api/flights] Forecast cache hit` vs `[forecastCache] MISS`.** Up from the pre-fix 8%
  (4/49) measured 2026-08-22 — the fix is working — but just under the ≥80% target, and every
  one of the 14 events, hits and misses alike, is on `TLV-KRK`; no other featured route shows
  any traffic in the window, so this is a one-route sample, not a featured-route-wide
  measurement. 0 misses were `stale`, 0 were `no cached row`, 0 read errors — **all 3 misses
  are `sanity`** (the new 5x data-integrity bound working as designed), e.g.
  `MISS TLV-KRK/USD: sanity 11.43x outside 5x (live 2229 vs cached 195)`.
  **This is the same root cause KAI-002's open question already named, still unfixed**: the
  nightly batch's "latest observation" price-selection (`forecastBatch.js`) has no
  departure-date awareness, so it can cache a far-future cheap fare against a near-term
  expensive search. KAI-004 widened the tolerance so normal seasonality stops false-
  positiving, but a genuine departure-date mismatch this large (11.4x) still trips the sanity
  bound correctly — it's supposed to. Fixing *that* means one of the three options logged
  under KAI-002 below (per-departure-date-bucket selection, keying the cache by
  `(route, currency, horizon_bucket)`, or the closest-to-a-canonical-horizon stopgap), not
  another tolerance tweak.
  **Before calling the ≥80% target formally met or missed, get traffic on more than one
  featured route** — the current sample can't distinguish "the fix works, target basically
  met" from "the fix works on the one route we happened to observe."

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
- **MEASURED (2026-08-22) — real cache-hit rate is ~8%, far below the ≥80% target, and the
  cause is not staleness.** Render logs from 2026-08-19 through 2026-08-22 (`flight-tracker-
  backend`, via the Render MCP connector): 4 `[api/flights] Forecast cache hit` lines against
  45 `[forecastCache] MISS … drift` lines — **0 stale misses, all 45 were the price-drift
  gate**, and 38 of those 45 are the same route, `TLV-KRK`.
  **Root cause: the drift gate is comparing prices across *different departure dates*, not
  measuring real price movement over time.** `fare_observations` for `TLV-KRK` shows the
  collector writing rows for several departure dates per sweep — `2026-11-20` at ~$134,
  `2026-10-21` at ~$139, `2026-09-05` at ~$249, `2026-08-22`/`2026-09-21` at $565–$734 — a
  5.5x spread that is entirely normal seasonality, not volatility. The batch's "latest
  observation" stand-in (`decisions.md`, 2026-08-09) selects whichever row the collector
  happened to write *last* in a sweep, with no departure-date filter — so
  `computed_current_price` in `forecast_cache` can land on the $134 far-future row while a
  user is searching a $613 near-term date. An 8% tolerance can never absorb a same-route,
  different-date gap that large; the gate isn't wrong, the comparison itself is
  apples-to-oranges. Confirmed at
  `docs/product/specs/p1-nightly-batch-forecast.md` §3.2 — the batch's price selection has no
  departure-date awareness at all.
  **This changes the diagnosis from the 2026-08-09 entry above** (which read the same drift
  gate as correctly admitting real traffic, based on 4 hits and no visibility into the miss
  volume) — with the miss count now measured, drift dominates overwhelmingly, and the fix
  implied by "widen `FORECAST_PRICE_DRIFT_TOLERANCE`" would not help, since no tolerance
  short of ~500% absorbs a seasonal fare spread.
  **Not fixed. Options for whoever picks this up** (touches `forecastBatch.js` and/or
  `forecastCache.js` — on the `ship-change` stop-list, needs a PR): (a) have the batch select
  the latest observation **per departure-date bucket** closest to a canonical horizon (e.g.
  the collector's own horizon grid) instead of just the newest row regardless of date: (b)
  key `forecast_cache` rows by `(route, currency, horizon_bucket)` instead of just
  `(route, currency)`, so the cached verdict actually matches the date range being searched —
  a bigger schema change; (c) as a cheaper stopgap, have the batch pick the observation whose
  `departure_date` is closest to "today + a representative horizon" (e.g. 30 days out) rather
  than most-recently-written, which would at least make the mismatch bounded and typical
  rather than arbitrary.
  **Still not fixed as of the 2026-09-05 re-measurement (see KAI-004 above)**: the drift gate
  is gone, but a mismatch large enough (11.4x, TLV-KRK again) still trips KAI-004's 5x sanity
  bound and misses. Options (a)/(b)/(c) above are still the fix.

## [KAI-001] Remove the 11 setState-in-effect cascading renders
**Status**: shipped (2026-08-26) — all 13 sites fixed and merged (turned out to be 13, not 11;
two more had landed since this entry was written — see note below). Ten sites shipped as PRs
#16–#23, the auth cluster as PR #24, the last two as PRs #25–#26, the `eslint.config.js` flip
back to `error` as PR #27 — Roy did the manual-verification pass on all four journeys himself
before merging #27, since it's stop-list row 4. Live in prod.
**Note**: two extra sites appeared after this entry was written — `App.jsx:124` and
`AuthModal.jsx:22` — from the auth-confirmation-toast commit (`83bfe57`), landed after KAI-001
was scoped. Exactly the decay this item's "Why now" predicted from leaving the rule at `warn`.
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
- [x] `npx eslint .` reports 0 `react-hooks/set-state-in-effect` warnings.
- [x] `react-hooks/set-state-in-effect` is back to `error` in `eslint.config.js`, and the
      downgrade comment is deleted rather than edited. Shipped in PR #27.
- [x] `npm test` passes with no test modified to accommodate a render-count change (656 tests,
      +62 new across the item, zero modified).
- [x] Manually verified unchanged: outbound/return toggle, simulator run to completion,
      alert firing into the notification tray, and the "When to Go" → "Search & Compare"
      handoff that re-hydrates the search form. Done by Roy before merging PR #27.

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

## [KAI-005] Playwright e2e suite has been broken since 2026-07-29, silently
**Status**: shipped (2026-08-26). Part (a), PR #30: all three specs pass against current
`main`. Part (b), the e2e-in-CI decision: recorded in `decisions.md` (gate on every PR,
blocking) and implemented in PR #31 (`ci.yml` + `playwright.config.js`) — held for Roy per
the `ship-change` stop-list, reviewed and merged. A flake the new gate caught on its second
run (a layout-stability assertion checking sub-pixel precision the runner couldn't hold) was
fixed in PR #32. `ci.yml` now blocks every PR on `test:e2e`, live in prod.
**User**: whoever needs the e2e suite as evidence a change didn't break a real user flow —
currently nobody gets that, because nothing runs it and nothing tells them it's stale.
**Problem**: found incidentally while doing the manual-verification pass for [KAI-001]. All
three specs in `tests/passengerSelection.spec.js` fail on their first line, waiting for
`text=Find Flights` — that nav label was renamed to "Search & Compare" in commit `4050aa7`
(2026-07-29), four weeks before this was noticed. `ci.yml` runs `npm test` (unit/vitest) on
every PR but never `npm run test:e2e` — so there is no gate that would have caught the rename
breaking e2e, and none that catches the next one either.
**Why now**: not urgent on its own, but it's the reason KAI-001's "manually verified unchanged"
criterion couldn't be discharged by test suite and had to fall to a human pass instead — an e2e
suite nothing runs provides exactly zero regression protection while looking, from the file
tree, like it provides some.
**Solution**: (a) update the stale selector(s) — likely just the one, but worth auditing the
rest of `tests/` for other UI-copy drift since nothing has exercised them in a month; (b) make
an explicit, recorded decision on whether `test:e2e` joins `ci.yml` (tradeoff: e2e is slower
and more flake-prone than unit tests, but the alternative demonstrated here is silent, unbounded
drift) — even a decision to *not* gate on it should be a decision, not a default.
**Acceptance criteria**:
- [x] `npm run test:e2e` passes locally against current `main`. (3 passed; 9/9 under
      `--repeat-each=3`. `tests/` holds one spec file, so the audit for further UI-copy drift
      was that file — which had drifted three separate ways, not one: the nav label, the auth
      gate that now makes every workspace tab unreachable while signed out, and the passenger
      counters becoming `-`/`+` steppers rather than number inputs.)
- [x] A decision on e2e-in-CI is made and recorded in `docs/product/decisions.md`, whichever
      way it goes. (2026-08-26 — gate on every PR, blocking; nightly-schedule and
      non-blocking middle grounds considered and rejected in the entry.)
**Success metric**: e2e suite reflects the current UI and passes on demand; no more silent
multi-week drift between what e2e asserts and what the app actually shows.
**Cost**: none — test-only change, no new external calls, no cache behaviour change.
**Out of scope**: writing new e2e coverage beyond fixing what's currently broken.
**Risks / open questions**:
- Resolved: the drift audit found and fixed all three (nav label, auth gate, passenger
  steppers) — `tests/` held only the one spec file, so the audit was complete, not partial.
- **Noted during rollout, not a KAI-005 blocker**: GitHub webhook delivery to this repo ran
  30–45 minutes behind while PRs #30/#31/#32 were shipping (`gh pr checks` showed no checks at
  merge time even though they'd passed). Each merge was verified against the correct commit
  SHA via `workflow_dispatch` rather than merged blind. Appears to have cleared on its own;
  worth a glance if a future PR's checks look stuck as "no checks reported."
