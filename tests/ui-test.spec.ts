import { test, expect } from '@playwright/test';

test.describe('Second Brain UI Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should display the main title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Second Brain');
  });

  test('should display empty state initially', async ({ page }) => {
    await expect(page.locator('.empty')).toBeVisible();
    await expect(page.locator('.empty .icon')).toContainText('🧠');
  });

  test('should ask a question and receive answer', async ({ page }) => {
    const input = page.locator('#question');
    const askBtn = page.locator('#askBtn');

    await input.fill('What projects are we working on?');
    await askBtn.click();

    // Wait for response
    await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 30000 });

    // Check that answer contains expected elements
    const assistantMessage = page.locator('.message.assistant .bubble');
    await expect(assistantMessage).toBeVisible();
  });

  test('should show sources in sidebar', async ({ page }) => {
    // Wait for sources to load
    await expect(page.locator('.source')).toBeVisible({ timeout: 10000 });

    const sources = page.locator('.source');
    const count = await sources.count();

    // Should have at least one source configured
    expect(count).toBeGreaterThan(0);
  });

  test('should have functional sync button', async ({ page }) => {
    const syncBtn = page.locator('button:has-text("Sync Data")');
    await expect(syncBtn).toBeVisible();

    // Click sync button
    await syncBtn.click();

    // Check that it shows syncing state
    await expect(syncBtn).toContainText('Syncing...');
    await expect(syncBtn).toBeDisabled();
  });

  test('should have functional scan button', async ({ page }) => {
    const scanBtn = page.locator('button:has-text("Find Savings")');
    await expect(scanBtn).toBeVisible();

    // Click scan button
    await scanBtn.click();

    // Check that it shows scanning state
    await expect(scanBtn).toContainText('Scanning...');
    await expect(scanBtn).toBeDisabled();
  });

  test('should display alerts section', async ({ page }) => {
    await expect(page.locator('.alerts-header')).toContainText('Savings Alerts');
    await expect(page.locator('.alert')).toBeVisible();
  });

  test('should handle enter key in input', async ({ page }) => {
    const input = page.locator('#question');
    await input.fill('Test question');
    await input.press('Enter');

    // Should trigger the askQuestion function
    await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 30000 });
  });

  test('should clear input after asking', async ({ page }) => {
    const input = page.locator('#question');
    await input.fill('Some question');
    await input.press('Enter');

    // Input should be cleared after submitting
    await expect(input).toHaveValue('');
  });

  test('should refresh data after sync', async ({ page }) => {
    const syncBtn = page.locator('button:has-text("Sync Data")');

    // Get initial source count
    const initialSources = await page.locator('.source').count();

    // Click sync
    await syncBtn.click();

    // Wait for sync to complete
    await expect(syncBtn).toContainText('Refresh from all sources');
    await expect(syncBtn).toBeEnabled();

    // Verify sources are still displayed
    await expect(page.locator('.source')).toHaveCount(initialSources);
  });

  test('should show savings alerts after scan', async ({ page }) => {
    const scanBtn = page.locator('button:has-text("Find Savings")');

    // Initially might show "No alerts yet"
    await expect(page.locator('.alert')).toBeVisible();

    // Click scan
    await scanBtn.click();

    // Wait for scan to complete
    await expect(scanBtn).toContainText('Refresh from all sources');
    await expect(scanBtn).toBeEnabled();

    // Alerts section should still be visible
    await expect(page.locator('.alerts-header')).toContainText('Savings Alerts');
  });
});