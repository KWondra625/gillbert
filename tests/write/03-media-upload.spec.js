// Layer 2, create and clean up (Staging only): uploading every photo and video type the
// site accepts to a test catch, then checking the result on Staging rather than trusting
// the upload page. Each file's media record is written as soon as it's uploaded; HEIC/HEIF,
// MOV and MP4 then go through the background conversion (MP4s only convert when they
// aren't H.264), so the test waits for each record to reach 'complete'.
const fs = require('fs');
const path = require('path');
const { test, expect, unlockAdmin, STAGING_STORAGE_HOST } = require('../support/fixtures');
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
  { file: 'video-hevc.mp4',      type: 'video/mp4',       mediaType: 'Video', converted: true },
  { file: 'video-hdr.mp4',       type: 'video/mp4',       mediaType: 'Video', converted: true },
  { file: 'video-4k.mp4',        type: 'video/mp4',       mediaType: 'Video', converted: true },
  { file: 'video.mov',           type: 'video/mp4',       mediaType: 'Video', converted: true },
  { file: 'video-portrait.mov',  type: 'video/mp4',       mediaType: 'Video', converted: true },
  // Real iPhone files, when media/phone/ has them (git-ignored; see .gitignore) and
  // PHONE_MEDIA=1 is set.
  ...(process.env.PHONE_MEDIA === '1' ? listPhoneFiles() : []).map(file => file.toLowerCase().endsWith('.mov')
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

// Waits until `count` new media rows exist beyond `before` and all of them have finished
// (complete or failed), and returns them.
async function waitForNewMedia(before, count, timeout, { finished = ['complete'] } = {}) {
  const known = new Set(before.map(m => m.id));
  let fresh = [];
  await expect.poll(async () => {
    fresh = (await mediaFor(target.catchNumber)).filter(m => !known.has(m.id));
    const failed = fresh.filter(m => m.displayStatus === 'failed' && !finished.includes('failed'));
    if (failed.length) return `failed: ${failed.map(m => `${m.originalFileName} (${m.errorMessage})`).join(', ')}`;
    return fresh.length >= count && fresh.every(m => finished.includes(m.displayStatus)) ? 'done' : 'waiting';
  }, { timeout, intervals: [2_000, 5_000] }).toBe('done');
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

// Files over 8 MB go up in blocks that Azure stitches together; the stored file must match
// the original byte for byte. A JPEG with padding after its end marker is still a valid
// JPEG, and plain JPEGs aren't converted, so the stored bytes are exactly the uploaded ones.
test('a 20 MB file uploads in blocks and arrives intact', async ({ page }) => {
  test.setTimeout(180_000);
  const jpg = fs.readFileSync(path.join(MEDIA, 'photo.jpg'));
  const big = Buffer.concat([jpg, Buffer.alloc(20 * 1024 * 1024 - jpg.length, 0x5a)]);
  const before = await mediaFor(target.catchNumber);
  await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await page.locator('#files').setInputFiles({ name: 'big-photo.jpg', mimeType: 'image/jpeg', buffer: big });
  await page.locator('#uploadBtn').click();
  await expect(page.locator('#successState')).toBeVisible({ timeout: 120_000 });

  const [item] = await waitForNewMedia(before, 1, 30_000);
  expect(item.fileSizeInBytes).toBe(big.length);
  const res = await fetch(item.readUrl);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/jpeg');
  expect(Buffer.from(await res.arrayBuffer()).equals(big), 'stored bytes match the original').toBe(true);
});

test('several mixed files in one upload all arrive', async ({ page }) => {
  test.setTimeout(CONVERSION_TIMEOUT + 90_000);
  const files = ['photo.jpg', 'photo.heic', 'video.mp4', 'video.mov'];
  const before = await mediaFor(target.catchNumber);
  await upload(page, files);

  const fresh = await waitForNewMedia(before, files.length, CONVERSION_TIMEOUT);
  expect(fresh.map(m => m.contentType).sort()).toEqual(['image/jpeg', 'image/jpeg', 'video/mp4', 'video/mp4']);
});

test('each file gets its own result on the upload page', async ({ page }) => {
  test.setTimeout(CONVERSION_TIMEOUT + 90_000);
  const before = await mediaFor(target.catchNumber);
  await upload(page, ['photo.png', 'photo-portrait.heic']);
  const rows = page.locator('#successFiles .file-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('✅ Done');
  await expect(rows.nth(1)).toContainText('⏳ Converting');
  await waitForNewMedia(before, 2, CONVERSION_TIMEOUT);
});

test('the catch detail page shows every uploaded file', async ({ page }) => {
  const all = await mediaFor(target.catchNumber);
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await expect(page.locator('.media-tile')).toHaveCount(all.length);
  // Only finished videos play; a failed or stuck one shows as a ⚠️ tile instead
  await expect(page.locator('.media-tile--video'))
    .toHaveCount(all.filter(m => m.mediaType === 'Video' && m.displayStatus === 'complete').length);
  await expect(page.locator('.media-tile--failed'))
    .toHaveCount(all.filter(m => ['failed', 'stuck'].includes(m.displayStatus)).length);
});

// #11: a file that fails to convert is reported honestly. The upload page says it's
// converting (not done), the record ends as failed with the reason, the original is kept
// so Retry has something to work from, and the catch page shows a ⚠️ tile.
test('a HEIC that fails to convert ends as failed, not as a success (#11)', async ({ page }) => {
  test.setTimeout(CONVERSION_TIMEOUT + 90_000);
  const before = await mediaFor(target.catchNumber);
  await upload(page, ['broken.heic']);
  await expect(page.locator('#successFiles .file-row').first()).toContainText('⏳ Converting');

  const [item] = await waitForNewMedia(before, 1, CONVERSION_TIMEOUT, { finished: ['failed'] });
  expect(item.status).toBe('failed');
  expect(item.errorMessage, 'the reason is stored').toBeTruthy();
  expect((await fetch(item.readUrl)).status, 'the original is kept for Retry').toBe(200);

  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await expect(page.locator(`.media-tile--failed[data-media-id="${item.id}"]`)).toContainText("Couldn't convert");
});

// #4 failure paths against real Staging storage and workflows
test.describe('when things go wrong', () => {
  test.use({ allowConsoleErrors: true }); // the dropped upload logs its error

  test('a dropped connection fails just that file, and Retry resumes it intact', async ({ page }) => {
    test.setTimeout(240_000);
    const jpg = fs.readFileSync(path.join(MEDIA, 'photo.jpg'));
    const big = Buffer.concat([jpg, Buffer.alloc(20 * 1024 * 1024 - jpg.length, 0x3c)]);
    const before = await mediaFor(target.catchNumber);

    // The second 8 MB piece can't get through until `dropping` is cleared
    let dropping = true;
    const sentBlocks = [];
    await page.route(url => url.searchParams.get('comp') === 'block', route => {
      const id = atob(new URL(route.request().url()).searchParams.get('blockid'));
      if (dropping && id === 'block-000001') return route.abort('internetdisconnected');
      sentBlocks.push(id);
      return route.continue();
    });

    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
    await page.locator('#files').setInputFiles([
      { name: 'small.jpg', mimeType: 'image/jpeg', buffer: jpg },
      { name: 'dropped.jpg', mimeType: 'image/jpeg', buffer: big },
    ]);
    await page.locator('#uploadBtn').click();

    const rows = page.locator('#fileList .file-row');
    // Each piece is tried 5 times (about 30 s of backing off) before the file is marked failed
    await expect(rows.nth(1)).toContainText('❌ Failed', { timeout: 120_000 });
    await expect(rows.nth(0)).toContainText('✅ Done');
    await expect(page.locator('#retryBtn')).toHaveText(/Retry 1 Failed File/);
    expect(sentBlocks).toEqual(['block-000000']);

    dropping = false;
    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible({ timeout: 120_000 });
    expect(sentBlocks, 'Retry picked up at the second piece').toEqual(['block-000000', 'block-000001', 'block-000002']);

    const fresh = await waitForNewMedia(before, 2, 30_000);
    const item = fresh.find(m => m.originalFileName === 'dropped.jpg');
    expect(item.fileSizeInBytes).toBe(big.length);
    const res = await fetch(item.readUrl);
    expect(Buffer.from(await res.arrayBuffer()).equals(big), 'stored bytes match the original').toBe(true);
  });

  test('Media Activity: Retry runs a failed file again, and Delete removes it and its file', async ({ page }) => {
    test.setTimeout(CONVERSION_TIMEOUT + 90_000);
    const failed = (await mediaFor(target.catchNumber))
      .find(m => m.originalFileName === 'broken.heic' && m.displayStatus === 'failed');
    test.skip(!failed, 'needs the failed broken.heic from the test above');

    await unlockAdmin(page);
    await page.goto('media-activity.html');
    await page.locator('#catchFilter').selectOption(target.catchNumber);
    await page.locator(`.row-action[data-action="retry"][data-id="${failed.id}"]`).click();
    await expect(page.locator('#status')).toContainText('Retry started.');

    // It goes back through Convert Media and, being broken, fails again with a newer timestamp
    await expect.poll(async () => {
      const m = (await mediaFor(target.catchNumber)).find(x => x.id === failed.id);
      return m && m.displayStatus === 'failed' && m.statusUpdatedAt > failed.statusUpdatedAt;
    }, { timeout: CONVERSION_TIMEOUT, intervals: [2_000, 5_000] }).toBe(true);

    await page.reload();
    await page.locator('#catchFilter').selectOption(target.catchNumber);
    const del = page.locator(`.row-action[data-action="delete"][data-id="${failed.id}"]`);
    await del.click();
    await expect(del).toHaveText('Tap again to delete');
    await del.click();
    await expect(page.locator('#status')).toContainText('Deleted.');

    expect((await mediaFor(target.catchNumber)).some(m => m.id === failed.id), 'the record is gone').toBe(false);
    expect((await fetch(failed.readUrl)).status, 'its file is gone from storage').not.toBe(200);
  });
});
