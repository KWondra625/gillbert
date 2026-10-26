// Layer 2, create and clean up (Staging only): uploading every photo and video type the
// site accepts to a test catch, then checking the result on Staging rather than trusting
// the upload page. HEIC/HEIF and MOV are converted in the background after the page says
// "success" (issue #11 is about that success being shown even when conversion fails), so
// for those the test waits for the converted JPEG/MP4 to actually appear.
const fs = require('fs');
const path = require('path');
const { test, expect, STAGING_STORAGE_HOST } = require('../support/fixtures');
const { getCatchMedia } = require('../support/staging-api');
const { requireStagingWrites, ensureTestCatch } = require('../support/test-data');

requireStagingWrites();
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
  // Real iPhone files, when media/phone/ has them (git-ignored; see .gitignore).
  ...listPhoneFiles().map(file => file.endsWith('.mov')
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
