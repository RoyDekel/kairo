# KAIRO — Open-Source Integration Plan

**Repo:** `github.com/RoyDekel/kairo`
**Date:** 2 August 2026
**Status:** Proposal — not yet executed

---

## 0. Executive summary

KAIRO's backend architecture is sound. The provider abstraction (`FlightProvider` →
`SerpApi` / `Kiwi` / `TravelPayouts` / `Simulated`), the two-tier cache
(`quoteCache` in-memory + `flightSearchCache` in Postgres), and the JWT boundary are all
built correctly. `fareHistory.js` in particular is the strongest module in the repo — it
already refuses to record simulated fares and reports `null` rather than inventing a
baseline.

Three structural problems remain, and every one of them has an open-source answer:

| # | Problem | Consequence | Fix |
|---|---------|-------------|-----|
| 1 | Real fares cost money per search (SerpApi) | `estimateFlights()` is hardwired to `simulated`, so the entire "When to Go" page shows invented prices | Replace SerpApi with **`fli`** (free, no key) |
| 2 | Fares are only recorded when a user happens to search | `fare_observations` fills slowly and is biased toward routes people already looked at; `MIN_OBSERVATIONS = 5` is rarely met | Add a **scheduled collector** (pattern from flight-finder) |
| 3 | `priceConfidenceEngine.js` fabricates its own evidence | `low90Day = currentPrice * 0.75`, `confidenceScore = 84 + hash % 12`, and a 7-point `priceHistory` derived entirely from today's price | Replace with **real forecasting** over the collected observations |

Problem 3 deserves emphasis. The comment block in `fare_observations.sql` correctly
identifies this exact anti-pattern and fixes it on the server. The client-side engine
still does it — the same mistake, one layer up. Phases 1 and 2 exist largely to make
Phase 5 possible.

**Recommended order:** Phase 1 → Phase 2 → Phase 3 → Phase 5 are the critical path.
Phases 4, 6 and 7 are independent and can run in parallel or be deferred.

---

## 1. Current-state assessment

### What is solid and should not be touched

| Module | Why it's good |
|--------|---------------|
| `server/services/fareHistory.js` | Rejects simulated fares at the write site, batches route stats into one query, returns `null` below `MIN_OBSERVATIONS` instead of guessing |
| `server/services/flightSearchCache.js` + `quoteCache.js` | Correctly refuses to cache simulated results, so a provider outage doesn't poison the cache |
| `server/providers/flightProvider.js` | Clean base class. The new providers below slot in without touching it |
| `server.js` `/api/flights/estimates` | Already prefers a real cached quote over an estimate, and already labels its source |
| Test coverage | 25+ Vitest suites plus Playwright. Regression risk on refactor is genuinely low |

### What needs to change

| Module | Issue |
|--------|-------|
| `src/utils/priceConfidenceEngine.js` | Every number is synthesized from the current price. This is the single biggest credibility problem in the product |
| `server/services/flightSearchService.js` | `estimateFlights()` hardcodes `providers.simulated`. Single active provider, no chain, no per-call override |
| `shared/catalog.js` | 32 airports hardcoded (9.4 KB). Any new route requires a code change and a deploy |
| `server/providers/apiSportsProvider.js` | 18 KB of quota management (`dailyBudget.js`, `fixtures_cache`) for data that is free elsewhere |
| `src/utils/flightSimulator.js` | Simulated telemetry presented in a "Telemetry HUD" |
| `package.json` | `amadeus@^11` is installed but never imported — dead dependency |

---

## 2. Guiding principles for this work

1. **Never regress the fabrication rule.** `fareHistory` rejects `provider === 'simulated'`.
   Every new provider must return a truthful `providerName`, and any new estimator must be
   labelled `source: 'estimate'` end-to-end.
2. **New providers are additive.** Each phase adds a class implementing `FlightProvider`.
   Nothing existing gets deleted until the replacement has run in production for a week.
3. **One env flag per phase.** Every change ships behind a flag defaulting to current
   behaviour, so rollback is an env change and not a revert.
4. **Stay in Node where possible.** `fli` ships a first-party TypeScript port (`fli-js`),
   so the main provider needs no sidecar at all. Reserve Python sidecars for the one
   thing that genuinely requires them — forecasting in Phase 5.

---

## Phase 0 — Prerequisites

**Effort:** 1 hour · **Risk:** none

- [ ] Remove the unused `amadeus` dependency from `package.json`
- [ ] Extend `.env.example` with the new variables introduced below
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is available to any process that writes
      `fare_observations` (RLS is enabled with no policy, so only the service key writes)
- [ ] Add the `currency` column from Phase 2 **now** — see §7, "First commit"

---

## Phase 1 — Free flight data via `fli-js`

> **Goal:** eliminate the per-search cost that forces the discovery page onto simulated data.

**Source:** [`punitarani/fli`](https://github.com/punitarani/fli) — MIT, reverse-engineered
Google Flights internal API. No scraping, no browser, no API key, sub-second.
**Effort:** 2 days · **Risk:** medium (Google can change the internal format)

### The important detail: no sidecar needed

`fli` publishes a **1:1 TypeScript port as [`fli-js`](https://www.npmjs.com/package/fli-js)** —
same models, same filter encoding, same direct-API approach. KAIRO is an ESM Node project,
so this is a plain `npm install` and a new provider class. No Python, no Docker, no extra
process to operate.

It also supports more than SerpApi does on the axes you already use:

| Capability | KAIRO needs it for | `fli-js` |
|---|---|---|
| `currency` (ISO 4217) | `fare_observations.currency` | ✅ `search(filters, { currency })` |
| `country` / `gl=` | Per-market price comparison | ✅ |
| Cabin class | `travelClass` query param | ✅ ECONOMY / PREMIUM_ECONOMY / BUSINESS / FIRST |
| Max stops | `stops` query param | ✅ ANY / NON_STOP / ONE_STOP / TWO_PLUS_STOPS |
| Round trip | `/api/flights` | ✅ |
| Built-in rate limiting + retries | Phase 2 collector | ✅ |
| **Cheapest-dates search** | Not built yet — see below | ✅ `search_dates` |

That last row is a free feature. `search_dates` returns the cheapest travel dates across a
range, which is exactly the primitive KAIRO's "When to Go" page is trying to approximate.
Worth a follow-up ticket after this phase lands.

### Architecture

```
Express (server.js)
    │
    ▼
FlightSearchService
    ├── FliProvider          ──▶  fli-js  ──▶  Google Flights internal API
    ├── SerpApiProvider           (in-process, no sidecar)
    ├── KiwiProvider
    ├── TravelPayoutsProvider
    └── SimulatedProvider    (last resort)
```

### Files

**Modified — `package.json`**

```bash
npm install fli-js
```

> Pin the exact version. This library depends on an undocumented Google format; an
> unpinned upgrade is an unannounced breaking change. Use `~` at most, never `^`.

**New — `server/providers/fliProvider.js`**

Mirror `serpapiProvider.js`. It already contains all the shape-mapping logic you need —
reuse `mapSerpApiToFlight`'s output contract verbatim so nothing downstream changes:

```js
import { Airport, FlightSearchFilters, FlightSegment, SearchFlights, SeatType }
  from 'fli-js';
import { FlightProvider } from './flightProvider.js';
import { AIRPORTS, getDistance, calculatePassengerCost } from './constants.js';

const SEAT_BY_TRAVEL_CLASS = {
  '1': SeatType.ECONOMY,
  '2': SeatType.PREMIUM_ECONOMY,
  '3': SeatType.BUSINESS,
  '4': SeatType.FIRST,
};

export class FliProvider extends FlightProvider {
  async searchAsync({ origin, destination, departureDate, returnDate,
                      passengers, travelClass }) {
    const [out, ret] = await Promise.all([
      this.fetchLeg(origin, destination, departureDate, passengers, travelClass),
      returnDate
        ? this.fetchLeg(destination, origin, returnDate, passengers, travelClass)
        : Promise.resolve([]),
    ]);
    return {
      outbound: out.map(o => this.mapToFlight(o, 'outbound', passengers)).filter(Boolean),
      return:   ret.map(o => this.mapToFlight(o, 'return',   passengers)).filter(Boolean),
    };
  }

  async fetchLeg(from, to, date, passengers, travelClass) {
    // Airport is an enum keyed by IATA. An unknown code must fail loudly here rather
    // than silently produce an empty result that looks like "no flights available".
    if (!Airport[from] || !Airport[to]) {
      throw new Error(`[fli] Unsupported IATA code: ${!Airport[from] ? from : to}`);
    }
    const filters = new FlightSearchFilters({
      passenger_info: {
        adults: passengers?.adults ?? 1,
        children: passengers?.children ?? 0,
        infants_in_seat: passengers?.infants ?? 0,
        infants_on_lap: 0,
      },
      flight_segments: [new FlightSegment({
        departure_airport: [[[Airport[from], 0]]],
        arrival_airport:   [[[Airport[to],   0]]],
        travel_date: date,
      })],
      seat_type: SEAT_BY_TRAVEL_CLASS[travelClass] ?? SeatType.ECONOMY,
    });
    // Currency is pinned, not defaulted. fare_observations medians are only meaningful
    // within a single currency — see Phase 2.
    return await new SearchFlights().search(filters, {
      currency: process.env.FARE_CURRENCY || 'USD',
    }) || [];
  }

  // mapToFlight: must emit the identical field set as mapSerpApiToFlight —
  // id, flightNumber, airlineCode, airlineName, departureTime, arrivalTime, duration,
  // durationVal, price, passengerCosts, cabinClass, stops, planeType, terminal,
  // baggage, reliability, seatsRemaining, direction, origin, destination, distance.
  // Note fli returns duration in MINUTES and legs under `flight.legs`.
}
```

**Modified — `server/services/flightSearchService.js`**

Two changes. First, register the provider and put it first in autodetect:

```js
this.providers = {
  simulated: new SimulatedProvider(),
  kiwi: new KiwiProvider(),
  travelpayouts: new TravelPayoutsProvider(),
  serpapi: new SerpApiProvider(),
  fli: new FliProvider(),          // new
};

determineActiveProvider() {
  const configured = process.env.FLIGHT_PROVIDER;
  if (configured && this.providers[configured.toLowerCase()]) {
    return configured.toLowerCase();
  }
  if (process.env.FLI_ENABLED === 'true') return 'fli';   // free — try before paid
  if (process.env.SERPAPI_KEY?.trim()) return 'serpapi';
  // ... unchanged
}
```

Second — and this is the change that actually matters — make `estimateFlights()` capable
of using a real provider:

```js
/**
 * Breadth-first pricing for the discovery page.
 *
 * Historically this always used the simulated provider because paid providers bill per
 * search. With a free provider configured that constraint is gone, so real quotes are
 * used when one is available and the simulated provider becomes the fallback rather
 * than the default.
 *
 * Callers MUST continue to label the result. `providerUsed` is returned so `source`
 * can be set to 'live' or 'estimate' honestly rather than by assumption.
 */
async estimateFlights(searchRequest) {
  if (process.env.ESTIMATES_USE_REAL_PROVIDER === 'true'
      && this.activeProviderName !== 'simulated') {
    try {
      const results = await this.activeProvider.searchAsync(searchRequest);
      return { ...results, providerUsed: this.activeProviderName };
    } catch (err) {
      console.warn(`[estimateFlights] ${this.activeProviderName} failed, `
                 + `falling back to simulated: ${err.message}`);
    }
  }
  return { ...(await this.providers.simulated.searchAsync(searchRequest)),
           providerUsed: 'simulated' };
}
```

**Modified — `server.js`, `/api/flights/estimates`**

The `source` and `provider` fields are currently hardcoded to `'estimate'` / `'simulated'`
in the non-cached branch. Derive them instead:

```js
const results = await flightSearchService.estimateFlights({ /* ...unchanged... */ });
const providerUsed = results.providerUsed || 'simulated';
// ...
return {
  destination,
  roundtripPrice: outbound.price + (returnFlight ? returnFlight.price : 0),
  outbound,
  return: returnFlight,
  source: providerUsed === 'simulated' ? 'estimate' : 'live',
  provider: providerUsed,
  quotedAt: providerUsed === 'simulated' ? null : new Date().toISOString(),
};
```

Add a concurrency cap here. `estimateFlights` currently fans out with a bare
`Promise.allSettled` over up to 60 destinations — acceptable against an in-process
simulator, a stampede against a live upstream. Cap it at 6–8 concurrent.

### Environment

```env
FLI_ENABLED=true
FLIGHT_PROVIDER=fli
FARE_CURRENCY=USD                   # pinned, not defaulted — see Phase 2
ESTIMATES_USE_REAL_PROVIDER=false   # flip to true once fli is stable in prod
ESTIMATES_MAX_CONCURRENCY=6
```

### Tests

- `src/utils/__tests__/fliProvider.test.js` — mirror `serpapiProvider.test.js`, mock
  `SearchFlights.search`, assert the mapped shape matches `mapSerpApiToFlight`'s contract
  field for field
- Extend `providerDiagnostics.test.js` with the new autodetect precedence
- Extend `priceConsistency.test.js` to assert `source: 'live'` is never emitted for a
  simulated result
- Add a case for an IATA code absent from `fli`'s `Airport` enum — it must throw, not
  return `[]`. An empty array is indistinguishable from "no flights on this route",
  which is the kind of silent lie `fareHistory` was written to avoid

### Exit criteria

`fli-js` returns real offers for TLV→BCN, TLV→JFK and TLV→NRT; `/api/flights` produces the
same field shape as under SerpApi; the full Vitest suite passes unchanged.

### Follow-up ticket

Wire `fli`'s `search_dates` into a new `/api/flights/cheapest-dates` endpoint. KAIRO
currently approximates "when should I go" from single-date estimates; this returns it
directly from the source.

---

## Phase 2 — Scheduled fare collector

> **Goal:** stop depending on user traffic to build the historical baseline.

**Pattern source:** [`affromero/flight-finder`](https://github.com/affromero/flight-finder) — its
built-in `node-cron` scraper loop and price-snapshot model.
**Effort:** 2 days · **Risk:** low · **Depends on:** Phase 1

### The problem in numbers

`fareHistory.record()` is called from exactly one place: the `/api/flights` handler, after
a user search. `MIN_OBSERVATIONS = 5` means a route needs five separate user searches
before any percentile is reported. With a 32-hub catalog that is 496 directional route
pairs. The baseline will effectively never populate, and where it does, it will be biased
toward whatever people happened to search.

A collector fixes both: coverage becomes deterministic and unbiased.

### Files

```bash
npm install node-cron     # not currently a dependency
```

**New — `server/jobs/fareCollector.js`**

```js
import cron from 'node-cron';
import { FlightSearchService } from '../services/flightSearchService.js';
import { fareHistory } from '../services/fareHistory.js';
import { cheapestFlight } from '../services/quoteCache.js';
import { AIRPORTS } from '../../shared/catalog.js';

const HOME = (process.env.COLLECTOR_HOME_AIRPORTS || 'TLV').split(',');
const HORIZONS = [14, 30, 60, 90];   // days out — captures the booking curve
const NIGHTS = 7;

/**
 * Samples fares on a fixed schedule so the historical baseline reflects the market
 * rather than the search log.
 *
 * Writes go through fareHistory.record(), which rejects simulated quotes — so a
 * collector run during a provider outage records nothing rather than recording noise.
 */
export function startFareCollector(service = new FlightSearchService()) {
  if (process.env.COLLECTOR_ENABLED !== 'true') return;

  cron.schedule(process.env.COLLECTOR_CRON || '0 */6 * * *', async () => {
    const destinations = Object.keys(AIRPORTS);
    for (const origin of HOME) {
      for (const destination of destinations) {
        if (destination === origin) continue;
        for (const horizon of HORIZONS) {
          await sampleOne(service, origin, destination, horizon);
          await sleep(Number(process.env.COLLECTOR_DELAY_MS || 2000));
        }
      }
    }
  });
}
```

Key constraints to honour in the implementation:

- **Sequential, not parallel.** The rate limit on a reverse-engineered endpoint is the
  binding constraint, not wall-clock time.
- **`provider` must be truthful.** Pass `service.providerName`, never a literal. If the
  provider fell back to simulated, `fareHistory` will correctly discard the row.
- **Resume, don't restart.** Persist a cursor so a crash mid-sweep doesn't re-sample from
  the top and skew the sample toward the alphabetically early destinations.

**Modified — `supabase/fare_observations.sql`**

Two additions. First, distinguish collector rows from user-search rows so you can
detect sampling bias later:

```sql
alter table public.fare_observations
  add column if not exists collected_by text not null default 'user_search';
  -- 'user_search' | 'collector'
```

Second, add currency. Every provider is assumed to quote USD today; `fli` and `kiwi`
do not necessarily agree on that, and a mixed-currency column silently corrupts every
median in `fareHistory.medianOf()`:

```sql
alter table public.fare_observations
  add column if not exists currency text not null default 'USD';

create index if not exists fare_observations_route_currency_idx
  on public.fare_observations (route, currency, observed_at desc);
```

Then update `fareHistory.statsForRoutes()` to filter on currency, and
`fareHistory.record()` to reject a row whose currency it doesn't recognise — same
defensive posture as the existing simulated-provider check.

**Modified — `server.js`**

```js
import { startFareCollector } from './server/jobs/fareCollector.js';
// ...
app.listen(PORT, () => {
  startFareCollector();
  // ...existing banner
});
```

### Environment

```env
COLLECTOR_ENABLED=false
COLLECTOR_CRON=0 */6 * * *
COLLECTOR_HOME_AIRPORTS=TLV
COLLECTOR_DELAY_MS=2000
```

### Exit criteria

After 7 days of collection, `select route, count(*) from fare_observations where
collected_by = 'collector' group by route` shows ≥ 5 observations for at least 80% of
routes from TLV.

---

## Phase 3 — Real airport catalog

> **Goal:** stop shipping a code change every time a route is added.

**Source:** [`davidmegginson/ourairports-data`](https://github.com/davidmegginson/ourairports-data) —
Public Domain, 85,753 airports, updated weekly. Plus
[OpenFlights `routes.dat`](https://openflights.org/data.php) (ODbL) for route validity.
**Effort:** 1–2 days · **Risk:** low

### Approach

Do **not** load 85k airports into the client bundle. Build a curated subset at build time
and keep `shared/catalog.js`'s existing export shape so nothing downstream changes.

**New — `scripts/buildCatalog.js`**

```js
/**
 * Generates shared/catalog.generated.js from OurAirports.
 *
 * Filters to large_airport + medium_airport with a scheduled service and an IATA code,
 * which reduces 85,753 rows to roughly 1,200 — small enough to ship, broad enough that
 * adding a destination is a config change rather than a code change.
 *
 * Run: node scripts/buildCatalog.js
 */
const SOURCE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const KEEP_TYPES = new Set(['large_airport', 'medium_airport']);
// emit: { [iata]: { name, city, country, coords: [lat, lon], tz } }
```

**Modified — `shared/catalog.js`**

Becomes a thin façade. Existing consumers (`server.js`, `serpapiProvider.js`,
`constants.js`, `FlightMap.jsx`) import `AIRPORTS` and never change:

```js
import { GENERATED_AIRPORTS } from './catalog.generated.js';

/** Airports surfaced in the UI. Everything else stays searchable but unlisted. */
export const FEATURED_HUBS = (process.env.VITE_FEATURED_HUBS
  || 'TLV,LHR,CDG,JFK,DXB,FCO,NRT,ATH,BCN,PRG,LIS').split(',');

export const AIRPORTS = GENERATED_AIRPORTS;
export const DISCOVERY_DESTINATIONS = FEATURED_HUBS.map(c => GENERATED_AIRPORTS[c])
                                                   .filter(Boolean);
```

### Watch-outs

- `getDistance(coords)` in `constants.js` expects `[lat, lon]`. OurAirports supplies
  `latitude_deg` / `longitude_deg` as separate columns — get the order right or every
  distance and every map arc will be wrong.
- `server.js` currently defaults `destinationCodes` to `Object.keys(AIRPORTS)`. With 1,200
  airports that becomes a 1,200-way fan-out. **Change that default to
  `DISCOVERY_DESTINATIONS` in the same commit** — this is the one line that turns this
  phase from an improvement into an outage.
- Add `scripts/buildCatalog.js` to a monthly CI job so the catalog doesn't rot.

---

## Phase 4 — Free sports fixtures layer

> **Goal:** cut API-Sports quota consumption and retire most of `dailyBudget.js`.

**Source:** [`openfootball/football.json`](https://github.com/openfootball/football.json) —
Public Domain, no API key.
**Effort:** 2 days · **Risk:** low · **Independent of Phases 1–3**

### Approach

Insert a free tier in front of the paid one. `eventMerge.js` already merges multiple
event sources, so this is an additional source rather than a rewrite.

**New — `server/providers/openFootballProvider.js`**

Fetches season JSON from the CDN, caches it in `event_cache`, and exposes the same
interface `apiSportsProvider.js` exposes. Coverage: the major European leagues plus
several others — call `hasCoverage` honestly so `server.js` keeps reporting
`coverage: 'ticketed-only'` where the free source is thin. That flag is already wired
through both `/api/events` and `/api/events/batch`; do not weaken it.

**Modified — `server/services/eventSearchService.js`**

```
openFootball (free, cached)  →  apiSports (paid, budget-gated)  →  simulated
```

Only consult API-Sports for competitions openfootball does not cover. `dailyBudget.js`
stays in place but should stop being the binding constraint.

### Note on scope

openfootball is **football only**, and its data is season fixtures rather than live
scores. It does not replace Ticketmaster for concerts and it does not cover other sports.
Expect it to displace a meaningful share of API-Sports calls, not all of them.

---

## Phase 5 — Replace the fabricated prediction engine

> **Goal:** make the Buy/Wait verdict mean something.

**Source:** [`Nixtla/statsforecast`](https://github.com/Nixtla/statsforecast) (Apache-2.0) or
[`unit8co/darts`](https://github.com/unit8co/darts) (Apache-2.0).
**Effort:** 4–5 days · **Risk:** medium · **Depends on:** Phases 1 and 2 (needs data)

### What is wrong today

`src/utils/priceConfidenceEngine.js`, lines 40–70:

```js
const low90Day  = Math.max(45, Math.round(currentPrice * 0.75));
const high90Day = Math.round(currentPrice * 1.25);
const priceHistory = [
  { label: '90d ago', price: Math.round(high90Day * 0.96) },
  // ...every point derived from currentPrice
];
const confidenceScore = 84 + (positiveHash % 12);   // 84–95, from a hash of the flight ID
```

`low90Day` is not a 90-day low; it is 75% of today's price. `priceHistory` is not history.
`confidenceScore` is a hash. The UI presents all three as evidence, alongside a
`rationalePillars` array claiming "4 years of historical flight pricing algorithms".

This is the same failure `fare_observations.sql` was written to correct — its header
comment describes it precisely — but the fix was applied only on the server.

### Target architecture

```
fare_observations (real, collected)
        │
        ▼
server/services/forecastService.js
        │   ├── < 5 obs   → { verdict: null, reason: 'insufficient_history' }
        │   ├── 5–29 obs  → percentile only (existing fareHistory.summarise)
        │   └── ≥ 30 obs  → forecast sidecar → 7-day projection + interval
        ▼
/api/flights  ──▶  flight.insights  ──▶  BuyVerdict.jsx
```

### Files

**New — `sidecar/forecast/main.py`** — FastAPI wrapper over StatsForecast. Accepts a
price series, returns a point forecast plus an 80% prediction interval.

> This is the **only** Python process in the plan (Phase 1 runs natively in Node via
> `fli-js`). If adding a second runtime to the deploy is unwelcome, a pure-JS fallback —
> a rolling median plus a seasonal-naive baseline over the same `fare_observations` —
> gets you most of the credibility benefit for a fraction of the operational cost. The
> honest empty state below matters far more than the sophistication of the model.

**New — `server/services/forecastService.js`**

```js
/** Below this, a forecast describes noise. */
const MIN_OBS_FOR_FORECAST = 30;

/**
 * Returns null rather than a verdict when the data cannot support one.
 *
 * This mirrors fareHistory.summarise(): the absence of a basis is reported, never
 * filled in. A UI that says "not enough history yet" is more valuable than one that
 * says "WAIT 6 MORE DAYS" on the strength of a hash.
 */
export async function forecastRoute(route, prices) { /* ... */ }
```

**Rewritten — `src/utils/priceConfidenceEngine.js`**

Becomes a pure presenter. Delete `low90Day` / `high90Day` / `avg90Day` /
`confidenceScore` / `priceHistory` / `animatedSteps` synthesis entirely. Read from
`flight.insights`. Where the server sends `null`, render the null state.

**Modified — `src/components/BuyVerdict.jsx`, `PriceHistoryGraph.jsx`**

Both need a genuine empty state: *"We've seen this route 3 times. We need 5 before we'll
call it."* That sentence is more persuasive than a fabricated 89% confidence score, and
it is the honest version of the product.

**Delete — `getZeroClickDemoData()`**

Hardcoded fake Tokyo data. If a landing-page demo is needed, mark it
`isDemo: true` and have the UI label it as such.

### Tests

`priceConfidenceEngine.test.js` is currently 1 KB — the smallest test file in the repo,
for the module making the strongest claims. Rewrite it to assert:

- `< MIN_OBSERVATIONS` → verdict is `null`, and no numeric confidence is emitted
- No output field is a pure function of `currentPrice`
- `verdictEvidence.js` never cites a source that wasn't actually consulted

---

## Phase 6 — Real telemetry and correct map geometry

**Sources:** [OpenSky Network API](https://opensky-network.org/) (free),
[`xSNOWM4Nx/react-flight-tracker`](https://github.com/xSNOWM4Nx/react-flight-tracker) (polling
pattern), [`Leaflet.Geodesic`](https://github.com/henrythasler/Leaflet.Geodesic) (MIT).
**Effort:** 3 days · **Risk:** low · **Independent**

### 6a — Geodesic arcs (do this one first; it's an afternoon)

`FlightMap.jsx` draws flight paths with hand-rolled interpolation. On long-haul routes
(TLV→NRT, TLV→JFK) a naive great-circle approximation visibly diverges from the true path
and breaks at the antimeridian.

```bash
npm install leaflet.geodesic
```

Replace the manual arc computation with `L.geodesic`. Purely visual, no API surface
change, immediately noticeable on long routes.

### 6b — Live aircraft positions

Add `server/providers/openSkyProvider.js` and an `/api/telemetry/live` endpoint.

Keep `flightSimulator.js` — it remains the correct choice for a flight that hasn't
departed. But when a real position is available, use it, and **label which one the HUD is
showing**. A "Telemetry HUD" displaying simulated data without saying so has the same
credibility problem as Phase 5.

Note OpenSky's anonymous rate limit is low. Cache aggressively via the existing
`ttlCache.js` and poll no faster than every 10–15 s.

---

## Phase 7 — Alert delivery

**Source:** [`caronc/apprise`](https://github.com/caronc/apprise) (BSD-2), the notification
layer behind `changedetection.io`. Threshold-matching semantics from
[`jez500/pricebuddy`](https://github.com/jez500/pricebuddy).
**Effort:** 2 days · **Risk:** low · **Depends on:** Phase 2 (needs the collector to fire on)

`AlertsManager.jsx` (13.5 KB) manages alerts client-side. Nothing evaluates them when the
browser is closed — which is when a price drop actually happens.

- **New** `supabase/price_alerts.sql` — `user_id`, `route`, `target_price`, `channel`,
  `last_notified_at`
- **New** `server/jobs/alertEvaluator.js` — runs immediately after each collector sweep,
  compares fresh observations against active alerts
- **New** `server/services/notifier.js` — thin Apprise wrapper (email / Telegram)
- Rate-limit per alert (one notification per 24 h) so a volatile route can't spam

---

## 3. Consolidated environment variables

```env
# --- Phase 1: fli ---
FLI_ENABLED=true
FLIGHT_PROVIDER=fli
FARE_CURRENCY=USD
ESTIMATES_USE_REAL_PROVIDER=false
ESTIMATES_MAX_CONCURRENCY=6

# --- Phase 2: collector ---
COLLECTOR_ENABLED=false
COLLECTOR_CRON=0 */6 * * *
COLLECTOR_HOME_AIRPORTS=TLV
COLLECTOR_DELAY_MS=2000

# --- Phase 3: catalog ---
VITE_FEATURED_HUBS=TLV,LHR,CDG,JFK,DXB,FCO,NRT,ATH,BCN,PRG,LIS

# --- Phase 4: fixtures ---
OPENFOOTBALL_ENABLED=false

# --- Phase 5: forecasting ---
FORECAST_SIDECAR_URL=http://localhost:3004
FORECAST_MIN_OBSERVATIONS=30

# --- Phase 6: telemetry ---
OPENSKY_ENABLED=false
OPENSKY_POLL_INTERVAL_MS=15000

# --- Phase 7: alerts ---
ALERTS_ENABLED=false
APPRISE_URLS=
```

---

## 4. Sequencing and effort

| Phase | Effort | Blocks | Blocked by | Priority |
|-------|--------|--------|------------|----------|
| 0 — Prerequisites | 1 h | 1, 2 | — | Do first |
| 1 — `fli-js` provider | 2 d | 2, 5 | 0 | **Critical** |
| 2 — Fare collector | 2 d | 5, 7 | 1 | **Critical** |
| 3 — Airport catalog | 1–2 d | — | — | High |
| 4 — Fixtures | 2 d | — | — | Medium |
| 5 — Forecasting | 4–5 d | — | 1, 2 | **Critical** |
| 6a — Geodesic arcs | 0.5 d | — | — | Quick win |
| 6b — OpenSky | 2.5 d | — | — | Medium |
| 7 — Alerts | 2 d | — | 2 | Medium |

**Critical path:** 0 → 1 → 2 → *(wait ~2 weeks for data)* → 5. Roughly 9–11 working days
of engineering plus a two-week data-accumulation window before the forecasting work can
be evaluated at all.

Phases 3, 4, 6 and 7 are independent — good candidates to slot into that waiting period.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `fli-js` breaks when Google changes its internal format | Medium | High | Pin the exact version; keep SerpApi registered as fallback; alert on provider error rate |
| `fli-js` lags the Python `fli` on a needed fix | Low | Medium | It's a first-party 1:1 port, so drift should be small — but if it stalls, the Python package plus a small FastAPI sidecar is the documented escape hatch |
| Collector gets rate-limited or IP-blocked | Medium | Medium | Sequential with delay; `fli` has built-in rate limiting and retries; the fallback is the status quo, not an outage |
| OurAirports migration explodes the discovery fan-out | Low | **High** | Change the `Object.keys(AIRPORTS)` default to `DISCOVERY_DESTINATIONS` in the same commit — see Phase 3 |
| Mixed-currency rows corrupt every median | Medium | High | Add the `currency` column in Phase 2 *before* the collector writes its first row |
| Forecasts stay unavailable because data never reaches 30 obs/route | Medium | Medium | Narrow `COLLECTOR_HOME_AIRPORTS` and the destination list; depth beats breadth here |
| Rewriting `priceConfidenceEngine` makes the product look *less* confident | High | Low | It should. The current confidence is not real. Ship the honest empty state |

---

## 6. What is explicitly out of scope

- **`affromero/flight-finder` as a codebase.** Next.js + Prisma + Playwright. Referenced
  here for its collector pattern and price-snapshot model only — not to be adopted wholesale.
- **`LetsFG`.** Its `local.py` posts to `letsfg.co` and the `connectors/` directory is
  empty; the engine is closed and hosted. Optional low-cost-carrier fallback at best, and
  only after Phase 1 is stable.
- **Migrating off Supabase.** It is already open source and it is working. No reason.
- **Replacing Chart.js with Plotly.** flight-finder uses Plotly; that is not a reason to
  churn a working chart layer.

---

## 7. First commit

If you want a single change that de-risks everything downstream, it is Phase 0 plus the
`currency` column from Phase 2. Adding a currency column to an empty table is trivial.
Adding it after the collector has written 50,000 mixed-currency rows means every median
in `fareHistory` has been quietly wrong and there is no way to reconstruct which rows were
which.

Do that before anything else writes to `fare_observations`.

---

## Appendix — Source index

| Project | License | Used for | Phase |
|---------|---------|----------|-------|
| [`fli-js`](https://www.npmjs.com/package/fli-js) ([punitarani/fli](https://github.com/punitarani/fli)) | MIT | Free Google Flights data — **native Node, no sidecar** | 1 |
| [affromero/flight-finder](https://github.com/affromero/flight-finder) | MIT | Collector pattern, snapshot model | 2 |
| [davidmegginson/ourairports-data](https://github.com/davidmegginson/ourairports-data) | Public Domain | Airport catalog | 3 |
| [OpenFlights](https://openflights.org/data.php) | ODbL | Route validity | 3 |
| [openfootball/football.json](https://github.com/openfootball/football.json) | Public Domain | Free fixtures | 4 |
| [Nixtla/statsforecast](https://github.com/Nixtla/statsforecast) | Apache-2.0 | Price forecasting | 5 |
| [OpenSky Network](https://opensky-network.org/) | Free tier | Live aircraft positions | 6 |
| [Leaflet.Geodesic](https://github.com/henrythasler/Leaflet.Geodesic) | MIT | Correct arc geometry | 6 |
| [caronc/apprise](https://github.com/caronc/apprise) | BSD-2 | Notification delivery | 7 |
| [jez500/pricebuddy](https://github.com/jez500/pricebuddy) | MIT | Threshold semantics | 7 |
| [AWeirdDev/flights](https://github.com/AWeirdDev/flights) | MIT | Backup scraper | 1 (reserve) |
