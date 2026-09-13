import { mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

/*
  The unit suite, run as if today were CLOCK_SHIFT_DAYS later (default 400).

    npm run test:clock-shift                      # +400 days
    CLOCK_SHIFT_DAYS=30 npm run test:clock-shift  # +30 days

  A failure here that `npm test` does not have means a test depends on today's date —
  almost always a hardcoded "future" date that is about to become a past one. Build the date
  relative to Date.now() instead. See src/setupClockShift.js and the clock-shift job in
  .github/workflows/ci.yml.
*/
const raw = process.env.CLOCK_SHIFT_DAYS ?? '400';
const days = Number(raw);
if (!Number.isInteger(days) || days <= 0) {
  throw new Error(`CLOCK_SHIFT_DAYS must be a positive whole number of days, got "${raw}"`);
}

const config = mergeConfig(baseConfig, {
  test: { provide: { clockShiftDays: days } },
});

// Replaced rather than merged: the shim must run BEFORE setupTests.js, so that modules it
// imports never capture the real clock. mergeConfig would append it after.
config.test.setupFiles = ['./src/setupClockShift.js', ...[].concat(baseConfig.test.setupFiles)];

export default config;
