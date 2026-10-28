// Layer 1, read-only: the upload page's per-file results and the catch page's media
// states (#10). Every media call these pages make is answered here in the browser
// (upload slots, the storage upload, commit, retry and the media list), so nothing is
// written anywhere; only the catch itself is read from Staging.
const path = require('path');
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getCatches } = require('../support/staging-api');

const MEDIA = path.join(__dirname, '..', 'media');
const FAKE_STORAGE = 'https://upload.test.invalid';

let catchNumber;
test.beforeAll(async () => {
  const catches = await getCatches();
  catchNumber = catches[0].catchNumber;
});

function mediaItem(id, overrides = {}) {
  return {
    id, catchNumber, blobPath: `catches/x/${id}.jpg`, readUrl: `${FAKE_STORAGE}/${id}.jpg`,
    originalFileName: `file-${id}.jpg`, mediaType: 'Photo', contentType: 'image/jpeg',
    uploadedAt: new Date().toISOString(), uploadedByAnglerId: null, uploadedByAnglerName: null,
    status: 'complete', displayStatus: 'complete', ...overrides,
  };
}

// Answers the media list with whatever `state.items` holds at the time of the request.
async function mockMediaList(page, state) {
  await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
    state.requests = (state.requests || 0) + 1;
    return route.fulfill({ json: state.items });
  });
  // The tiles' images point at a fake host; answer them with a 1x1 GIF.
  await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({
    contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
}

test.describe('catch page media states', () => {
  test('a converting file shows ⏳ and turns into the photo when it is ready', async ({ page }) => {
    const state = { items: [mediaItem(1), mediaItem(2, { status: 'submitted', displayStatus: 'submitted' })] };
    await mockMediaList(page, state);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);

    await expect(page.locator('.media-tile--pending')).toHaveCount(1);
    await expect(page.locator('.media-tile--pending')).toContainText('Processing');
    await expect(page.locator('.media-tile--photo')).toHaveCount(1);

    // Conversion finishes; the page's next check (every 10 s) swaps the tile in place.
    state.items = [mediaItem(1), mediaItem(2)];
    await expect(page.locator('.media-tile--pending')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.media-tile--photo')).toHaveCount(2);
  });

  test('stops checking once nothing is converting', async ({ page }) => {
    const state = { items: [mediaItem(1)] };
    await mockMediaList(page, state);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await expect(page.locator('.media-tile--photo')).toHaveCount(1);
    await page.waitForTimeout(12_000);
    expect(state.requests).toBe(1);
  });

  test('a failed or stuck file shows ⚠️ without buttons for other anglers', async ({ page }) => {
    const state = { items: [
      mediaItem(3, { status: 'failed', displayStatus: 'failed', errorMessage: 'boom' }),
      mediaItem(4, { status: 'processing', displayStatus: 'stuck' }),
    ] };
    await mockMediaList(page, state);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);

    const failed = page.locator('.media-tile--failed');
    await expect(failed).toHaveCount(2);
    await expect(failed.nth(0)).toContainText("Couldn't convert");
    await expect(failed.nth(1)).toContainText('Taking too long');
    await expect(page.locator('.media-tile-action')).toHaveCount(0);
  });

  test('admin can retry a failed file', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [mediaItem(5, { status: 'failed', displayStatus: 'failed' })] };
    await mockMediaList(page, state);
    let retried = null;
    await page.route(url => url.pathname.endsWith('/catch-media/retry'), route => {
      retried = route.request().postDataJSON();
      state.items = [mediaItem(5, { status: 'submitted', displayStatus: 'submitted' })];
      return route.fulfill({ json: { success: true, mediaId: 5, status: 'submitted' } });
    });
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);

    await page.locator('.media-tile-action[data-action="retry"]').click();
    expect(retried).toEqual({ mediaId: 5 });
    await expect(page.locator('.media-tile--pending')).toHaveCount(1);
  });

  test.describe('when a delete fails', () => {
    test.use({ allowConsoleErrors: true }); // the page logs the failed delete

    test('a delete that comes back as an empty 200 is reported as a failure', async ({ page }) => {
      await unlockAdmin(page);
      const state = { items: [mediaItem(6, { status: 'failed', displayStatus: 'failed' })] };
      await mockMediaList(page, state);
      await page.route(url => url.pathname.endsWith('/catch-media/delete'), route => route.fulfill({ status: 200, body: '' }));
      await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);

      await page.locator('.media-tile-action[data-action="delete"]').click();
      await page.locator('#deleteMediaConfirm').click();
      await expect(page.locator('#status')).toContainText('Delete failed');
      await expect(page.locator('.media-tile--failed')).toHaveCount(1);
    });
  });
});

test.describe('upload page results', () => {
  test.use({ allowConsoleErrors: true }); // the failed commit below logs its error

  // Fake upload slots, storage and commit. `failFirstCommitFor` names a file whose first
  // commit fails (it then succeeds on retry). Returns what was sent where.
  async function mockUploadFlow(page, { failFirstCommitFor } = {}) {
    const calls = { puts: [], commits: [] };
    const failed = new Set();
    await page.route(url => url.pathname.endsWith('/catch-media/get-sas'), route => {
      const { files } = route.request().postDataJSON();
      return route.fulfill({ json: { uploads: files.map((f, i) => ({
        originalName: f.name, size: f.size, contentType: f.type, mediaType: f.type.startsWith('video/') ? 'Video' : 'Photo',
        blobPath: `catches/x/F${calls.puts.length}${i}.${f.name.split('.').pop()}`,
        uploadUrl: `${FAKE_STORAGE}/put/${encodeURIComponent(f.name)}?sig=x` })) } });
    });
    await page.route(`${FAKE_STORAGE}/put/**`, route => {
      calls.puts.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()));
      return route.fulfill({ status: 201, body: '' });
    });
    await page.route(url => url.pathname.endsWith('/catch-media/commit'), route => {
      const { uploads } = route.request().postDataJSON();
      const u = uploads[0];
      calls.commits.push(u.originalName);
      if (u.originalName === failFirstCommitFor && !failed.has(u.originalName)) {
        failed.add(u.originalName);
        return route.fulfill({ status: 200, body: '' }); // n8n's empty answer when a workflow fails
      }
      const converting = /\.(heic|mov|mp4)$/i.test(u.originalName);
      return route.fulfill({ json: { success: true, files: [{ id: calls.commits.length, status: converting ? 'submitted' : 'complete' }] } });
    });
    // The catch page we're redirected to isn't under test here.
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route => route.fulfill({ json: [] }));
    return calls;
  }

  test('each file gets its own result, and the page hands off with a 15 s countdown', async ({ page }) => {
    const calls = await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(['photo.jpg', 'photo.heic', 'video.mp4'].map(f => path.join(MEDIA, f)));
    await page.locator('#uploadBtn').click();

    await expect(page.locator('#successState')).toBeVisible();
    const rows = page.locator('#successFiles .file-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('✅ Done');
    await expect(rows.nth(1)).toContainText('⏳ Converting');
    await expect(rows.nth(2)).toContainText('⏳ Converting');
    await expect(page.locator('#successMsg')).toContainText('2 files are still converting');
    await expect(page.locator('#countdown')).toHaveText(/^1[0-5]$/);
    expect(calls.puts.sort()).toEqual(['photo.heic', 'photo.jpg', 'video.mp4']);

    // Stay Here cancels the countdown.
    await page.locator('#stayHereBtn').click();
    await expect(page.locator('#successRedirect')).toBeHidden();
    const shown = await page.locator('#countdown').textContent();
    await page.waitForTimeout(2_000);
    await expect(page.locator('#countdown')).toHaveText(shown);
  });

  test('a file that fails to record keeps the others, and retry only re-records it', async ({ page }) => {
    const calls = await mockUploadFlow(page, { failFirstCommitFor: 'photo.png' });
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(['photo.jpg', 'photo.png'].map(f => path.join(MEDIA, f)));
    await page.locator('#uploadBtn').click();

    const rows = page.locator('#fileList .file-row');
    await expect(rows.nth(1)).toContainText('❌ Failed');
    await expect(rows.nth(0)).toContainText('✅ Done');
    await expect(page.locator('#successState')).toBeHidden();
    await expect(page.locator('#retryBtn')).toHaveText(/Retry 1 Failed File/);

    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    // Uploaded once each; photo.png was recorded twice (the failed try, then the retry).
    expect(calls.puts.sort()).toEqual(['photo.jpg', 'photo.png']);
    expect(calls.commits.filter(n => n === 'photo.png')).toHaveLength(2);
  });
});
