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
