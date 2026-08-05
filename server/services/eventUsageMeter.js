import { utcDay } from './dailyBudget.js';

/**
 * Where the event budget actually goes.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The TTL ladder in eventCache.js was sized against a model of traveller behaviour, not
 * against this product's traffic. That model said the change would cut provider calls
 * somewhere between 1.1x and 2.1x depending on whether users book last-minute or plan
 * months ahead — a spread wide enough that the next decision (loosen the imminent tier?
 * pre-warm from the watchlist?) cannot be made from it. The model also predicted that
 * after the change the `imminent` tier would account for roughly 65% of remaining spend,
 * which is a claim worth checking before acting on.
 *
 * So this measures the thing the model guessed at: for every event lookup, which tier the
 * window fell on and whether it was answered from memory, from the durable table, or by
 * paying a provider.
 *
 * DELIBERATELY CHEAP. Counters in memory, no database writes, no timers. Telemetry that
 * costs a row per lookup would consume the budget it exists to protect, and a periodic
 * timer is meaningless on a host that spins the service down when idle. Reporting is
 * driven by activity instead: a line every N provider calls, plus a snapshot on
 * /api/health for reading it live.
 *
 * WHAT IT IS NOT: a store of record. The process restarts and the counters go with it, so
 * treat a snapshot as "since this instance woke up", which is what `sinceIso` says. The
 * durable count of provider calls already exists in api_usage_daily via DailyBudget; this
 * answers the different question of what those calls were spent ON.
 * -------------------------------------------------------------------------------------
 */

/**
 * How a lookup was answered.
 *
 * Only two values, and deliberately not three. Splitting the cached case into memory and
 * durable reads well but cannot be counted honestly here: the discovery page calls
 * warmCache() first, which promotes durable rows into memory in bulk, so every one of the
 * ~31 lookups that follows is a memory hit for a value the durable tier actually supplied.
 * A three-way split would report that page as almost entirely memory-served and make the
 * durable tier look useless.
 *
 * The durable tier is measured where it can be measured — promotions, counted at the
 * prefetch itself, via recordDurablePromotions().
 */
export const LookupSource = {
  /** Answered without touching a provider, from either cache tier. */
  CACHED: 'cached',
  /** Nothing cached: a provider was called and the daily ceiling was charged. */
  PROVIDER: 'provider'
};

const SOURCES = Object.values(LookupSource);

/** Log a summary after this many provider calls. Activity-driven, so idle costs nothing. */
const DEFAULT_REPORT_EVERY = 25;

export class EventUsageMeter {
  constructor({ now = () => Date.now(), reportEvery = DEFAULT_REPORT_EVERY, logger = console } = {}) {
    this.now = now;
    this.reportEvery = reportEvery;
    this.logger = logger;
    this.#reset(utcDay(this.now()));
  }

  #reset(day) {
    this.day = day;
    this.sinceMs = this.now();
    this.byTier = new Map();
    this.totals = Object.fromEntries(SOURCES.map((s) => [s, 0]));
    this.durablePromotions = 0;
    this.providerCallsSinceReport = 0;
  }

  /**
   * Windows the durable table supplied that memory did not have.
   *
   * Counted at the prefetch rather than inferred per lookup, because prefetch promotes
   * into memory before the lookups happen. This is the number that says whether the
   * durable tier is earning its place — each promotion is a provider call a cold start
   * would otherwise have paid.
   */
  recordDurablePromotions(count = 0) {
    if (!Number.isFinite(count) || count <= 0) return;
    this.#rollIfNewDay();
    this.durablePromotions += count;
  }

  /*
    Counters are per UTC day because the provider quota they explain resets on that clock.
    A meter on a different day boundary than the budget it describes would attribute the
    morning's calls to yesterday's ceiling.
  */
  #rollIfNewDay() {
    const day = utcDay(this.now());
    if (day !== this.day) this.#reset(day);
  }

  /**
   * Records one event lookup.
   *
   * @param {string} tier    Ladder tier name from ttlTierFor().
   * @param {string} source  One of LookupSource.
   */
  record(tier, source) {
    if (!SOURCES.includes(source)) return;
    this.#rollIfNewDay();

    if (!this.byTier.has(tier)) {
      this.byTier.set(tier, Object.fromEntries(SOURCES.map((s) => [s, 0])));
    }
    this.byTier.get(tier)[source] += 1;
    this.totals[source] += 1;

    if (source !== LookupSource.PROVIDER) return;

    this.providerCallsSinceReport += 1;
    if (this.providerCallsSinceReport >= this.reportEvery) {
      this.providerCallsSinceReport = 0;
      this.report();
    }
  }

  /**
   * The picture so far.
   *
   * `share` is each tier's percentage of PROVIDER calls specifically — not of lookups.
   * A tier can dominate lookups while costing nothing (that is what a working cache looks
   * like), and spending is the only column that competes for the daily ceiling.
   */
  snapshot() {
    this.#rollIfNewDay();

    const lookups = SOURCES.reduce((sum, s) => sum + this.totals[s], 0);
    const providerCalls = this.totals[LookupSource.PROVIDER];

    const tiers = {};
    for (const [tier, counts] of this.byTier) {
      const tierLookups = SOURCES.reduce((sum, s) => sum + counts[s], 0);
      tiers[tier] = {
        ...counts,
        lookups: tierLookups,
        shareOfProviderCalls: providerCalls === 0
          ? 0
          : Number(((counts[LookupSource.PROVIDER] / providerCalls) * 100).toFixed(1))
      };
    }

    return {
      day: this.day,
      sinceIso: new Date(this.sinceMs).toISOString(),
      lookups,
      ...this.totals,
      durablePromotions: this.durablePromotions,
      /*
        The headline. Every point of hit rate is a provider call not spent, and it is the
        number that says whether the TTL ladder is doing its job on real traffic rather
        than on an assumed traveller mix.
      */
      cacheHitRate: lookups === 0
        ? null
        : Number((((lookups - providerCalls) / lookups) * 100).toFixed(1)),
      tiers
    };
  }

  /** One line, only when there is something to say. */
  report() {
    const s = this.snapshot();
    if (s.lookups === 0) return s;

    const byTier = Object.entries(s.tiers)
      .sort((a, b) => b[1].provider - a[1].provider)
      .map(([tier, t]) => `${tier} ${t.provider}(${t.shareOfProviderCalls}%)`)
      .join(' ');

    this.logger.log(
      `[eventUsage] ${s.day} since ${s.sinceIso}: ${s.lookups} lookups, `
      + `${s.cacheHitRate}% cached, ${s.durablePromotions} rescued by the durable tier, `
      + `${s.provider} provider calls — spend by tier: ${byTier}`
    );

    return s;
  }

  /** Test seam. */
  reset() {
    this.#reset(utcDay(this.now()));
  }
}

/** Shared instance, so every caller in the process counts into the same picture. */
export const eventUsageMeter = new EventUsageMeter();
