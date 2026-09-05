# KAIRO Roadmap

> Maintained by the `product-manager` agent. Themes and sequencing, not a task list —
> individual items live in `backlog.md`.

**Product promise**: Never overpay for flights. KAIRO tells you whether to buy now or wait,
and shows you why.

**Primary user**: _(to be defined — the PM agent should force this on first session)_

**Core bet**: A price verdict you can trust, made richer by knowing *why* a route is
expensive right now (an event, a season, a demand spike). Google Flights tells you the
price. KAIRO tells you what to do about it.

---

## The forecasting arc (P1 → P4)

A single dependency chain turns the current seasonal-naive verdict into an event-aware,
model-driven one. Each phase is a prerequisite for the next — the order is forced, not a
preference. **The data-logging foundation is already live**: the fare collector and the
`fare_observations` table have been collecting real quotes on the featured routes since
Phase 2, so every phase below builds on real history rather than a cold start.

```
[LIVE] collector + fare_observations   →   [SHIPPED] P1 → [SHIPPED] P2 → P3 → P4
```

## Now

- **P3 — Events-as-covariate loop.** Turn the event overlay from decoration into signal:
  Ticketmaster events → e5 embeddings → `pgvector` similarity → an `event_impact_score` fed
  into Chronos as a covariate, so "a concert is spiking this route" becomes part of the
  forecast rather than a badge beside it. **Unblocked** — P2 is live, so there is now a
  covariate slot to feed: `roydekel/chronos-2-kairo`'s `handler.py` calls
  `pipeline.predict_df` and would need `future_df` wired through with the real forecast's
  known-future covariates for this to land on the model side; `forecastService.js`'s request
  payload (currently just `inputs` + `prediction_length`/`num_samples`) would need an
  `event_impact_score` column added, matching `handler.py`.
  **Spec written 2026-09-05 (KAI-006): `specs/p3-events-covariate-loop.md` — and it revises this
  entry.** Reading the code found that the event score is not decoration beside the prediction;
  it is already inside it and already fabricated (`isSoldOut ? 96 : 75 + (idx % 20)`, forcing
  BUY_NOW at ≥90). It also found two blockers this entry does not name: the forecast series is
  indexed on `observed_at` rather than departure date, and Chronos-2's `predict_df` conditions a
  covariate on its **past** values, which KAIRO has no event history to supply. So P3 resequences
  into P3a (fix the score, stop it overriding the verdict — buildable now, zero cost), P3b (start
  the event archive — buildable now), P3c (the covariate — blocked). The e5/`pgvector`/reranker
  chain named above is **rejected**; see `decisions.md`, 2026-09-05.
  **Half of P3a already shipped, same day**: [PR #36](https://github.com/RoyDekel/kairo/pull/36)
  stopped the score overriding the verdict and deleted the fabricated narrative. Still open:
  `eventImpactScore.js` (a real scorer to replace the still-fabricated number in
  `ticketmasterProvider.js`) and P3b/P3c in full.

## Shipped

- **P1 — Nightly batch forecast + `forecast_cache`** — _shipped (KAI-002), PR #7, live
  2026-08-09._ A `node-cron` job precomputes verdicts for the featured routes off the request
  path and writes them to a Supabase `forecast_cache` table; `/api/flights` reads the cached
  verdict instead of computing live. Confirmed serving hits in prod; remaining work is
  measuring the real hit rate (see backlog). Spec: `specs/p1-nightly-batch-forecast.md`.
- **P2 — Wire the live Chronos-2 endpoint into Render and verify.** _shipped (KAI-003),
  2026-08-22, config-only (no PR — nothing changed in `main`)._ `roydekel/chronos-2-kairo`'s
  Dedicated Inference Endpoint is wired into Render (`HF_ENDPOINT_URL`/`HF_API_KEY`), and
  every `forecast_cache` row now carries `reason: huggingface_chronos_forecast` instead of
  `seasonal_naive_forecast`. `FORECAST_LIVE_HF_ENABLED=false` — the endpoint is scale-to-zero,
  so only the nightly batch calls it; live request-path misses still serve seasonal-naive
  rather than risk a cold-start timeout (decisions.md, 2026-08-22). Spec:
  `specs/p2-hf-endpoint-rollout.md`.

## Later

- **P4 — LLM verdict narrative (`gpt-oss-20b`).** A natural-language "why" beneath the
  verdict, generated from the model's own evidence. **Deliberately last**: a fluent
  explanation of a wrong verdict is more dangerous than no explanation, so the numbers have
  to be trustworthy (P1–P3) before we let prose speak for them.

## Explicitly not doing

_See `decisions.md` for rejections and their reasoning._

---

## Health metrics to watch

| Metric | Why it matters | Current |
|---|---|---|
| Verdict accuracy (BUY/WAIT vs. actual 7-day price move) | The entire product rests on it | unmeasured |
| External API spend per active user | Unit economics; `dailyBudget` caps it | unmeasured |
| Cache hit rate (quote / event) | Directly drives the above | unmeasured |
| Return visits per watchlist created | Whether the alert loop works | unmeasured |

Three of four being unmeasured is itself the most important thing on this page.
