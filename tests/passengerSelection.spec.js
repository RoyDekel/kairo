import { test, expect } from '@playwright/test';

/*
  E2E for the passenger/cabin-class selector on "Search & Compare"
  (src/components/AlternativeFlights.jsx).

  Two things this file has to work around, both of which broke it silently before
  (see [KAI-005] in docs/product/backlog.md):

  1. Every workspace tab is behind auth. App.jsx renders NAV_ITEMS as buttons that open
     the sign-in modal instead of switching tabs while `user` is null, and signed-out
     visitors are pinned to the landing page. So a UI test of the search form has to
     arrive already signed in.

  2. Nav copy moves. "Find Flights" became "Search & Compare" in 4050aa7 and this suite
     went on asserting the old string for four weeks without anyone noticing, because
     nothing ran it. Selectors here are therefore anchored to roles and to the one stable
     class name the popover already has (`.passenger-popover`), not to positional XPath.
*/

// Supabase persists its session under `sb-<project-ref>-auth-token`, where the ref is the
// first hostname label of VITE_SUPABASE_URL. That URL is pinned in src/lib/supabaseClient.js
// (env value and hardcoded fallback are the same project). Seeding that key is how we get a
// signed-in app without shipping real credentials in the repo or putting a live Supabase
// round-trip on the critical path of a UI test. If the project ref ever changes, the
// `Sign In` assertion in beforeEach fails immediately and says so -- it does not silently
// fall through to a 30s timeout on the nav click.
const SUPABASE_PROJECT_REF = 'xcqtmvmomdbepjuyqnog';
const AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

function fakeSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + 60 * 60;
  const encode = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');

  // supabase-js only reads `expires_at` off the stored session to decide whether to refresh,
  // but a structurally valid JWT keeps anything that decodes the token happy too.
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@kairo.test',
      iat: nowSeconds,
      exp: expiresAt
    }),
    'e2e-signature-not-verified-client-side'
  ].join('.');

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 60 * 60,
    expires_at: expiresAt,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@kairo.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date(nowSeconds * 1000).toISOString()
    }
  };
}

// The popover's rows are direct children of `.passenger-popover`; each holds one label and
// its -/+ stepper. Filtering direct children by label text avoids the `../../..` walk the
// previous version used, which would break on any wrapper div added to the markup.
const counterRow = (page, label) =>
  page.locator('.passenger-popover > div').filter({ hasText: label });

// "1 Passenger, Economy" / "4 Passengers, Economy" -- matching the shape rather than a
// fixed count keeps this locator valid while the test changes the count.
const passengerButton = (page) =>
  page.getByRole('button', { name: /\d+ Passengers?,/ });

test.describe('KAIRO Passenger Selection E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // `globalThis`, not `window`: this callback is serialised and runs in the browser, but
    // eslint lints tests/ with node globals only (eslint.config.js), so `window` reads as
    // undefined here. `globalThis.localStorage` is the same object at runtime and is legal
    // in both environments.
    await page.addInitScript(
      ([key, session]) => globalThis.localStorage.setItem(key, session),
      [AUTH_STORAGE_KEY, JSON.stringify(fakeSession())]
    );

    // vite.config.js sets `base: '/kairo/'`, so the app is not served from the root.
    await page.goto('/kairo/');

    // Gate on the app having accepted the session before clicking a nav item: while `user`
    // is still null those buttons open the auth modal rather than switching tabs.
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Search & Compare', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search & Compare Fares' })).toBeVisible();
  });

  test('opens passenger selection dropdown, increments counters, and updates passenger count text', async ({ page }) => {
    // 1. Initially should show "1 Passenger"
    const passengerBtn = passengerButton(page);
    await expect(passengerBtn).toContainText('1 Passenger');

    // 2. Click the selector button to open the dropdown overlay
    await passengerBtn.click();

    const dropdown = page.locator('.passenger-popover');
    await expect(dropdown).toBeVisible();

    // 3. Update passenger counts. These are -/+ steppers, not number inputs: 1 -> 2 adults,
    //    0 -> 1 child, 0 -> 1 infant.
    await counterRow(page, 'Adults').getByRole('button', { name: '+' }).click();
    await counterRow(page, 'Children').getByRole('button', { name: '+' }).click();
    await counterRow(page, 'Infants').getByRole('button', { name: '+' }).click();

    // The text on the selector button should update immediately to "4 Passengers"
    await expect(passengerBtn).toContainText('4 Passengers');

    // 4. Click the "Done" button to close the dropdown
    await dropdown.getByRole('button', { name: 'Done' }).click();

    // Verify dropdown is now closed
    await expect(dropdown).toBeHidden();
  });

  test('closes passenger selection dropdown when clicking outside', async ({ page }) => {
    await passengerButton(page).click();

    const dropdown = page.locator('.passenger-popover');
    await expect(dropdown).toBeVisible();

    // Click outside the dropdown (the panel heading)
    await page.getByRole('heading', { name: 'Search & Compare Fares' }).click();

    // Verify the dropdown closes automatically
    await expect(dropdown).toBeHidden();
  });

  test('asserts that Passenger selection dropdown overlays on top of the Search Flights CTA without pushing layout', async ({ page }) => {
    const passengerBtn = passengerButton(page);
    const searchBtn = page.getByRole('button', { name: 'Search Flights', exact: true });

    // Get position of the Search Flights button BEFORE opening the dropdown
    const searchBtnBoxBefore = await searchBtn.boundingBox();
    expect(searchBtnBoxBefore).not.toBeNull();

    // Open dropdown
    await passengerBtn.click();

    const dropdown = page.locator('.passenger-popover');
    await expect(dropdown).toBeVisible();

    // Get position of the Search Flights button AFTER opening the dropdown
    const searchBtnBoxAfter = await searchBtn.boundingBox();
    expect(searchBtnBoxAfter).not.toBeNull();

    // Verify both elements are visible simultaneously
    await expect(searchBtn).toBeVisible();
    await expect(dropdown).toBeVisible();

    const dropdownBox = await dropdown.boundingBox();
    expect(dropdownBox).not.toBeNull();

    /*
      The Search Flights button should NOT have moved down: the popover is
      `position: absolute` (index.css `.passenger-popover`) and must overlay the form rather
      than reflow it.

      Tolerance rather than equality, and the size of it matters. This was
      `toBeCloseTo(y, 1)` -- agreement to within 0.05px -- which failed on a CI runner with a
      0.3px difference, a number no browser promises anything about (sub-pixel flex layout,
      font metrics settling). Meanwhile the regression being guarded against is not subtle:
      if the popover ever stopped being absolutely positioned it would push this button down
      by its own full height, asserted just below to be well clear of the tolerance. A
      tolerance far tighter than the property under test does not make the test stricter, it
      only makes it report noise.
    */
    const LAYOUT_JITTER_TOLERANCE_PX = 2;
    expect(dropdownBox.height).toBeGreaterThan(LAYOUT_JITTER_TOLERANCE_PX * 20);
    expect(Math.abs(searchBtnBoxAfter.y - searchBtnBoxBefore.y)).toBeLessThan(LAYOUT_JITTER_TOLERANCE_PX);

    // The dropdown top coordinate (y) is above the search button y
    expect(dropdownBox.y).toBeLessThan(searchBtnBoxAfter.y);
  });
});
