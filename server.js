import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { FlightSearchService } from './server/services/flightSearchService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Log incoming API calls for transparent developer experience
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Initialize the Strategy Orchestrator
const flightSearchService = new FlightSearchService();

// Health check endpoint for zero-downtime & cold-start warming
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'kairo-backend', timestamp: new Date().toISOString() });
});

// Unified search endpoint
app.get('/api/flights', async (req, res) => {
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
