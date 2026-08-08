/**
 * Presentation helpers for flight rows.
 *
 * Kept out of the component so the string logic is unit-testable (CLAUDE.md rule 6) and
 * shared by anything that renders a stops label.
 */

/**
 * The stops label with its layover airport(s) appended.
 *
 * A bare "1 stop" hides the single fact a connecting traveller cares about most — WHERE
 * the stop is. When we know the layover airport(s), show them: "1 stop · MAD",
 * "2 stops · MAD, LIS". Non-stop itineraries carry no layovers and render just "Direct".
 *
 * @param {string} stops            e.g. 'Direct', '1 stop', '2 stops'
 * @param {string[]} [layoverAirports] IATA codes of the connection airports, in order
 * @returns {string}
 */
export function formatStopsLabel(stops, layoverAirports) {
  const label = stops || '';
  if (!Array.isArray(layoverAirports) || layoverAirports.length === 0) {
    return label;
  }
  const codes = layoverAirports.filter(Boolean);
  if (codes.length === 0) return label;
  return `${label} · ${codes.join(', ')}`;
}
