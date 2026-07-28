// AeroTrack Flight & Price Simulator Engine - Upgraded for Dynamic Search

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

// Haversine formula to compute great circle distance in kilometers
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

// Format duration from hours to "Xh Ym"
const formatDuration = (hours) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

// Calculate cost for a passenger structure
export const calculatePassengerCost = (basePrice, passengers) => {
  const { adults = 1, children = 0, infants = 0 } = passengers;
  const adultCost = adults * basePrice;
  const childCost = children * (basePrice * 0.75); // 25% discount for children
  const infantCost = infants * (basePrice * 0.10); // 90% discount for infants
  
  return {
    adults: Math.round(adultCost),
    children: Math.round(childCost),
    infants: Math.round(infantCost),
    total: Math.round(adultCost + childCost + infantCost)
  };
};

// Dynamically generate a set of flights between two airports for a specific date and direction
export const generateFlightsForRoute = (originCode, destinationCode, dateStr, direction = 'outbound', passengers = { adults: 1 }) => {
  const origin = AIRPORTS[originCode];
  const destination = AIRPORTS[destinationCode];
  
  if (!origin || !destination) return [];
  
  const distance = getDistance(origin.coords, destination.coords);
  
  // Base flight duration: cruising at 760 km/h + 30 mins (0.5h) climb/descent time
  const durationHours = (distance / 760) + 0.5;
  const durationStr = formatDuration(durationHours);
  
  // Base ticket price: $40 entry fee + $0.075 per km
  const basePricePerAdult = Math.round(40 + distance * 0.075);
  
  const dayOfWeek = new Date(dateStr).getDay(); // Weekend multiplier
  const dateFactor = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6 ? 1.2 : 1.0;
  
  // Decide which airlines fly this route based on distance and region
  let carrierOptions = [];
  
  if (distance < 1500) {
    // Short-haul European/MidEast: Low-cost and regional carriers
    carrierOptions = ['W6', 'FR', 'LO', 'ATH'];
  } else if (distance >= 1500 && distance < 4500) {
    // Medium-haul: National carriers
    carrierOptions = ['LO', 'LY', 'BA', 'AF', 'FCO'];
  } else {
    // Long-haul (transatlantic, Tokyo, Dubai): Premium carriers
    carrierOptions = ['LY', 'BA', 'AF', 'DL', 'EK', 'JL'];
  }
  
  // Filter carriers actually defined in AIRLINES
  const availableCarriers = carrierOptions
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

  return availableCarriers.map((airline, idx) => {
    // Calculate randomized offset for departure slot and airline tier
    const tierMultiplier = airline.type === 'lowcost' ? 0.85 : 1.15;
    const timeMultiplier = idx === 0 ? 0.95 : idx === 2 ? 1.05 : 1.0; // Early/late hours are cheaper
    
    const adultPrice = Math.round(basePricePerAdult * dateFactor * tierMultiplier * timeMultiplier);
    
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
      id: `${airline.code}-${idx + 100}-${direction}-${dateStr}`,
      flightNumber: `${airline.code} ${idx + 101 + (direction === 'return' ? 10 : 0)}`,
      airlineCode: airline.code,
      airlineName: airline.name,
      departureTime: departures[idx],
      arrivalTime: formattedArrival + (nextDay ? ' (+1d)' : ''),
      duration: durationStr,
      durationVal: durationHours,
      price: adultPrice, // adult base price
      passengerCosts: priceDetails, // Breakdown and total cost
      cabinClass: airline.type === 'lowcost' ? 'Economy' : 'Economy Standard',
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

  let advice = 'HOLD';
  let adviceDetails = 'Prices are fluctuating but stable. Watch for drops.';
  
  const lastHistoryPrice = history[history.length - 1].price;
  const startHistoryPrice = history[0].price;
  const avgPredPrice = predictions.reduce((sum, item) => sum + item.price, 0) / daysOfPrediction;

  if (avgPredPrice > lastHistoryPrice * 1.05) {
    advice = 'BUY NOW';
    adviceDetails = 'Prices are projected to increase by 5-15% as seat availability shrinks.';
  } else if (lastHistoryPrice < startHistoryPrice * 0.95 || avgPredPrice < lastHistoryPrice * 0.95) {
    advice = 'WAIT';
    adviceDetails = 'Prices are currently lower than average or expected to dip in the coming days.';
  } else {
    advice = 'BUY NOW';
    adviceDetails = 'High demand season. Fares are unlikely to drop further.';
  }

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

  let altitude = 0;
  let speed = 0;
  let status = 'Scheduled';

  if (progress <= 0) {
    status = 'Boarding';
    altitude = 0;
    speed = 0;
  } else if (progress < 0.08) {
    status = 'Takeoff';
    altitude = Math.round(progress * 12.5 * 36000);
    speed = Math.round(250 + progress * 12.5 * 550);
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
