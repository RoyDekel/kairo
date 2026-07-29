import { AIRPORTS, generateFlightsForRoute } from './flightSimulator';

/**
 * Global Event Intelligence Catalog
 * Maps destination airport codes to major annual/recurring events, sports matches, festivals, and concerts.
 */
export const GLOBAL_EVENTS = [
  // Barcelona (BCN)
  {
    id: 'evt-bcn-1',
    destination: 'BCN',
    title: 'Barcelona European Summer Concert Series',
    venue: 'Estadi Olímpic Lluís Companys',
    category: 'music',
    categoryLabel: 'Music 🎵',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 10, dateEndDay: 30,
    priceEstimate: '$95 - $280',
    description: 'Annual summer stadium concerts and live international tours in Barcelona.'
  },
  {
    id: 'evt-bcn-2',
    destination: 'BCN',
    title: 'Primavera Sound / Festival Sónar',
    venue: 'Parc del Fòrum Barcelona',
    category: 'festivals',
    categoryLabel: 'Festivals 🎪',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 31,
    priceEstimate: '$65 - $180',
    description: 'Famous summer outdoor electronic & indie music festival along the Mediterranean.'
  },

  // Paris (CDG)
  {
    id: 'evt-cdg-1',
    destination: 'CDG',
    title: 'Paris Summer Jazz & Acoustic Sessions',
    venue: 'Salle Pleyel Paris',
    category: 'music',
    categoryLabel: 'Music 🎵',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 9, dateEndDay: 30,
    priceEstimate: '$65 - $180',
    description: 'Acclaimed international jazz ensemble and acoustic performances at Salle Pleyel.'
  },
  {
    id: 'evt-cdg-2',
    destination: 'CDG',
    title: 'Paris International Cultural Showcase & Art Fair',
    venue: 'Grand Palais Paris',
    category: 'culture',
    categoryLabel: 'Culture 🏛️',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 31,
    priceEstimate: '$30 - $90',
    description: 'Contemporary art exhibitions, live performances, and French gastronomy showcase.'
  },

  // London (LHR)
  {
    id: 'evt-lhr-1',
    destination: 'LHR',
    title: 'British Summer Time Open-Air Festival',
    venue: 'Hyde Park London',
    category: 'music',
    categoryLabel: 'Music 🎵',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 31,
    priceEstimate: '$110 - $350',
    description: 'Major summer festival and headliner outdoor concert series in Central London.'
  },
  {
    id: 'evt-lhr-2',
    destination: 'LHR',
    title: 'FRAMELESS Immersive Art Experience',
    venue: 'Marble Arch Place London',
    category: 'culture',
    categoryLabel: 'Culture 🏛️',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 31,
    priceEstimate: '$35 - $90',
    description: 'Multi-sensory digital art exhibition in Central London.'
  },

  // Madrid (MAD)
  {
    id: 'evt-mad-1',
    destination: 'MAD',
    title: 'Real Madrid at Santiago Bernabéu',
    venue: 'Santiago Bernabéu Stadium',
    category: 'sports',
    categoryLabel: 'Sports ⚽',
    dateStartMonth: 8, dateStartDay: 15, dateEndMonth: 8, dateEndDay: 28,
    priceEstimate: '$95 - $280',
    description: 'Experience the newly renovated retractable-roof Bernabéu arena.'
  },
  {
    id: 'evt-mad-2',
    destination: 'MAD',
    title: 'Mad Cool Summer Nights Festival',
    venue: 'Valdebebas Event Center',
    category: 'festivals',
    categoryLabel: 'Festivals 🎪',
    dateStartMonth: 8, dateStartDay: 8, dateEndMonth: 8, dateEndDay: 24,
    priceEstimate: '$70 - $160',
    description: 'Open-air international rock, pop, and electronic summer series.'
  },

  // Berlin (BER)
  {
    id: 'evt-ber-1',
    destination: 'BER',
    title: 'Berlin Electronic Music Week',
    venue: 'Watergate & Tresor',
    category: 'festivals',
    categoryLabel: 'Festivals 🎪',
    dateStartMonth: 8, dateStartDay: 5, dateEndMonth: 8, dateEndDay: 25,
    priceEstimate: '$25 - $75',
    description: 'World capital of techno music, featuring legendary DJ lineups.'
  },

  // Munich (MUC)
  {
    id: 'evt-muc-1',
    destination: 'MUC',
    title: 'FC Bayern Munich Summer Supercup',
    venue: 'Allianz Arena',
    category: 'sports',
    categoryLabel: 'Sports ⚽',
    dateStartMonth: 8, dateStartDay: 10, dateEndMonth: 8, dateEndDay: 22,
    priceEstimate: '$70 - $210',
    description: 'Watch Bayern Munich play at the illuminated Allianz Arena.'
  },

  // Krakow (KRK)
  {
    id: 'evt-krk-1',
    destination: 'KRK',
    title: 'Krakow Live Music & Pierogi Cultural Festival',
    venue: 'Main Market Square (Rynek Główny)',
    category: 'culture',
    categoryLabel: 'Culture 🏛️',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 30,
    priceEstimate: '$15 - $45',
    description: 'Historic Old Town food and live acoustic indie stage performances.'
  },

  // Rome (FCO)
  {
    id: 'evt-fco-1',
    destination: 'FCO',
    title: 'AS Roma Serie A Opener',
    venue: 'Stadio Olimpico',
    category: 'sports',
    categoryLabel: 'Sports ⚽',
    dateStartMonth: 8, dateStartDay: 16, dateEndMonth: 8, dateEndDay: 29,
    priceEstimate: '$40 - $130',
    description: 'Passionate Italian football action under the Roman lights.'
  },

  // Amsterdam (AMS)
  {
    id: 'evt-ams-1',
    destination: 'AMS',
    title: 'Canal Festival & Open Air Concerts',
    venue: 'Prinsengracht Canal',
    category: 'festivals',
    categoryLabel: 'Festivals 🎪',
    dateStartMonth: 8, dateStartDay: 8, dateEndMonth: 8, dateEndDay: 24,
    priceEstimate: '$0 - $60',
    description: 'Classical music floating on pontoon stages throughout Amsterdam canals.'
  },

  // Miami (MIA)
  {
    id: 'evt-mia-1',
    destination: 'MIA',
    title: 'Inter Miami CF Match / Lionel Messi Live',
    venue: 'Chase Stadium',
    category: 'sports',
    categoryLabel: 'Sports ⚽',
    dateStartMonth: 8, dateStartDay: 5, dateEndMonth: 8, dateEndDay: 28,
    priceEstimate: '$110 - $350',
    description: 'MLS action starring Lionel Messi in South Florida.'
  },

  // Tokyo (NRT / HND)
  {
    id: 'evt-tokyo-1',
    destination: 'NRT',
    title: 'Summer Sonic Tokyo Music Festival',
    venue: 'ZOZO Marine Stadium',
    category: 'music',
    categoryLabel: 'Music 🎵',
    dateStartMonth: 8, dateStartDay: 14, dateEndMonth: 8, dateEndDay: 22,
    priceEstimate: '$120 - $280',
    description: 'Massive dual-city Japanese music festival with international headliners.'
  },

  // Seoul (ICN)
  {
    id: 'evt-icn-1',
    destination: 'ICN',
    title: 'K-Pop World Super Concert',
    venue: 'Seoul Olympic Stadium',
    category: 'music',
    categoryLabel: 'Music 🎵',
    dateStartMonth: 8, dateStartDay: 10, dateEndMonth: 8, dateEndDay: 25,
    priceEstimate: '$80 - $220',
    description: 'Top-tier Korean pop artists, choreography, and stadium production.'
  },

  // Athens (ATH)
  {
    id: 'evt-ath-1',
    destination: 'ATH',
    title: 'Epidaurus Ancient Theater Summer Drama',
    venue: 'Ancient Theater of Epidaurus',
    category: 'culture',
    categoryLabel: 'Culture 🏛️',
    dateStartMonth: 8, dateStartDay: 1, dateEndMonth: 8, dateEndDay: 30,
    priceEstimate: '$30 - $80',
    description: 'Performances under the stars in a 2,400-year-old ancient Greek amphitheater.'
  }
];

/**
 * Searches global destinations and correlates flight prices with live event calendars.
 * 
 * @param {Object} params
 * @param {string} params.origin - Origin airport code (e.g. 'TLV')
 * @param {string} params.departureDate - YYYY-MM-DD
 * @param {string} params.returnDate - YYYY-MM-DD
 * @param {number} [params.maxBudget] - Optional max budget limit in USD
 * @param {string[]} [params.interests] - Selected category filters ('music', 'sports', 'festivals', 'culture')
 * @returns {Array<Object>} List of ranked recommended destination packages
 */
export function searchAIDestinations({
  origin = 'TLV',
  departureDate = '2026-08-11',
  returnDate = '2026-08-16',
  maxBudget = 1000,
  interests = []
}) {
  const depDateObj = new Date(departureDate);
  const depMonth = depDateObj.getMonth() + 1; // 1-12
  const depDay = depDateObj.getDate();

  const destinationCodes = Object.keys(AIRPORTS).filter((code) => code !== origin);

  const results = [];

  for (const destCode of destinationCodes) {
    const destinationInfo = AIRPORTS[destCode];

    // Generate mock roundtrip flights
    const outboundFlights = generateFlightsForRoute(origin, destCode, departureDate, 'outbound', { adults: 1 });
    const returnFlights = generateFlightsForRoute(destCode, origin, returnDate, 'return', { adults: 1 });

    if (!outboundFlights.length || !returnFlights.length) continue;

    const cheapestOutbound = outboundFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), outboundFlights[0]);
    const cheapestReturn = returnFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), returnFlights[0]);

    const totalRoundtripPrice = cheapestOutbound.price + cheapestReturn.price;

    // Filter by budget if provided
    if (maxBudget && totalRoundtripPrice > maxBudget) continue;

    // Benchmark comparison price (simulate 25%-45% baseline market savings)
    const averageMarketPrice = Math.round(totalRoundtripPrice * 1.35);
    const savingsAmount = averageMarketPrice - totalRoundtripPrice;
    const savingsPercent = Math.round((savingsAmount / averageMarketPrice) * 100);

    // Match events happening in destination during travel month/day window
    let matchedEvents = GLOBAL_EVENTS.filter((evt) => {
      if (evt.destination !== destCode) return false;

      // Simple date overlap check
      const eventActive =
        (depMonth === evt.dateStartMonth && depDay >= evt.dateStartDay && depDay <= evt.dateEndDay) ||
        (depMonth >= evt.dateStartMonth && depMonth <= evt.dateEndMonth);

      return eventActive;
    });

    // If interest filter applied, boost matching events
    if (interests.length > 0) {
      const filteredEvents = matchedEvents.filter((evt) => interests.includes(evt.category));
      if (filteredEvents.length > 0) {
        matchedEvents = filteredEvents;
      }
    }

    // Default fallback event generator for destination if catalog has no direct match for specific date
    if (matchedEvents.length === 0) {
      matchedEvents = [
        {
          id: `evt-gen-${destCode}-1`,
          destination: destCode,
          title: `${destinationInfo.city} Summer Night Sessions`,
          venue: `${destinationInfo.city} City Center & Riverfront`,
          category: 'culture',
          categoryLabel: 'Culture 🏛️',
          priceEstimate: '$20 - $50',
          description: `Live outdoor cultural performances, food stalls, and music across ${destinationInfo.city}.`
        }
      ];
    }

    // Calculate AI Recommendation Match Score (0 to 100)
    const priceScore = Math.min(50, savingsPercent * 1.2);
    const eventScore = Math.min(30, matchedEvents.length * 15);
    const interestBonus = interests.some((i) => matchedEvents.some((e) => e.category === i)) ? 20 : 5;
    
    const matchScore = Math.min(99, Math.round(priceScore + eventScore + interestBonus));

    // Construct Natural Language AI Insight Statement
    const topEvent = matchedEvents[0];
    const aiInsight = `${destinationInfo.city} is a 🔥 top match! Flight is ${savingsPercent}% below historical average ($${totalRoundtripPrice} roundtrip). Plus, catch "${topEvent.title}" at ${topEvent.venue} during your trip.`;

    results.push({
      id: `ai-dest-${destCode}`,
      destination: destinationInfo,
      originCode: origin,
      destCode,
      roundtripPrice: totalRoundtripPrice,
      averageMarketPrice,
      savingsPercent,
      savingsAmount,
      outboundFlight: cheapestOutbound,
      returnFlight: cheapestReturn,
      matchedEvents,
      matchScore,
      aiInsight,
      departureDate,
      returnDate
    });
  }

  // Sort results by AI Match Score descending
  return results.sort((a, b) => b.matchScore - a.matchScore);
}
