// Layer 2, create and clean up (Staging only): setup photos (gear stage 3) end to end, with real
// files in Staging's gear-media storage. A test tip-up gets a photo (JPEG), a catch on that setup,
// a setup change (the photo carries over to v2), a replacement (HEIC-free PNG; v1 and the catch
// keep the first photo, so its files stay), and a remove (the second photo's files go).
// Last, a second test tip-up with a photo is deleted, and its files go with it.
// Everything is "E2E Test …"; run `npm run cleanup` afterwards: it removes the test tip-up's
// remaining photo files through the app, then the rows.
// Needs scripts/gear/11 (+ 02 and vw_catch_details re-run), the gear-media container and the
// photo workflows (tools/n8n-migration/gear/deploy_gear_photos.py) on Staging.
const path = require('path');
const { test, expect } = require('../support/fixtures');
const { apiGet, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const NAME = testName('Photo Tip-up');
const MEDIA = path.join(__dirname, '..', 'media');
let tipId;
let first;       // the first photo's { thumbnailUrl, viewingUrl, originalUrl }
let second;
let catchNumber;

async function tip() {
  const raw = await apiGet(`gear/get?id=${tipId}`);
  return (Array.isArray(raw) ? raw[0] : raw).tipUps[0];
}
const status = url => fetch(url, { method: 'HEAD' }).then(r => r.status);
async function expectFiles(photo, want) {
  for (const k of ['thumbnailUrl', 'viewingUrl', 'originalUrl']) {
    await expect.poll(() => status(photo[k]), { message: `${k} ${want === 200 ? 'there' : 'gone'}`, timeout: 15_000 }).toBe(want);
  }
}

test('set up: a test tip-up with a setup', async ({ page }) => {
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(NAME);
  await page.locator('#owner').selectOption({ index: 1 });
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
  tipId = new URL(page.url()).searchParams.get('id');
  await page.locator('#hook').fill(testName('Photo Hook A'));
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tipId}`));
});

test('add a photo: three files in gear-media, shown on the page, badge on the list', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`gear-tipup.html?id=${tipId}`);
  await expect(page.locator('#photoAddBtn')).toBeVisible();
  await page.locator('#photoInput').setInputFiles(path.join(MEDIA, 'photo.jpg'));
  await expect(page.locator('#photoView')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#historyList')).toContainText('Photo added');
  first = (await tip()).setup.photo;
  expect(first.thumbnailUrl).toMatch(new RegExp(`/gear-media/gear/${tipId}/[A-Z0-9]+-thumb\\.jpg$`));
  expect(first.viewingUrl).toMatch(/-view\.jpg$/);
  expect(first.originalUrl).toMatch(/\.jpg$/);
  await expectFiles(first, 200);
  expect((await tip()).setup.versionNo).toBe(1);
  await page.goto('gear.html');
  await expect(page.locator(`.gear-card[data-id="${tipId}"] .gear-card-photo-badge`)).toHaveCount(1);
});

test('a catch on it, then a setup change: v2 carries the photo', async ({ page }) => {
  const { anglers, fishSpecies, bodiesOfWater } = await getLookups();
  await page.goto('log-catch.html');
  await page.locator('#anglerId').selectOption(String(anglers[0].id));
  await page.locator('#fishSpeciesId').selectOption(String(fishSpecies[0].id));
  await page.locator('#bodyOfWaterId').selectOption(String(bodiesOfWater[0].id));
  await page.locator('#catchDate').fill('2026-11-20');
  await page.locator('#gearSearch').fill(NAME);
  await page.locator('#gearSuggestions .tag-suggestion').first().click();
  await page.locator('#notes').fill(`${NOTES_MARKER} setup photo catch, run ${RUN_ID}`);
  await page.locator('#saveViewBtn').click();
  await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
  catchNumber = new URL(page.url()).searchParams.get('catchNumber');
  await expect(page.locator('.caught-on-photo img')).toHaveAttribute('src', first.thumbnailUrl);

  await page.goto(`gear-setup.html?id=${tipId}`);
  await page.locator('#hook').fill(testName('Photo Hook B'));
  await page.locator('#saveBtn').click();
  await page.locator('#newSetupBtn').click();   // saved minutes ago, so the page asks: the rig changed
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tipId}`));
  const t = await tip();
  expect(t.setup.versionNo).toBe(2);
  expect(t.setup.photo).toEqual(first);
});

test('replace on v2: still v2, the catch keeps the first photo, and its files stay', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`gear-tipup.html?id=${tipId}`);
  await expect(page.locator('#photoReplaceBtn')).toBeVisible();
  await page.locator('#photoInput').setInputFiles(path.join(MEDIA, 'photo.png'));
  await expect(page.locator('#historyList')).toContainText('Photo replaced', { timeout: 90_000 });
  const t = await tip();
  second = t.setup.photo;
  expect(second.thumbnailUrl).not.toBe(first.thumbnailUrl);
  expect(t.setup.versionNo).toBe(2);
  await expectFiles(second, 200);
  await expectFiles(first, 200);     // v1 (and the catch) still show it
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
  await expect(page.locator('.caught-on-photo img')).toHaveAttribute('src', first.thumbnailUrl);
});

test('remove: the second photo\'s files go; the first stays with v1', async ({ page }) => {
  await page.goto(`gear-tipup.html?id=${tipId}`);
  await page.locator('#photoRemoveBtn').click();
  await page.locator('#photoRemoveYes').click();
  await expect(page.locator('#photoAddBtn')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#historyList')).toContainText('Photo removed');
  expect((await tip()).setup.photo).toBeNull();
  await expectFiles(second, 404);
  await expectFiles(first, 200);
});

test('deleting a tip-up with no catches deletes its photo files too', async ({ page }) => {
  test.setTimeout(120_000);
  const name = testName('Photo Tip-up Delete');
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(name);
  await page.locator('#owner').selectOption({ index: 1 });
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
  const id = new URL(page.url()).searchParams.get('id');
  await page.goto(`gear-tipup.html?id=${id}`);
  await expect(page.locator('#photoAddBtn')).toBeVisible();
  await page.locator('#photoInput').setInputFiles(path.join(MEDIA, 'photo.jpg'));
  await expect(page.locator('#photoView')).toBeVisible({ timeout: 90_000 });
  const raw = await apiGet(`gear/get?id=${id}`);
  const photo = (Array.isArray(raw) ? raw[0] : raw).tipUps[0].setup.photo;
  await expectFiles(photo, 200);

  await page.goto(`gear-edit.html?id=${id}`);
  await page.locator('#deleteBtn').click();
  await page.locator('#deleteYes').click();
  await expect(page).toHaveURL(/gear\.html/);
  await expectFiles(photo, 404);
});
