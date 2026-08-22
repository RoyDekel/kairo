# KAI-004 — Fix the `forecast_cache` price-drift gate (root cause of the ~8% hit rate)

**Status**: proposed (ships as a PR for Roy — see Rollout)
**Owner**: product-manager → feature-dev
**Depends on**: KAI-002 (shipped), the 2026-08-22 hit-rate measurement in `backlog.md`
**Blocks**: nothing on the forecasting arc, but the ≥80% cache-hit-rate success metric in
`specs/p1-nightly-batch-forecast.md` §8 stays unmet until this ships

---

## 1. What was measured, and what it actually means

`backlog.md` [KAI-002] recorded the finding: 4 cache hits vs. 45 drift-gated misses in Render
logs (2026-08-19 → 2026-08-22), 38 of the 45 on `TLV-KRK`. The batch's `computed_current_price`
for a route can land on whatever departure date the collector happened to observe last in a
sweep — for `TLV-KRK` that ranged $134 (Nov) to $734 (Sep), a 5.5x seasonal spread that has
nothing to do with price *volatility*. The `FORECAST_PRICE_DRIFT_TOLERANCE=0.08` gate
(`forecastCache.js`, "the trust guardrail" per `decisions.md`, 2026-08-09) rejects nearly
every one of those as unsafe to serve.

**That diagnosis was one layer too shallow.** Tracing what the gate is actually protecting —
by reading `server.js:684-725` and `server/services/insightsEngine.js` end to end — shows the
guardrail is defending a value the user never sees unprotected:

- `server.js` never sends the raw `forecast` object to the client. It is only ever passed as
  an input to `computeEventDrivenInsights(flight, request, events, { forecast, comparisonPrice })`
  (lines 711 and 723), once per flight card, with `comparisonPrice` set to **that flight's own
  live price** (line 708/720: `cheapestReturnPrice + flight.price` etc.). The JSON response
  (`server.js:777-799`) contains `outbound`/`return` (each with `.insights`) — no top-level
  `forecast` field at all.
- Inside `insightsEngine.js`, whenever `forecast.prices` is present (true for every cached
  tier except the early-returned `insufficient_history` one) — **`pricePercentile`,
  `recommendation`, and `expectedSavings` are all recomputed from `comparisonPriceToUse` (the
  live per-flight price), not from the cached object's own stale fields**:
  ```js
  // insightsEngine.js:59-61
  const pricePercentile = forecast
    ? (forecast.prices ? percentileOf(comparisonPriceToUse, forecast.prices) : forecast.pricePercentile)
    : ...
  // insightsEngine.js:70-72
  if (forecast && forecast.prices) {
    const isCheaperThanForecast = comparisonPriceToUse <= (forecast.forecastMedian || avg90Day);
    recommendation = (pricePercentile <= 25 || isCheaperThanForecast) ? 'BUY_NOW' : 'WAIT';
  }
  // insightsEngine.js:98-100
  const expectedSavings = forecast
    ? Math.max(15, Math.round(comparisonPriceToUse - Math.min(forecast.forecastMedian || avg90Day, low90Day)))
    : ...
  ```
  The only cached fields that pass through **unrecomputed** are `confidenceScore`,
  `sampleSize`, `priceHistory`, and `low90Day`/`high90Day`/`avg90Day` — all of which are
  properties of the **90-day historical distribution and the model's own uncertainty band**,
  not of the specific price the cache happened to be computed against. `confidenceScore`
  specifically (`forecastService.js:389`, `95 - cv * 30` where `cv` is the forecast interval's
  own spread) is a pure function of the Chronos quantile spread — it does not take
  `currentPrice` as an input at all.

**Conclusion: the price-drift gate is solving a problem `insightsEngine.js` already solves
one layer downstream.** It was added (2026-08-09) as "the trust guardrail" against a
confidently-wrong verdict reaching the user from a stale price — a real risk in principle,
but the recommendation the user actually sees was, even then, already being recomputed live.
The gate has been rejecting ~92% of cache reads to protect against something that isn't the
actual failure mode, at the cost of defeating P1's entire purpose (moving forecast compute off
the request path) for the routes it fires on hardest.

---

## 2. The fix

### 2.1 Decision: drop the price-point comparison; gate on time-freshness only

`ForecastCache.get()` (`server/services/forecastCache.js`) currently gates on two independent
checks: `staleHours` (time) and `driftTolerance` (price-point match against
`computed_current_price`). **Remove the price-drift check.** Time-freshness alone is the
correct gate, because the fields that genuinely age are 90-day-window statistics
(`low90Day`/`high90Day`/`avg90Day`, the Chronos quantile forecast itself) — properties of
*when* the model was last computed, not of what price triggered the computation. The
price-sensitive decision (`recommendation`, `pricePercentile`, `expectedSavings`) is already
safe on any cache row regardless of price, because `insightsEngine.js` never trusts the
cached value for those fields — it always recomputes them against the live price at request
time.

This directly reverses the 2026-08-09 decision ("this gate is non-negotiable in the
design"). That reversal is warranted because the premise it was written under — "the cached
verdict was computed against the last observed fare... serving it blind would risk showing a
BUY/WAIT that no longer matches the fare on screen" — turns out to be already handled by code
that existed independently in `insightsEngine.js`. The 2026-08-09 entry's own "what would
change this" names exactly this evidence: *"if the drift gate turns out to fire on a large
fraction of featured-route searches... the stand-in is too stale."* It does, dominantly — but
the fix isn't a better stand-in (option (b) in that entry, the split-derivation refactor); it's
recognizing the split-derivation the entry worried about **already exists**, just not where
anyone was looking.

### 2.2 Keep a much looser sanity bound — not for price drift, for data integrity

Don't remove the concept of comparing live-vs-cached price entirely. A live price that is
wildly out of line with the cached one (10x, or a tenth) is more likely a currency mismatch, a
`fare_observations` data error, or a provider glitch than a legitimate seasonal spread — and
*that* is worth falling back to live compute for, cheaply. Replace
`FORECAST_PRICE_DRIFT_TOLERANCE` (default `0.08`, meaning ±8%) with a sanity multiple — e.g.
`FORECAST_PRICE_SANITY_MULTIPLE` default `5` (live price more than 5x or less than 1/5th of
`computed_current_price` fails the sanity check; TLV-KRK's actual 5.5x seasonal spread sits
right at the edge of this by design — it should mostly pass). This is a data-integrity check,
not a decision-freshness check, and the name and default should say so.

### 2.3 Add the regression test that makes this safe: lock in the recompute invariant

There is currently **no test file for `insightsEngine.js` at all.** The invariant this whole
fix depends on — "recommendation/pricePercentile/expectedSavings are always derived from the
live price, never the cached forecast's stale ones" — is presently unverified by anything.
Add `server/services/__tests__/insightsEngine.test.js` (or
`src/utils/__tests__/insightsEngine.test.js`, matching wherever eslint's node/browser split
puts it) asserting:

- Given a `forecast` object with a stale `recommendation`/`pricePercentile`/`expectedSavings`
  computed against a distant cached price, and a `comparisonPrice` far from that cached price,
  `computeEventDrivenInsights` returns a `recommendation`/`pricePercentile`/`expectedSavings`
  consistent with `comparisonPrice` and `forecast.prices`/`forecast.forecastMedian` — **not**
  with the forecast object's own stale fields.
- `confidenceScore`, `sampleSize`, and `priceHistory` **do** pass through from the cached
  object unchanged (proving they're legitimately cacheable, and guarding against a future
  change accidentally trying to "fix" them by drift-gating too).
- The `forecast.verdict === null` (insufficient-history) early return still short-circuits
  before any of the above.

This test is the actual trust guardrail going forward — it directly encodes the invariant this
whole spec's safety argument rests on, so a future change to `insightsEngine.js` that breaks
it fails CI immediately, rather than the failure mode being "a confidently wrong verdict
someone notices in production."

---

## 3. Changes required

- **`server/services/forecastCache.js`** — `get()`: remove the `driftTolerance` price-point
  check; add the `sanityMultiple` check (§2.2). Update the miss-reason log line's drift
  message accordingly (`MISS ... sanity <multiple>x` instead of `drift X > Y`).
- **`server.js`** — swap the `driftTolerance` option passed to `forecastCache.get()` for
  `sanityMultiple`, reading `FORECAST_PRICE_SANITY_MULTIPLE` (default `5`) instead of
  `FORECAST_PRICE_DRIFT_TOLERANCE`.
- **`.env.example`** — replace the `FORECAST_PRICE_DRIFT_TOLERANCE` block with
  `FORECAST_PRICE_SANITY_MULTIPLE`, rewriting the comment to describe a data-integrity check,
  not a decision-freshness guardrail.
- **New: `insightsEngine.test.js`** (§2.3).
- **`src/utils/__tests__/forecastCache.test.js`** — retire "THE GUARDRAIL: returns null when
  live price drifts past tolerance" (the premise no longer holds); add tests for the sanity
  multiple (serves within 5x, rejects beyond it) in its place. Every other test in the file
  (staleness gate, miss/error handling, `put()`, `latestObservedPrice`) is unaffected.
- **`docs/product/decisions.md`** — new entry recording this reversal, linked from the
  2026-08-09 "trust guardrail" entry's own "what would change this" clause.
- **`docs/product/backlog.md`** — this KAI-004 entry; mark KAI-002's hit-rate item resolved by
  this fix once shipped and re-measured.

**Explicitly not touched**: `forecastService.js`'s engine math (tiering, the Chronos call,
`buildDailyIndex`), `forecastBatch.js`'s route iteration or "latest observation" price
selection (still the honest zero-cost stand-in for `computed_current_price` — see 2026-08-09,
first entry, unchanged by this spec), and `insightsEngine.js`'s existing logic (only tested,
not modified — its recompute behavior is the thing this fix relies on, not something it
needs to change).

---

## 4. Acceptance criteria

1. `ForecastCache.get()` no longer rejects a fresh row solely because the live price differs
   from `computed_current_price` by more than 8%.
2. `ForecastCache.get()` still rejects a row where the live price is more than
   `FORECAST_PRICE_SANITY_MULTIPLE`x (or less than 1/multiple) of `computed_current_price` —
   proving the data-integrity check still catches a genuinely bad row (e.g. a live price 20x
   the cached one).
3. `ForecastCache.get()` still rejects on `staleHours` exactly as before (unchanged behavior —
   regression, not new coverage).
4. `insightsEngine.test.js` exists and asserts the recompute invariant in §2.3, including the
   "cached fields that legitimately pass through unchanged" half.
5. Re-running the same log query this spec's diagnosis used (`[api/flights] Forecast cache
   hit` vs `[forecastCache] MISS`) against a representative post-ship window shows the
   `TLV-KRK`-style drift misses gone — remaining misses, if any, are staleness or genuine
   sanity-check rejections.
6. `npm test` + `npm run lint` + `npm run build` green — the repo-wide definition of done.

---

## 5. Rollout

- **PR, not a self-merge.** `forecastCache.js` is "any cache in `server/services/`" on the
  `ship-change` stop-list, same as KAI-002/003. `feature-dev` opens the PR and stops; Roy
  reviews and merges.
- **Verification after merge**: re-run the same Render-log query from the 2026-08-22
  measurement (`list_logs` for `*Forecast cache hit*` and `*forecastCache*MISS*` on
  `flight-tracker-backend`) over a few days of real traffic, and update the KAI-002 backlog
  entry with the new hit rate — closing the loop the 2026-08-09/2026-08-22 entries left open.
- No env var needs flipping to activate this — `FORECAST_CACHE_READ_ENABLED` is already `true`
  in prod (P1 is live); this changes what counts as a hit, not whether reads happen.

---

## 6. Risks / open questions

- **The sanity multiple's default (5x) is a starting guess, like the original 8% was.** If
  routes exist with even wider legitimate seasonal spreads than `TLV-KRK`'s 5.5x, they'd still
  drift-reject under this scheme too — though far less often than at 8%. Tune from measured
  data post-ship, the same way the original tolerance was meant to be tuned.
- **This makes `insightsEngine.js`'s recompute behavior load-bearing in a way it wasn't
  explicitly designed to be.** It already worked this way, but nothing enforced it as an
  invariant until §2.3's test. Any future change to `insightsEngine.js` that stops
  recomputing `recommendation`/`pricePercentile`/`expectedSavings` live would silently
  reopen the exact "confidently wrong verdict" risk the 2026-08-09 gate was written to
  prevent — which is why that test is part of this spec's acceptance criteria, not optional
  follow-up.
- **`confidenceScore` still comes from the cached object, unrecomputed.** That's correct
  (it's a property of the model's own quantile spread, not of price), but worth flagging: if
  a future change to `forecastService.js` ever made `confidenceScore` price-dependent, this
  fix's safety argument would need revisiting.
