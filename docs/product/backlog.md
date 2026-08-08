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

## [KAI-001] Remove the 11 setState-in-effect cascading renders
**Status**: proposed
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
- [ ] `npx eslint .` reports 0 `react-hooks/set-state-in-effect` warnings.
- [ ] `react-hooks/set-state-in-effect` is back to `error` in `eslint.config.js`, and the
      downgrade comment is deleted rather than edited.
- [ ] `npm test` passes with no test modified to accommodate a render-count change.
- [ ] Manually verified unchanged: outbound/return toggle, simulator run to completion,
      alert firing into the notification tray, and the "When to Go" → "Search & Compare"
      handoff that re-hydrates the search form.

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
