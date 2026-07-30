import { EventProvider } from './eventProvider.js';

/**
 * Hand-written event data for local development.
 *
 * IMPORTANT: this is only used when no live provider is configured — i.e. running without
 * API credentials. It is deliberately NOT a fallback for a provider that is merely
 * unreachable. It used to be, which meant a throttled or down API produced fabricated
 * listings ("El Clásico", "Primavera Sound") rendered identically to real ones, with
 * nothing telling the user. An unreachable provider now reports `unavailable` instead.
 */

const CURATED = {
  BCN: [
    { id: 'sim-bcn-1', title: 'FC Barcelona vs Real Madrid (El Clásico)', venue: 'Estadi Olímpic Lluís Companys', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$120 - $350', eventImpactScore: 96, isSoldOut: true },
    { id: 'sim-bcn-2', title: 'Primavera Sound Festival', venue: 'Parc del Fòrum', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$85 - $240', eventImpactScore: 92, isSoldOut: false }
  ],
  CDG: [
    { id: 'sim-cdg-1', title: 'Coldplay Music of the Spheres', venue: 'Stade de France', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$95 - $280', eventImpactScore: 98, isSoldOut: true },
    { id: 'sim-cdg-2', title: 'PSG Champions League Night', venue: 'Parc des Princes', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$110 - $320', eventImpactScore: 90, isSoldOut: true }
  ],
  LHR: [
    { id: 'sim-lhr-1', title: 'Premier League London Derby', venue: 'Wembley Stadium', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$100 - $300', eventImpactScore: 94, isSoldOut: true },
    { id: 'sim-lhr-2', title: 'British Summer Time Hyde Park', venue: 'Hyde Park London', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$80 - $210', eventImpactScore: 89, isSoldOut: false }
  ],
  JFK: [
    { id: 'sim-jfk-1', title: 'US Open Tennis Championships', venue: 'Arthur Ashe Stadium', category: 'sports', categoryLabel: 'Sports 🎾', priceEstimate: '$150 - $450', eventImpactScore: 97, isSoldOut: true },
    { id: 'sim-jfk-2', title: 'Stadium Tour Encore Night', venue: 'MetLife Stadium', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$200 - $600', eventImpactScore: 99, isSoldOut: true }
  ]
};

export class SimulatedEventProvider extends EventProvider {
  static get key() {
    return 'simulated';
  }

  /** No network calls, so the limit is nominal. */
  static get rateLimit() {
    return { limit: 1e9, windowMs: 1 };
  }

  async fetchEvents(location, _window, airportCode) {
    const code = airportCode?.toUpperCase();
    const city = location.city;

    const curated = CURATED[code];
    const events = curated || [
      {
        id: `sim-${code}-gen1`,
        title: `${city} International Music & Cultural Festival`,
        venue: `${city} Main Exhibition Center`,
        category: 'music',
        categoryLabel: 'Music 🎵',
        priceEstimate: '$75 - $190',
        eventImpactScore: 88,
        isSoldOut: false
      },
      {
        id: `sim-${code}-gen2`,
        title: `${city} Championship Sports Showcase`,
        venue: `${city} Arena Stadium`,
        category: 'sports',
        categoryLabel: 'Sports ⚽',
        priceEstimate: '$65 - $160',
        eventImpactScore: 85,
        isSoldOut: false
      }
    ];

    return this.ok(
      events.map((e) => ({
        ...e,
        source: SimulatedEventProvider.key,
        destination: airportCode,
        // Marked false so nothing downstream can present this as verified live data.
        isLiveApi: false,
        date: e.date || null
      })),
      'simulated'
    );
  }
}
