// Layer 1, read-only: every page opens cleanly on a local copy using Staging data.
const { test, expect, STAGING_HOST } = require('../support/fixtures');

const BANNER = `Local copy · Staging data (${STAGING_HOST.split('.')[0]})`;

const PAGES = [
  'index.html', 'catches-listing.html', 'catch-details.html', 'log-catch.html',
  'edit-catch.html', 'media-upload.html', 'catch-chat.html', 'ask-gillbert.html',
  'fish-of-fame.html', 'anglers-listing.html', 'create-angler.html', 'edit-angler.html',
  'fish-species-listing.html', 'create-fish-species.html', 'edit-fish-species.html',
  'bodies-of-water-listing.html', 'create-body-of-water.html', 'edit-body-of-water.html',
  'me.html', 'under-the-hood.html', 'media-activity.html', 'whats-new.html', 'features-functionality.html', 'notifications.html',
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
