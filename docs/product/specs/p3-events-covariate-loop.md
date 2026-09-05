# P3 — Events-as-covariate loop

**Status**: proposed (KAI-006). Ships as PRs for Roy — see Rollout.
**Owner**: product-manager → feature-dev
**Depends on**: P1 (KAI-002) and P2 (KAI-003) shipped and live in prod
**Blocks**: P4 (LLM narrative)
**Revises**: `roadmap.md`'s P3 entry and `KAIRO_HuggingFace_Integration_Analysis.md` §3 — both
describe an architecture that does not survive contact with the current code. See §1 and §4.

> **UPDATE (2026-09-05, after this spec was drafted) — half of P3a already shipped.**
> [PR #36](https://github.com/RoyDekel/kairo/pull/36) (`fix(insights): stop a fabricated event
> score overriding the verdict`) removed `isHighImpactEvent` from `insightsEngine.js`'s
> recommendation chain and deleted the `due to event ticket pressure` / `expectedSavings * 1.2`
> narrative, before this spec's docs were shipped. So **AC 6 and AC 7 below are done** — the
> verdict can no longer be overridden by the event score, and the fabricated causal sentence is
> gone. **AC 1–5, 8, 9 are still open**: `ticketmasterProvider.js:194` still computes
> `impactScore = isSoldOut ? 96 : 75 + (idx % 20)` inline — the number is still fabricated, it
> just no longer has the power to flip BUY/WAIT. `eventImpactScore.js` (the real, deterministic
> scorer this spec proposes) has not been built. Every claim below describing the override as
> presently live is describing the pre-PR-#36 state; read it as "was true until 2026-09-05,"
> not as the current state of `main`.

---

## 1. What changed once the code was actually read

`roadmap.md` scopes P3 as one chain: *Ticketmaster → e5 embeddings → `pgvector` similarity →
`event_impact_score` → Chronos covariate*. Three findings change that plan, one of them fatal
to the sequencing.

**1. `event_impact_score` already exists, is already wired into the verdict, and the number is
fabricated.** It is not a badge beside the prediction — it is already inside it. It just isn't
measuring anything (§2).

**2. The embedding / `pgvector` / reranker layer solves a matching problem KAIRO does not
have.** Events are already keyed to a destination city and a date window by the provider query
itself, and `eventMerge.js` already cross-references sources. Rejected, with reasoning, in §4.

**3. The covariate cannot be fed yet, and not for the reason the roadmap gives.** The roadmap
says the blocker was P2 (no covariate slot). P2 is live and the slot exists, but Chronos-2's
`predict_df` requires every covariate column present in the context frame to also be present in
`future_df` — i.e. the model conditions on the covariate's **past**, not just its future. KAIRO
has no event history to put in that column, and the series it would attach to is indexed on the
wrong axis (§3). Feeding an all-zeros-in-the-past, non-zero-in-the-future column to a
forecasting model is not a covariate; it is an unconstrained shock.

So P3 becomes three stages, sequenced by what is actually buildable:

| Stage | What | Buildable today | New metered API calls |
|---|---|---|---|
| **P3a** | Replace the fabricated impact score; stop it overriding the verdict | **Yes** | **Zero** |
| **P3b** | Start the event history archive the covariate needs to condition on | **Yes** | Zero steady-state; bounded one-off backfill |
| **P3c** | Feed `event_impact_score` to Chronos as a covariate | **No — gated on P3b** | Zero (reads the archive) |

P3a is the trust fix and it is the one worth doing first. P3b is the data-logging step that has
to start now because every day without it is a day of joint history lost permanently — the exact
argument the analysis doc makes for fare logging in §2 and never applies to events. P3c is the
headline feature and it is honestly months of data away.

---

## 2. What exists today (the audit)

### 2.1 The impact score is an array index and a boolean

`server/providers/ticketmasterProvider.js:194`:

```js
const isSoldOut = statusCode === 'soldout' || statusCode === 'offsale';
const impactScore = isSoldOut ? 96 : 75 + (idx % 20);
```

`idx` is the event's position in the response array, which is sorted `date,asc` and capped at
`size: '10'`. So the non-sold-out branch produces 75–84 purely as a function of *how many events
happened to be listed before this one*, and it is presented to the user as a percentage of
"demand impact" (`verdictEvidence.js:61`: `"— ${impact}% demand impact"`).

Two things follow, and they should be stated separately because they carry different urgency:

- **The index path is currently harmless but one config change from harmful.** At `size: 10` it
  tops out at 84, below the 90 threshold. Raise the page size to 20 — an obviously reasonable
  change someone will make — and the 16th–20th listings start scoring 90–94 and forcing BUY_NOW
  on ordinal position alone.
- **The sold-out path was live and moved the verdict — fixed 2026-09-05, PR #36 (see the UPDATE
  banner above).** `insightsEngine.js:27,75` (pre-fix, shown to explain the mechanism that was
  removed):

  ```js
  const isHighImpactEvent = eventImpactScore >= 90;
  if (recommendation === 'BUY_NOW' || daysToDeparture <= 14 || isHighImpactEvent) {
    recommendation = 'BUY_NOW';
  }
  ```

  Any single sold-out or off-sale Ticketmaster listing anywhere in the destination city during
  the travel window overrides the Chronos-2 verdict to BUY_NOW. A sold-out comedy night in a
  200-seat club in Paris outranks the model. That is the product's one named unrecoverable
  failure mode — a confidently wrong BUY the user acts on with their own money — reached through
  a hardcoded `96`.

- **`insightsEngine.js:26` invents a score when there are no events at all**: `const
  eventImpactScore = topEvent ? topEvent.eventImpactScore : 70`. Seventy percent impact, from
  nothing.

- **API-Sports fixtures deliberately carry no score** (`apiSportsProvider.js:444` — *"inventing
  them would feed the buy/wait verdict a number with nothing behind it"*, which is exactly right
  and exactly what Ticketmaster does two files away). The consequence is a latent bug for
  whenever `APISPORTS_DISABLED` is cleared: `insightsEngine`'s `reduce` compares
  `curr.eventImpactScore > prev.eventImpactScore` against `undefined`, which is always false, so
  a fixture that is first in the array becomes `topEvent` with an `undefined` score and
  `verdictEvidence` renders *"No major event competing for seats"* — pointing `wait` — about a
  city that has a fixture on.

### 2.2 The narrative asserts causation the product cannot support

`insightsEngine.js:111` and its client twin `priceConfidenceEngine.js:44`:

> `Fares are predicted to rise by ~$${Math.round(expectedSavings * 1.2)} due to event ticket pressure.`

`expectedSavings` is `currentPrice - min(forecastMedian, low90Day)` — a statement about the
90-day price range. Multiplying it by 1.2 and attributing the result to a concert is a causal
claim with no estimator behind it. This is P4's failure mode (fluent prose over numbers that
aren't there) already shipped, ahead of P4.

There is also a live inconsistency between the two: `computeEventDrivenInsights` does not return
a `prices` array, so `priceConfidenceEngine.js:31`'s branch is never taken when `BuyVerdict`
passes a `basePriceOverride` — the client falls to the `else` at line 53 and recomputes
`recommendation` from a `priceDiffPct <= 12` rule of its own, while still rendering the server's
`summary`. A user can therefore see a WAIT-styled panel carrying an event-surge BUY sentence.
**Out of scope for P3 — it is a bug, not a feature gap — but it should go to `bug-fixer`, and it
is more urgent than anything in this spec.**

### 2.3 What is genuinely good and must be built on, not replaced

- `EventSearchService` — provider orchestration, coverage-vs-enrichment distinction, honest
  `unavailable` ≠ `empty` semantics, simulated fallback when nothing is configured.
- `EventCache` — two tiers (memory → Supabase `event_cache`), and a TTL ladder
  (imminent/near/mid/far) that is one of the better-reasoned pieces of code in the repo.
- `eventUsageMeter` — per-tier attribution of where the event budget goes.
- `DailyBudget` — a hard daily ceiling, currently wired to API-Sports only.
- `eventMerge.js` — cross-references the same match from two sources into one card.

P3 adds a scorer, an archive and a covariate column. It touches none of the above except to add
a `DailyBudget` to Ticketmaster (§6.3), which is missing today.

### 2.4 Provider reality (correcting the analysis doc)

The analysis doc assumed no event provider was wired. Wrong, in both directions:

- **Ticketmaster is wired and live in production** (`TICKETMASTER_API_KEY`), rate-limited to
  5 req/s, with an informally documented 5,000/day quota and **no `DailyBudget` ceiling**.
- **API-Sports is wired and deliberately switched off** (`APISPORTS_DISABLED=1`), because the
  free plan only answers for roughly today ±1 day and KAIRO asks about future trips. It has a
  `DailyBudget` of 80/day ready for the day a paid plan lands.
- So production coverage is `ticketed-only`, and the API already says so.

---

## 3. Why the covariate cannot be fed yet

Two independent blockers. Either alone is sufficient; both are real.

### 3.1 The series is on the wrong axis

`buildDailyIndex` (`forecastService.js:92`) produces one point per **`observed_at` day** — the
day the quote was taken — and deliberately normalises *across* departure-date horizon buckets so
that a day sampled only at the 90-day horizon is comparable to a day sampled at all four.
`forecastRoute` then predicts seven further observation days.

An event's demand effect is a property of the **departure date** — a concert on 14 September
raises the fare for flights arriving around 14 September, whichever day you happen to ask on. So
a covariate column laid against the existing series would be answering *"what happens to the
horizon-blended index of quotes taken on day D when an event occurs on day D"*, which is not the
mechanism, and is additionally diluted by the very normalisation that makes the index usable.

Two ways out, both real work:

- **(a) Forecast a departure-date-indexed series.** The physically correct fix, and it converges
  with KAI-002's still-open option (b), keying `forecast_cache` by `(route, currency,
  horizon_bucket)`. Bigger change; touches the engine.
- **(b) Project event pressure onto the observation axis** — for observation day D, the
  event pressure over the departure dates being quoted on D, weighted by the horizon mix. Cheaper,
  buildable, and its meaning must be written down honestly because it is an approximation, not
  the mechanism.

**This spec does not decide between them.** It decides that P3c cannot start until one is chosen,
and that P3b's archive must be keyed by **event date**, not lookup date, so that either remains
possible. (§6.2)

### 3.2 There is no event history to condition on

Chronos-2 takes covariates natively, but `predict_df` requires that every covariate column in the
context frame also appear in `future_df` — the model reads the covariate's relationship to the
target **from the context window** and extrapolates it. ([amazon/chronos-2 model
card](https://huggingface.co/amazon/chronos-2), [AutoGluon Chronos-2
tutorial](https://auto.gluon.ai/stable/tutorials/timeseries/forecasting-chronos.html))

KAIRO has no historical event data at all:

- `event_cache` rows are a *cache*. They carry `expires_at`, are keyed by lookup window rather
  than event date, and are explicitly designed to be deleted.
- Ticketmaster is queried for the user's future travel window, so nothing about the past is
  retained.
- `fare_observations` therefore joins to nothing.

Passing a column that is zero for all 90 context days and non-zero for the 7 forecast days gives
the model no relationship to learn and licenses it to do anything with the spike. That is
strictly worse than no covariate, because the output would still arrive dressed in quantiles and
a confidence score.

**And even once the archive exists, be honest about the statistics.** A 90-day context window on
one route containing perhaps two to five event days is not enough signal for in-context learning
of an event coefficient. P3c's entry criteria (§5.3) are written around that, and P3c's success
criterion is explicitly permitted to come back negative.

---

## 4. Rejected: the embedding / `pgvector` / reranker layer

**Decision: not built. Not in P3, not as a follow-up, until the condition in "what would change
this" is met.** Recorded in `decisions.md` on the same date as this spec.

The proposal (analysis doc §3.2/§3.4) is: embed each event with
`intfloat/multilingual-e5-base` via HF Inference Providers, store the vectors in Supabase with
`pgvector`, retrieve by cosine similarity keyed on `(destination city, date window)`, optionally
re-rank with `BAAI/bge-reranker-large`, and derive `event_impact_score` from the result.

**It solves a retrieval problem KAIRO does not have.** Ticketmaster is already queried with
`countryCode` + `city` + `startDateTime`/`endDateTime` (`ticketmasterProvider.js:62–71`), so
every event in hand is already known to be in the right city on the right dates. There is no
free-text corpus to search, no ambiguity about which city an event belongs to, and no ranking
task — `eventMerge.js` already deduplicates across sources and the list is at most ten items
long. Cosine similarity over ten already-correct rows returns the same ten rows.

**It cannot produce the number the feature actually needs.** The missing quantity is *magnitude*
— how much a given event moves the fare. An embedding tells you "Coldplay" is close to
"Radiohead". It does not know either fills a stadium, and it has no view whatsoever of the
relationship between an event and a fare. Substituting semantic similarity for demand
elasticity is precisely the "plausible-looking number with nothing behind it" this repo has now
twice written comments about.

**It is a new metered dependency, a new Postgres extension and a new failure mode, for that.**
`pgvector` is not enabled anywhere in this project — no `supabase/*.sql` file references it and
nothing in the repo imports a vector client — so it is a new extension plus a migration plus a
`ship-change` stop-list review. The embedding calls are per-event: ~10 events × ~31 destinations
is ~310 embedding calls on a single cold discovery search, plus a reranker pass. They would sit
behind `eventCache`, which genuinely amortises them, but a new billed dependency on the app's
highest-fan-out path buys a re-ranking of a list that was already correct.

**What we build instead** (§5.1) is a deterministic scorer over signals Ticketmaster already
returns in the same response, at zero marginal cost: sell-through status, the published price
band, category, event count in the window, and multi-day/festival classification. Every input is
inspectable, every weight is written down, and the whole thing is unit-testable without a
network.

**What would change this**: a concrete retrieval problem appearing that the current keys cannot
answer — realistically, adding a provider whose events are *not* pre-filtered by city (a
free-text or national feed), or de-duplicating the same event across three or more sources with
inconsistent naming where `eventMerge.js`'s string matching demonstrably fails on measured
examples. "It would be more sophisticated" is not that problem. Note also that embeddings would
be a reasonable tool for a *different* feature — semantic destination discovery ("somewhere warm
with live music in October") — and that is where to revisit them, not here.

---

## 5. The build

### 5.1 P3a — a real event impact score, and no verdict override (buildable now)

**New file: `server/services/eventImpactScore.js`.** Pure, synchronous, no I/O, no network — per
hard rule 6. Exports:

```
scoreEvent(event, context) -> { score, confidence, inputs, unscorable }
scoreEventList(events, context) -> { topEvent, score, confidence, inputs, unscorable }
```

`context` carries what the scorer needs beyond the event itself: the number of events in the
window, the destination airport code, the travel window, and the coverage mode
(`full` | `ticketed-only`).

**Inputs, all already present in the payload — no new calls:**

| Signal | Source today | Why it is evidence |
|---|---|---|
| `isSoldOut` (`soldout`/`offsale`) | `ticketmasterProvider.js:193` | Real sell-through. The strongest honest signal we have. |
| Published price band (`priceRanges` min/max) | already fetched, discarded into a display string | A high band is a demand proxy the provider itself publishes. |
| Category (`sports`/`music`/`festivals`/`culture`) | `parseTicketmasterCategory` | Festivals and international fixtures draw travel; local theatre does not. |
| Event count in window | derivable from the list | Many concurrent events is a city-level pressure signal one event is not. |
| Multi-day span | `dates` | A three-day festival occupies more of a travel window than one night. |
| Coverage mode | `EventSearchService.hasCoverage` | On `ticketed-only`, the score must carry lower confidence — we cannot see club-sold fixtures. |

**Rules the scorer must obey — these are the point of the exercise, not implementation detail:**

1. **`priceEstimate`'s defaults must not enter the score.** `ticketmasterProvider.js:187` falls
   back to `min: 55, max: 220` when `priceRanges` is absent. Those are invented. An event with
   no published price band scores on the other signals with reduced confidence; it does not
   score as if it were a $55–220 event.
2. **An event with no scorable signal returns `unscorable: true` and no score**, the way
   `apiSportsProvider` already refuses to invent one. `null` is a legitimate answer.
3. **No ordinal position, ever.** Nothing in the score may be a function of array index.
4. **Bounded and documented.** The scale, every weight, and every threshold live in one file
   with a header comment explaining what each buys, in the style of `eventCache.js`'s TTL ladder.
5. **The simulated provider feeds the same scorer** rather than carrying its own hardcoded
   number, so the zero-cost degrade path (hard rule 3) exercises the same code.

**And the part that actually mattered: the score stops changing the verdict — DONE, PR #36,
2026-09-05, ahead of the rest of this spec.**

`insightsEngine.js`'s `isHighImpactEvent` branch is removed from the recommendation chain. The
BUY/WAIT verdict comes from the forecast engine — Chronos-2 via `forecast_cache`, or
seasonal-naive — and from nothing else. The event score's job becomes:

- **evidence**: a `verdictEvidence` item, honestly directional, with its confidence stated;
- **narrative**: an event may be *named* in the summary as context ("there is a sold-out show at
  the Accor Arena on your dates") but may not assert a fare effect. The
  `expectedSavings * 1.2` sentence is deleted, not rephrased.
- **a covariate input** later, in P3c, where a model can weigh it against measured history.

**No feature flag on this one, deliberately.** P1's flags gate *new* behaviour that might be
wrong. This removes behaviour that is known to be unsound, and a flag able to restore a
fabricated verdict override is a trap for whoever finds it in six months.

**`daysToDeparture <= 14 → BUY_NOW` in the same branch is out of scope.** It is a different
heuristic with a different (weaker but non-fabricated) justification, and bundling its removal
would make a regression untraceable. Flagged in §11.

### 5.2 P3b — the event observation archive (buildable now)

**New table `event_observations`** (§6.2) and a writer that costs nothing, because it stores what
the app has already fetched and is about to throw away.

- **Write path**: after `EventSearchService.#queryProviders` returns an `ok` result, upsert one
  row per event keyed on `(source, event_id, event_date)`, alongside the existing
  `eventCache.set`. This is additive to the cache, not a bypass of it — a cache *hit* writes
  nothing new, since the row is already archived. Hard rule 4 respected.
- **Snapshot semantics**: `isSoldOut` and the price band are *as observed at `observed_at`*, not
  properties of the event. An event that sells out three weeks before the date is a stronger
  signal than one that sells out on the day, and only a row per observation preserves that. Keep
  the latest observation per `(source, event_id, event_date)` plus `first_seen_at`; do not
  collapse to one row per event.
- **Failure is silent and costless**: an archive write failure logs and continues. It must never
  fail a search — same contract as `eventCache`'s write path.

**Backfill (optional, one-off, bounded).** Ticketmaster Discovery accepts past date ranges, so
~90 days of history for the featured hubs can be pulled in one job: ~10 destinations × 3 monthly
windows, paginated, ≈ 30–90 calls against a 5,000/day quota. Two honest caveats that must be in
the job's header comment:

- **`fare_observations` only starts in early August 2026**, so backfilling further back than the
  fare history buys nothing joinable. 90 days is already generous.
- **Backfilled status codes are as-of-now, not as-of-then.** A past event's `soldout` flag says
  nothing about when it sold out. Backfilled rows must be marked `backfilled = true` and
  excluded from any sell-through-timing signal.

Gated behind its own flag, default off, and it is the first thing in the product that would spend
Ticketmaster budget in a burst — which is why §6.3 adds the missing `DailyBudget`.

### 5.3 P3c — the covariate (blocked; entry criteria, not a build)

**Do not start P3c until all four hold. `feature-dev` should refuse the ticket otherwise.**

1. **Data**: ≥ 60 days of `event_observations` coverage overlapping `fare_observations` on
   ≥ 5 featured routes, with ≥ 10 distinct event days per route. Below that there is nothing for
   in-context learning to read.
2. **Axis**: a written decision (in `decisions.md`) on §3.1 — departure-date-indexed series, or
   the documented observation-axis projection. Not an implicit choice made in a diff.
3. **Harness**: a backtest that can compare 7-day-ahead q50 against the realised daily index,
   with and without the covariate, on the same routes and dates. Without it there is no way to
   know the covariate helped, and "it looks more sophisticated" is not evidence.
4. **`handler.py`**: `roydekel/chronos-2-kairo`'s handler moves from `pipeline.predict` on a bare
   `inputs` array to `pipeline.predict_df(df, future_df, ...)`, and the new request contract is
   smoke-tested by hand exactly as P2 §2.1 did — because `forecastService.js` falls back to
   seasonal-naive *silently* on an unrecognised response, so a contract mismatch is invisible
   from inside the app. That handler lives in a separate repo; the contract change must land
   there and be verified **before** `forecastService.js` starts sending the new shape.

**Shape, when it is unblocked** (recorded here so the archive is designed for it, not as an
instruction to build):

```
Request:  { "inputs": {"target": [...90], "event_impact_score": [...90]},
            "future":  {"event_impact_score": [...7]},
            "parameters": { "prediction_length": 7, "num_samples": 20 } }
Response: unchanged — { "quantiles": { "0.1": [...7], "0.5": [...7], "0.9": [...7] } }
```

Backwards compatibility is a requirement, not a nicety: an endpoint that has not yet been updated
must keep working on the old payload, so the covariate ships behind
`FORECAST_EVENT_COVARIATE_ENABLED`, default off, and an absent/failed covariate degrades to
exactly today's call.

**P3c is permitted to fail.** If the backtest shows the covariate does not improve out-of-sample
error, the correct outcome is a `decisions.md` rejection and no ship. Building it and shipping it
anyway because it was on the roadmap is how a product acquires a confidently wrong verdict.

---

## 6. Data model

### 6.1 No change to `forecast_cache`

The covariate value used for a cached verdict is worth recording when P3c lands (as a lifted
column, for the same operability reasons P1 lifted `reason` and `confidence_score`), but the
table does not change in P3a or P3b.

### 6.2 `supabase/event_observations.sql` (new, P3b)

```sql
-- Historical record of events observed at KAIRO's destinations.
--
-- Run once in the Supabase SQL editor.
--
-- WHY THIS IS NOT event_cache. event_cache is a CACHE: keyed by lookup window, carrying
-- expires_at, designed to be deleted. This is an ARCHIVE: keyed by the event's own date,
-- never expired, and the only thing that will ever be joinable against fare_observations.
--
-- WHY IT HAS TO START NOW. Chronos-2 conditions a covariate on its PAST values, not just its
-- future ones. Without a history of what was on, when, and how it was selling, there is
-- nothing to put in the context column and the covariate cannot be fed at all (P3 spec §3.2).
-- Ticketmaster only answers about the future, so history not captured today is lost for good.
--
-- ONE ROW PER OBSERVATION, not per event. isSoldOut and the price band are snapshots: an event
-- that sold out three weeks out is a different signal from one that sold out on the day, and
-- only a per-observation row preserves that.

create table if not exists public.event_observations (
  source          text        not null,        -- 'ticketmaster' | 'apisports' | ...
  event_id        text        not null,        -- the provider's own id
  event_date      date        not null,        -- THE EVENT'S date. The join key. Not the lookup date.
  destination     text        not null,        -- airport code, from the catalog's 32 hubs
  observed_at     timestamptz not null default now(),
  first_seen_at   timestamptz not null default now(),
  title           text,
  venue           text,
  category        text,
  is_sold_out     boolean,
  price_min       numeric,                     -- null when the provider published none. NEVER the 55/220 default.
  price_max       numeric,
  impact_score    integer,                     -- eventImpactScore.js output; null when unscorable
  impact_inputs   jsonb,                       -- which signals fired, so a past score can be re-derived
  backfilled      boolean     not null default false,
  primary key (source, event_id, event_date)
);

-- The covariate build reads by destination and date range.
create index if not exists event_observations_dest_date_idx
  on public.event_observations (destination, event_date);

-- Written only by the server using the service key, which bypasses RLS. RLS on with no policy
-- denies every browser client while leaving the server unaffected.
alter table public.event_observations enable row level security;
```

`impact_inputs` is not decoration: when the scorer's weights change — and they will — a stored
score becomes uncomparable across time. Storing which signals fired means past rows can be
re-scored rather than discarded.

### 6.3 A `DailyBudget` for Ticketmaster (new, P3b)

Ticketmaster today has a 5 req/s rate limiter and no daily ceiling. `dailyBudget.js`'s own header
makes the argument better than this spec can: *"A rate limit is not a ceiling. It controls how
fast the budget is spent, not whether it runs out."* API-Sports got a ceiling only after an
incident. Adding `TICKETMASTER_DAILY_LIMIT` (default ~1,000, well under the documented 5,000)
before introducing the first job that can spend in a burst is cheap insurance, and it reuses the
existing `DailyBudget` + `api_usage_daily` machinery with no new concepts.

---

## 7. Environment variables (`.env.example`, house style)

```bash
# --- P3b: Event observation archive ---
#
# Archives every event the app already fetched, keyed by the EVENT's date, so there is a
# history to join against fare_observations. Costs no extra provider calls: it writes what
# eventCache has already paid for and is about to expire.
#
# Create the table first: supabase/event_observations.sql. Requires SUPABASE_SERVICE_KEY.
#
# Why it has to be on early: Chronos-2 conditions a covariate on its PAST values (P3 spec
# §3.2). Ticketmaster only answers about the future, so a day not archived is lost forever.
EVENT_ARCHIVE_ENABLED=false

# One-off historical backfill for the featured hubs. Ticketmaster accepts past date windows,
# so ~90 days over ~10 cities is ~30-90 calls. Leave OFF after it has run once.
#
# TWO CAVEATS, both real. (1) fare_observations only starts in early August 2026, so history
# older than that joins to nothing. (2) A past event's sold-out flag is as-of-NOW, not
# as-of-then — backfilled rows are marked backfilled=true and must be excluded from any
# sell-through-TIMING signal.
EVENT_ARCHIVE_BACKFILL_ENABLED=false
EVENT_ARCHIVE_BACKFILL_DAYS=90

# Hard daily ceiling on Ticketmaster calls, deliberately below the documented 5,000/day.
# The 5 req/s rate limiter paces spend; it does not cap it. API-Sports got its ceiling after
# an incident (see APISPORTS_DAILY_LIMIT); this one arrives before the backfill job that
# would be the first thing able to spend in a burst.
# Requires supabase/api_usage_daily.sql to be durable across restarts.
TICKETMASTER_DAILY_LIMIT=1000

# --- P3c: Events as a Chronos covariate --- NOT BUILDABLE YET, see P3 spec §5.3 ---
#
# Sends event_impact_score to the HF endpoint as a known-future covariate. Requires
# handler.py in roydekel/chronos-2-kairo to have moved to predict_df/future_df FIRST — an
# unrecognised response falls back to seasonal-naive SILENTLY, so a contract mismatch does
# not surface as an error anywhere.
#
# Off means the exact request that ships today. Do not turn this on before the four entry
# criteria in the spec are met, in particular the backtest: a covariate that has not been
# shown to reduce out-of-sample error is a confident number with nothing behind it.
FORECAST_EVENT_COVARIATE_ENABLED=false
```

---

## 8. Acceptance criteria

### P3a — scoring and de-coupling (ships first, on its own)

1. `server/services/eventImpactScore.js` exists, is pure (no network, no Supabase, no
   `process.env` reads inside the scoring function), and every weight and threshold is declared
   as a named constant with a comment stating what it buys.
2. No score is a function of an event's position in a list. Given the same event, `scoreEvent`
   returns the same score whether it is first or tenth in the array — asserted directly by test.
3. An event with no `priceRanges` from the provider is scored without the `55`/`220` defaults,
   and returns lower `confidence` than the same event with a published band.
4. An event with no scorable signal returns `unscorable: true` and a `null` score. Nothing
   downstream substitutes a number for it — in particular the "no events at all" case no longer
   reports `eventImpactScore: 70`.
5. `ticketmasterProvider.format` no longer computes `impactScore` inline; the provider emits raw
   signals (`isSoldOut`, `priceMin`, `priceMax`, `category`, dates) and the service scores them.
   The simulated provider goes through the same scorer.
6. **DONE (PR #36, 2026-09-05).** `computeEventDrivenInsights` never changes `recommendation` on
   the basis of an event score. Given a forecast with `verdict: 'WAIT'` and an event scoring at
   the top of the scale, the returned `recommendation` is `WAIT`. This was the criterion the
   whole stage existed for; it has its own named test in `insightsEngine.test.js`.
7. **DONE for `insightsEngine.js` (PR #36). Still open for `priceConfidenceEngine.js`** — that
   file's copy of the same dead sentence is unreachable today (§2.2, §11) and was deliberately
   left alone by PR #36 to keep that fix revertible; removing it belongs with the separate
   `prices`-array bug. The string `due to event ticket pressure` and the `expectedSavings * 1.2`
   calculation are gone from `insightsEngine.js`'s live path. No server-side summary asserts a
   fare effect from an event.
8. `verdictEvidence.js` renders an event item that states its coverage limitation when
   `eventCoverage === 'ticketed-only'` (existing behaviour, preserved) and its confidence when
   the score is low-confidence (new). An `unscorable` event produces a neutral context item, not
   a directional one.
9. `npm test`, `npm run lint`, `npm run build` all green, with no existing test modified to
   accommodate a changed verdict — a test that has to change here is a test that was pinning the
   override, and it should be deleted with a comment saying so, not adjusted.

### P3b — the archive (ships second)

10. `supabase/event_observations.sql` creates the table with primary key
    `(source, event_id, event_date)`, the `(destination, event_date)` index, and RLS enabled with
    no policy.
11. With `EVENT_ARCHIVE_ENABLED != 'true'`, no archive write occurs and event lookups behave
    exactly as today.
12. With it enabled, a provider-answered `ok` lookup writes one row per event; a **cache hit
    writes nothing** (no new information, no new row).
13. An archive write failure logs a warning and the search still returns `200` with its events.
    Asserted by test, not by inspection.
14. `price_min`/`price_max` are `null` when the provider published no `priceRanges` — the
    `55`/`220` display defaults never reach the table.
15. Re-observing the same event on a later day updates `observed_at`, `is_sold_out` and the price
    band while preserving `first_seen_at`.
16. Ticketmaster calls consume a `DailyBudget` with limit `TICKETMASTER_DAILY_LIMIT`; when the
    ceiling is reached the provider reports `unavailable` (never `empty` — a suppressed lookup is
    not an empty one, per `dailyBudget.js`'s existing contract).
17. The backfill job is off by default, bounded by `EVENT_ARCHIVE_BACKFILL_DAYS`, marks every row
    `backfilled = true`, and logs one summary line: destinations covered, rows written, calls
    spent.

### P3c — the covariate (not started until §5.3's four entry criteria are met)

18. A `decisions.md` entry records the §3.1 axis decision, with reasoning, before any code.
19. The backtest harness exists and can report 7-day-ahead q50 MAE with and without the covariate
    on the same routes and date ranges.
20. `handler.py` accepts the new payload, has been smoke-tested by hand (P2 §2.1's `curl`
    method), and still returns the unchanged quantiles response shape.
21. With `FORECAST_EVENT_COVARIATE_ENABLED != 'true'`, `forecastService.js` sends byte-identical
    requests to today's.
22. With it on, a route with no event history sends a well-formed all-zeros covariate rather
    than omitting the column — a partially-present column is the one shape `predict_df` rejects.
23. A covariate build failure falls back to the covariate-free call, not to seasonal-naive: an
    event-lookup problem must not silently downgrade the forecast engine.
24. The backtest result — improvement or not — is recorded in `decisions.md` **before** the flag
    is enabled in production.

---

## 9. Test plan (Vitest)

Server-side tests live in `src/utils/__tests__/` per the existing convention
(`fareCollector.test.js`, `forecastCache.test.js`, `insightsEngine.test.js`).

- **`eventImpactScore.test.js`** (new) — the position-independence property (AC 2); missing
  price band lowers confidence rather than substituting defaults (AC 3); unscorable returns null
  (AC 4); every named weight has at least one test that would fail if it were changed silently.
- **`insightsEngine.test.js`** (exists — extend) — the load-bearing one: a top-of-scale event
  against a `WAIT` forecast still returns `WAIT` (AC 6). This file already exists specifically
  because KAI-004's safety argument rests on its recompute invariant; the no-override invariant
  belongs next to it for the same reason.
- **`ticketmasterProvider.test.js`** (exists — extend) — emits raw signals, no inline score
  (AC 5); price defaults absent (AC 14).
- **`verdictEvidence.test.js`** (exists — extend) — coverage and confidence phrasing, unscorable
  produces a neutral item (AC 8).
- **`eventArchive.test.js`** (new) — flag gating (AC 11); cache hit writes nothing (AC 12);
  write failure never fails the search (AC 13); re-observation preserves `first_seen_at`
  (AC 15). Reuse the Supabase builder stub already used by `forecastCache.test.js`.
- **`dailyBudget` wiring for Ticketmaster** — ceiling reached ⇒ `unavailable`, not `empty`
  (AC 16). Mirror the existing API-Sports budget tests.

`npm test` + `npm run lint` + `npm run build` green is the definition of done, per CLAUDE.md.

---

## 10. Cost

| Stage | Per user action | Per day | Cache implications |
|---|---|---|---|
| **P3a** | **Zero new external calls.** Pure function over a payload already fetched. | Zero | None. No cache path added, removed or bypassed. |
| **P3b steady-state** | **Zero.** Writes what `eventCache` already paid for. One Supabase upsert per event per cold lookup — Postgres, not a metered API. | Zero provider calls | Additive to `eventCache`, never a bypass. A cache hit writes nothing. |
| **P3b backfill** | n/a (a job, not a user action) | **One-off ~30–90 Ticketmaster calls** against a 5,000/day quota, newly ceilinged at 1,000 | Backfill rows bypass `eventCache` deliberately — they are archive rows for past windows nobody will search. |
| **P3c** | Zero new event calls (reads the archive). HF call count unchanged — same one batch call per route per day, larger body. | Unchanged | `forecast_cache` unchanged in shape. |

**The rejected embedding layer, priced for the record**: ~10 events × ~31 destinations ≈ 310
embedding calls per cold discovery window, plus a reranker pass, on HF Inference Providers'
pay-per-use billing — amortised by `eventCache` but a new billed dependency, a new extension and
a new migration, on the app's highest-fan-out path. §4 is why that is not worth it.

**The genuinely expensive thing in P3 is not API calls — it is time.** P3b's value is realised in
60–90 days, not on merge. That is the honest cost, and it is the reason to start it now rather
than when P3c is wanted.

---

## 11. Out of scope

- **The embedding / `pgvector` / reranker layer** — rejected in §4, with the condition that
  would reverse it.
- **`daysToDeparture <= 14 → BUY_NOW`** in the same `insightsEngine` branch. A different
  heuristic with a weaker but non-fabricated justification. Removing it alongside the event
  override would make any regression untraceable to a cause. Worth its own backlog item.
- **The `priceConfidenceEngine.js` client-side 12% recompute** (§2.2) — a live bug where the
  displayed recommendation and the displayed summary can come from different rules. Goes to
  `bug-fixer`, and it is more urgent than this spec.
- **Fixing the API-Sports `undefined` score comparison** in `insightsEngine`'s `reduce`
  (§2.1) beyond what AC 4 implicitly covers — dormant while `APISPORTS_DISABLED=1`, but it
  should be checked before that flag is ever cleared.
- **Departure-date-indexed forecasting / keying `forecast_cache` by horizon bucket** — KAI-002's
  open option (b). P3c will force the decision (§3.1) but does not carry the change.
- **Re-enabling API-Sports** (needs a paid plan) and **any new event provider** (SeatGeek,
  PredictHQ). PredictHQ in particular sells an event-impact score directly and would be a
  buy-versus-build conversation, not a P3 task.
- **The LLM narrative (P4).** P3a deletes a fabricated causal sentence; it does not write a
  better one.
- **Fine-tuning Chronos-2** on KAIRO's own data.

---

## 12. Rollout

Three separate PRs, in order. None of them self-merge.

1. **P3a — split in two by circumstance, not by design.** The verdict-decoupling half (AC 6, 7
   for `insightsEngine.js`) **already shipped as PR #36, 2026-09-05** — found and fixed while
   reviewing this spec, ahead of the rest of P3a. Manually verified before merge: a search
   against a sold-out event no longer flips the verdict, and no summary claims a fare effect.
   **What remains** — `eventImpactScore.js` itself (AC 1–5, 8) and the `priceConfidenceEngine.js`
   half of AC 7 — still touches `insightsEngine.js`, still on the stop-list (*"the verdict
   engines — a plausible-looking wrong answer here is the one failure mode users act on with
   their own money"*), **still a PR for Roy, same as KAI-002/003/004/PR #36.**
2. **P3b** — new table (a migration), a new `DailyBudget` on a provider, a write path beside an
   existing cache. Stop-list: the budget/cache layer. **PR for Roy.** Live sequence: run
   `supabase/event_observations.sql` → set `TICKETMASTER_DAILY_LIMIT` → set
   `EVENT_ARCHIVE_ENABLED=true` → confirm rows appear and `api_usage_daily` counts Ticketmaster
   → run the backfill once, then turn it off.
3. **P3c** — blocked. Do not open a PR until §5.3's four criteria are met and AC 18–20 are
   discharged. When it does move, `handler.py` in the external repo changes and is smoke-tested
   **before** `forecastService.js` sends the new shape.

A merge is a production deploy: not done until `deploy.yml` is green and the change is confirmed
live at https://roydekel.github.io/kairo/.

---

## 13. Success metrics

One per stage, stated before the build.

- **P3a — the fraction of `/api/flights` responses where `insights.recommendation` differs from
  the forecast engine's own `verdict`.** Baseline (pre-PR-#36): unmeasured, non-zero on every
  search of a city with a sold-out listing. **Target: 0% — already structurally true post-PR-#36**,
  since the code path that could produce a difference no longer exists; the metric is now an
  invariant `insightsEngine.test.js` enforces rather than something to keep measuring. Events
  change the evidence and the explanation; they never change the answer.
- **P3b — days of joint (fare, event) coverage on featured routes.** Target: 60+ days on ≥ 5
  featured routes, which is precisely P3c's entry criterion. A count query, not a judgement.
- **P3c — 7-day-ahead q50 MAE against the realised daily index, with the covariate versus
  without, same routes and dates.** Target: strictly better. **If it is not better, P3c does not
  ship**, and the negative result goes in `decisions.md` — which is a cheap, honest outcome, not
  a failure.

---

## 14. Risks / open questions

- **The biggest risk in P3 was the one it removes — and the removal shipped, PR #36, 2026-09-05,
  before the rest of this spec did.** A sold-out comedy club no longer outranks Chronos-2 on the
  live production verdict. What's left of P3a is replacing the still-fabricated number
  (`ticketmasterProvider.js:194`) with `eventImpactScore.js`'s real one — lower-stakes now that
  it can't flip BUY/WAIT, but still worth doing so the evidence users read is honest too.
  Everything else in this spec is a data-collection exercise; P3a was a trust repair, and it is
  why the stages were ordered this way rather than starting with the covariate the roadmap leads
  with.
- **P3a will make some verdicts *less* decisive**, and that is correct, not a regression.
  "BUY NOW (EVENT SURGE)" reads better than "WAIT" and was, on that path, not earned. Expect the
  BUY rate on event-heavy destinations to fall. If someone later reads that as a bug, this
  paragraph is the answer.
- **The scorer's weights are a starting guess**, exactly as `FORECAST_PRICE_DRIFT_TOLERANCE=0.08`
  and `FORECAST_PRICE_SANITY_MULTIPLE=5` were. The difference is that this one is not permitted
  to move a verdict, so a wrong weight costs a misleading evidence line rather than a wrong BUY.
  Tune from `event_observations` once there is history; that is what `impact_inputs` is for.
- **P3b's value is entirely deferred.** It ships and nothing visible happens for two months.
  That is the least popular kind of work and the reason it will keep getting postponed if it
  is not started now. Ticketmaster does not sell the past.
- **P3c may not work, and the honest answer might be "events are not a usable covariate at
  KAIRO's data scale."** Ten featured routes, a 90-day window and a handful of event days per
  route is thin for in-context learning. Discovering that from a backtest costs a fortnight;
  discovering it from a live wrong verdict costs a user.
- **`forecastService.js` and `insightsEngine.js` are both on the `ship-change` stop-list.**
  Every stage here ships as a PR Roy reviews, never an agent self-merge — same as KAI-002,
  KAI-003 and KAI-004 before it. `pgvector` would have added a new external dependency, also
  stop-list; §4 removes that from the plan entirely.
- **Open: does the event window used for scoring match the travel window or the departure
  date?** Today `getEventsForDestination(destination, departureDate, returnDate)` uses the whole
  trip. For evidence that is right. For a covariate it may not be — arrival-day pressure and
  mid-trip pressure are different things. Decide with §3.1, not before.
- **Open: what happens to `event_observations` for a destination that leaves the featured set?**
  Nothing, deliberately — the archive is append-only history and dropping rows would silently
  shorten a context window later. Worth revisiting only if the table's size becomes a Supabase
  free-tier problem, which at ~10 destinations × ~10 events × ~365 days it will not.
