import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { FlightSearchService } from './server/services/flightSearchService.js';
import { TicketmasterService } from './server/services/ticketmasterService.js';
import { computeEventDrivenInsights } from './server/services/insightsEngine.js';
import { quoteCache, cheapestFlight } from './server/services/quoteCache.js';
import { EventStatus } from './server/services/eventCache.js';
import { AIRPORTS } from './shared/catalog.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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
const ticketmasterService = new TicketmasterService();

// Health check endpoint for zero-downtime & cold-start warming (Public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'kairo-backend', timestamp: new Date().toISOString() });
});

// Ticketmaster Event Intelligence Endpoint (Protected)
app.get('/api/events', requireAuth, async (req, res) => {
  const { destination = 'BCN', startDate, endDate } = req.query;
  try {
    const events = await ticketmasterService.getEventsForDestination(destination, startDate, endDate);
    res.json({ destination, count: events.length, events });
  } catch (error) {
    console.error("Ticketmaster events endpoint failed:", error);
    res.status(500).json({ error: "Failed to fetch destination event intelligence." });
  }
});

/**
 * Batched Event Intelligence Endpoint (Protected)
 *
 * Backs the "Where to Go" discovery page. The client used to hold the Ticketmaster key
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
    const settled = await Promise.allSettled(
      codes.map((code) => ticketmasterService.fetchEvents(code, startDate, endDate))
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
 * Prices many destinations at once for the "Where to Go" discovery page, through the
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

  const destinationCodes = (requested.length > 0 ? requested : Object.keys(AIRPORTS))
    .filter((code) => code !== originCode && AIRPORTS[code])
    .slice(0, 60);

  if (destinationCodes.length === 0) {
    return res.status(400).json({ error: 'No valid destinations to price.' });
  }

  try {
    const settled = await Promise.allSettled(
      destinationCodes.map(async (destination) => {
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

        return {
          destination,
          roundtripPrice: outbound.price + (returnFlight ? returnFlight.price : 0),
          outbound,
          return: returnFlight,
          source: 'estimate',
          provider: 'simulated',
          quotedAt: null
        };
      })
    );

    const estimates = {};
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        estimates[result.value.destination] = result.value;
      } else if (result.status === 'rejected') {
        console.warn(`[flights/estimates] Pricing failed for ${destinationCodes[idx]}:`, result.reason?.message || result.reason);
      }
    });

    res.json({ origin: originCode, departureDate, returnDate, count: Object.keys(estimates).length, estimates });
  } catch (error) {
    console.error('Estimates endpoint failed:', error);
    res.status(500).json({ error: 'Failed to compute destination fare estimates.' });
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
    stops = '0'
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
    stops
  };

  try {
    const results = await flightSearchService.searchFlights(request);
    const events = await ticketmasterService.getEventsForDestination(destination, departureDate, returnDate);

    // Enriched outbound and return flights with Event-Driven Insights
    const outboundWithInsights = (results.outbound || []).map(flight => ({
      ...flight,
      insights: computeEventDrivenInsights(flight, request, events)
    }));

    const returnWithInsights = (results.return || []).map(flight => ({
      ...flight,
      insights: computeEventDrivenInsights(flight, request, events)
    }));

    // Record the cheapest fare so /api/flights/estimates can serve this exact number to
    // the discovery page instead of a simulated one. This is what keeps "Where to Go"
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
    }

    res.json({
      ...results,
      outbound: outboundWithInsights,
      return: returnWithInsights,
      events
    });
  } catch (error) {
    console.error("Endpoint search failed:", error.message || error);
    res.status(500).json({ error: "An error occurred while fetching flight details." });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` KAIRO Backend Server listening on port ${PORT}`);
  console.log(` Target Endpoint: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
