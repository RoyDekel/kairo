import { describe, test, expect, vi, beforeEach } from 'vitest';
import { OpenSkyProvider } from '../../../server/providers/openSkyProvider.js';
import { TtlCache } from '../../../server/services/ttlCache.js';

describe('OpenSkyProvider', () => {
  let mockCache;
  let provider;

  beforeEach(() => {
    mockCache = new TtlCache({ ttlMs: 15000 });
    provider = new OpenSkyProvider({ cache: mockCache });
    vi.stubGlobal('fetch', vi.fn());
  });

  test('correctly converts IATA flight numbers to ICAO callsigns', () => {
    expect(provider.getFlightCallsign('LY 5134')).toBe('ELY5134');
    expect(provider.getFlightCallsign('6H 589')).toBe('ISR589');
    expect(provider.getFlightCallsign('IZ 173')).toBe('AIZ173');
    expect(provider.getFlightCallsign('W6 5122')).toBe('WZZ5122');
    expect(provider.getFlightCallsign('XX 123')).toBe('XX123'); // unknown designator falls back safely
  });

  test('calculates correct bounding box coordinates and returns mapped active telemetry', async () => {
    const mockStateVectors = {
      states: [
        // icao24, callsign, origin, time_pos, last_contact, lon, lat, baro_alt, on_ground, velocity, true_track
        ['484123', 'ELY5134 ', 'Israel', 1700000000, 1700000000, 34.0, 32.5, 9000, false, 230, 270, 0, null, 9000, '3212', false, 0]
      ]
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStateVectors
    });

    const telemetry = await provider.getLiveTelemetry('LY 5134', 'TLV', 'LCA');

    expect(telemetry).not.toBeNull();
    expect(telemetry.latitude).toBe(32.5);
    expect(telemetry.longitude).toBe(34.0);
    expect(telemetry.altitude).toBe(Math.round(9000 * 3.28084)); // meters to feet
    expect(telemetry.speed).toBe(Math.round(230 * 3.6)); // m/s to km/h
    expect(telemetry.heading).toBe(270);
    expect(telemetry.status).toBe('Airborne');
    expect(telemetry.source).toBe('live');
  });

  test('returns null if the flight is not airborne or not in the states response', async () => {
    const mockStateVectors = {
      states: [
        ['484123', 'WZZ5122 ', 'Hungary', 1700000000, 1700000000, 34.0, 32.5, 9000, false, 230, 270, 0, null, 9000, '3212', false, 0]
      ]
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStateVectors
    });

    const telemetry = await provider.getLiveTelemetry('LY 5134', 'TLV', 'LCA');
    expect(telemetry).toBeNull();
  });

  test('caches OpenSky Network API responses to prevent aggressive rate limiting', async () => {
    const mockStateVectors = {
      states: [
        ['484123', 'ELY5134 ', 'Israel', 1700000000, 1700000000, 34.0, 32.5, 9000, false, 230, 270, 0, null, 9000, '3212', false, 0]
      ]
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStateVectors
    });

    // First call triggers API fetch
    const t1 = await provider.getLiveTelemetry('LY 5134', 'TLV', 'LCA');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Second call hits cache (fetch is NOT called again)
    const t2 = await provider.getLiveTelemetry('LY 5134', 'TLV', 'LCA');
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(t1).toEqual(t2);
  });
});
