/*
  Guards the composite-font substitution.

  The app renders digits and currency in IBM Plex Mono while the surrounding prose
  stays in Public Sans / Outfit. That is done with @font-face rules that share a
  family name and differ by unicode-range, so it applies automatically -- which is
  exactly why it fails silently. Nothing throws when a screen opts out; the numbers
  just quietly render in the wrong face, and you only notice by looking.

  Two real regressions motivated these tests, both found by measuring rather than
  reading:

  1. PriceChart passed Chart.js `family: 'var(--font-mono)'`. Chart.js writes that
     string into ctx.font, and Canvas 2D does not resolve CSS custom properties --
     the assignment was rejected and the axis labels fell back to the canvas
     default of 10px sans-serif.

  2. Form controls do not inherit font-family. A bare <input> computed to Arial
     while its sibling <span> got PublicSansWithMono, so numbers inside fields
     rendered in a different face from numbers beside them.

  jsdom has no layout or font engine, so these assert on the declarations that
  drive the behaviour rather than on rendered glyphs.
*/

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (relative) => readFileSync(resolve(here, '..', relative), 'utf8');

const css = readSrc('index.css');

describe('numeric typography', () => {
  test('form controls inherit the composite family instead of the UA default', () => {
    /*
      The regression this catches: a rule that lists the form elements but sets
      only font-variant-numeric, which tunes figures inside a font the control is
      not using.
    */
    const rule = css.match(/input,\s*select,\s*button,\s*textarea[^{]*\{([^}]*)\}/);

    expect(rule, 'expected a shared rule covering input/select/button/textarea').toBeTruthy();
    expect(rule[1]).toMatch(/font-family:\s*inherit/);
  });

  test('canvas consumers use a literal family name, never a CSS variable', () => {
    /*
      Canvas cannot resolve var(). Any component drawing to a canvas has to reach
      for the constants in utils/canvasFonts.js, so a var() reaching a `family:`
      key is always the bug, not a style preference.
    */
    const chart = readSrc('components/PriceChart.jsx');

    expect(chart).not.toMatch(/family:\s*['"]var\(/);
    expect(chart).toMatch(/family:\s*CANVAS_FONT_MONO/);

    const fonts = readSrc('utils/canvasFonts.js');
    expect(fonts).toMatch(/IBM Plex Mono/);
    expect(fonts).not.toMatch(/var\(--/);
  });

  test('every weight of the composite families covers the digit range', () => {
    /*
      A weight whose base face exists but whose unicode-range face does not will
      render its digits in the base font. That is invisible in review and obvious
      on screen, so the two sets are compared directly.
    */
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
      family: (body.match(/font-family:\s*'([^']+)'/) || [])[1],
      weight: (body.match(/font-weight:\s*(\d+)/) || [])[1],
      subset: /unicode-range/.test(body)
    }));

    for (const family of ['OutfitWithMono', 'PublicSansWithMono']) {
      const mine = faces.filter((f) => f.family === family);
      const base = mine.filter((f) => !f.subset).map((f) => f.weight).sort();
      const digits = mine.filter((f) => f.subset).map((f) => f.weight).sort();

      expect(base.length, `${family} declares no base faces`).toBeGreaterThan(0);
      expect(digits, `${family} is missing digit faces for some weights`).toEqual(base);
    }
  });

  test('the digit range covers the characters the app actually formats', () => {
    // Digits, currency, sign, separators and the ratio/duration punctuation that
    // appears inside figures. A gap here shows up as one stray glyph mid-number.
    const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map(([, r]) => r.trim());

    expect(ranges.length).toBeGreaterThan(0);

    for (const range of ranges) {
      expect(range, 'digits').toMatch(/U\+30-39/);
      expect(range, 'dollar sign').toMatch(/U\+24/);
      expect(range, 'decimal point').toMatch(/U\+2E/);
      expect(range, 'thousands separator').toMatch(/U\+2C/);
    }
  });
});
