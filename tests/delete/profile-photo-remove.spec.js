// Layer 3, deletes (Staging only): removing the TEST angler's profile photo and
// checking the file is really gone from storage. Never touches a real angler.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, NAME_PREFIX } = require('../support/test-data');

requireStagingWrites();

test('remove the test angler\'s profile photo', async ({ page }) => {
  const data = await apiGet('anglers/get');
  const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
  const angler = list.filter(a => a.name.startsWith(`${NAME_PREFIX} Angler`) && a.profilePhotoReadUrl)
    .sort((a, b) => b.id - a.id)[0];
  test.skip(!angler, 'no E2E Test Angler with a photo; run write/04-profile-photo first');

  await unlockAdmin(page);
  await page.goto(`edit-angler.html?id=${angler.id}`);
  await expect(page.locator('#profilePhotoImg')).toBeVisible();
  await page.locator('#profilePhotoRemoveBtn').click();
  await expect(page.locator('#profilePhotoStatus')).toHaveText('Photo removed.');

  const fresh = await apiGet('anglers/get');
  const after = (Array.isArray(fresh) ? fresh : Object.values(fresh).find(Array.isArray) || []).find(a => a.id === angler.id);
  expect(after && after.profilePhotoReadUrl).toBeFalsy();
  await expect.poll(async () => (await fetch(angler.profilePhotoReadUrl)).status, { timeout: 20_000 }).toBe(404);
});
