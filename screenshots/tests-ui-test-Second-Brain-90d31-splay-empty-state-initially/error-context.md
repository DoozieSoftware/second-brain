# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/ui-test.spec.ts >> Second Brain UI Tests >> should display empty state initially
- Location: tests/ui-test.spec.ts:12:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Second Brain UI Tests', () => {
  4   |   test.beforeEach(async ({ page }) => {
> 5   |     await page.goto('http://localhost:3000');
      |                ^ Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
  6   |   });
  7   | 
  8   |   test('should display the main title', async ({ page }) => {
  9   |     await expect(page.locator('h1')).toContainText('Second Brain');
  10  |   });
  11  | 
  12  |   test('should display empty state initially', async ({ page }) => {
  13  |     await expect(page.locator('.empty')).toBeVisible();
  14  |     await expect(page.locator('.empty .icon')).toContainText('🧠');
  15  |   });
  16  | 
  17  |   test('should ask a question and receive answer', async ({ page }) => {
  18  |     const input = page.locator('#question');
  19  |     const askBtn = page.locator('#askBtn');
  20  | 
  21  |     await input.fill('What projects are we working on?');
  22  |     await askBtn.click();
  23  | 
  24  |     // Wait for response
  25  |     await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 30000 });
  26  | 
  27  |     // Check that answer contains expected elements
  28  |     const assistantMessage = page.locator('.message.assistant .bubble');
  29  |     await expect(assistantMessage).toBeVisible();
  30  |   });
  31  | 
  32  |   test('should show sources in sidebar', async ({ page }) => {
  33  |     // Wait for sources to load
  34  |     await expect(page.locator('.source')).toBeVisible({ timeout: 10000 });
  35  | 
  36  |     const sources = page.locator('.source');
  37  |     const count = await sources.count();
  38  | 
  39  |     // Should have at least one source configured
  40  |     expect(count).toBeGreaterThan(0);
  41  |   });
  42  | 
  43  |   test('should have functional sync button', async ({ page }) => {
  44  |     const syncBtn = page.locator('button:has-text("Sync Data")');
  45  |     await expect(syncBtn).toBeVisible();
  46  | 
  47  |     // Click sync button
  48  |     await syncBtn.click();
  49  | 
  50  |     // Check that it shows syncing state
  51  |     await expect(syncBtn).toContainText('Syncing...');
  52  |     await expect(syncBtn).toBeDisabled();
  53  |   });
  54  | 
  55  |   test('should have functional scan button', async ({ page }) => {
  56  |     const scanBtn = page.locator('button:has-text("Find Savings")');
  57  |     await expect(scanBtn).toBeVisible();
  58  | 
  59  |     // Click scan button
  60  |     await scanBtn.click();
  61  | 
  62  |     // Check that it shows scanning state
  63  |     await expect(scanBtn).toContainText('Scanning...');
  64  |     await expect(scanBtn).toBeDisabled();
  65  |   });
  66  | 
  67  |   test('should display alerts section', async ({ page }) => {
  68  |     await expect(page.locator('.alerts-header')).toContainText('Savings Alerts');
  69  |     await expect(page.locator('.alert')).toBeVisible();
  70  |   });
  71  | 
  72  |   test('should handle enter key in input', async ({ page }) => {
  73  |     const input = page.locator('#question');
  74  |     await input.fill('Test question');
  75  |     await input.press('Enter');
  76  | 
  77  |     // Should trigger the askQuestion function
  78  |     await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 30000 });
  79  |   });
  80  | 
  81  |   test('should clear input after asking', async ({ page }) => {
  82  |     const input = page.locator('#question');
  83  |     await input.fill('Some question');
  84  |     await input.press('Enter');
  85  | 
  86  |     // Input should be cleared after submitting
  87  |     await expect(input).toHaveValue('');
  88  |   });
  89  | 
  90  |   test('should refresh data after sync', async ({ page }) => {
  91  |     const syncBtn = page.locator('button:has-text("Sync Data")');
  92  | 
  93  |     // Get initial source count
  94  |     const initialSources = await page.locator('.source').count();
  95  | 
  96  |     // Click sync
  97  |     await syncBtn.click();
  98  | 
  99  |     // Wait for sync to complete
  100 |     await expect(syncBtn).toContainText('Refresh from all sources');
  101 |     await expect(syncBtn).toBeEnabled();
  102 | 
  103 |     // Verify sources are still displayed
  104 |     await expect(page.locator('.source')).toHaveCount(initialSources);
  105 |   });
```