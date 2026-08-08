---
name: ship-change
description: The single path by which any code change reaches main in KAIRO — branch, commit, push, open a pull request, wait for CI, merge. Use at the end of every task that modified files, whether it was a feature, a bug fix, a config change, or a docs change. Both feature-dev and bug-fixer end here. Also use when asked to "open a PR", "ship this", "push this up", or "merge it".
---

# Shipping a change to KAIRO

`main` is protected. Nothing is pushed to it directly — including by you. Every change
travels: **branch → commit → push → PR → green CI → merge**. `deploy.yml` fires on the
merge and publishes to GitHub Pages, so a merge *is* a production deploy. Treat it that way.

## Prerequisite

This requires the GitHub CLI (`gh`) to be installed and authenticated. Verify once:

```bash
gh auth status
```

If it fails, stop and tell Roy: `winget install GitHub.cli` then `gh auth login`. Do not
fall back to pushing to `main` because `gh` is missing.

---

## 0. Check the stop-list FIRST

**Some changes never auto-merge, no matter how green CI is.** Before you start, check
whether your diff touches any of these:

| Surface | Why it stops |
|---|---|
| `src/utils/priceConfidenceEngine.js`, `destinationFareVerdict.js`, `verdictEvidence.js`, `server/services/forecastService.js` | These produce the BUY/WAIT verdict. A plausible-looking wrong answer here is the one failure mode users act on with their own money, and no test suite can tell you the prediction became *less true*. |
| `src/contexts/AuthProvider.jsx`, `src/lib/supabaseClient.js`, `server/services/supabaseServer.js`, anything touching auth or RLS | A green test suite does not prove you didn't widen access. |
| `server/services/dailyBudget.js`, `eventUsageMeter.js`, any cache in `server/services/` | These cap real money spent on metered APIs. A bug here bills silently. |
| `.github/workflows/**`, `.env.example`, `vite.config.js`, `eslint.config.js` | Changing the gate itself. CI cannot validate its own weakening. |
| Any change that adds an npm dependency | Bundle size and supply-chain surface are human calls. |
| A diff over ~400 changed lines | Too large for CI to be meaningful evidence on its own. |

If **any** row matches: open the PR as normal, then **stop and tell Roy it's waiting for his
review**, naming which row triggered it. Do not merge.

Everything else: proceed through to merge on green.

---

## 1. Branch

Never work on `main`. Branch from an up-to-date `main`:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b <type>/<short-slug>
```

`<type>` is `feat`, `fix`, `chore`, `ci`, or `docs`. Slug is 2–4 words, kebab-case:
`fix/verdict-confidence-constant`, `feat/watchlist-price-drop-email`.

If you already made your edits on `main` before reading this, do not panic and do not
reset — `git stash`, branch, `git stash pop`.

## 2. Commit

One logical change per commit. Match the repo's existing style:

```
fix(forecast): stop reporting a confidence score that was a constant
feat(watchlist): email the user when a tracked fare drops below target
UI: render responsive tab list for Trip Type on mobile
ci: run test, lint and build on pull requests
```

Body: **why**, not what — the diff already says what. Wrap at 72 characters.

Before committing, run `git status` and `git diff --staged` and actually read them. Confirm
no `.env`, no key, no token, no `dist/`, no `node_modules/`, no stray debug logging, no
`.only` left on a test.

## 3. Push and open the PR

```bash
git push -u origin <branch>
gh pr create --base main --title "<same as commit subject>" --body "<see template>"
```

PR body template — fill every section, no placeholders left behind:

```markdown
## What
One or two sentences. Behaviour, not implementation.

## Why
The user problem, or the bug's root cause. Link the backlog item
(docs/product/backlog.md [KAI-xxx]) if there is one.

## How
The approach, and any non-obvious decision worth defending in review.

## Verification
- `npm test` — <result>
- `npm run lint` — <result>
- `npm run build` — <result>
- Reproduction re-run (bug fixes only): <what you did, what you saw>

## Risk
What could this break? What did you deliberately not change?
Stop-list surfaces touched: <none | which ones>
```

## 4. Wait for CI — genuinely wait

```bash
gh pr checks --watch
```

Do not merge on an assumption. Do not merge while checks are pending or queued.

**If CI fails:** fix it on the same branch and push again. Never merge a red PR, never
disable a check, never edit `ci.yml` to make your own PR pass — that lands you on the
stop-list and needs Roy either way.

## 5. Merge

Only when: checks are green, and step 0 found nothing.

```bash
gh pr merge --squash --delete-branch
```

Squash keeps `main` one-commit-per-change, which is what makes `git log --oneline` in this
repo readable and `git revert` a single safe operation.

## 6. Verify the deploy — you are not done at merge

The merge triggers `deploy.yml`, which runs `npm test` again, checks the `VITE_API_URL`
secret, builds, and publishes to Pages.

```bash
gh run watch
```

Then confirm the change is actually live at https://roydekel.github.io/kairo/ — a green
workflow has published a stale or broken bundle in this repo's history before, which is
why `deploy.yml` carries the comment block it does.

**If the deploy fails:** say so immediately and loudly. `main` is now ahead of production.
Diagnose before doing anything else; do not start another task on top of it.

## 7. Report

Close out with: PR number and URL, merge commit SHA, deploy run status, and the live-site
confirmation. If you stopped at step 0 or step 4 instead, say exactly that and why.

---

## Never

- `git push origin main` — directly, force, or otherwise.
- `--admin`, `--no-verify`, or any flag whose purpose is bypassing a check.
- Merging your own PR when the stop-list matched.
- Reporting "shipped" before the deploy run is green and the live site confirms it.
