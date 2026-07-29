import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { FlightSearchService } from './server/services/flightSearchService.js';

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

// Initialize the Strategy Orchestrator
const flightSearchService = new FlightSearchService();

// Health check endpoint for zero-downtime & cold-start warming (Public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'kairo-backend', timestamp: new Date().toISOString() });
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
    res.json(results);
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
