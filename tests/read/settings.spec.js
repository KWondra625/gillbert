// Layer 1, read-only: the admin Settings page. Settings save on this device (browser
// storage) today, so these tests change nothing on Staging.
const { test, expect } = require('../support/fixtures');

async function asAdmin(page) {
  await page.addInitScript(() => {
    localStorage.setItem('gillbert_admin_unlock_expires', String(Date.now() + 9e8));
  });
}

test('is locked for anyone who is not an unlocked admin', async ({ page }) => {
  await page.goto('settings.html');
  await expect(page.locator('#lockedCard')).toBeVisible();
  await expect(page.locator('#settingsBody')).toBeHidden();
});

test.describe('as admin', () => {
  test.beforeEach(async ({ page }) => { await asAdmin(page); });

  test('says plainly that changes are saved on this device only', async ({ page }) => {
    await page.goto('settings.html');
    await expect(page.locator('.preview-note')).toContainText('saved on this device only');
  });

  test('the welcome line shows on the home page, and resets to the default', async ({ page }) => {
    await page.goto('settings.html');
    await page.locator('#welcomeInput').fill('Tight lines, boys.');
    await page.locator('#welcomeSave').click();
    await expect(page.locator('#welcomeSaved')).toContainText('Saved on this device');
    await page.goto('index.html');
    await expect(page.locator('#welcomeLine')).toHaveText('Tight lines, boys.');

    await page.goto('settings.html');
    await page.locator('#welcomeReset').click();
    await expect(page.locator('#welcomeInput')).toHaveValue("Our crew's fishing record book.");
  });

  test('the season override changes the look right away and on every page', async ({ page }) => {
    await page.goto('settings.html');
    await page.locator('#waterOpen').check();
    await expect(page.locator('html')).toHaveAttribute('data-water', 'open');
    await page.locator('#waterHard').check();
    await expect(page.locator('html')).toHaveAttribute('data-water', 'hard');
    await page.goto('catches-listing.html');
    await expect(page.locator('html')).toHaveAttribute('data-water', 'hard');
    await page.waitForLoadState('networkidle'); // let its catch list finish loading before leaving

    await page.goto('settings.html');
    await page.locator('#waterAuto').check();
    expect(await page.evaluate(() => localStorage.getItem('gillbert_setting_waterOverride'))).toBeNull();
  });

  test('tease lines save one per line, and "pick another" can be undone', async ({ page }) => {
    await page.goto('settings.html');
    await page.locator('#teaseInput').fill('First line\n\n  Second line  \n');
    await page.locator('#teaseSave').click();
    await expect(page.locator('#teaseInput')).toHaveValue('First line\nSecond line');

    await expect(page.locator('#rememberReset')).toBeDisabled();
    await page.locator('#rememberNext').click();
    await expect(page.locator('#rememberReset')).toBeEnabled();
    expect(await page.evaluate(() => GillbertSettings.get('rememberWhenSkip'))).toBe(1);
    await page.locator('#rememberReset').click();
    expect(await page.evaluate(() => GillbertSettings.get('rememberWhenSkip'))).toBe(0);
  });
});
