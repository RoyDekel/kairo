/**
 * KAIRO shared catalog — the single source of truth for airports, airlines and the
 * pricing/geo math used by BOTH the browser client and the Node backend.
 *
 * Why this file exists: the catalog previously lived in two places
 * (src/utils/flightSimulator.js with 32 airports, server/providers/constants.js with 16).
 * Any destination the server didn't know about caused /api/flights to return nothing,
 * so the client silently fell back to its own simulator and quoted a different price
 * for the same route. Both sides now import from here.
 *
 * Keep this module dependency-free and free of browser/Node-specific globals so it can
 * be imported from either runtime.
 */

import { GENERATED_AIRPORTS } from './catalog.generated.js';

export const FEATURED_HUBS = (process.env.VITE_FEATURED_HUBS
  || 'TLV,LHR,CDG,JFK,DXB,FCO,NRT,ATH,BCN,PRG,LIS').split(',');

export const AIRPORTS = GENERATED_AIRPORTS;

/*
  There was a DISCOVERY_DESTINATIONS export here, resolving FEATURED_HUBS to
  airport objects. Nothing imported it: server.js caps the discovery fan-out by
  using FEATURED_HUBS directly, and AirportAutocomplete does the same for its
  pre-typing suggestions. Keeping it was worse than useless -- it read like the
  canonical discovery list while both real consumers went around it, so a change
  made here would have looked effective and done nothing.
*/

// Airline Directory with appropriate colors and codes
export const AIRLINES = {
  W6: { code: 'W6', name: 'Wizz Air', logo: '✈️', color: '#e0007b', type: 'lowcost' },
  FR: { code: 'FR', name: 'Ryanair', logo: '🔵', color: '#0033a0', type: 'lowcost' },
  LO: { code: 'LO', name: 'LOT Polish Airlines', logo: '🇵🇱', color: '#002663', type: 'national' },
  LY: { code: 'LY', name: 'EL AL Israel Airlines', logo: '🇮🇱', color: '#133068', type: 'national' },
  BA: { code: 'BA', name: 'British Airways', logo: '🇬🇧', color: '#00205b', type: 'national' },
  AF: { code: 'AF', name: 'Air France', logo: '🇫🇷', color: '#00209f', type: 'national' },
  DL: { code: 'DL', name: 'Delta Air Lines', logo: '🔺', color: '#e01933', type: 'national' },
  EK: { code: 'EK', name: 'Emirates', logo: '🇦🇪', color: '#d71920', type: 'national' },
  JL: { code: 'JL', name: 'Japan Airlines', logo: '🇯🇵', color: '#d90011', type: 'national' },
  IB: { code: 'IB', name: 'Iberia', logo: '🇪🇸', color: '#d71920', type: 'national' },
  LH: { code: 'LH', name: 'Lufthansa', logo: '🇩🇪', color: '#05164d', type: 'national' },
  KL: { code: 'KL', name: 'KLM Royal Dutch Airlines', logo: '🇳🇱', color: '#00a1de', type: 'national' },
  TP: { code: 'TP', name: 'TAP Air Portugal', logo: '🇵🇹', color: '#7ab800', type: 'national' },
  AZ: { code: 'AZ', name: 'ITA Airways', logo: '🇮🇹', color: '#0066b2', type: 'national' }
};

/** Haversine great-circle distance in kilometres. */
export const getDistance = (coords1, coords2) => {
  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;
  const R = 6371; // Earth radius in km

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

/** Format duration from decimal hours to "Xh Ym". */
export const formatDuration = (hours) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

/** Cost breakdown for a passenger structure (children -25%, infants -90%). */
export const calculatePassengerCost = (basePrice, passengers) => {
  const { adults = 1, children = 0, infants = 0 } = passengers || {};
  const adultCost = adults * basePrice;
  const childCost = children * (basePrice * 0.75);
  const infantCost = infants * (basePrice * 0.10);

  return {
    adults: Math.round(adultCost),
    children: Math.round(childCost),
    infants: Math.round(infantCost),
    total: Math.round(adultCost + childCost + infantCost)
  };
};

/**
 * Carriers plausibly serving a route, chosen by distance band.
 *
 * NOTE: these must be AIRLINE codes. The client copy of this logic previously listed
 * 'ATH' and 'FCO' (airport codes) here; both fell through to the AIRLINES.LO default,
 * which flipped the low-cost 0.85 multiplier to the national 1.15 and mis-priced
 * short-haul routes by roughly 35% relative to the server.
 */
export const getCarriersForDistance = (distance) => {
  if (distance < 1500) {
    // Short-haul European/MidEast: low-cost and regional carriers
    return ['W6', 'FR', 'LO', 'LY'];
  }
  if (distance < 4500) {
    // Medium-haul: national carriers
    return ['LO', 'LY', 'BA', 'AF'];
  }
  // Long-haul (transatlantic, Tokyo, Dubai): premium carriers
  return ['LY', 'BA', 'AF', 'DL', 'EK', 'JL'];
};

/** Base adult fare before carrier/time multipliers: $40 entry + $0.075/km, weekends +20%. */
export const getBaseAdultPrice = (distance, dateStr) => {
  const basePricePerAdult = Math.round(40 + distance * 0.075);
  const dayOfWeek = new Date(dateStr).getDay();
  const dateFactor = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6 ? 1.2 : 1.0;
  return basePricePerAdult * dateFactor;
};
