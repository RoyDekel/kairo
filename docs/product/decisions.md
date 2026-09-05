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

### 2026-09-05 — P3 is resequenced: the event score is fixed before the covariate is fed
> **PARTIALLY SHIPPED SAME DAY, ahead of this entry going in**: [PR #36](https://github.com/RoyDekel/kairo/pull/36)
> removed `isHighImpactEvent` from `insightsEngine.js`'s recommendation chain and deleted the
> fabricated narrative, before this decision and its spec were committed. The "Context" and
> "Reasoning" below describe the state that motivated the decision, which is the pre-PR-#36
> state — kept as written, not edited, per this file's own convention (see the 2026-08-09
> drift-gate entry's REVERSED note). What's still open: `eventImpactScore.js` itself (the real
> scorer to replace `ticketmasterProvider.js`'s still-fabricated number) and P3b/P3c in full.
**Decision**: P3 splits into three stages that ship separately — **P3a** replace the fabricated
`event_impact_score` and stop it overriding the verdict (buildable now, zero API cost); **P3b**
start an `event_observations` archive keyed by the event's own date (buildable now, ~zero API
cost); **P3c** feed the covariate to Chronos-2 (**blocked**, four entry criteria). This reverses
the roadmap's order, which leads with the covariate. Full reasoning in
`specs/p3-events-covariate-loop.md`; backlog pointer is KAI-006.
**Context**: `roadmap.md` calls P3 "unblocked" on the grounds that P2 is live and there is now a
covariate slot to feed. Reading the code for the spec, that is necessary but not sufficient, and
the more urgent finding was somewhere else entirely: the event overlay is **not** decoration
sitting beside the prediction. It is already inside it, and the number it carries is invented.
`ticketmasterProvider.js:194` computes `impactScore = isSoldOut ? 96 : 75 + (idx % 20)` — a
boolean or the event's position in the response array — and `insightsEngine.js:75` forces
`recommendation = 'BUY_NOW'` at ≥90. One sold-out Ticketmaster listing anywhere in the
destination city during the travel window overrides the live Chronos-2 verdict.
**Reasoning**: the product's stated unrecoverable failure is a confidently wrong BUY the user
acts on with their own money. There is a live path to one, reached through a hardcoded `96`, and
it is currently *above* the model in precedence. Fixing that is zero-cost, touches no external
API, and is worth more than the covariate it precedes. Feeding a covariate first would have laid
a measured signal on top of an unmeasured override and made the result impossible to attribute.
Two further blockers make P3c genuinely un-startable rather than merely lower priority. (1)
`buildDailyIndex` indexes the series on `observed_at` and deliberately normalises across
departure-date horizon buckets, but an event's demand effect is a property of the **departure
date** — so a covariate laid on the existing axis answers a question that is not the mechanism.
(2) Chronos-2's `predict_df` requires every covariate column in the context frame to also appear
in `future_df`: the model conditions on the covariate's **past**. KAIRO has no event history at
all — `event_cache` is a cache keyed by lookup window with an `expires_at`, and Ticketmaster only
answers about the future — so the context column would be all zeros and the forecast column
non-zero, which is not a covariate but an unconstrained shock. Hence P3b, and hence starting it
now: the analysis doc's own "every day without logging is a day of data lost forever" argument
was made for fares and never applied to events.
**Alternatives considered**:
- *Build P3 as the roadmap describes it, covariate first* — would have shipped a measured signal
  into a model on top of an unmeasured heuristic override, with no event history to condition on
  and no way to tell which layer produced any change.
- *Fix the score but keep the override, tuned* — rejected. The override's problem is not that
  its threshold is wrong, it is that nothing entitles an event count to outrank a fare model. A
  better-tuned override is the same claim with more decimal places.
- *Ship P3a and P3b as one PR* — rejected on the repo's own precedent (KAI-001's "do these one at
  a time"): one changes the verdict path, the other adds a table and a provider budget. A
  regression in a combined diff has no safe bisect.
- *Wait for more fare history before starting any of it* — P3a needs no history, and P3b is the
  thing that makes waiting productive rather than merely slow.
**What would change this**: if measurement after P3a shows event-driven BUYs were in fact
well-calibrated — i.e. fares on those searches really did rise — that is an argument for putting
the signal back, but as a covariate the model weighs, never as an override. And if P3b's archive
after 90 days shows fewer than ~10 event days per featured route, P3c should be reconsidered
outright rather than built on a sample that cannot support it.

### 2026-09-05 — Rejected: e5 embeddings + `pgvector` + reranker for event matching
**Decision**: KAIRO does **not** build the embedding / vector-search / reranking layer described
in `KAIRO_HuggingFace_Integration_Analysis.md` §3 and carried into `roadmap.md`'s P3 entry. No
`pgvector` extension, no `intfloat/multilingual-e5-base` calls, no `BAAI/bge-reranker-large`
pass. `event_impact_score` is computed by a deterministic scorer over signals the event providers
already return (`specs/p3-events-covariate-loop.md` §5.1).
**Context**: the analysis doc (2026-08-06) proposed Ticketmaster → e5 embeddings → Supabase
`pgvector` → cosine similarity keyed on `(destination city, date window)` → optional reranker →
`event_impact_score`, and called it "the differentiating feature." That doc predates P1/P2
shipping and assumed no event provider was wired at all. Both assumptions are stale: Ticketmaster
has been live in production for weeks, API-Sports is wired and deliberately switched off
(`APISPORTS_DISABLED=1`, the free plan only answers for roughly today ±1 day), and `eventMerge.js`
already cross-references sources.
**Reasoning**: it solves a retrieval problem this product does not have.
`ticketmasterProvider.js:62–71` queries with `countryCode` + `city` + `startDateTime`/
`endDateTime`, so every event in hand is *already* known to be in the right city on the right
dates. There is no free-text corpus, no city ambiguity, and no ranking task — the list is at most
ten items and `eventMerge.js` already deduplicates it. Cosine similarity over ten already-correct
rows returns the same ten rows. Worse, it cannot produce the quantity the feature actually needs,
which is **magnitude**: an embedding knows "Coldplay" is near "Radiohead" and has no view at all
of whether either fills a stadium or of how a fixture relates to a fare. Substituting semantic
similarity for demand elasticity is the same category error this repo has already written two
comments about (`apiSportsProvider.js:444`, `forecastService.js:368`) — a plausible-looking number
with nothing behind it, arriving dressed in a confidence score. Against the cost lens: it adds a
Postgres extension enabled nowhere in this project, a migration, a new billed HF dependency, and
~310 embedding calls plus a reranker pass per cold discovery window (~10 events × ~31
destinations) on the app's highest-fan-out path — all of it stop-list territory — to re-rank a
list that was already correct.
**Alternatives considered**:
- *Embeddings for artist/team prominence rather than matching* — the honest version of the idea,
  and still wrong tool: draw size is a popularity fact, not a similarity fact, and an embedding
  carries no popularity signal. If prominence is wanted, buy it (PredictHQ sells an event-impact
  score directly) or derive it from venue capacity — a buy-vs-build conversation, not this.
- *`pgvector` now, cheap, to have the capability ready* — infrastructure built ahead of a use
  case that has not been named. The extension can be enabled in one migration on the day a real
  retrieval problem exists.
- *The deterministic scorer we chose* — every input inspectable, every weight written down and
  unit-testable without a network, zero marginal cost.
**What would change this**: a concrete retrieval problem the current keys cannot answer —
realistically, adding a provider whose events are **not** pre-filtered by city (a free-text or
national feed), or de-duplicating the same event across three or more sources with inconsistent
naming where `eventMerge.js`'s string matching demonstrably fails on measured examples.
"It would be more sophisticated" is not that problem. Separately, embeddings remain a reasonable
tool for a *different* feature — semantic destination discovery ("somewhere warm with live music
in October") — and that is where to revisit them, on their own merits, not here.

### 2026-08-26 — `npm run test:e2e` becomes a blocking check on every pull request
**Decision**: `ci.yml` gains an `e2e` job that installs chromium and runs the Playwright
suite on every PR, in parallel with `verify` and blocking on failure. Not a nightly, not
`continue-on-error`. `playwright.config.js`'s `webServer` is made portable at the same time
(`npm run dev` rather than `npm.cmd run dev`, and a CI-sized startup timeout), because the
suite could not have run on a Linux runner as written.
**Context**: [KAI-005]. All three specs in `tests/passengerSelection.spec.js` had been failing
in `beforeEach` since `4050aa7` (2026-07-29), waiting for a nav label renamed in that same
commit. It was found four weeks later, by hand, during KAI-001's manual-verification pass —
not by any gate. `ci.yml` has run `npm test`, `npm run lint` and `npm run build` on every PR
since 2026-08-08 and has never run `test:e2e`. The backlog entry's own framing is the reason
this entry exists at all: e2e-in-CI had never been decided either way, and "no decision" is
what let the drift run for a month.
**Reasoning**: the interesting part is not that the suite broke — it is *how much* it broke
before anyone looked. Fixing the renamed label was not enough. Two further changes had landed
on top of the first break and were equally invisible: the landing page and auth gate now make
every workspace tab unreachable while signed out (so no signed-out spec can reach the search
form at all), and the passenger counters became `-`/`+` steppers, so the spec that called
`.fill()` on three number inputs was addressing elements that no longer exist. A one-line fix
at the PR that caused it became a rewrite of the whole file. That compounding is the cost this
gate is buying off, and it grows superlinearly with how long the suite goes unrun.
Against that, the standard objections to e2e-in-CI do not describe what is actually in this
repo. Cost, measured rather than assumed: the job was run on an ubuntu runner before this
entry was written — 42s end to end, of which the tests themselves are 8.6s and most of the
rest is the chromium download. It runs in parallel with `verify`, which already takes longer
than that, so the marginal wall-clock cost of having the gate at all is currently zero.
Flake: these specs make no network assertions and
perform one deterministic UI interaction; the config already sets `retries: 2` and
`workers: 1` under CI; nine consecutive local runs under `--repeat-each=3` passed with no
flake. If a *future* spec is flaky, that is a fact about that spec, and the remedy is to fix
or delete it rather than to ungate the suite that would have reported it.
There is also direct precedent. The 2026-08-08 entry rejected dropping `lint` from `ci.yml`
on the grounds that "removing the thing that found the bugs because it found bugs is how the
repo got here." A suite that is never run is the same outcome reached by omission rather than
by argument — and it is worse than having no suite, because the file tree advertises coverage
that does not exist. KAI-001's acceptance criteria had to fall back to a human pass for
exactly that reason.
**Alternatives considered**:
- *Nightly schedule (`on: schedule`) plus `workflow_dispatch`* — the obvious middle ground,
  and the one this decision came closest to taking. Rejected on three counts. (1) The drift is
  always *caused by a PR*, and in this repo a merge is a production deploy — so a nightly can
  only ever report a break that is already live, with the causing diff no longer in anyone's
  head. (2) A scheduled red that blocks nothing is precisely the signal this repo has already
  demonstrated it will let sit: the 100 pre-existing lint errors accumulated the same way,
  under a rule that was "enforced" by a command nobody ran. (3) GitHub disables scheduled
  workflows in repositories with no activity for 60 days, so the mode that most needs to
  survive neglect is the one that quietly switches itself off — the failure mode of KAI-005,
  reintroduced at the workflow level.
- *Non-blocking step on PRs (`continue-on-error: true`)* — same information, no enforcement.
  A red X that nobody is required to act on trains everyone to stop reading the X.
- *Leave it out and rely on running it by hand* — the status quo, and the direct cause of
  KAI-005. Recorded here as rejected rather than left as a default, which is the whole point.
- *Grow e2e coverage first, gate later* — backwards. Gating three tests is cheap and can be
  reversed in one commit; growing an ungated suite just manufactures more stale assertions
  that look like coverage. Gate what exists, then add.
**What would change this**: demote to nightly if either number moves — spurious failures on
unrelated PRs exceeding roughly one in twenty runs *after* retries, or e2e wall-clock passing
~5 minutes and becoming the thing PR authors wait on. A check that is habitually re-run until
green is worse than no check, so the trigger for revisiting is flake rate, not absolute
runtime. Separately, this must be revisited if any spec ever needs real credentials: the
suite currently seeds a fake Supabase session into `localStorage`, and if a spec instead had
to sign in for real, it could not stay on `pull_request` at all — secrets are not exposed to
fork PRs (the same constraint `ci.yml`'s build step already documents), so it would move to a
post-merge or scheduled job.

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
