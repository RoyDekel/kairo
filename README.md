# KAIRO ✈️ — Smart AI Flight Price & Buy Timing Engine

**KAIRO** ("Never Overpay For Flights Again") is an AI-powered Flight Price Intelligence and Telemetry web application. Inspired by the ancient concept of *Kairos* (the exact right moment to act), KAIRO predicts whether flight prices will rise or drop, gives you an instant Buy Timing rating with confidence scores, and pairs flight deals with live concerts, sports matches, and music festivals across 32 global hubs.

---

## Key Features

*   **🔍 Dynamic Roundtrip Search Engine**: Disables one-way search to focus on roundtrip flights. Includes select inputs for departure/arrival airports, date pickers, and passenger selectors.
*   **🌍 Multi-Route Airport Catalog**: Pre-stores coordinates for major global hubs (Tel Aviv `TLV`, Krakow `KRK`, London `LHR`, Paris `CDG`, New York `JFK`, Dubai `DXB`, Rome `FCO`, Tokyo `NRT`, Athens `ATH`) to enable dynamic geodesic flight path drawing and Haversine distance tracking.
*   **👥 Passenger Structure & Multipliers**: Supports counts for Adults, Children, and Infants. Fares scale dynamically based on route distance and passenger discount coefficients (e.g. 25% discount for children, 90% discount for infants).
*   **🔄 Two-Step Booking Flow**: Guides users through a logical checkout flow:
    1.  *Select Outbound Leg* (lists outbound flights on departure date).
    2.  *Select Return Leg* (lists return flights on return date with outbound leg summary).
    3.  *Confirm Bundle* (shows pricing breakdowns and a CTA button to track the roundtrip package).
*   **📍 Auto-Bounding Telemetry Map**: Uses Leaflet.js (CartoDB Dark Matter layer) to render paths. Centering and zoom factors update dynamically using `fitBounds()` to frame any selected route (short-haul or trans-oceanic).
*   **📊 Price History & Projections**: Shows a line graph powered by Chart.js representing a 30-day price history and a 7-day future price prediction.
*   **💡 Booking Recommendations**: Computes price trends to recommend **BUY NOW**, **WAIT**, or **HOLD** actions.
*   **🔔 Alerts & Live Logs Feed**: Setup price drops and status notifications triggers to capture simulated price fluctuations and telemetry alerts.
*   **⏱️ Telemetry Simulator HUD**: Adjust simulation speeds (1x, 5x, 20x) or drag the slider manually to test flight phases (Scheduled → Boarding → Takeoff → Cruising → Descending → Landed).

---

## Tech Stack

*   **Core**: React + Vite (Fast HMR & bundlers)
*   **Styling**: Custom CSS variables, glassmorphic card elements, custom scrollbars, and neon glow accents.
*   **Maps**: [Leaflet.js](https://leafletjs.com/) (using CartoDB Dark Matter tile layer)
*   **Charts**: [Chart.js](https://www.chartjs.org/) + [React Chartjs 2](https://react-chartjs-2.js.org/)
*   **Icons**: [Lucide React](https://lucide.dev/)

---

## Getting Started

Follow these steps to run the flight tracker locally:

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (which includes `npm`).

### 2. Installation
Navigate to your project directory and install the dependencies:
```bash
# Navigate to the folder
cd flight-tracker

# Install packages
npm install
```

### 3. Development Server
Launch the development server to run it on your machine:
```bash
npm run dev
```
Once started, open **[http://localhost:5173/flight-tracker/](http://localhost:5173/flight-tracker/)** in your web browser.

### 4. Build & Deployment (GitHub Pages)
To compile the production bundles and deploy them directly to GitHub Pages:
```bash
# 1. Compile the build and push the site online
npm run deploy

# 2. Push source changes to your repository main branch
git add .
git commit -m "Update tracker features and configuration"
git push
```
The application will be hosted on your GitHub subdomain at:
`https://<your-github-username>.github.io/flight-tracker/`