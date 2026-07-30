import { MARQUEE_PAIRS, SIGNATURE_EVENTS, DECIDER_KEYWORDS } from './fixtures.js';

/**
 * Recognises when a trip happens to coincide with something rare.
 *
 * Turns a list of events into at most one short, concrete sentence:
 *
 *   "You're in Madrid during an El Clásico weekend."
 *   "You're visiting Munich during Oktoberfest and a Bayern Munich home match."
 *
 * ---------------------------------------------------------------------------
 * TWO DELIBERATE CONSTRAINTS
 *
 * 1. A BADGE, NOT A SCORE. The discovery card already shows an AI match score and the
 *    verdict already shows a confidence percentage. A third number would turn the screen
 *    into percentage soup. This returns null for ordinary trips, and its value comes
 *    entirely from how rarely it appears.
 *
 * 2. NOTHING IS INFERRED FROM A CALENDAR. Every signal here is derived from an event a
 *    provider actually returned. There is no table saying "Oktoberfest runs late
 *    September", because using one would let KAIRO announce a festival it has no evidence
 *    is happening. If the providers don't surface it, we say nothing.
 *
 *    Consequence worth knowing: coverage limits become silence. While only a ticketing
 *    provider is configured, an event sold exclusively by its organiser won't be detected.
 *    That is the honest failure mode — a missed badge, never a false one.
 * ---------------------------------------------------------------------------
 */

/** Impact score above which a sold-out event counts as a major draw. */
const MAJOR_IMPACT = 90;

/** How many notable events in one window constitute a genuinely busy trip. */
const STACK_THRESHOLD = 2;

function normalize(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this event name one of the signature events people plan trips around? */
export function matchSignatureEvent(event) {
  const title = normalize(event?.title);
  if (!title) return null;
  return SIGNATURE_EVENTS.find((name) => title.includes(normalize(name))) || null;
}

/** Is this one of the rivalries in the shared fixture table? */
export function isMarqueeFixture(event) {
  const teams = [event?.homeTeam, event?.awayTeam].filter(Boolean).map(normalize);

  if (teams.length === 2) {
    const sorted = [...teams].sort();
    if (MARQUEE_PAIRS.some(([a, b]) => sorted[0].includes(a) && sorted[1].includes(b))) return true;
  }

  // Nickname in the title, e.g. "El Clásico" with no teams named.
  const title = normalize(event?.title);
  return MARQUEE_PAIRS.some(([a, b]) => title.includes(a) && title.includes(b)) ||
    DECIDER_KEYWORDS.some((k) => k.includes('clasico') && title.includes(normalize(k)));
}

/** Does the title suggest a decisive occasion rather than a routine date? */
export function isDecider(event) {
  const title = normalize(event?.title);
  if (!title) return false;
  return DECIDER_KEYWORDS.some((keyword) => title.includes(normalize(keyword)));
}

/** A sold-out event with high demand pressure. Only a ticketing source can know this. */
function isSoldOutMajor(event) {
  return Boolean(event?.isSoldOut) && (event?.eventImpactScore ?? 0) >= MAJOR_IMPACT;
}

/** Shortens an event title for use inside a sentence. */
function shortTitle(event) {
  const title = (event?.title || '').trim();
  if (title.length <= 48) return title;
  return `${title.slice(0, 45).trimEnd()}…`;
}

/**
 * Detects the notable occasion for a destination, if there is one.
 *
 * @param {object} input
 * @param {string} input.city    Destination city name, used in the sentence.
 * @param {Array}  input.events  Events already confirmed by a provider.
 * @returns {{tier: 'rare'|'notable', headline: string, reasons: string[], events: Array}|null}
 */
export function detectTravelOccasion({ city, events } = {}) {
  if (!Array.isArray(events) || events.length === 0) return null;

  const marquee = events.filter(isMarqueeFixture);
  const signature = events.filter((e) => matchSignatureEvent(e));
  const deciders = events.filter((e) => isDecider(e) && !marquee.includes(e));
  const soldOutMajors = events.filter(isSoldOutMajor);

  const reasons = [];
  const highlights = [];

  if (signature.length > 0) {
    reasons.push('signature-event');
    highlights.push(...signature);
  }
  if (marquee.length > 0) {
    reasons.push('marquee-fixture');
    highlights.push(...marquee);
  }
  if (deciders.length > 0) {
    reasons.push('decider');
    highlights.push(...deciders);
  }
  if (soldOutMajors.length > 0) {
    reasons.push('sold-out-major');
    highlights.push(...soldOutMajors);
  }

  // Distinct notable events, preserving discovery order.
  const notable = [...new Set(highlights)];
  if (notable.length === 0) return null;

  if (notable.length >= STACK_THRESHOLD) reasons.push('stacked');

  /*
    Rare is reserved for things that genuinely don't happen often: a marquee rivalry, a
    signature festival, or several notable events landing in the same short trip. A single
    cup tie or a sold-out gig is worth mentioning but is not rare.
  */
  const isRare =
    marquee.length > 0 || signature.length > 0 || notable.length >= STACK_THRESHOLD;

  return {
    tier: isRare ? 'rare' : 'notable',
    headline: buildHeadline({ city, notable, marquee, signature }),
    reasons: [...new Set(reasons)],
    events: notable
  };
}

function buildHeadline({ city, notable, marquee, signature }) {
  const place = city ? `in ${city}` : 'there';

  // Name at most two things; beyond that the sentence stops being readable.
  const named = [...signature, ...marquee, ...notable]
    .filter((e, i, arr) => arr.indexOf(e) === i)
    .slice(0, 2)
    .map(shortTitle)
    .filter(Boolean);

  if (named.length === 0) {
    return `Notable timing ${place} during your trip.`;
  }

  if (named.length === 1) {
    return `You're ${place} for ${named[0]}.`;
  }

  const extra = notable.length - 2;
  const tail = extra > 0 ? `, plus ${extra} more` : '';
  return `You're ${place} for ${named[0]} and ${named[1]}${tail}.`;
}
