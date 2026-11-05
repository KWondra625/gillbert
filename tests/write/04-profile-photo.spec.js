// Layer 2, create and clean up (Staging only): giving the TEST angler a profile photo
// through the crop flow. Never a real angler: the test refuses to run without the
// "E2E Test Angler" from 01-lookups. Layer 3 (delete/) removes the photo again.
const path = require('path');
const { test, expect, unlockAdmin, STAGING_STORAGE_HOST } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, NAME_PREFIX, apiPost } = require('../support/test-data');

requireStagingWrites();
// Both tests change the same test angler's photo, so they must not overlap
test.describe.configure({ mode: 'serial' });

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

// A HEIC goes to the server first (browsers can't draw it): Convert Media turns it into a JPEG,
// which comes back and opens in the crop box like any other photo. The crop is what's saved,
// and neither the uploaded HEIC nor the converted copy is left in storage.
test('a HEIC profile photo is converted, cropped and saved as JPEG', async ({ page }) => {
  test.setTimeout(150_000);
  const angler = await testAngler();
  test.skip(!angler, 'no E2E Test Angler on Staging; run 01-lookups first');
  const before = angler.profilePhotoReadUrl;

  await unlockAdmin(page);
  await page.goto(`edit-angler.html?id=${angler.id}`);
  await expect(page.locator('#anglerForm')).toBeVisible();
  await page.locator('#profilePhotoInput').setInputFiles(path.join(__dirname, '..', 'media', 'photo.heic'));
  await expect(page.locator('#profilePhotoStatus')).toContainText('Converting your photo');
  await expect(page.locator('#cropModal'), 'the converted photo opens in the crop box').toHaveClass(/open/, { timeout: 60_000 });
  await page.locator('#cropConfirmBtn').click();

  await expect.poll(async () => (await testAngler()).profilePhotoReadUrl, { timeout: 60_000 }).not.toBe(before);
  const { profilePhotoReadUrl } = await testAngler();
  expect(profilePhotoReadUrl, 'stored as a JPEG').toMatch(/\.jpg$/);
  expect(profilePhotoReadUrl, 'stored in the Staging storage account').toContain(STAGING_STORAGE_HOST);
  const res = await fetch(profilePhotoReadUrl);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/jpeg');
  await expect(page.locator('#profilePhotoImg')).toBeVisible({ timeout: 30_000 });

  const scan = await apiPost('catch-media/admin', { action: 'scan' });
  const leftovers = scan.orphanFiles.filter(f => f.container === 'angler-media' && f.anglerId === angler.id);
  expect(leftovers.map(f => f.blobPath), 'no HEIC or converted copy left behind').toEqual([]);
});

test('a photo that is too large or not a photo is refused with a reason, before uploading', async ({ page }) => {
  const angler = await testAngler();
  test.skip(!angler, 'no E2E Test Angler on Staging; run 01-lookups first');
  let slotRequests = 0;
  page.on('request', r => { if (r.url().includes('anglers/get-photo-sas')) slotRequests++; });

  await unlockAdmin(page);
  await page.goto(`edit-angler.html?id=${angler.id}`);
  await expect(page.locator('#anglerForm')).toBeVisible();
  await page.locator('#profilePhotoInput').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.locator('#profilePhotoStatus')).toContainText("isn't supported");
  await page.locator('#profilePhotoInput').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(26 * 1024 * 1024, 1) });
  await expect(page.locator('#profilePhotoStatus')).toContainText('too large (26 MB); the limit is 25 MB');
  await expect(page.locator('#cropModal')).not.toHaveClass(/open/);
  expect(slotRequests, 'nothing was sent').toBe(0);
});
