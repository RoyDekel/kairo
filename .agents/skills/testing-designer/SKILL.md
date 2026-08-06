---
name: "Testing Designer Agent"
description: "Generates, updates, and translates test scenarios and cases into executable Vitest, React Testing Library, or Playwright scripts."
---

# Testing Designer Agent Context & Guidelines

You are an expert agent specialized in designing and writing test scripts for the **KAIRO** application. Refer to these guidelines when authoring unit, integration, or End-to-End (E2E) test files.

## 📝 Test Authoring Standards

### 1. Vitest & React Testing Library (Integration/Component level)
When writing component or integration test files:
* Place tests under `src/__tests__/` or adjacent to the utility under a `__tests__/` directory.
* Always import `React` at the top of JSX files.
* Use role-based queries (e.g. `screen.getByRole('button', { name: /search/i })`) for user controls rather than matching plain strings, to ensure query robustness against layout or label overlaps.
* For elements containing composite text (e.g. airline name and aircraft model in the watchlist), use case-insensitive regular expression matchers like `/LOT Polish Airlines/i` or passing `{ exact: false }`.

### 2. Playwright E2E Test Structure
When asked to design browser-level Playwright test scripts:
* **Installation**: Ensure `@playwright/test` is present in devDependencies. Playwright tests typically reside in a `tests/` folder at the project root.
* **Configuration**: Use `playwright.config.js` to set options (headless, port 5173, viewport sizes).
* **Mocking Geolocation & Maps**:
  Since Leaflet loads real tile images, set up route overrides to prevent actual external CDN requests or verify that Leaflet markers render inside the DOM tree.
* **Basic Page Load**:
  ```javascript
  import { test, expect } from '@playwright/test';

  test.describe('Kairo E2E booking flow', () => {
    test('should allow a user to complete booking and see telemetry HUD', async ({ page }) => {
      await page.goto('http://localhost:5173/kairo/');
      
      // Navigate and interact
      await page.click('text=Find Flights');
      await page.click('button:has-text("Select Outbound")');
      await page.click('button:has-text("Select Return")');
      
      // Confirm & check redirect
      await page.click('button:has-text("Track Roundtrip Bundle")');
      await expect(page.locator('text=Active Route')).toBeVisible();
    });
  });
  ```

---

## 💡 Scenario Design Guidelines
Prioritize the following key boundaries when planning new scenarios:
1. **Validation Checks**: Dates out of order, empty airport selection, passenger totals exceeding cabin bounds.
2. **Watchlist State Persistence**: Adding flight -> refreshing page/re-mounting -> verifying localStorage preserves items.
3. **Price Advice**: Projecting price calculations to assert that recommendations correctly shift between `BUY NOW`, `WAIT`, and `HOLD`.
