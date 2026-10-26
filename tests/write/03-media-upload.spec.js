// Layer 2, create and clean up (Staging only): uploading every photo and video type the
// site accepts to a test catch, then checking the result on Staging rather than trusting
// the upload page. HEIC/HEIF and MOV are converted in the background after the page says
// "success" (issue #11 is about that success being shown even when conversion fails), so
// for those the test waits for the converted JPEG/MP4 to actually appear.
const fs = require('fs');
const path = require('path');
const { test, expect, STAGING_STORAGE_HOST } = require('../support/fixtures');
const { getCatchMedia } = require('../support/staging-api');
const { requireStagingWrites, requireMediaTests, ensureTestCatch } = require('../support/test-data');

requireStagingWrites();
requireMediaTests();
test.describe.configure({ mode: 'serial' });

const MEDIA = path.join(__dirname, '..', 'media');
const CONVERSION_TIMEOUT = 180_000;

// file → what Staging should end up storing for it
const CASES = [
  { file: 'photo.jpg',           type: 'image/jpeg',      mediaType: 'Photo' },
  { file: 'photo.jpeg',          type: 'image/jpeg',      mediaType: 'Photo' },
  { file: 'photo.png',           type: 'image/png',       mediaType: 'Photo' },
  { file: 'photo.gif',           type: 'image/gif',       mediaType: 'Photo' },
  { file: 'photo.webp',          type: 'image/webp',      mediaType: 'Photo' },
  { file: 'photo.heic',          type: 'image/jpeg',      mediaType: 'Photo', converted: true },
  { file: 'photo.heif',          type: 'image/jpeg',      mediaType: 'Photo', converted: true },
  { file: 'photo-portrait.heic', type: 'image/jpeg',      mediaType: 'Photo', converted: true },
  { file: 'video.mp4',           type: 'video/mp4',       mediaType: 'Video' },
  { file: 'video.mov',           type: 'video/mp4',       mediaType: 'Video', converted: true },
  { file: 'video-portrait.mov',  type: 'video/mp4',       mediaType: 'Video', converted: true },
  // Real iPhone files, when media/phone/ has them (git-ignored; see .gitignore) and
  // PHONE_MEDIA=1 is set.
  ...(process.env.PHONE_MEDIA === '1' ? listPhoneFiles() : []).map(file => file.endsWith('.mov')
    ? { file, type: 'video/mp4', mediaType: 'Video', converted: true }
    : { file, type: 'image/jpeg', mediaType: 'Photo', converted: true }),
];

function listPhoneFiles() {
  const dir = path.join(MEDIA, 'phone');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /.(heic|heif|mov)$/i.test(f)).sort().map(f => `phone/${f}`);
}

let target;
test.beforeAll(async () => { target = await ensureTestCatch(); });

const mediaFor = getCatchMedia;

async function upload(page, files) {
  await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await expect(page.locator('#uploadState')).toBeVisible();
  await page.locator('#files').setInputFiles(files.map(f => path.join(MEDIA, f)));
  await page.locator('#uploadBtn').click();
  await expect(page.locator('#successState'), 'the upload page reports success').toBeVisible({ timeout: 60_000 });
}

// Waits until `count` new media rows exist beyond `before`, and returns them.
async function waitForNewMedia(before, count, timeout) {
  const known = new Set(before.map(m => m.id));
  let fresh = [];
  await expect.poll(async () => {
    fresh = (await mediaFor(target.catchNumber)).filter(m => !known.has(m.id));
    return fresh.length;
  }, { timeout, intervals: [2_000, 5_000] }).toBeGreaterThanOrEqual(count);
  return fresh;
}

async function expectServed(item, type) {
  const res = await fetch(item.readUrl);
  expect(res.status, `${item.readUrl} is readable`).toBe(200);
  expect(res.headers.get('content-type')).toBe(type);
}

for (const c of CASES) {
  test(`upload ${c.file} → stored as ${c.type}`, async ({ page }) => {
    test.setTimeout(CONVERSION_TIMEOUT + 90_000);
    const before = await mediaFor(target.catchNumber);
    await upload(page, [c.file]);

    const [item] = await waitForNewMedia(before, 1, c.converted ? CONVERSION_TIMEOUT : 30_000);
    expect(item.mediaType).toBe(c.mediaType);
    expect(item.contentType).toBe(c.type);
    expect(item.fileSizeInBytes).toBeGreaterThan(0);
    expect(item.readUrl, 'stored in the Staging storage account').toContain(STAGING_STORAGE_HOST);
    await expectServed(item, c.type);
  });
}

test('several mixed files in one upload all arrive', async ({ page }) => {
  test.setTimeout(CONVERSION_TIMEOUT + 90_000);
  const files = ['photo.jpg', 'photo.heic', 'video.mp4', 'video.mov'];
  const before = await mediaFor(target.catchNumber);
  await upload(page, files);

  const fresh = await waitForNewMedia(before, files.length, CONVERSION_TIMEOUT);
  expect(fresh.map(m => m.contentType).sort()).toEqual(['image/jpeg', 'image/jpeg', 'video/mp4', 'video/mp4']);
});

test('the catch detail page shows every uploaded file', async ({ page }) => {
  const all = await mediaFor(target.catchNumber);
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await expect(page.locator('.media-tile')).toHaveCount(all.length);
  await expect(page.locator('.media-tile--video')).toHaveCount(all.filter(m => m.mediaType === 'Video').length);
});

// Known bug #11: for HEIC/MOV the page reports success before conversion has run, so a
// file that fails to convert still shows "success" and never attaches. test.fail()
// means this test is expected to fail until that's fixed; once the page reports the
// failure, it passes, Playwright flags it as "unexpectedly passed", and test.fail()
// should be removed. The broken file's raw upload may be left in Staging storage; the
// test notes whether it was.
test('a HEIC that fails to convert is not reported as a success (#11)', async ({ page }) => {
  test.fail(true, 'known bug #11: the upload page reports success before conversion finishes');
  test.setTimeout(CONVERSION_TIMEOUT + 90_000);
  const before = await mediaFor(target.catchNumber);
  const slots = page.waitForResponse(r => r.url().includes('catch-media/get-sas'));

  await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await page.locator('#files').setInputFiles(path.join(MEDIA, 'broken.heic'));
  await page.locator('#uploadBtn').click();
  const rawUrl = ((await (await slots).json()).uploads || [])[0]?.uploadUrl?.split('?')[0];

  // What the page claims, then what actually happened.
  const claimedSuccess = await page.locator('#successState')
    .waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
  // Give the background conversion time to finish (or fail), then confirm nothing attached.
  await page.waitForTimeout(45_000);
  expect((await mediaFor(target.catchNumber)).length, 'nothing should attach from a broken file').toBe(before.length);
  if (rawUrl) {
    const leftOver = (await fetch(rawUrl)).status === 200;
    test.info().annotations.push({ type: 'note', description: `raw upload ${leftOver ? 'left in' : 'not in'} Staging storage: ${rawUrl}` });
  }
  expect(claimedSuccess, 'the page should not report success for a file that failed to convert').toBe(false);
});
