// Layer 1, read-only: every page opens cleanly on a local copy using Staging data.
const { test, expect, STAGING_HOST } = require('../support/fixtures');

const BANNER = `Local copy · Staging data (${STAGING_HOST.split('.')[0]})`;

const PAGES = [
  'index.html', 'catches-listing.html', 'catch-details.html', 'log-catch.html',
  'edit-catch.html', 'media-upload.html', 'catch-chat.html', 'ask-gillbert.html',
  'fish-of-fame.html', 'anglers-listing.html', 'create-angler.html', 'edit-angler.html',
  'fish-species-listing.html', 'create-fish-species.html', 'edit-fish-species.html',
  'bodies-of-water-listing.html', 'create-body-of-water.html', 'edit-body-of-water.html',
  'me.html', 'under-the-hood.html', 'media-activity.html', 'whats-new.html', 'features-functionality.html', 'notifications.html', 'settings.html',
];

for (const path of PAGES) {
  test(`${path} loads with the Staging banner`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('#envBanner')).toContainText(BANNER);
    await page.waitForLoadState('networkidle');
  });
}

test('notifications.html points a local copy at Staging ntfy', async ({ page }) => {
  await page.goto('notifications.html');
  await expect(page.locator('#subscribeLink')).toHaveAttribute('href', 'ntfy://ntfy-lab01.builtbykw.net/gillbert-catches');
  await expect(page.locator('#serverUrl')).toHaveText('https://ntfy-lab01.builtbykw.net');
  await expect(page.locator('#topicName')).toHaveText('gillbert-catches');
});

test('notifications.html: the App Store badge opens the Apple easter egg first', async ({ page }) => {
  await page.goto('notifications.html');
  const modal = page.locator('#appleModal');
  await expect(modal).toBeHidden();
  await page.locator('#appStoreBadge').click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("The fish don't judge you, but we do.");
  await expect(page.locator('#appleModalStore')).toHaveAttribute('href', 'https://apps.apple.com/us/app/ntfy/id1625396347');
  await expect(modal.locator('a.secondary-button')).toHaveAttribute('href', 'https://www.android.com/switch/');
  if (process.env.SHOT) { await page.waitForTimeout(400); await page.screenshot({ path: process.env.SHOT }); }
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('catch-details.html: a catch that does not exist gets the "it got away" pop-up', async ({ page }) => {
  await page.goto('catch-details.html?catchNumber=Catch%2099-999999');
  const modal = page.locator('#lostCatchModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#lostCatchTitle')).toHaveText(/shook the line|jumped off the line|grab the net/);
  await expect(page.locator('#lostCatchNumber')).toHaveText('Catch 99-999999');
  await expect(page.locator('#lostCatchBrowse')).toHaveAttribute('href', './catches-listing.html');
  await expect(modal.locator('a[href="./index.html"]')).toBeVisible();
  await expect(page.locator('#detailsContainer')).toBeEmpty();
  if (process.env.SHOT) { await page.waitForTimeout(400); await page.screenshot({ path: process.env.SHOT }); }
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#status')).toContainText('got away');
});

test('catch-details.html: a link with no catch number gets the same pop-up', async ({ page }) => {
  await page.goto('catch-details.html');
  await expect(page.locator('#lostCatchModal')).toBeVisible();
  await expect(page.locator('#lostCatchTitle')).toHaveText(/shook the line|jumped off the line|grab the net/);
  await expect(page.locator('#lostCatchText')).toContainText("didn't say which catch");
  await expect(page.locator('#lostCatchBrowse')).toHaveAttribute('href', './catches-listing.html');
});
