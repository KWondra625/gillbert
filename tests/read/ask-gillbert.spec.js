// Layer 1, read-only: Ask Gillbert answers a question. This calls Claude, so it spends
// API tokens. It runs by default; set SKIP_AI=1 to skip it.
const { test, expect } = require('../support/fixtures');

test.skip(!!process.env.SKIP_AI, 'SKIP_AI is set');

test('Ask Gillbert answers a question about the record book', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-chrome', 'one AI call per run is enough');
  test.setTimeout(120_000);
  await page.goto('ask-gillbert.html');
  await page.locator('#chatInput').fill('How many catches are in the record book? Answer with just the number.');
  await page.locator('#chatSendBtn').click();

  const reply = page.locator('.message--gillbert:not(.message--thinking):not(.message--error)').last();
  await expect(reply).toBeVisible({ timeout: 90_000 });
  await expect(reply).toContainText(/\d+/);
  await expect(page.locator('.message--error')).toHaveCount(0);
});
