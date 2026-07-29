import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { FlightSearchService } from './server/services/flightSearchService.js';
import { TicketmasterService } from './server/services/ticketmasterService.js';
import { computeEventDrivenInsights } from './server/services/insightsEngine.js';

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
      codes.map((code) => ticketmasterService.getEventsForDestination(code, startDate, endDate))
    );

    const eventsByDestination = {};
    settled.forEach((result, idx) => {
      const code = codes[idx];
      if (result.status === 'fulfilled') {
        eventsByDestination[code] = result.value || [];
      } else {
        console.warn(`[events/batch] Lookup failed for ${code}:`, result.reason?.message || result.reason);
        eventsByDestination[code] = [];
      }
    });

    res.json({ count: codes.length, eventsByDestination });
  } catch (error) {
    console.error('Batched events endpoint failed:', error);
    res.status(500).json({ error: 'Failed to fetch batched destination event intelligence.' });
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
