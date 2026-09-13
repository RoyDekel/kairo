/**
 * Typical baggage policy per carrier, for the Search & Compare bag-cost ESTIMATE.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS IS A TABLE AND NOT PROVIDER DATA
 *
 * No provider KAIRO can call reports what a bag costs. fli (the production provider)
 * gets nothing from Google's shopping response and returns `baggage: null`; SerpApi's
 * `bags` parameter covers carry-on only and bills per search; Kiwi Tequila is closed to
 * new partners. So the only honest option is a typical-policy table, labelled everywhere
 * it surfaces as an estimate.
 *
 * -------------------------------------------------------------------------------------
 * WHAT A ROW MEANS
 *
 * Each row describes the CHEAPEST fare family the carrier sells, because that is the fare
 * Google Flights (and so every KAIRO result) surfaces first:
 *
 *   included: true    the bag is part of that fare
 *             false   it is always sold as an extra on that fare
 *             'fare'  it depends on the fare family, and the lowest one (Light / Basic /
 *                     Lite) usually excludes it — estimated as extra, flagged as such
 *
 *   fee:          [min, max] USD, one way, per passenger, bought online at booking.
 *                 A carrier that publishes one flat price gets [price, price].
 *                 `null` means the carrier publishes no price for it, so the bag renders
 *                 "fee unknown" rather than an invented number.
 *   longHaulFee:  the same for flights at or over LONG_HAUL_KM, where carriers charge more.
 *                 `null` means the published price only covers shorter routes, so a
 *                 long-haul flight renders "fee unknown" rather than borrowing it.
 *   longHaulIncluded: overrides `included` on long-haul, for carriers whose cheapest
 *                 fare differs by route length (e.g. a Basic fare sold on short-haul only).
 *
 * The "Checked bag" option means the carrier's standard 20–23 kg bag: 20 kg where that is
 * the size sold (Ryanair, Wizz, Vueling, Transavia, Arkia), 23 kg otherwise.
 *
 * Carriers are left out rather than guessed at. A missing row renders "bag fee unknown"
 * and adds nothing to the total — a wrong number presented as a policy is worse than a
 * gap the user can see.
 *
 * -------------------------------------------------------------------------------------
 * PROVENANCE — every row says which of these it is, all checked 2026-09-13:
 *
 *   VERIFIED     read directly off the carrier's own page.
 *   SITE-SEARCH  the carrier's page could not be read directly (bot-blocked or rendered
 *                by script), so the figure comes from a search restricted to the
 *                carrier's own domain. Carrier-sourced, but not seen first-hand.
 *   REPORTED     the carrier publishes no price; the figure is traveller/third-party
 *                reporting for 2025–26.
 *   UNVERIFIED   could not be checked; general knowledge. Review before relying on it.
 *
 * EUR and GBP prices are converted at €1 = $1.16 and £1 = $1.32 — the rates Eurowings and
 * Iberia themselves apply on their multi-currency fee tables — and rounded to whole dollars.
 * -------------------------------------------------------------------------------------
 */

/** Great-circle distance (km) from which a flight uses a carrier's long-haul fee band. */
export const LONG_HAUL_KM = 4000;

const LOW_COST = (carryOnFee, checkedFee) => ({
  carryOn: { included: false, fee: carryOnFee },
  checked: { included: false, fee: checkedFee }
});

const BAG_INCLUDED = {
  carryOn: { included: true },
  checked: { included: true }
};

export const AIRLINE_BAGGAGE = {
  // ---------------------------------------------------------------- Low-cost
  // Only an under-seat personal item is in the base fare.

  // Wizz Air. Personal item only: VERIFIED. WIZZ Priority (10 kg trolley) €10–60 online:
  // VERIFIED at wizzair.com/…/wizz-priority. 20 kg bag €13–86.50: REPORTED — wizzair.com
  // publishes weight tiers but no prices.
  W6: LOW_COST([12, 70], [15, 100]),

  // Ryanair. VERIFIED at ryanair.com/gb/en/useful-info/help-centre/fees: Priority & 2 Cabin
  // Bags €12.49–36, 20 kg check-in bag €21.49–59.99, at time of booking, per flight.
  FR: LOW_COST([14, 42], [25, 70]),

  // easyJet. One small under-seat bag included: VERIFIED at easyjet.com/…/fees, which
  // publishes NO online bag prices ("fees vary … you'll see exact price at time of
  // purchase"; £60 at the airport). Bands are UNVERIFIED.
  U2: LOW_COST([10, 50], [25, 70]),

  // Vueling. Basic (Fly Light) is personal item only: VERIFIED. 20 kg bag €14–96 online:
  // VERIFIED at help.vueling.com (Checked Luggage Allowance). Cabin-bag price is not
  // published ("prices vary depending on the booking"): UNVERIFIED band.
  VY: LOW_COST([10, 40], [16, 111]),

  // Transavia (HV flight numbers). VERIFIED at transavia.com help pages: cabin bag €20–50
  // one way; 20 kg checked €33–61 online.
  HV: LOW_COST([23, 58], [38, 71]),

  // Eurowings. BASIC = small underseat bag only: VERIFIED at eurowings.com/…/baggage.html,
  // which quotes USD directly: large cabin bag from $24, first 23 kg bag from $21. The
  // page gives no maximum; the upper bounds (€50 / €70) are SITE-SEARCH.
  EW: LOW_COST([24, 58], [21, 81]),

  // Israir. VERIFIED 2026-09-13 at israir.co.il/Passengers_Info/Baggage_Policy: personal
  // item 40x30x20 included; online, per direction: trolley (10kg) $30, first 23kg bag $65.
  // The page covers all international flights. Prices have risen repeatedly ($20/$45 →
  // $25/$50 → $30/$65), so re-check this row first when the table is reviewed.
  '6H': LOW_COST([30, 30], [65, 65]),

  // Arkia. VERIFIED 2026-09-13 at ssr.arkia.co.il/en/luggage-information: personal item
  // 20x30x40 included; online in advance, per direction: trolley (8kg) $25, first 20kg bag
  // $50. The page is for EUROPE flights only, so long-haul routes stay unknown.
  IZ: {
    carryOn: { included: false, fee: [25, 25], longHaulFee: null },
    checked: { included: false, fee: [50, 50], longHaulFee: null }
  },

  // Pegasus. Basic / Light international fares carry a 3kg under-seat item only (per
  // flypgs.com general rules). Pegasus prices add-ons dynamically by route and publishes
  // no fixed tariff, so these bands are REPORTED 2025–26 online prices (8kg cabin bag,
  // 20kg checked) — moderate confidence.
  PC: LOW_COST([7, 22], [16, 44]),

  // ---------------------------------------------------------------- Full-service

  // EL AL. Lite includes one carry-on (gate-checked free on Europe/UAE routes) and no
  // checked bag, Classic includes one 23 kg bag: VERIFIED at elal.com/eng/baggage. The
  // Lite bag price is not published ("the fee varies"); $35 is REPORTED from an earlier
  // EL AL fare table. Long-haul stays unknown: North America sells no Lite fare (the
  // cheapest fare includes a bag) while Far East Lite does not — one number can't cover both.
  LY: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [35, 70], longHaulFee: null }
  },

  // Lufthansa Group. From 19 May 2026 a new Economy Basic fare — personal item only, with
  // the carry-on sold as an add-on — is rolling out on SELECT short/medium-haul routes:
  // VERIFIED at newsroom.lufthansagroup.com (23 Apr 2026) and lufthansa.com Europe fares.
  // Whether the cheapest fare on a route includes a carry-on therefore depends on the
  // route, and the add-on price is not published: short-haul carry-on is unknown.
  // Long-haul keeps the 8 kg cabin bag. First checked bag €35 Europe / €60–70 long-haul:
  // SITE-SEARCH (lufthansa.com fare pages).
  LH: {
    carryOn: { included: 'fare', fee: null, longHaulIncluded: true },
    checked: { included: 'fare', fee: [41, 41], longHaulFee: [70, 81] }
  },

  // Air France / KLM. Light keeps a 12 kg cabin allowance and has no checked bag:
  // SITE-SEARCH (klm.com ticket options). First extra bag bought ≥24h ahead €20–70 within
  // Europe, €30–240 intercontinental: VERIFIED at klm.com/…/extra-oversized-overweight-baggage
  // (the Air France-KLM group applies one policy).
  KL: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [23, 81], longHaulFee: [35, 278] }
  },

  // British Airways. UNVERIFIED — BA's allowance pages render only through a widget that
  // could not be read, and third-party reports CONFLICT on whether Basic still includes
  // the full-size cabin bag. Kept as "included" (the majority report) pending a check.
  BA: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [30, 70], longHaulFee: [60, 110] }
  },

  // Iberia. "With all our fares you can take a carry-on bag": VERIFIED at
  // iberia.com/us/baggage. First 23 kg bag online, VERIFIED at iberia.com/us/luggage/
  // allowance-in-hold (Iberia quotes USD itself): Europe, Israel & North Africa zone
  // $22–111; America & Asia €50–135 (≈ $58–158).
  IB: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [22, 111], longHaulFee: [58, 158] }
  },

  // ITA Airways. Economy Light: "No baggage" checked — VERIFIED at ita-airways.com/…/
  // checked-baggage. 8 kg cabin bag included and first bag €30 Europe / €50–55
  // intercontinental: SITE-SEARCH (ita-airways.com Light terms).
  AZ: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [35, 35], longHaulFee: [58, 64] }
  },

  // TAP. Discount fare keeps a 10 kg cabin bag, no checked bag; long-haul Basic includes
  // one. First bag €30 Europe, €65 long-haul: SITE-SEARCH (flytap.com; the long-haul figure
  // is from an older TAP fee PDF — weakest row in this group).
  TP: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [35, 35], longHaulFee: [75, 75] }
  },

  // LOT. Economy Saver keeps an 8 kg cabin bag; checked bag is excluded in Europe and to
  // the US/Canada but INCLUDED to Japan/China/India/Korea, and LOT publishes no bag price
  // (itinerary-specific): SITE-SEARCH. Checked bag therefore stays unknown.
  LO: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: null }
  },

  // Aegean. Light allows EITHER a personal item OR an 8 kg carry-on; no checked bag. First
  // bag prepaid €20–60 on international routes: SITE-SEARCH (aegeanair.com conditions).
  A3: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: [23, 70] }
  },

  // Etihad. Economy Basic keeps a 7 kg cabin bag, no checked bag; the bag price is only
  // shown in Manage Booking, not published: SITE-SEARCH. Checked bag stays unknown.
  EY: {
    carryOn: { included: true },
    checked: { included: 'fare', fee: null }
  },

  // ---------------------------------------------------------------- US carriers
  // Basic Economy keeps a full-size carry-on on transatlantic routes (American: on all
  // routes — VERIFIED at news.aa.com, 2026 bag-fee update). No checked bag on Basic.
  // Domestic first bag $45 (Delta) / $50 prepaid (American Basic, from 18 May 2026 —
  // VERIFIED news.aa.com). Transatlantic Basic first bag ~$75 (Delta, United) / $85
  // (American, tickets issued from 18 May 2026): SITE-SEARCH (delta.com, united.com, aa.com).
  DL: { carryOn: { included: true }, checked: { included: 'fare', fee: [45, 45], longHaulFee: [75, 75] } },
  UA: { carryOn: { included: true }, checked: { included: 'fare', fee: [45, 45], longHaulFee: [75, 75] } },
  AA: { carryOn: { included: true }, checked: { included: 'fare', fee: [50, 50], longHaulFee: [85, 85] } },

  // ---------------------------------------------------------------- Bag included
  // Even the lowest economy fare includes a checked bag on international routes (Qatar
  // Economy Lite 20 kg; Emirates Economy Special 20 kg / 1x23 kg; Singapore Economy Lite
  // 25 kg; Cathay Economy Light 1x23 kg; JAL / ANA 2x23 kg): SITE-SEARCH on each carrier's
  // own domain.
  EK: BAG_INCLUDED, // Emirates
  QR: BAG_INCLUDED, // Qatar Airways
  JL: BAG_INCLUDED, // Japan Airlines
  NH: BAG_INCLUDED, // ANA
  SQ: BAG_INCLUDED, // Singapore Airlines
  CX: BAG_INCLUDED // Cathay Pacific
};

// Carriers that share a policy with a row above.
AIRLINE_BAGGAGE.LX = AIRLINE_BAGGAGE.LH; // SWISS
AIRLINE_BAGGAGE.OS = AIRLINE_BAGGAGE.LH; // Austrian
AIRLINE_BAGGAGE.SN = AIRLINE_BAGGAGE.LH; // Brussels Airlines
AIRLINE_BAGGAGE.AF = AIRLINE_BAGGAGE.KL; // Air France
