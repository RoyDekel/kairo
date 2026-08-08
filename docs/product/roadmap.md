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

## Now

_Empty. Run the `product-manager` agent to populate._

## Next

_Empty._

## Later

_Empty._

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
