// Layer 2, create and clean up (Staging only): giving the TEST angler a profile photo
// through the crop flow. Never a real angler: the test refuses to run without the
// "E2E Test Angler" from 01-lookups. Layer 3 (delete/) removes the photo again.
const path = require('path');
const { test, expect, unlockAdmin, STAGING_STORAGE_HOST } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, NAME_PREFIX } = require('../support/test-data');

requireStagingWrites();

async function testAngler() {
  const data = await apiGet('anglers/get');
  const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
  return list.filter(a => a.name.startsWith(`${NAME_PREFIX} Angler`)).sort((a, b) => b.id - a.id)[0];
}

test('crop and upload a profile photo for the test angler', async ({ page }) => {
  const angler = await testAngler();
  test.skip(!angler, 'no E2E Test Angler on Staging; run 01-lookups first');

  await unlockAdmin(page);
  await page.goto(`edit-angler.html?id=${angler.id}`);
  await expect(page.locator('#anglerForm')).toBeVisible();
  await page.locator('#profilePhotoInput').setInputFiles(path.join(__dirname, '..', 'media', 'photo.jpg'));
  await expect(page.locator('#cropModal')).toHaveClass(/open/);
  await page.locator('#cropConfirmBtn').click();

  await expect(page.locator('#profilePhotoImg')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await testAngler()).profilePhotoReadUrl, { timeout: 30_000 }).toBeTruthy();
  const { profilePhotoReadUrl } = await testAngler();
  expect(profilePhotoReadUrl, 'stored in the Staging storage account').toContain(STAGING_STORAGE_HOST);
  expect((await fetch(profilePhotoReadUrl)).status).toBe(200);
});
