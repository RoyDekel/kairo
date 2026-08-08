// KAIRO Flight & Price Simulator Engine - Upgraded for Dynamic Search
//
// Airports, airlines and the shared pricing/geo math now live in shared/catalog.js so
// the browser and the Node backend cannot drift apart. They are re-exported here to
// keep every existing `from '../utils/flightSimulator'` import working unchanged.
import { getPriceConfidenceInsight } from './priceConfidenceEngine.js';
import {
  AIRPORTS,
  AIRLINES,
  getDistance,
  formatDuration,
  calculatePassengerCost,
  getCarriersForDistance,
  getBaseAdultPrice
} from '../../shared/catalog.js';

export { AIRPORTS, AIRLINES, getDistance, calculatePassengerCost };

// Dynamically generate a set of flights between two airports for a specific date and direction
export const generateFlightsForRoute = (originCode, destinationCode, dateStr, direction = 'outbound', passengers = { adults: 1 }, travelClass = 'ALL') => {
  const origin = AIRPORTS[originCode];
  const destination = AIRPORTS[destinationCode];
  
  if (!origin || !destination) return [];
  
  const distance = getDistance(origin.coords, destination.coords);
  
  // Base flight duration: cruising at 760 km/h + 30 mins (0.5h) climb/descent time
  const durationHours = (distance / 760) + 0.5;
  const durationStr = formatDuration(durationHours);

  // Base fare and carrier selection come from shared/catalog.js so this fallback
  // simulator produces exactly the same numbers as the server's SimulatedProvider.
  const basePrice = getBaseAdultPrice(distance, dateStr);
  const availableCarriers = getCarriersForDistance(distance)
    .map(code => AIRLINES[code] || AIRLINES.LO) // Fallback to LOT
    .slice(0, 4); // Limit to 4 options
    
  // Generate 4 flights with varying departure slots, pricing, and airframes
  const departures = ['06:20', '11:45', '16:10', '21:30'];
  const aircraftModels = [
    distance > 4000 ? 'Boeing 777-300ER' : 'Boeing 737 MAX 8',
    distance > 4000 ? 'Airbus A350-900' : 'Airbus A321neo',
    distance > 4000 ? 'Boeing 787-9 Dreamliner' : 'Boeing 737-800',
    distance > 4000 ? 'Airbus A330-900neo' : 'Boeing 737-900ER'
  ];

  let cabinClassName = 'Economy';
  let classMultiplier = 1.0;
  if (travelClass === '2' || String(travelClass).toLowerCase().includes('premium')) {
    cabinClassName = 'Premium Economy';
    classMultiplier = 1.6;
  } else if (travelClass === '3' || String(travelClass).toLowerCase().includes('business')) {
    cabinClassName = 'Business';
    classMultiplier = 2.8;
  } else if (travelClass === '4' || String(travelClass).toLowerCase().includes('first')) {
    cabinClassName = 'First';
    classMultiplier = 4.5;
  }

  return availableCarriers.map((airline, idx) => {
    // Calculate randomized offset for departure slot and airline tier
    const tierMultiplier = airline.type === 'lowcost' ? 0.85 : 1.15;
    const timeMultiplier = idx === 0 ? 0.95 : idx === 2 ? 1.05 : 1.0; // Early/late hours are cheaper
    
    const adultPrice = Math.round(basePrice * tierMultiplier * timeMultiplier * classMultiplier);
    
    // Compute total structure pricing
    const priceDetails = calculatePassengerCost(adultPrice, passengers);
    
    // Arrival time calculation
    const [depHours, depMins] = departures[idx].split(':').map(Number);
    let arrHours = Math.floor(depHours + durationHours);
    let arrMins = Math.round(depMins + (durationHours - Math.floor(durationHours)) * 60);
    if (arrMins >= 60) {
      arrHours += 1;
      arrMins -= 60;
    }
    const nextDay = arrHours >= 24;
    arrHours = arrHours % 24;
    
    const formattedArrival = `${String(arrHours).padStart(2, '0')}:${String(arrMins).padStart(2, '0')}`;
    
    // Baggage policy based on carrier tier
    const baggageDesc = airline.type === 'lowcost' 
      ? '1 small personal bag (underseat) included. Carry-on costs extra.' 
      : '1 carry-on (8kg) + 1 checked bag (23kg) included.';

    return {
      id: `${originCode}-${destinationCode}-${airline.code}-${idx + 100}-${direction}-${dateStr}`,
      flightNumber: `${airline.code} ${idx + 101 + (direction === 'return' ? 10 : 0)}`,
      airlineCode: airline.code,
      airlineName: airline.name,
      departureTime: departures[idx],
      arrivalTime: formattedArrival + (nextDay ? ' (+1d)' : ''),
      duration: durationStr,
      durationVal: durationHours,
      price: adultPrice, // adult base price
      passengerCosts: priceDetails, // Breakdown and total cost
      cabinClass: cabinClassName,
      stops: 'Direct',
      planeType: aircraftModels[idx],
      terminal: `${originCode} T${idx === 2 ? '1' : '3'} → ${destinationCode} T1`,
      baggage: baggageDesc,
      reliability: `${90 + (idx % 3) * 3}% On-Time`,
      seatsRemaining: Math.floor(2 + (airline.code.charCodeAt(0) % 8)),
      direction,
      origin: originCode,
      destination: destinationCode,
      distance
    };
  });
};

// Generate price history (past 30 days) and prediction (next 7 days)
export const generatePriceHistory = (flightNumber, basePrice) => {
  const history = [];
  const predictions = [];
  const daysOfHistory = 30;
  const daysOfPrediction = 7;
  
  let seed = 0;
  for (let i = 0; i < flightNumber.length; i++) {
    seed += flightNumber.charCodeAt(i);
  }
  const lcg = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  let currentVal = basePrice * 0.75;
  for (let i = daysOfHistory; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    
    const rand = lcg() - 0.45;
    const fluctuation = basePrice * 0.03 * rand;
    currentVal = currentVal + fluctuation;
    
    if (i < 5) {
      const weight = (5 - i) / 5;
      currentVal = currentVal * (1 - weight) + basePrice * weight;
    }
    
    history.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: Math.round(currentVal)
    });
  }

  history[history.length - 1].price = basePrice;

  let predVal = basePrice;
  const trendStrength = lcg() > 0.3 ? 0.04 : -0.01;

  for (let i = 1; i <= daysOfPrediction; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    
    const rand = lcg() - 0.3;
    const change = basePrice * trendStrength * rand;
    predVal = predVal + change;

    predictions.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: Math.round(predVal)
    });
  }

  const priceInsight = getPriceConfidenceInsight({ id: flightNumber, price: basePrice }, basePrice);
  const advice = priceInsight.actionHeadline;
  const adviceDetails = priceInsight.summary;

  return { history, predictions, advice, adviceDetails };
};

// Interpolate coordinates along the Great Circle (geodesic path) between any two coordinate sets
export const getFlightTelemetry = (progress, originCoords, destinationCoords) => {
  const [lat1, lon1] = originCoords || [32.0114, 34.8867];
  const [lat2, lon2] = destinationCoords || [50.0777, 19.7848];
  
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLon1 = (lon1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const rLon2 = (lon2 * Math.PI) / 180;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((rLat1 - rLat2) / 2) ** 2 +
      Math.cos(rLat1) * Math.cos(rLat2) * Math.sin((rLon1 - rLon2) / 2) ** 2
    )
  );

  let lat, lon;

  if (progress <= 0) {
    lat = lat1;
    lon = lon1;
  } else if (progress >= 1) {
    lat = lat2;
    lon = lon2;
  } else {
    const A = Math.sin((1 - progress) * d) / Math.sin(d);
    const B = Math.sin(progress * d) / Math.sin(d);
    const x = A * Math.cos(rLat1) * Math.cos(rLon1) + B * Math.cos(rLat2) * Math.cos(rLon2);
    const y = A * Math.cos(rLat1) * Math.sin(rLon1) + B * Math.cos(rLat2) * Math.sin(rLon2);
    const z = A * Math.sin(rLat1) + B * Math.sin(rLat2);
    
    lat = (Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * 180) / Math.PI;
    lon = (Math.atan2(y, x) * 180) / Math.PI;
  }

  const yBearing = Math.sin(rLon2 - rLon1) * Math.cos(rLat2);
  const xBearing = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(rLon2 - rLon1);
  let heading = (Math.atan2(yBearing, xBearing) * 180) / Math.PI;
  heading = (heading + 360) % 360;

  // Declared without initialisers: the branch chain below ends in an unconditional `else`,
  // so every path assigns all three. Seeding them here only produced values nothing read.
  let altitude;
  let speed;
  let status;

  if (progress <= 0) {
    status = 'Scheduled';
    altitude = 0;
    speed = 0;
  } else if (progress < 0.05) {
    status = 'Boarding';
    altitude = 0;
    speed = 0;
  } else if (progress < 0.10) {
    status = 'Takeoff';
    altitude = Math.round(progress * 10 * 36000);
    speed = Math.round(250 + progress * 10 * 550);
  } else if (progress >= 0.08 && progress < 0.88) {
    status = 'In Flight';
    altitude = 36000 + Math.round(Math.sin(progress * Math.PI * 10) * 400);
    speed = 820 + Math.round(Math.sin(progress * Math.PI * 5) * 15);
  } else if (progress >= 0.88 && progress < 0.99) {
    status = 'Descending';
    const descentProg = (0.99 - progress) / (0.99 - 0.88);
    altitude = Math.round(descentProg * 36000);
    speed = Math.round(200 + descentProg * 620);
  } else {
    status = 'Landed';
    altitude = 120; // Default airport height (ft)
    speed = 0;
  }

  const totalDistance = Math.round(6371 * d); // Dynamic km
  const distanceCovered = Math.round(totalDistance * progress);
  const distanceRemaining = Math.max(0, totalDistance - distanceCovered);

  // Time remaining (assuming cruising at 780km/h + 30 mins)
  const totalMinutes = Math.round((totalDistance / 780) * 60 + 30);
  const timeRemaining = Math.max(0, Math.round(totalMinutes * (1 - progress)));

  return {
    latitude: lat,
    longitude: lon,
    heading: Math.round(heading),
    altitude,
    speed,
    status,
    progress: Math.round(progress * 100),
    distanceCovered,
    distanceRemaining,
    timeRemaining
  };
};

// Generate deep search URL for Skyscanner
export const getSkyscannerUrl = (origin, destination, dateStr) => {
  if (!dateStr) return 'https://www.skyscanner.com';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return 'https://www.skyscanner.com';
  const yy = parts[0].slice(-2);
  const mm = parts[1];
  const dd = parts[2];
  const dateFormatted = `${yy}${mm}${dd}`;
  
  return `https://www.skyscanner.com/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}/${dateFormatted}/`;
};
