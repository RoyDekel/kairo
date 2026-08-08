# KAIRO — Project Context

Shared context for every Claude agent working in this repo. Read before doing anything.

## What this is

KAIRO is an AI flight-price intelligence web app: it predicts whether fares will rise or
drop, issues a BUY / WAIT / HOLD verdict with a confidence score, and pairs destinations
with live sports fixtures and concerts across 32 global hubs.

Live: https://roydekel.github.io/kairo/
Backend: https://flight-tracker-backend-8bxt.onrender.com (Render)

## Stack

- **Frontend**: React 19, Vite 8, plain JS (ES modules, `.jsx`). No TypeScript.
- **Styling**: CSS variables, glassmorphic dark UI. No Tailwind, no CSS-in-JS.
- **Map**: Leaflet 1.9 + react-leaflet 5 + leaflet.geodesic (CartoDB Dark Matter tiles)
- **Charts**: Chart.js 4 + react-chartjs-2
- **Icons**: lucide-react
- **Backend**: Node + Express 5 (`server.js` + `server/`)
- **Auth/DB**: Supabase (Auth JWT + Postgres cache tables)
- **Tests**: Vitest 4 + React Testing Library + jsdom; Playwright for e2e
- **Deploy**: GitHub Actions → GitHub Pages (frontend). Backend deploys separately on Render.

## Layout

```
src/
  App.jsx              orchestrates global state (search, bundle, watchlist, alerts, sim)
  components/          UI; each has __tests__/ alongside
  contexts/            AuthProvider.jsx (Supabase session)
  lib/                 apiBase.js, dataService.js, supabaseClient.js
  utils/               pure logic: flightSimulator, priceConfidenceEngine,
                       destinationMatchScore, destinationFareVerdict, aiDestinationEngine,
                       verdictEvidence, discoveryEventCache
server/
  providers/           flight + event data sources (serpapi, kiwi, travelpayouts, fli,
                       ticketmaster, apiSports, openSky) + simulated fallbacks
  services/            caching, rate limiting, budget, forecast, insights, notifier
  jobs/                fareCollector, alertEvaluator, keepAlive (node-cron)
shared/                catalog.js + catalog.generated.js (32 airports), fixtures, clubCities
docs/product/          roadmap, backlog, decisions — product source of truth
.claude/agents/        feature-dev, bug-fixer, product-manager
.claude/skills/        ship-change (the path to main), testing-planner/designer/executor,
                       release-stuck-server
```

## Commands

| Purpose | Command |
|---|---|
| Full dev (client + server) | `npm run dev` |
| Client only | `npm run dev:client` (Vite, port 5173) |
| Server only | `npm run dev:server` (Express, port 3001) |
| Unit tests | `npm test` (vitest --run) |
| Watch tests | `npm run test:watch` |
| E2E | `npm run test:e2e` |
| Lint | `npm run lint` |
| Prod build | `npm run build` |

**The definition of done for any code change is: `npm test` passes AND `npm run lint` is
clean AND `npm run build` succeeds.** Those same three run in `ci.yml` on every pull
request, and `deploy.yml` runs `npm test` again on merge — a failing test blocks both the
merge and the deploy.

## Hard rules

1. **Never commit secrets.** `.env` is real and gitignored. `.env.example` is the template
   that gets updated when a new key is introduced.
2. **`VITE_API_URL`** must stay set as a GitHub Actions secret. `src/lib/apiBase.js` has a
   hardcoded production fallback — it is a safety net, not a substitute.
3. **Every provider needs a simulated fallback.** External APIs are rate-limited and
   metered; the app must degrade to simulated data rather than error out.
4. **Respect the caches.** `quoteCache`, `flightSearchCache`, `eventCache`,
   `persistentDayCache`, `dailyBudget`, `eventUsageMeter` exist because these APIs cost
   money per call. Don't add a code path that bypasses them.
5. **`vite.config.js` sets `base: '/kairo/'`.** Anything that constructs an asset or route
   URL must account for it.
6. **Pure logic goes in `src/utils/` or `server/services/`, not in components.** That's
   what makes it testable, and the test suite reflects it.
7. **eslint config is environment-split** (browser for `src/`, node for `server/`+`shared/`+
   `tests/`). Put new files where their globals are already configured.

## Testing conventions

- Unit tests live in `__tests__/` next to the code, named `*.test.js` / `*.test.jsx`.
- Mock Leaflet (`L.map`, `L.marker`, `L.polyline`, `L.divIcon`, `fitBounds`) and
  `react-chartjs-2` — jsdom has no canvas.
- `src/setupTests.js` is the global setup. Playwright specs live in `tests/`.
- Deeper guidance: `.claude/skills/testing-planner/SKILL.md` and its sibling skills.

## Git — `main` is protected

**Nothing is pushed to `main` directly. Every change goes through a pull request.**

```
branch → commit → push → PR → ci.yml green → squash-merge → deploy.yml publishes
```

- The full procedure lives in `.claude/skills/ship-change/SKILL.md`. Follow it verbatim at
  the end of any task that changed a file. Requires `gh` installed and authenticated.
- Branch names: `feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…` (kebab-case, 2–4 words).
- Commit messages follow the existing style: `fix(forecast): …`, `UI: …`, `ci: …`.
- Agents merge their own PR **only** when CI is green *and* the diff misses every row of
  the stop-list in `ship-change`. The stop-list covers the verdict engines, auth, the
  budget/cache layer, CI config, new dependencies, and any diff over ~400 lines — those
  open a PR and wait for Roy.
- **A merge is a production deploy.** The job isn't done until `deploy.yml` is green and
  the change is confirmed live at https://roydekel.github.io/kairo/.
