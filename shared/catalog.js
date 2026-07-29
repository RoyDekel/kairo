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

// Catalog of supported airports with coordinates, names, cities, and countries
export const AIRPORTS = {
  TLV: { code: 'TLV', name: 'Ben Gurion Airport', city: 'Tel Aviv', country: 'Israel', coords: [32.0114, 34.8867] },
  KRK: { code: 'KRK', name: 'John Paul II Airport', city: 'Krakow', country: 'Poland', coords: [50.0777, 19.7848] },
  LHR: { code: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'United Kingdom', coords: [51.4700, -0.4543] },
  CDG: { code: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France', coords: [49.0097, 2.5479] },
  JFK: { code: 'JFK', name: 'John F. Kennedy Intl Airport', city: 'New York', country: 'United States', coords: [40.6413, -73.7781] },
  DXB: { code: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'United Arab Emirates', coords: [25.2532, 55.3657] },
  FCO: { code: 'FCO', name: 'Leonardo da Vinci Airport', city: 'Rome', country: 'Italy', coords: [41.8003, 12.2389] },
  NRT: { code: 'NRT', name: 'Narita International Airport', city: 'Tokyo', country: 'Japan', coords: [35.7720, 140.3929] },
  ATH: { code: 'ATH', name: 'Eleftherios Venizelos Airport', city: 'Athens', country: 'Greece', coords: [37.9356, 23.9484] },
  LAX: { code: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'United States', coords: [33.9416, -118.4085] },
  SIN: { code: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', country: 'Singapore', coords: [1.3644, 103.9915] },
  HND: { code: 'HND', name: 'Tokyo Haneda Airport', city: 'Tokyo', country: 'Japan', coords: [35.5494, 139.7798] },
  AMS: { code: 'AMS', name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'Netherlands', coords: [52.3105, 4.7683] },
  SYD: { code: 'SYD', name: 'Sydney Kingsford Smith Airport', city: 'Sydney', country: 'Australia', coords: [-33.9461, 151.1772] },
  BCN: { code: 'BCN', name: 'Josep Tarradellas Barcelona-El Prat Airport', city: 'Barcelona', country: 'Spain', coords: [41.2974, 2.0833] },
  HKG: { code: 'HKG', name: 'Hong Kong International Airport', city: 'Hong Kong', country: 'China', coords: [22.3080, 113.9185] },
  MAD: { code: 'MAD', name: 'Adolfo Suárez Madrid–Barajas Airport', city: 'Madrid', country: 'Spain', coords: [40.4839, -3.5680] },
  BER: { code: 'BER', name: 'Berlin Brandenburg Airport', city: 'Berlin', country: 'Germany', coords: [52.3667, 13.5033] },
  MUC: { code: 'MUC', name: 'Munich Airport', city: 'Munich', country: 'Germany', coords: [48.3538, 11.7861] },
  VIE: { code: 'VIE', name: 'Vienna International Airport', city: 'Vienna', country: 'Austria', coords: [48.1103, 16.5697] },
  PRG: { code: 'PRG', name: 'Václav Havel Airport Prague', city: 'Prague', country: 'Czech Republic', coords: [50.1008, 14.2600] },
  BUD: { code: 'BUD', name: 'Budapest Ferenc Liszt Intl Airport', city: 'Budapest', country: 'Hungary', coords: [47.4369, 19.2556] },
  LIS: { code: 'LIS', name: 'Humberto Delgado Airport', city: 'Lisbon', country: 'Portugal', coords: [38.7756, -9.1354] },
  DUB: { code: 'DUB', name: 'Dublin Airport', city: 'Dublin', country: 'Ireland', coords: [53.4264, -6.2499] },
  MXP: { code: 'MXP', name: 'Milan Malpensa Airport', city: 'Milan', country: 'Italy', coords: [45.6301, 8.7255] },
  ZRH: { code: 'ZRH', name: 'Zurich Airport', city: 'Zurich', country: 'Switzerland', coords: [47.4582, 8.5554] },
  MIA: { code: 'MIA', name: 'Miami International Airport', city: 'Miami', country: 'United States', coords: [25.7959, -80.2870] },
  ICN: { code: 'ICN', name: 'Incheon International Airport', city: 'Seoul', country: 'South Korea', coords: [37.4602, 126.4407] },
  BKK: { code: 'BKK', name: 'Suvarnabhumi Airport', city: 'Bangkok', country: 'Thailand', coords: [13.6900, 100.7501] },
  CPH: { code: 'CPH', name: 'Copenhagen Airport', city: 'Copenhagen', country: 'Denmark', coords: [55.6180, 12.6508] },
  EDI: { code: 'EDI', name: 'Edinburgh Airport', city: 'Edinburgh', country: 'United Kingdom', coords: [55.9500, -3.3725] },
  GIG: { code: 'GIG', name: 'Rio de Janeiro/Galeão Airport', city: 'Rio de Janeiro', country: 'Brazil', coords: [-22.8089, -43.2436] }
};

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
