# KAIRO Product Decisions

> Append-only. Newest at the top. Maintained by the `product-manager` agent.
>
> **Rejections are the most valuable entries here.** They exist so the same idea is not
> re-argued from scratch in two months. Every rejection records what would change the answer.

## Format

```markdown
### YYYY-MM-DD — Title
**Decision**: what was decided
**Context**: what prompted it
**Reasoning**: why, against the product lens
**Alternatives considered**: and why they lost
**What would change this**: the evidence that would reverse the call
```

---

### 2026-08-22 — The `forecast_cache` price-drift gate is removed; it was redundant (reverses 2026-08-09)
**Decision**: `ForecastCache.get()` no longer compares the live fare against
`computed_current_price` as a percentage. `FORECAST_PRICE_DRIFT_TOLERANCE` (0.08) is replaced
by `FORECAST_PRICE_SANITY_MULTIPLE` (default 5) — a data-integrity bound that rejects a row
only when the live price is more than 5x or under 1/5th of the cached one. Time-freshness
(`FORECAST_STALE_HOURS`) is now the only real gate, and is unchanged. **This directly reverses
the 2026-08-09 entry below, which called that gate "non-negotiable in the design."**
**Context**: the 2026-08-22 hit-rate measurement (KAI-002) found 4 cache hits against 45
misses, **all 45 the drift gate, none staleness**, 38 of them on `TLV-KRK`. The first read of
that data blamed the batch's departure-date-blind price selection: `computed_current_price`
can land on a $134 November observation while the user searches a $613 near-term date, and no
percentage tolerance absorbs a 5.5x seasonal spread. Tracing what the gate actually protects
(`server.js:684-729`, `insightsEngine.js` end to end) showed the diagnosis was one layer too
shallow. Full trace in `specs/kai-004-forecast-cache-drift-gate-fix.md` §1.
**Reasoning**: the cached `forecast` object is never sent to the client. It is only ever an
input to `computeEventDrivenInsights`, once per flight card, with `comparisonPrice` set to
that flight's own live price — and whenever `forecast.prices` is present, that function
**recomputes `pricePercentile`, `recommendation` and `expectedSavings` from the live price**,
discarding the cached object's own values. The confidently-wrong-verdict failure mode the
2026-08-09 gate was written to prevent was already prevented, by code that existed
independently one layer downstream, before that gate was ever added. The fields that do pass
through uncomputed — `confidenceScore`, `sampleSize`, `priceHistory`,
`low90Day`/`high90Day`/`avg90Day` — are properties of the 90-day window and the model's own
quantile spread, not of the price the cache was computed against (`confidenceScore` is
`95 - cv * 30` over the forecast interval; `currentPrice` is not an input to it). Those age
with *time*, which is exactly what the staleness gate already covers. So the gate was buying
nothing and costing ~92% of reads — defeating P1's entire purpose on the routes it fired on
hardest. The 2026-08-09 entry's own "what would change this" named this evidence
("if the drift gate turns out to fire on a large fraction of featured-route searches"); it
predicted the remedy would be the split-derivation refactor, but that split **already exists**
in `insightsEngine.js` — it was just never recognised as such.
**Alternatives considered**:
- *Widen the tolerance* — the obvious first move, and useless: nothing short of ~500% absorbs
  a seasonal fare spread, and at that width the gate is no longer a drift check anyway.
- *Fix the batch's price selection instead* (per-departure-date buckets, or keying
  `forecast_cache` by horizon) — a real improvement to `forecastBatch.js` and worth doing on
  its own merits, but it is a schema/engine change on the stop-list, and it would have been
  fixing the *input* to a gate that shouldn't run at all. This decision makes that imprecision
  harmless rather than urgent; the 2026-08-09 "latest observation" stand-in is untouched.
- *Keep a tightened gate as belt-and-braces* — rejected because a gate that fires is not free:
  every rejection is a full request-path forecast recompute, which is the exact cost P1 exists
  to remove. A bound that only catches corrupt data (5x) keeps the cheap insurance without the
  bill.
**What would change this**: `insightsEngine.js` ceasing to recompute
`recommendation`/`pricePercentile`/`expectedSavings` from the live price would reopen the
original risk immediately and require restoring a price gate — which is why that invariant is
now pinned by `src/utils/__tests__/insightsEngine.test.js` rather than left implicit. Also:
if `confidenceScore` ever becomes price-dependent in `forecastService.js`, this safety
argument needs re-deriving. And if the re-measured hit rate does not clear the ≥80% target
with drift misses gone, the remaining causes (staleness, genuine sanity rejections) are the
next thing to look at — not this gate again.

### 2026-08-22 — P2 cost decision resolved: pay-per-hour HF Dedicated Endpoint approved
**Decision**: Roy has an active Hugging Face subscription with per-hour billing enabled, and
has provisioned a Dedicated Inference Endpoint for `roydekel/chronos-2-kairo` (a duplicate of
`amazon/chronos-2` with a custom `handler.py` matching the request/response contract
`forecastService.js` already calls). The cost sign-off that `roadmap.md` flagged as blocking
P2 is resolved — P2 moves from "Later" to "Now".
**Context**: `roadmap.md`'s P2 entry (written 2026-08-08) named two blockers: P1 shipping
(done, KAI-002) and "a cost decision — a dedicated endpoint bills for uptime, so someone has
to sign off the run rate before it goes on." Roy confirmed the subscription and hourly
billing are already in place and the endpoint is already running.
**Reasoning**: a Dedicated Inference Endpoint is the only way to serve Chronos-2 — HF's
serverless Inference Providers do not host time-series models (verified directly against the
API; see `KAIRO_HuggingFace_Integration_Analysis.md` §0.3). That means uptime cost is
unavoidable for this model family, not a configuration choice. What remained was an explicit
answer to "is that acceptable" — which this decision records as yes.
**Alternatives considered**: none re-litigated here — the model choice (`amazon/chronos-2`
over Bolt/TimesFM/Moirai/etc.) and the "batch-only, not per-request" mitigation are already
decided in the P1 spec and the HF analysis doc; this entry only unblocks proceeding with them.
**What would change this**: if actual per-hour spend materially exceeds the ~$8–95/month
estimate in the analysis doc (scale-to-zero vs. always-on) once real usage is observed, revisit
whether the endpoint should be scale-to-zero-only, restricted to the nightly batch
(`FORECAST_LIVE_HF_ENABLED=false`), or dropped in favour of the cheaper
`ibm-granite/granite-timeseries-ttm-r2` fallback named in the same doc.

### 2026-08-22 — `FORECAST_LIVE_HF_ENABLED=false`: the Chronos-2 endpoint is scale-to-zero
**Decision**: `FORECAST_LIVE_HF_ENABLED` is set to `false` in Render (overriding the code
default of `true`). The live `/api/flights` request path never calls the HF endpoint; only
the nightly `forecastBatch.js` job does (`source === 'batch'` bypasses this flag entirely —
`forecastService.js:309`).
**Context**: `HF_ENDPOINT_URL`/`HF_API_KEY` for `roydekel/chronos-2-kairo` are now set in
Render (KAI-003), and a manual smoke test confirmed the response contract works (200, 751ms,
correct quantile shape). Checking the HF dashboard, the endpoint is configured **scale-to-zero**,
not always-on.
**Reasoning**: on scale-to-zero, the first request after the endpoint idles out has to cold-
start a 120M-parameter model, which routinely exceeds the request path's 4s
`AbortController` timeout (`forecastService.js:329`) — so a live call gains nothing on a cold
hit (silent fallback to seasonal-naive either way) and, on a warm hit, re-arms the idle timer
from ordinary search traffic, turning a scale-to-zero endpoint into effectively always-on
billing driven by user volume rather than the batch's predictable once-a-day schedule. Since
the batch already ignores this flag, disabling it costs nothing on the batch side — Tier 3
forecasts still get real Chronos-2 output nightly — and only removes the *unpredictable* cost
and latency path.
**Alternatives considered**:
- *Leave `true`* — would have been correct if the endpoint were always-on; rejected because
  it isn't, and the mismatch between "flag assumes always-on" and "endpoint is scale-to-zero"
  is exactly the failure mode this flag exists to prevent (see `.env.example`'s comment on it).
- *Switch the endpoint to always-on instead* — trades a predictable ~daily cost for a fixed
  ~$95/month floor (per the HF analysis doc's estimate) regardless of traffic; not chosen
  without a separate cost conversation.
**What would change this**: switching the endpoint to always-on in the HF dashboard (then
`FORECAST_LIVE_HF_ENABLED=true` becomes safe again), or if p95 request-path latency data shows
seasonal-naive-only Tier 3 verdicts are hurting verdict quality enough to justify the cost of
always-on.

### 2026-08-09 — P1 batch "current price" is the latest observation, not a fresh live quote
**Decision**: the nightly forecast batch computes each route's verdict against the most
recent `fare_observations` row for that route+currency, not against a freshly fetched live
quote. Routes with no observation are skipped, not priced.
**Context**: `forecastService.forecastRoute` takes `currentPrice` as an argument, but the
batch runs off the request path and has no live quote to hand it. Something has to stand in.
**Reasoning**: a live provider search per route in the batch would multiply the exact metered
API calls (SerpApi / fli) the batch exists to move off the hot path, and re-couple the batch
to provider rate limits — the cost lens kills it. `currentPrice` only feeds `pricePercentile`,
the BUY/WAIT rule and `expectedSavings`; the latest observed fare is the honest, zero-cost
stand-in for those, and the collector already keeps it fresh on exactly the featured routes
the batch covers. The staleness this introduces is bounded by the read-path drift gate (next
entry), not left open.
**Alternatives considered**:
- *Fresh live quote per route* — most accurate `currentPrice`, but pays the per-route provider
  cost the feature is designed to eliminate, and puts the batch back under the rate limiter.
- *Split `forecastRoute` into a price-independent model half (cache it) and a price-relative
  half (recompute live)* — the clean end state, but it refactors the verdict engine, which is
  on the `ship-change` stop-list, and risks a second source of truth for the decision rule.
  Deferred as a follow-up rather than bundled into P1.
**What would change this**: if the drift gate turns out to fire on a large fraction of
featured-route searches (meaning the latest observation is routinely far from live price), the
stand-in is too stale and the split-derivation refactor becomes worth its risk.

### 2026-08-09 — P1 read path guards the cached verdict with a price-drift gate (default 8%)
> **REVERSED 2026-08-22** (KAI-004, top of this file). The gate fired on ~92% of reads, and
> the tracing that prompted this entry's own "what would change this" showed the risk it
> guards was already handled in `insightsEngine.js`. Kept here for the record; do not
> re-implement from it.
**Decision**: `/api/flights` serves a cached verdict only when the user's live roundtrip price
is within `FORECAST_PRICE_DRIFT_TOLERANCE` (default 0.08) of the `computed_current_price` the
verdict was calculated against — in addition to a time-freshness check
(`FORECAST_STALE_HOURS`, default 26h). Outside either bound it recomputes live. This gate is
non-negotiable in the design.
**Context**: the cached verdict is computed against the last *observed* fare (see previous
entry), which can diverge from the price the user is actually looking at. Serving it blind
would risk showing a BUY/WAIT that no longer matches the fare on screen.
**Reasoning**: the product's one unrecoverable failure is a confidently wrong verdict a user
acts on with their own money — "a plausible-looking wrong answer is the one failure mode users
act on" (`ship-change` stop-list). A verdict computed against a materially different price is
exactly that. Rather than duplicate the engine's decision logic on the read path (which would
create a second, drift-prone source of truth for the verdict), the gate bounds the price
error and, when it's exceeded, falls back to the one authoritative computation. The default 8%
is a starting knob, not a proven threshold.
**Alternatives considered**:
- *Serve any fresh cache row regardless of price* — simplest, but re-opens the confidently-
  wrong-verdict failure mode the whole product is built to avoid.
- *Recompute `pricePercentile` and the recommendation on the read path against the live price*
  — avoids the staleness without a live history read, but re-implements the decision rule
  outside the engine, i.e. two places that can disagree about BUY vs WAIT. Rejected for P1 for
  the same reason the engine is stop-listed; noted as a possible refinement.
**What would change this**: production data on how often the gate fires and whether cache-served
verdicts ever disagree with a same-moment live recompute. If disagreement shows up, tighten the
tolerance before adding logic; if the gate rarely fires, it can be loosened to raise hit rate.

### 2026-08-08 — `set-state-in-effect` downgraded to a warning, not suppressed, not fixed
**Decision**: `react-hooks/set-state-in-effect` drops from `error` to `warn` in
`eslint.config.js`. The 11 existing violations stay in the code, catalogued as
[KAI-001] in the backlog. Every other lint error in the repo was fixed properly in the same
change, taking `npx eslint .` from 100 errors to 0.
**Context**: the new `ci.yml` pull-request gate ran `npm run lint` for the first time and
found 100 pre-existing errors. CLAUDE.md has always defined done as "test + lint + build",
but nothing had ever actually enforced the lint half, so the errors accumulated unseen. The
gate is correct; the errors were the bug.
**Reasoning**: the other 89 errors were unused imports, dead assignments and generated-file
noise — mechanical, provably behaviour-neutral, safe to fix in an infrastructure PR. These 11
are not. Each one changes when a component re-renders, in `App.jsx`, `AuthProvider.jsx` and
`AlternativeFlights.jsx` — the state orchestrator, the auth session, and the search results
list. Fixing them correctly means a different remedy per site (derive during render, key the
component, move to an event handler). Bundling 11 behavioural changes into a PR whose stated
purpose is "turn on CI" would mean that any resulting regression could not be bisected to a
cause, and would be discovered days later against a diff nobody would think to suspect.
Downgrading keeps every site reported on every run, including new ones, while letting the
gate hold the line on everything else. A `warn` is visible debt; the alternatives are not.
**Alternatives considered**:
- *Fix all 11 now* — correct end state, wrong PR. Turns an infrastructure change into a
  render-behaviour refactor of the three most central files in the app, with no test that
  currently asserts render counts to catch a mistake.
- *Per-line `eslint-disable` comments* — the worst option. Same amount of debt, but silent:
  the count drops to zero, the sites stop being listed, and the next instance gets a disable
  comment copy-pasted onto it because that is what the neighbours look like.
- *Drop `lint` from `ci.yml`* — rejected outright. The gate found real problems on its first
  run, including a leaked timer in `keepAlive.js`. Removing the thing that found the bugs
  because it found bugs is how the repo got here.
- *Leave lint failing until KAI-001 ships* — blocks every unrelated PR behind a render
  refactor of `App.jsx`.
**What would change this**: KAI-001 landing, at which point the rule goes back to `error`
and this entry becomes history. Sooner, if a user-visible performance problem is traced to
one of the 11 sites — that promotes KAI-001 above whatever is above it and the rule goes
back to `error` site by site. Also reconsider if the warning count ever rises above 11:
that would mean `warn` has stopped working as a deterrent and the debt is growing.

### 2026-08-08 — Product docs established as the source of truth
**Decision**: `docs/product/{roadmap,backlog,decisions}.md` are the single source of truth
for what KAIRO builds. Specs written here are the input contract for the `feature-dev` agent.
**Context**: Three agents (`feature-dev`, `bug-fixer`, `product-manager`) were introduced and
needed a shared, version-controlled place for product intent.
**Reasoning**: Markdown in-repo means specs are versioned alongside the code they describe,
diffable in review, and readable by the engineering agents without a connector or API.
**Alternatives considered**: GitHub Issues — better public trail, but adds a dependency and
a sync cost for a solo project, and agents would need `gh` on every read.
**What would change this**: More than one human contributor, or outside stakeholders who
need visibility without repo access.
