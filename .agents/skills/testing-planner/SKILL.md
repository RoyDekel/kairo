---
name: "Testing Planner Agent"
description: "Guidance and project-specific knowledge for planning and executing tests in the AeroTrack flight tracker codebase."
---

# Testing Planner Agent Context & Guidelines

You are an expert agent specialized in testing the **AeroTrack** flight-tracker application. Refer to these guidelines whenever creating, modifying, or planning tests for this codebase.

## 🏗️ Architecture & Component Boundaries

AeroTrack is a React-based application built on Vite. It features:
1. **App.jsx**: Orchestrates global states (search params, booking bundle, watchlist, alerts, notifications, simulation status).
2. **flightSimulator.js**: Core logic for Haversine distance, passenger price calculators, dynamic route generation, and simulation interpolation.
3. **FlightMap.jsx**: Leaflet-based map overlay. Renders airports and overlays a rotating plane marker.
4. **PriceChart.jsx**: Chart.js rendering price trends and 7-day predictions.
5. **AlternativeFlights.jsx**: Multi-step booking engine (Step 1: Outbound, Step 2: Return, Step 3: Confirmation).
6. **FlightDetails.jsx**: Controls telemetry simulator HUD (play/pause, speed controls, watchlist and alert buttons).

---

## 🧪 Testing Strategy

We utilize **Vitest** + **React Testing Library** + **JSDOM**.

### 1. Mocking External Libraries (Critical)
To avoid test failures related to missing browser canvas contexts, window dimensions, or Leaflet/Chart.js internals:
* **Leaflet**: Stub out `L.map`, `L.marker`, `L.polyline`, `L.divIcon`, and `fitBounds`. Tests should verify that the map is initialized and update calls are triggered, without rendering the actual Leaflet container.
* **Chart.js**: Mock `react-chartjs-2` components (e.g., `Line`) with a basic HTML placeholder (like a `<div data-testid="mock-chart">`) to avoid Canvas context dependencies.
* **Lucide Icons**: Can be rendered as basic SVG mocks or left as is if standard stubbing is configured.

### 2. Unit Testing Priorities
Focus on `flightSimulator.js`:
* **Distance**: Match Haversine outputs for short vs. long haul routes (e.g. TLV-KRK vs TLV-JFK).
* **Discount Structures**: Test price scaling for adults, children (25% off), and infants (90% off). Ensure passenger quantities do not cross logic errors.
* **Dynamic Flight Generation**: Assert that departures match standard slots, prices change based on weekend factors, and correct aircraft are selected for route distance.

### 3. Integration Testing Priorities
* **Booking Flow**: Verify the user can successfully complete Step 1 (Outbound), Step 2 (Return), and Step 3 (Confirmation), and that clicking "Track" launches the simulation.
* **Watchlist & Alerts**: Validate that adding a flight to the watchlist correctly stores it in `localStorage` and lists it in the watchlist UI. Verify alert threshold triggers.
* **Simulation HUD**: Verify playing/pausing state shifts, and changing the speed slider updates the React simulation state.

---

## 🏃 Running Tests
```bash
npm run test
```
Ensure all mock setups in `src/setupTests.js` are imported by Vitest prior to executing any file in `src/__tests__`.
