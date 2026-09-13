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
 *   longHaulFee:  the same for flights at or over LONG_HAUL_KM, where carriers charge more.
 *                 `null` means the published price only covers shorter routes, so a
 *                 long-haul flight renders "fee unknown" rather than borrowing it.
 *
 * Carriers are left out rather than guessed at. A missing row renders "bag fee unknown"
 * and adds nothing to the total — a wrong number presented as a policy is worse than a
 * gap the user can see.
 *
 * Provenance differs by row, and each row says which it is:
 *   - VERIFIED rows were read off the carrier's own fee page on the date given.
 *   - Every other row was compiled 2026-09 from general knowledge of published fee
 *     structures and has NOT been checked against the carrier's live fee page — review
 *     before treating it as current.
 * -------------------------------------------------------------------------------------
 */

/** Great-circle distance (km) from which a flight uses a carrier's long-haul fee band. */
export const LONG_HAUL_KM = 4000;

const LOW_COST = (carryOnFee, checkedFee) => ({
  carryOn: { included: false, fee: carryOnFee },
  checked: { included: false, fee: checkedFee }
});

// Full-service carriers whose lowest (Light / Basic) fare keeps the cabin bag but drops
// the checked one.
const LIGHT_FARE_CARRIER = {
  carryOn: { included: true },
  checked: { included: 'fare', fee: [30, 70], longHaulFee: [60, 110] }
};

const US_CARRIER = {
  carryOn: { included: true },
  checked: { included: 'fare', fee: [35, 45], longHaulFee: [75, 100] }
};

const BAG_INCLUDED = {
  carryOn: { included: true },
  checked: { included: true }
};

export const AIRLINE_BAGGAGE = {
  // Low-cost: only an under-seat personal item is in the base fare.
  W6: LOW_COST([20, 60], [30, 85]), // Wizz Air
  FR: LOW_COST([10, 40], [25, 75]), // Ryanair
  U2: LOW_COST([10, 50], [25, 70]), // easyJet
  VY: LOW_COST([10, 40], [20, 60]), // Vueling
  HV: LOW_COST([15, 45], [25, 65]), // Transavia
  EW: LOW_COST([15, 40], [25, 60]), // Eurowings

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
  // no fixed tariff, so these bands are traveller-reported 2025–26 online prices
  // (8kg cabin bag, 20kg checked) — moderate confidence, NOT verified.
  PC: LOW_COST([7, 22], [16, 44]),

  // Full-service, Light / Basic / Lite fares.
  LY: LIGHT_FARE_CARRIER, // EL AL
  LH: LIGHT_FARE_CARRIER, // Lufthansa
  LX: LIGHT_FARE_CARRIER, // SWISS
  OS: LIGHT_FARE_CARRIER, // Austrian
  SN: LIGHT_FARE_CARRIER, // Brussels Airlines
  LO: LIGHT_FARE_CARRIER, // LOT
  AF: LIGHT_FARE_CARRIER, // Air France
  KL: LIGHT_FARE_CARRIER, // KLM
  BA: LIGHT_FARE_CARRIER, // British Airways
  IB: LIGHT_FARE_CARRIER, // Iberia
  AZ: LIGHT_FARE_CARRIER, // ITA Airways
  TP: LIGHT_FARE_CARRIER, // TAP Air Portugal
  A3: LIGHT_FARE_CARRIER, // Aegean
  EY: LIGHT_FARE_CARRIER, // Etihad (Economy Basic)

  // US carriers: Basic Economy keeps the cabin bag on international routes.
  DL: US_CARRIER, // Delta
  UA: US_CARRIER, // United
  AA: US_CARRIER, // American

  // Checked bag included in every economy fare.
  EK: BAG_INCLUDED, // Emirates
  QR: BAG_INCLUDED, // Qatar Airways
  JL: BAG_INCLUDED, // Japan Airlines
  NH: BAG_INCLUDED, // ANA
  SQ: BAG_INCLUDED, // Singapore Airlines
  CX: BAG_INCLUDED // Cathay Pacific
};
