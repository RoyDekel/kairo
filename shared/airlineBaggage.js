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
 *   fee:          [min, max] USD, one way, per passenger, bought online at booking
 *   longHaulFee:  the same for flights at or over LONG_HAUL_KM, where carriers charge more
 *
 * Carriers are left out rather than guessed at. A missing row renders "bag fee unknown"
 * and adds nothing to the total — a wrong number presented as a policy is worse than a
 * gap the user can see.
 *
 * Compiled 2026-09 from general knowledge of published fee structures. NOT checked
 * against each carrier's live fee page — review before treating any row as current.
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
