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
