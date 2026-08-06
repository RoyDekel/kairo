import { test, expect } from '@playwright/test';

test.describe('KAIRO Passenger Selection E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local development server page
    await page.goto('http://localhost:5173/kairo/');
    
    // Switch to "Find Flights" tab
    await page.click('text=Find Flights');
  });

  test('opens passenger selection dropdown, increments counters, and updates passenger count text', async ({ page }) => {
    // 1. Initially should show "1 Passenger"
    const passengerBtn = page.locator('button:has-text("Passenger")');
    await expect(passengerBtn).toContainText('1 Passenger');

    // 2. Click the selector button to open the dropdown overlay
    await passengerBtn.click();

    // Verify dropdown content is visible
    const dropdownContainer = page.locator('text=Adults').locator('xpath=../../..');
    await expect(dropdownContainer).toBeVisible();

    // Locate the input fields inside the dropdown container
    const inputs = dropdownContainer.locator('input');
    const adultsInput = inputs.nth(0);
    const childrenInput = inputs.nth(1);
    const infantsInput = inputs.nth(2);

    // 3. Update passenger counts
    await adultsInput.fill('2');
    await childrenInput.fill('1');
    await infantsInput.fill('1');

    // The text on the selector button should update immediately to "4 Passengers"
    await expect(passengerBtn).toContainText('4 Passengers');

    // 4. Click the "Done" button to close the dropdown
    const doneBtn = page.locator('button:has-text("Done")');
    await doneBtn.click();

    // Verify dropdown is now closed
    await expect(dropdownContainer).not.toBeVisible();
  });

  test('closes passenger selection dropdown when clicking outside', async ({ page }) => {
    const passengerBtn = page.locator('button:has-text("Passenger")');
    await passengerBtn.click();

    const dropdownContainer = page.locator('text=Adults').locator('xpath=../../..');
    await expect(dropdownContainer).toBeVisible();

    // Click outside the dropdown container (e.g. click the header text)
    await page.click('h3:has-text("Roundtrip Flight Search")');

    // Verify the dropdown closes automatically
    await expect(dropdownContainer).not.toBeVisible();
  });

  test('asserts that Passenger selection dropdown overlays on top of the Search Flights CTA without pushing layout', async ({ page }) => {
    const passengerBtn = page.locator('button:has-text("Passenger")');
    const searchBtn = page.locator('button:has-text("Search Flights")');

    // Get position of the Search Flights button BEFORE opening the dropdown
    const searchBtnBoxBefore = await searchBtn.boundingBox();
    expect(searchBtnBoxBefore).not.toBeNull();

    // Open dropdown
    await passengerBtn.click();
    
    const dropdownContainer = page.locator('text=Adults').locator('xpath=../../..');
    await expect(dropdownContainer).toBeVisible();

    // Get position of the Search Flights button AFTER opening the dropdown
    const searchBtnBoxAfter = await searchBtn.boundingBox();
    expect(searchBtnBoxAfter).not.toBeNull();

    // The Search Flights button should NOT have moved down (layout is NOT pushed down by absolute overlay)
    expect(searchBtnBoxAfter.y).toBeCloseTo(searchBtnBoxBefore.y, 1);

    // Verify both elements are visible simultaneously
    await expect(searchBtn).toBeVisible();
    await expect(dropdownContainer).toBeVisible();

    // Verify that the dropdown container visually overlaps or is positioned above the search button vertically
    const dropdownBox = await dropdownContainer.boundingBox();
    expect(dropdownBox).not.toBeNull();

    // The dropdown top coordinate (y) is above the search button y
    expect(dropdownBox.y).toBeLessThan(searchBtnBoxAfter.y);
  });
});
