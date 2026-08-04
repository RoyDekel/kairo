import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { FlightSearchService } from './server/services/flightSearchService.js';
import { EventSearchService, EventStatus } from './server/services/eventSearchService.js';
import { computeEventDrivenInsights } from './server/services/insightsEngine.js';
import { quoteCache, cheapestFlight } from './server/services/quoteCache.js';
import { flightSearchCache } from './server/services/flightSearchCache.js';
import { fareHistory, FareHistory } from './server/services/fareHistory.js';
import { forecastService } from './server/services/forecastService.js';
import { openSkyProvider } from './server/providers/openSkyProvider.js';
import { getServerSupabase } from './server/services/supabaseServer.js';
import { startFareCollector } from './server/jobs/fareCollector.js';
import { verifySchema } from './server/services/schemaCheck.js';
import { AIRPORTS, FEATURED_HUBS } from './shared/catalog.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * The single currency every fare is quoted and stored in.
 *
 * FareHistory computes medians and percentiles across rows; mixing currencies in that
 * column makes the statistic meaningless and unrecoverable after the fact, because a row
 * carries no record of what it should have been converted from. Providers are told which
 * currency to quote, and the currency they actually returned is written alongside the
 * fare so a future change here cannot silently reinterpret old rows.
 */
const FARE_CURRENCY = (process.env.FARE_CURRENCY || 'USD').toUpperCase();

app.use(cors());
app.use(express.json());

// Initialize Supabase client for backend JWT verification
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xcqtmvmomdbepjuyqnog.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_X_AbTFp1cIyEuu0guIhK0w__c72c3sD';

const supabaseServer = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Log incoming API calls for transparent developer experience
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Authentication middleware enforcing valid Supabase JWT Bearer token
const requireAuth = async (req, res, next) => {
  if (!supabaseServer) {
    console.warn("Supabase client unavailable on server backend; passing through.");
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);
  try {
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired access token' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Token validation failed' });
  }
};

// Initialize Services
const flightSearchService = new FlightSearchService();
const eventSearchService = new EventSearchService();

/*
  Health check for zero-downtime & cold-start warming (Public).

  Also reports which flight provider this instance selected and why. Deliberately public
  and credential-free: it names the provider and the deciding rule, never a key. This is
  the cheapest way to answer "is the free provider actually live in production?" — one
  curl, no login, no Supabase query, no reading id prefixes out of a network tab.
*/
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'kairo-backend',
    timestamp: new Date().toISOString(),
    flightProvider: flightSearchService.providerName,
    flightProviderReason: flightSearchService.selectionReason,
    fareCurrency: FARE_CURRENCY,
    estimatesUseRealProvider: process.env.ESTIMATES_USE_REAL_PROVIDER === 'true',
    collectorEnabled: process.env.COLLECTOR_ENABLED === 'true'
  });
});

app.get('/api/diagnose-fli', async (req, res) => {
  const { from = 'TLV', to = 'CDG', date = '2026-09-08' } = req.query;
  const url = `https://www.google.com/travel/flights?q=Flights+from+${from}+to+${to}+on+${date}&curr=USD&hl=en&gl=US`;
  const CONSENT_COOKIE = process.env.FLI_CONSENT_COOKIE || 'SOCS=CAESHAgBEhIaAB; CONSENT=YES+cb';
  
  const report = {
    url,
    consentCookie: CONSENT_COOKIE,
  };

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Cookie': CONSENT_COOKIE
      }
    });

    report.status = resp.status;
    report.redirected = resp.redirected;
    report.finalUrl = resp.url;
    report.headers = Array.from(resp.headers.entries());

    const html = await resp.text();
    report.htmlLength = html.length;
    report.containsInitData = html.includes('AF_initDataCallback');
    report.containsDs1 = html.includes("key:'ds:1'") || html.includes('key: "ds:1"') || html.includes("'ds:1'");
    
    // Scan matches
    const matches = [...html.matchAll(/AF_initDataCallback\s*\(/g)];
    report.matchCount = matches.length;
    report.snippets = [];
    for (let i = 0; i < Math.min(matches.length, 5); i++) {
      const pos = matches[i].index;
      report.snippets.push(html.slice(pos, pos + 200).replace(/\n/g, ' '));
    }
    
    if (html.includes('consent.google.com') || html.includes('Consent redirect') || html.includes('Before you continue to Google')) {
      report.diagnosis = 'Blocked by Google Consent redirection / Consent Wall.';
    } else if (html.includes('recaptcha') || html.includes('g-recaptcha') || html.includes('detected unusual traffic')) {
      report.diagnosis = 'Blocked by Google Bot Challenge / CAPTCHA (unusual traffic detected).';
    } else if (report.containsDs1) {
      report.diagnosis = 'Success! Flights ds:1 data block was found and parsed.';
    } else {
      report.diagnosis = 'Unknown response structure. No ds:1 key found, but no known block indicator found.';
    }

  } catch (err) {
    report.error = err.message || String(err);
    report.diagnosis = 'Network or request error.';
  }

  res.json(report);
});

// Ticketmaster Event Intelligence Endpoint (Protected)
app.get('/api/events', requireAuth, async (req, res) => {
  const { destination = 'BCN', startDate, endDate } = req.query;
  try {
    const events = await eventSearchService.getEventsForDestination(destination, startDate, endDate);
    res.json({
      destination,
      count: events.length,
      events,
      // Lets the client avoid asserting "nothing major is on" from partial coverage.
      coverage: eventSearchService.hasCoverage ? 'full' : 'ticketed-only'
    });
  } catch (error) {
    console.error("Ticketmaster events endpoint failed:", error);
    res.status(500).json({ error: "Failed to fetch destination event intelligence." });
  }
});

/**
 * Batched Event Intelligence Endpoint (Protected)
 *
 * Backs the "When to Go" discovery page. The client used to hold the Ticketmaster key
 * and issue one request per airport; it now sends the whole destination list here and
 * the server fans out in parallel, keeping the credential server-side.
 */
app.get('/api/events/batch', requireAuth, async (req, res) => {
  const { destinations = '', startDate, endDate } = req.query;

  const codes = destinations
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40); // Bound the fan-out so one request can't stampede the upstream API.

  if (codes.length === 0) {
    return res.status(400).json({ error: 'Missing required query parameter: destinations' });
  }

  try {
    /*
      One database read for the whole page, before any per-destination work.

      The durable cache would otherwise be consulted 31 times over the network for a
      single discovery search. Warming first means a window the app has already looked up
      costs one round trip in total and zero provider calls.
    */
    await eventSearchService.warmCache(codes, startDate, endDate);

    const settled = await Promise.allSettled(
      codes.map((code) => eventSearchService.fetchEvents(code, startDate, endDate))
    );

    /*
      Report per-destination status, not just a list.

      A destination with no events and a destination we were rate limited on both used to
      arrive as an empty array, so the discovery page dropped them identically — one
      correctly, one as a silent lie. `unavailable` lets the client say "couldn't check"
      instead of "nothing on".
    */
    const eventsByDestination = {};
    const statusByDestination = {};
    const unavailable = [];

    settled.forEach((result, idx) => {
      const code = codes[idx];

      if (result.status === 'fulfilled') {
        eventsByDestination[code] = result.value.events || [];
        statusByDestination[code] = result.value.status;
        if (result.value.status === EventStatus.UNAVAILABLE) unavailable.push(code);
        return;
      }

      console.warn(`[events/batch] Lookup threw for ${code}:`, result.reason?.message || result.reason);
      eventsByDestination[code] = [];
      statusByDestination[code] = EventStatus.UNAVAILABLE;
      unavailable.push(code);
    });

    res.json({
      count: codes.length,
      eventsByDestination,
      statusByDestination,
      // Same field /api/events reports. The discovery page needs it to say how much of
      // "what's on" it could actually see, rather than presenting a ticketing channel as
      // the whole calendar.
      coverage: eventSearchService.hasCoverage ? 'full' : 'ticketed-only',
      // Lets the UI admit the result set is incomplete rather than presenting it as final.
      partial: unavailable.length > 0,
      unavailableDestinations: unavailable
    });
  } catch (error) {
    console.error('Batched events endpoint failed:', error);
    res.status(500).json({ error: 'Failed to fetch batched destination event intelligence.' });
  }
});

/**
 * Broad Fare Estimates Endpoint (Protected)
 *
 * Prices many destinations at once for the "When to Go" discovery page, through the
 * SAME FlightSearchService that /api/flights uses — the client no longer runs a pricing
 * algorithm of its own.
 *
 * Each destination resolves in one of two ways:
 *   source: 'live'     — a real provider quote previously fetched by /api/flights and
 *                        still inside the cache TTL. Guaranteed identical to what the
 *                        Search & Compare page shows.
 *   source: 'estimate' — the simulated provider, because scanning ~31 destinations
 *                        against a paid provider on every keystroke isn't viable.
 */
app.get('/api/flights/estimates', requireAuth, async (req, res) => {
  const {
    origin,
    departureDate,
    returnDate,
    destinations = '',
    adults = '1',
    children = '0',
    infants = '0',
    stops = '0'
  } = req.query;

  if (!origin || !departureDate) {
    return res.status(400).json({ error: 'Missing required query parameters: origin, departureDate' });
  }

  const passengers = {
    adults: parseInt(adults, 10),
    children: parseInt(children, 10),
    infants: parseInt(infants, 10)
  };

  const originCode = String(origin).toUpperCase();

  // Default to every known airport except the origin.
  const requested = destinations
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  const destinationCodes = (requested.length > 0 ? requested : FEATURED_HUBS)
    .filter((code) => code !== originCode && AIRPORTS[code])
    .slice(0, 60);

  if (destinationCodes.length === 0) {
    return res.status(400).json({ error: 'No valid destinations to price.' });
  }

  try {
    // Process destinations in concurrent chunks (batch size 6) to avoid upstream rate limits
    const CHUNK_SIZE = Number(process.env.ESTIMATES_MAX_CONCURRENCY) || 6;
    const settled = [];

    for (let i = 0; i < destinationCodes.length; i += CHUNK_SIZE) {
      const chunk = destinationCodes.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (destination) => {
          const keyParts = { origin: originCode, destination, departureDate, returnDate, passengers, stops };

          // Prefer a real quote we already paid for.
          const cached = quoteCache.get(keyParts);
          if (cached) {
            return {
              destination,
              roundtripPrice: cached.roundtripPrice,
              outbound: cached.outbound,
              return: cached.return,
              source: 'live',
              provider: cached.source,
              quotedAt: cached.quotedAt
            };
          }

          const results = await flightSearchService.estimateFlights({
            origin: originCode,
            destination,
            departureDate,
            returnDate,
            passengers,
            stops
          });

          const outbound = cheapestFlight(results.outbound);
          const returnFlight = cheapestFlight(results.return);
          if (!outbound) return null;

          const providerUsed = results?.providerUsed || 'simulated';
          const isSimulated = providerUsed === 'simulated';

          return {
            destination,
            roundtripPrice: outbound.price + (returnFlight ? returnFlight.price : 0),
            outbound,
            return: returnFlight,
            source: isSimulated ? 'estimate' : 'live',
            provider: providerUsed,
            quotedAt: isSimulated ? null : new Date().toISOString()
          };
        })
      );
      settled.push(...chunkResults);
    }

    const estimates = {};
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        estimates[result.value.destination] = result.value;
      } else if (result.status === 'rejected') {
        console.warn(`[flights/estimates] Pricing failed for ${destinationCodes[idx]}:`, result.reason?.message || result.reason);
      }
    });

    /*
      Attach the real historical position of each fare, in ONE query for the whole page.

      This is what lets the discovery card say "cheaper than 80% of the fares we have seen
      for this route" instead of the old fixed 26% saving against a baseline defined as the
      fare times 1.35. Routes without enough observations report nulls, and the UI is
      expected to say so rather than fill the gap.
    */
    const routeKeys = Object.keys(estimates).map((destination) => FareHistory.routeKey(originCode, destination));
    const historyByRoute = await fareHistory.statsForRoutes(routeKeys, FARE_CURRENCY);

    for (const [destination, estimate] of Object.entries(estimates)) {
      const entry = historyByRoute[FareHistory.routeKey(originCode, destination)];
      Object.assign(estimate, fareHistory.summarise(estimate.roundtripPrice, entry));
    }

    res.json({ origin: originCode, departureDate, returnDate, count: Object.keys(estimates).length, estimates });
  } catch (error) {
    console.error('Estimates endpoint failed:', error);
    res.status(500).json({ error: 'Failed to compute destination fare estimates.' });
  }
});

// ─── Price Alerts CRUD (Protected by JWT Authentication) ─────────────────────

app.post('/api/alerts', requireAuth, async (req, res) => {
  const supabase = getServerSupabase();
  if (!supabase) {
    return res.status(503).json({ error: 'Alert storage unavailable — Supabase not configured.' });
  }

  const { origin, destination, targetPrice, channel = 'telegram', channelTarget } = req.body;

  if (!origin || !destination || !targetPrice) {
    return res.status(400).json({ error: 'Missing required fields: origin, destination, targetPrice' });
  }

  if (!['telegram', 'email'].includes(channel)) {
    return res.status(400).json({ error: `Unsupported channel: ${channel}. Use 'telegram' or 'email'.` });
  }

  /*
    A delivery address is mandatory, not optional.

    notifier.js falls back to TELEGRAM_DEFAULT_CHAT_ID when an alert carries no
    chat_id. That fallback is a single process-wide value, so an alert stored
    without a target would deliver to whoever owns that env var rather than to
    the user who created it — leaking their route and target price to a stranger
    while they receive nothing. Rejecting the write here is what keeps the
    fallback a local development convenience instead of a cross-user misroute.

    The same rule applies to email for the simpler reason that a null recipient
    can never be delivered: the alert would sit in the table looking healthy and
    silently fire nothing, forever.
  */
  if (!channelTarget || !String(channelTarget).trim()) {
    return res.status(400).json({
      error: channel === 'telegram'
        ? 'A Telegram chat ID is required so the alert can be delivered to you.'
        : 'An email address is required so the alert can be delivered to you.'
    });
  }

  const route = `${origin.toUpperCase()}-${destination.toUpperCase()}`;

  const { data, error } = await supabase
    .from('price_alerts')
    .insert({
      user_id: req.user.id,
      route,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      target_price: Number(targetPrice),
      channel,
      channel_target: String(channelTarget).trim()
    })
    .select()
    .single();

  if (error) {
    console.error('[api/alerts] Insert failed:', error.message);
    return res.status(500).json({ error: 'Failed to create alert.' });
  }

  res.status(201).json({ alert: data });
});

app.get('/api/alerts', requireAuth, async (req, res) => {
  const supabase = getServerSupabase();
  if (!supabase) {
    return res.json({ alerts: [] });
  }

  const { data, error } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[api/alerts] Fetch failed:', error.message);
    return res.status(500).json({ error: 'Failed to fetch alerts.' });
  }

  res.json({ alerts: data || [] });
});

app.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  const supabase = getServerSupabase();
  if (!supabase) {
    return res.status(503).json({ error: 'Alert storage unavailable.' });
  }

  const { error } = await supabase
    .from('price_alerts')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) {
    console.error('[api/alerts] Delete failed:', error.message);
    return res.status(500).json({ error: 'Failed to deactivate alert.' });
  }

  res.json({ success: true });
});

// Live flight telemetry route (Protected by JWT Authentication)
app.get('/api/telemetry/live', requireAuth, async (req, res) => {
  const { flightNumber, origin, destination } = req.query;

  if (!flightNumber || !origin || !destination) {
    return res.status(400).json({ error: "Missing required parameters: flightNumber, origin, destination" });
  }

  try {
    const telemetry = await openSkyProvider.getLiveTelemetry(flightNumber, origin, destination);
    res.json({ telemetry });
  } catch (error) {
    console.error('[api/telemetry/live] Failed:', error);
    res.status(500).json({ error: 'Failed to retrieve live flight telemetry.' });
  }
});

// Unified search endpoint (Protected by JWT Authentication)
app.get('/api/flights', requireAuth, async (req, res) => {
  const {
    origin,
    destination,
    departureDate,
    returnDate,
    adults = '1',
    children = '0',
    infants = '0',
    stops = '0',
    travelClass = '1'
  } = req.query;

  if (!origin || !destination || !departureDate) {
    return res.status(400).json({ error: "Missing required query parameters: origin, destination, departureDate" });
  }

  const request = {
    origin,
    destination,
    departureDate,
    returnDate,
    passengers: {
      adults: parseInt(adults, 10),
      children: parseInt(children, 10),
      infants: parseInt(infants, 10)
    },
    stops,
    travelClass
  };

  const cacheKeyParts = { origin, destination, departureDate, returnDate, passengers: request.passengers, stops, travelClass };

  try {
    let results = await flightSearchCache.get(cacheKeyParts);
    let servedFromCache = false;

    if (results) {
      servedFromCache = true;
      console.log(`[api/flights] Cache hit for ${origin}->${destination} ${departureDate}; skipping ${flightSearchService.providerName.toUpperCase()} call.`);
    } else {
      results = await flightSearchService.searchFlights(request);

      // Only cache a real, successful provider result. A simulated response -- whether
      // simulation is the active strategy or a real provider just failed and this is the
      // fallback -- must never be cached: it would keep serving a "provider is down"
      // substitute long after the provider recovered, and it costs nothing to regenerate,
      // so caching it buys nothing.
      if (!results.warning && flightSearchService.providerName !== 'simulated') {
        await flightSearchCache.set(cacheKeyParts, results);
      }
    }

    const cheapestOutboundRaw = cheapestFlight(results.outbound);
    const cheapestReturnRaw = cheapestFlight(results.return);
    const cheapestOutboundPrice = cheapestOutboundRaw?.price || 0;
    const cheapestReturnPrice = cheapestReturnRaw?.price || 0;
    const currentRoundtripPrice = cheapestOutboundPrice + cheapestReturnPrice;

    const forecast = await forecastService.forecastRoute(origin, destination, currentRoundtripPrice, FARE_CURRENCY);

    const events = await eventSearchService.getEventsForDestination(destination, departureDate, returnDate);

    // Enriched outbound and return flights with Event-Driven Insights
    const outboundWithInsights = (results.outbound || []).map(flight => {
      const flightRoundtripPrice = flight.price + cheapestReturnPrice;
      return {
        ...flight,
        insights: computeEventDrivenInsights(flight, request, events, {
          coverage: eventSearchService.hasCoverage ? 'full' : 'ticketed-only',
          forecast,
          comparisonPrice: flightRoundtripPrice
        })
      };
    });

    const returnWithInsights = (results.return || []).map(flight => {
      const flightRoundtripPrice = cheapestOutboundPrice + flight.price;
      return {
        ...flight,
        insights: computeEventDrivenInsights(flight, request, events, {
          coverage: eventSearchService.hasCoverage ? 'full' : 'ticketed-only',
          forecast,
          comparisonPrice: flightRoundtripPrice
        })
      };
    });

    // Record the cheapest fare so /api/flights/estimates can serve this exact number to
    // the discovery page instead of a simulated one. This is what keeps "When to Go"
    // and "Search & Compare" in agreement for any route the user has actually opened.
    const cheapestOutbound = cheapestFlight(outboundWithInsights);
    if (cheapestOutbound) {
      const cheapestReturn = cheapestFlight(returnWithInsights);
      quoteCache.set(
        { origin, destination, departureDate, returnDate, passengers: request.passengers, stops },
        {
          roundtripPrice: cheapestOutbound.price + (cheapestReturn ? cheapestReturn.price : 0),
          outbound: cheapestOutbound,
          return: cheapestReturn,
          source: results.warning ? 'simulated' : flightSearchService.providerName
        }
      );

      /*
        Record the fare so "below the usual price" can eventually be measured instead of
        asserted. Only real provider quotes are stored — FareHistory rejects simulated
        ones — because a baseline built from the model would describe the model.

        NOT recorded on a cache hit. The cached payload is one quote; re-recording it on
        every refresh within the 30-minute TTL writes N identical rows for one observation,
        and FareHistory reads sampleSize as independent evidence. Five refreshes would
        satisfy MIN_OBSERVATIONS and produce a percentile computed over five copies of the
        same number — a confident-looking statistic backed by a single data point.

        Awaited but never allowed to fail the response: a lost observation costs a slightly
        thinner baseline, nothing more.
      */
      if (!servedFromCache) {
        await fareHistory.record({
          origin,
          destination,
          departureDate,
          returnDate,
          roundtripPrice: cheapestOutbound.price + (cheapestReturn ? cheapestReturn.price : 0),
          provider: results.warning ? 'simulated' : flightSearchService.providerName,
          // Recorded, not assumed. A median over rows in mixed currencies measures the
          // exchange rate rather than the market, and once the rows are written there is
          // no way to tell which was which. The provider reports what it was quoted.
          currency: results.currency || FARE_CURRENCY
        });
      }
    }

    res.json({
      ...results,
      outbound: outboundWithInsights,
      return: returnWithInsights,
      events,
      /*
        Say who answered.

        Without this, a working free provider and a silent fallback to the simulated one
        are indistinguishable from the response: same shape, same fields, plausible
        numbers. Confirming which had actually served meant reading flight id prefixes or
        querying Supabase. `provider` makes it a field.

        `servedFromCache` matters just as much — a cache hit reaches no provider at all, so
        `provider` then describes who filled the cache up to 30 minutes ago, not who was
        asked now.
      */
      provider: results.warning ? 'simulated' : flightSearchService.providerName,
      servedFromCache,
      currency: results.currency || FARE_CURRENCY
      // `providerError` rides along in ...results when a fallback fired — see
      // FlightSearchService.searchFlights.
    });
  } catch (error) {
    console.error("Endpoint search failed:", error.message || error);
    res.status(500).json({ error: "An error occurred while fetching flight details." });
  }
});

// Start Server
app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(` KAIRO Backend Server listening on port ${PORT}`);
  console.log(` Target Endpoint: http://localhost:${PORT}`);
  console.log(` Fare currency:   ${FARE_CURRENCY}`);
  console.log(`===============================================`);

  startFareCollector();

  // Awaited after listen() so a slow or unreachable Supabase delays the report, never the
  // service. The result is logged, not acted on: an out-of-date schema costs observations,
  // which is worth shouting about and not worth refusing to serve traffic over.
  await verifySchema();
});
