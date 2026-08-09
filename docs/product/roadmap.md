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
[LIVE] collector + fare_observations   →   P1 → P2 → P3 → P4
```

## Now

- **P1 — Nightly batch forecast + `forecast_cache`** — _in progress (KAI-002)._
  A `node-cron` job precomputes verdicts for the featured routes off the request path and
  writes them to a Supabase `forecast_cache` table; `/api/flights` reads the cached verdict
  instead of computing live. Pays off immediately on the seasonal-naive engine by removing
  forecast latency from the request, and is the **prerequisite** that makes a Chronos
  endpoint usable (a live HF call cold-starts slower than the 4s request timeout on Render's
  free tier). Spec: `specs/p1-nightly-batch-forecast.md`.

## Next

- **P2 — Stand up the Chronos-2 HF endpoint and point the batch at it.**
  Provision the `amazon/chronos-2` Dedicated Inference Endpoint, set `HF_ENDPOINT_URL`, and
  let the batch (which already calls it when the var is set) run it off the request path
  where a slow cold start is harmless. **Blocked on P1** (without precompute the endpoint is
  unusable) **and on a cost decision** — a dedicated endpoint bills for uptime, so someone
  has to sign off the run rate before it goes on.

## Later

- **P3 — Events-as-covariate loop.** Turn the event overlay from decoration into signal:
  Ticketmaster events → e5 embeddings → `pgvector` similarity → an `event_impact_score` fed
  into Chronos as a covariate, so "a concert is spiking this route" becomes part of the
  forecast rather than a badge beside it. **Depends on P2** — there is no covariate slot
  until the model taking covariates is live.
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
