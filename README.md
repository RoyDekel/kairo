# KAIRO ✈️ — Smart AI Flight Price & Event-Driven Telemetry Engine

**KAIRO** ("Never Overpay For Flights Again") is an AI-powered Flight Price Intelligence and Telemetry web application. Inspired by the ancient concept of *Kairos* (the exact right moment to act), KAIRO predicts whether flight prices will rise or drop, gives you an instant Buy Timing rating with confidence scores, and pairs flight deals with live concerts, sports matches, and music festivals across 32 global destination hubs.

---

## 🌟 Key Features

### 📍 Interactive Telemetry & Flight Map
* **CartoDB Dark Matter Visualization**: Powered by Leaflet.js (`react-leaflet`), featuring dynamic geodesic flight paths, animated aircraft icons, and auto-bounding viewport adjustment (`fitBounds`).
* **Real-Time Telemetry Simulator HUD**: Live flight status tracker (Scheduled → Boarding → Takeoff → Cruising → Descending → Landed) with adjustable simulation speeds (1x, 5x, 20x) and interactive flight phase controls.

### 🤖 Event-Driven AI Intelligence ("When to Go" Explorer)
* **Live Event Integration**: Aggregates live sports fixtures (API-Sports) and entertainment/concerts (Ticketmaster) to identify high-demand event occasions.
* **Event-Driven Price Insights**: Highlights pricing pressure indicators, match schedules, and event impact badges for popular destinations.
* **Smart Destination Discovery**: Batch-prices up to 32 destinations concurrently via server-side fan-out, aligning fare estimates with cached live quotes.

### 📈 Price Intelligence & Confidence Engine
* **Price Projections & History**: Interactive line charts (Chart.js) showing 30-day historical price trends and 7-day future predictions.
* **Buy Verdict Ratings**: Computes algorithmic recommendations (**BUY NOW**, **WAIT**, or **HOLD**) accompanied by price confidence ratings and evidence breakdowns.
* **Watchlist & Price Alerts**: Set custom target price notifications with live telemetry and price change logs.

### ✈️ Dynamic Roundtrip Booking Flow
* **32-Airport Global Hub Catalog**: Pre-configured catalog supporting major global hubs (`TLV`, `LHR`, `CDG`, `JFK`, `DXB`, `FCO`, `NRT`, `ATH`, `BCN`, `PRG`, `LIS`, etc.).
* **Passenger & Cabin Configuration**: Passenger count controls (Adults, Children with 25% discount, Infants with 90% discount) and cabin class filters.
* **2-Step Selection**: Smooth flow selecting outbound leg, return leg, and reviewing bundled trip summaries.

### 🔒 Secure Full-Stack Architecture & Auth
* **Express.js API Server**: Dedicated Node backend serving protected endpoints (`/api/flights`, `/api/flights/estimates`, `/api/events`, `/api/events/batch`).
* **Supabase JWT Authentication**: Secure user login/signup modal with JWT Bearer token middleware validation (`requireAuth`).
* **Multi-Provider Flight Engine**: Pluggable provider strategies (SerpApi Google Flights, Kiwi, TravelPayouts) with automated fallback to simulated data.
* **Durable Caching & Rate Limiting**: In-memory TTL quote cache, plus Supabase PostgreSQL `fixtures_cache` for efficient API-Sports daily data storage.

---

## 🛠️ Tech Stack

### Frontend
* **Core**: React 19, Vite 8, JavaScript (ES Modules)
* **Styling**: Modern CSS variables, glassmorphic UI cards, dark mode neon accents
* **Mapping**: Leaflet 1.9 & React-Leaflet 5 (CartoDB Dark Matter tile layer)
* **Charts**: Chart.js 4 & React Chartjs 2
* **Icons**: Lucide React

### Backend & Database
* **Server**: Node.js & Express 5
* **Authentication**: Supabase Auth (`@supabase/supabase-js`)
* **Database / Cache**: Supabase PostgreSQL (`fixtures_cache`), In-Memory TTL Cache
* **APIs**: SerpApi (Google Flights), Kiwi.com, TravelPayouts, Ticketmaster, API-Sports

### Testing & Quality Assurance
* **Unit & Integration**: Vitest + React Testing Library + JSDOM
* **E2E Testing**: Playwright
* **Code Quality**: ESLint 10

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3001

# Supabase Auth & Database
VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Live Flight API Providers (Optional - falls back to simulated provider if omitted)
SERPAPI_KEY=your_serpapi_key
KIWI_API_KEY=your_kiwi_api_key
TRAVELPAYOUTS_TOKEN=your_travelpayouts_token
FLIGHT_PROVIDER=serpapi # Optional choice: serpapi | kiwi | travelpayouts | simulated

# Live Event API Providers (Optional - falls back to simulated provider if omitted)
TICKETMASTER_API_KEY=your_ticketmaster_api_key
API_SPORTS_KEY=your_apisports_api_key
```

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure [Node.js](https://nodejs.org/) (v18+) is installed.

### 2. Installation
Clone the repository and install dependencies:
```bash
cd kairo
npm install
```

### 3. Running Development Server
Start both the Vite frontend (port 5173) and Express backend (port 3001) concurrently:
```bash
cmd /c "npm run dev"
# or
npm run dev
```
Open **[http://localhost:5173/kairo/](http://localhost:5173/kairo/)** in your web browser.

---

## 🧪 Testing & Verification

Run unit & integration test suites:
```bash
cmd /c "npm test"
```

Run Playwright E2E tests:
```bash
cmd /c "npm run test:e2e"
```

---

## 📦 Build & Deployment

Compile the production bundle and deploy to GitHub Pages:
```bash
npm run build
npm run deploy
```
Hosted live at `https://<your-github-username>.github.io/kairo/`