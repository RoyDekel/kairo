import { inject } from 'vitest';

/*
  Moves the wall clock forward for the clock-shift CI job. Loaded only by
  vitest.clockshift.config.js, never by a plain `npm test`.

  A test that hardcodes a "future" date passes until that date arrives, then fails on main
  and every PR at once — 2026-09-20 in ticketmasterProvider.test.js did exactly that when it
  crossed the insights engine's 14-day window. Running the suite as if it were N days later
  turns that into a failure now, on the PR that introduced the date.

  Only the wall clock moves: Date.now(), `new Date()` and `Date()`. Dates built from explicit
  arguments are untouched, timers are untouched, and vi.useFakeTimers still works because it
  wraps whatever Date is installed when it is called.
*/
const days = inject('clockShiftDays') ?? 0;
const offsetMs = days * 86400000;

// Kept under a registry symbol so a setup file evaluated twice in one worker shifts from the
// real clock, not from an already-shifted one.
const REAL_DATE = Symbol.for('kairo.realDate');
const RealDate = (globalThis[REAL_DATE] ??= Date);

if (offsetMs !== 0) {
  // A function rather than a class, so `Date()` called without `new` still returns a string
  // instead of throwing.
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offsetMs).toString();
    return args.length === 0 ? new RealDate(RealDate.now() + offsetMs) : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => RealDate.now() + offsetMs;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  Object.defineProperty(ShiftedDate, 'name', { value: 'Date' });

  globalThis.Date = ShiftedDate;
}
