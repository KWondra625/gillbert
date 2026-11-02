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

  test('a file that finishes while the lightbox is open shows once it closes', async ({ page }) => {
    const state = { items: [mediaItem(1), mediaItem(2, { status: 'processing', displayStatus: 'processing' })] };
    await mockMediaList(page, state);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('.media-tile--photo').first().click();
    await expect(page.locator('#lightbox')).toHaveClass(/open/);

    state.items = [mediaItem(1), mediaItem(2)];
    await expect.poll(() => state.requests, { timeout: 20_000 }).toBeGreaterThan(1);
    await expect(page.locator('.media-tile--pending')).toHaveCount(1); // held back while open
    await page.locator('#lightboxClose').click();
    await expect(page.locator('.media-tile--pending')).toHaveCount(0);
    await expect(page.locator('.media-tile--photo')).toHaveCount(2);
  });

  test('dragging along a video (to jump ahead) does not flip to the next item', async ({ page }) => {
    const state = { items: [
      mediaItem(1, { mediaType: 'Video', contentType: 'video/mp4', readUrl: `${FAKE_STORAGE}/1.mp4`, originalFileName: 'clip.mp4' }),
      mediaItem(2),
    ] };
    await mockMediaList(page, state);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('.media-tile--video').first().click();
    await expect(page.locator('#lightboxVideo')).toBeVisible();

    // A synthetic sideways drag: works the same in every test browser
    const swipe = (target, from, to) => page.evaluate(([sel, a, b]) => {
      const t = document.querySelector(sel);
      for (const [type, x] of [['touchstart', a], ['touchend', b]]) {
        const ev = new Event(type, { bubbles: true });
        Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x }] });
        t.dispatchEvent(ev);
      }
    }, [target, from, to]);

    // Both directions on the video: neither changes the item
    await swipe('#lightboxVideo', 300, 50);
    await swipe('#lightboxVideo', 50, 300);
    await expect(page.locator('#lightboxVideo')).toBeVisible();
    await expect(page.locator('#lightboxImg')).toBeHidden();
    // The same drag off the video moves to the photo (whichever side of the video it is)
    await swipe('#lightbox', 300, 50);
    if (await page.locator('#lightboxImg').isHidden()) await swipe('#lightbox', 50, 300);
    await expect(page.locator('#lightboxImg')).toBeVisible();
  });

  test('an older background check answering after Retry does not undo it', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [mediaItem(1, { status: 'submitted', displayStatus: 'submitted' }),
                            mediaItem(2, { status: 'failed', displayStatus: 'failed' })], requests: 0 };
    let held = null;
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
      state.requests++;
      if (state.hold) { state.hold = false; held = { route, items: state.items }; return; }
      return route.fulfill({ json: state.items });
    });
    await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({
      contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
    await page.route(url => url.pathname.endsWith('/catch-media/retry'), route => {
      state.items = [mediaItem(1), mediaItem(2, { status: 'submitted', displayStatus: 'submitted' })];
      return route.fulfill({ json: { success: true, mediaId: 2, status: 'submitted' } });
    });
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await expect(page.locator('.media-tile--failed')).toHaveCount(1);

    // The next background check sees the old state (file 1 done, file 2 still failed) but
    // is slow to answer; Retry on file 2 happens meanwhile.
    state.items = [mediaItem(1), mediaItem(2, { status: 'failed', displayStatus: 'failed' })];
    state.hold = true;
    await expect.poll(() => held, { timeout: 20_000 }).not.toBeNull();
    await page.locator('.media-tile-action[data-action="retry"]').click();
    await expect(page.locator('.media-tile--pending')).toHaveCount(1);

    await held.route.fulfill({ json: held.items }); // the old answer finally arrives
    await page.waitForTimeout(1_000);
    await expect(page.locator('.media-tile--pending')).toHaveCount(1); // still retrying, not ⚠️
    // ...and checking carries on
    const before = state.requests;
    await expect.poll(() => state.requests, { timeout: 20_000 }).toBeGreaterThan(before);
  });

  test.describe('when a background check fails', () => {
    test.use({ allowConsoleErrors: true }); // the page logs the failed check

    test('it keeps checking, and the tile still updates', async ({ page }) => {
      const state = { items: [mediaItem(1, { status: 'submitted', displayStatus: 'submitted' })], fail: 0 };
      await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
        state.requests = (state.requests || 0) + 1;
        if (state.fail > 0) { state.fail--; return route.fulfill({ status: 500, body: '' }); }
        return route.fulfill({ json: state.items });
      });
      await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({
        contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
      await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
      await expect(page.locator('.media-tile--pending')).toHaveCount(1);

      state.fail = 1; // the next check fails; the one after finds it finished
      state.items = [mediaItem(1)];
      await expect(page.locator('.media-tile--pending')).toHaveCount(0, { timeout: 35_000 });
      await expect(page.locator('.media-tile--photo')).toHaveCount(1);
    });
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

// Fake upload slots, storage and commit. `failFirstCommitFor` names a file whose first
// commit fails (it then succeeds on retry). Returns what was sent where.
async function mockUploadFlow(page, { failFirstCommitFor } = {}) {
  const calls = { slotRequests: [], puts: [], commits: [] };
  const failed = new Set();
  await page.route(url => url.pathname.endsWith('/catch-media/get-sas'), route => {
    const { files } = route.request().postDataJSON();
    calls.slotRequests.push(files.map(f => f.name));
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

test.describe('upload page results', () => {
  test.use({ allowConsoleErrors: true }); // the failed commit below logs its error

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

  test('converting rows turn ✅ Done or ⚠️ while the page stays open', async ({ page }) => {
    await mockUploadFlow(page);
    // Registered last, so it answers before mockUploadFlow's empty list
    const state = { items: [] };
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route => route.fulfill({ json: state.items }));
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(['photo.heic', 'video.mov'].map(f => path.join(MEDIA, f)));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    await page.locator('#stayHereBtn').click();

    // The commit mock numbers records 1, 2 in commit order; mark whichever is the HEIC done
    // and the other failed.
    const rows = page.locator('#successFiles .file-row');
    await expect(rows).toHaveCount(2);
    state.items = [
      mediaItem(1, { status: 'complete', displayStatus: 'complete' }),
      mediaItem(2, { status: 'failed', displayStatus: 'failed' }),
    ];
    await expect(page.locator('#successFiles .file-row--complete')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('#successFiles .file-row--convertFailed')).toHaveCount(1);
    await expect(page.locator('#successFiles .file-row--convertFailed')).toContainText("Couldn't convert");
    await expect(page.locator('#successMsg')).toContainText("1 file couldn't be converted");
  });

  test('Go to Catch Now and Stay Here are full-width with space between them', async ({ page }) => {
    await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#successState')).toBeVisible();

    const go = await page.locator('#successBackBtn').boundingBox();
    const stay = await page.locator('#stayHereBtn').boundingBox();
    expect(Math.abs(go.width - stay.width)).toBeLessThan(2);
    expect(stay.y - (go.y + go.height)).toBeGreaterThanOrEqual(16);
    await page.locator('#stayHereBtn').click();
  });

  test('when one file is refused, the others still flip from ⏳ to ✅', async ({ page }) => {
    await mockUploadFlow(page);
    const state = { items: [] };
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route => route.fulfill({ json: state.items }));
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    const fs = require('fs');
    await page.locator('#files').setInputFiles([
      { name: 'photo.heic', mimeType: 'image/heic', buffer: fs.readFileSync(path.join(MEDIA, 'photo.heic')) },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
    ]);
    await page.locator('#uploadBtn').click();

    const rows = page.locator('#fileList .file-row');
    await expect(rows.nth(0)).toContainText('⏳ Converting');
    await expect(rows.nth(1)).toContainText("🚫 Can't upload");
    state.items = [mediaItem(1)]; // the commit mock recorded the HEIC as id 1
    await expect(rows.nth(0)).toContainText('✅ Done', { timeout: 20_000 });
  });

  test('if the upload slot request fails on Retry, every file in it can be retried', async ({ page }) => {
    await page.clock.install();
    const calls = await mockUploadFlow(page, { failFirstCommitFor: 'photo.png' });
    const state = { failPutFor: 'photo.jpg', failSas: false };
    // Registered after mockUploadFlow, so these answer first and fall back to it otherwise
    await page.route(url => url.pathname.endsWith('/catch-media/get-sas'), route =>
      state.failSas ? route.fulfill({ status: 500, body: '' }) : route.fallback());
    await page.route(`${FAKE_STORAGE}/put/**`, route => {
      if (route.request().url().includes(encodeURIComponent(state.failPutFor || '-'))) {
        state.failPutFor = null;
        return route.fulfill({ status: 403, body: 'AuthenticationFailed' });
      }
      return route.fallback();
    });
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(['photo.png', 'photo.jpg'].map(f => path.join(MEDIA, f)));
    await page.locator('#uploadBtn').click();

    // photo.png is in storage but its record failed; photo.jpg never reached storage
    const rows = page.locator('#fileList .file-row');
    await expect(rows.nth(0)).toContainText('❌ Failed');
    await expect(rows.nth(1)).toContainText('❌ Failed');

    // 46 minutes later photo.jpg's upload link is too old, so Retry asks for a new one, and that fails
    await page.clock.fastForward('46:00');
    state.failSas = true;
    await page.locator('#retryBtn').click();
    await expect(rows.nth(0)).toContainText('❌ Failed'); // not stuck on ⏸️ Waiting
    await expect(rows.nth(1)).toContainText('❌ Failed');
    await expect(page.locator('#retryBtn')).toHaveText(/Retry 2 Failed Files/);

    state.failSas = false;
    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    expect(calls.puts.filter(n => n === 'photo.png'), 'photo.png was only uploaded once').toHaveLength(1);
    expect(calls.commits.filter(n => n === 'photo.png')).toHaveLength(2);
    await page.locator('#stayHereBtn').click();
  });

  test('the upload log stays collapsed until opened', async ({ page }) => {
    await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await expect(page.locator('.log-details')).toBeHidden(); // nothing logged yet
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    await page.locator('#stayHereBtn').click();

    await expect(page.locator('.log-details summary')).toHaveText('Upload log');
    await expect(page.locator('#log')).toBeHidden();
    await page.locator('.log-details summary').click();
    await expect(page.locator('#log')).toContainText('photo.jpg is in the boat!');
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

test.describe('upload page checks before uploading', () => {
  test('a too-large or unsupported file is refused on its own row; the rest upload', async ({ page }) => {
    // A real 1 GB+ file is too big to hand the browser, so report one file's size as 1.5 GB
    await page.addInitScript(() => {
      const realSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
      Object.defineProperty(File.prototype, 'size', {
        get() { return this.name === 'huge.mp4' ? 1.5 * 1024 * 1024 * 1024 : realSize.call(this); },
      });
    });
    const calls = await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    const jpg = require('fs').readFileSync(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#files').setInputFiles([
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg },
      { name: 'huge.mp4', mimeType: 'video/mp4', buffer: jpg },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
    ]);
    await page.locator('#uploadBtn').click();

    const rows = page.locator('#fileList .file-row');
    await expect(rows.nth(0)).toContainText('✅ Done');
    await expect(rows.nth(1)).toContainText("🚫 Can't upload");
    await expect(rows.nth(1)).toContainText('Too large (1.5 GB); the limit is 1.0 GB per file.');
    await expect(rows.nth(2)).toContainText("isn't supported");
    await expect(page.locator('#status')).toContainText("2 of 3 files didn't make it");
    await expect(page.locator('#retryBtn')).toBeHidden();
    await expect(page.locator('#successState')).toBeHidden();
    expect(calls.slotRequests).toEqual([['photo.jpg']]);
    expect(calls.puts).toEqual(['photo.jpg']);
  });

  test('more than 10 files ask for upload slots 10 at a time', async ({ page }) => {
    const calls = await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    const jpg = require('fs').readFileSync(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#files').setInputFiles(Array.from({ length: 12 }, (_, i) =>
      ({ name: `p${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: jpg })));
    await page.locator('#uploadBtn').click();

    await expect(page.locator('#successState')).toBeVisible();
    expect(calls.slotRequests.map(r => r.length)).toEqual([10, 2]);
    expect(calls.puts).toHaveLength(12);
    await page.locator('#stayHereBtn').click();
  });
});

test.describe('upload page large files', () => {
  test.use({ allowConsoleErrors: true }); // the refused block logs its error

  test('a big file goes up in blocks, and Retry resumes from the block that failed', async ({ page }) => {
    await mockUploadFlow(page);
    // Registered last, so it answers the block calls before mockUploadFlow's storage route
    const sent = [];
    let refusedOnce = false;
    let blockList = null;
    await page.route(`${FAKE_STORAGE}/put/**`, async route => {
      const q = new URL(route.request().url()).searchParams;
      if (q.get('comp') === 'blocklist') {
        blockList = { body: route.request().postData(), type: route.request().headers()['x-ms-blob-content-type'] };
        return route.fulfill({ status: 201, body: '' });
      }
      const id = atob(q.get('blockid'));
      if (id === 'block-000001' && !refusedOnce) {
        refusedOnce = true;
        return route.fulfill({ status: 403, body: 'AuthenticationFailed' }); // a 4xx isn't retried on its own
      }
      sent.push(id);
      return route.fulfill({ status: 201, body: '' });
    });
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    // 17 MB: two full 8 MB blocks and a short one
    await page.locator('#files').setInputFiles({ name: 'big.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(17 * 1024 * 1024, 1) });
    await page.locator('#uploadBtn').click();

    const row = page.locator('#fileList .file-row').first();
    await expect(row).toContainText('❌ Failed');
    expect(sent).toEqual(['block-000000']);

    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    // Block 0 wasn't sent again; the list stitches all three in order
    expect(sent).toEqual(['block-000000', 'block-000001', 'block-000002']);
    expect(blockList.body).toContain(['000000', '000001', '000002'].map(n => `<Latest>${btoa(`block-${n}`)}</Latest>`).join(''));
    expect(blockList.type).toBe('video/mp4');
    await page.locator('#stayHereBtn').click();
  });
});

test.describe('media activity page', () => {
  test('turns away a visitor who isn\'t admin', async ({ page }) => {
    await page.goto('media-activity.html');
    await expect(page.locator('#errorMsg')).toHaveText("You don't have permission to access this page.");
  });

  test('lists uploads newest first and filters to the ones needing attention', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [
      mediaItem(10, { uploadedAt: '2026-10-01T12:00:00Z' }),
      mediaItem(11, { uploadedAt: '2026-10-03T12:00:00Z', status: 'failed', displayStatus: 'failed', errorMessage: 'magick failed' }),
      mediaItem(12, { uploadedAt: '2026-10-02T12:00:00Z', status: 'processing', displayStatus: 'stuck' }),
      mediaItem(13, { uploadedAt: '2026-10-04T12:00:00Z', status: 'submitted', displayStatus: 'submitted' }),
    ] };
    await mockMediaList(page, state);
    await page.goto('media-activity.html');

    const rows = page.locator('#mediaList .media-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('file-13.jpg');
    await expect(rows.nth(3)).toContainText('file-10.jpg');
    await expect(page.locator('#summary')).toContainText('2 need attention');

    await page.locator('.filter-chip[data-filter="attention"]').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('magick failed');
    await expect(page.locator('#mediaList .row-action[data-action="retry"]')).toHaveCount(2);
  });

  test('the catch filter narrows the list to one catch', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [
      mediaItem(30, { catchNumber: 'Catch 26-009' }),
      mediaItem(31, { catchNumber: 'Catch 26-010' }),
      mediaItem(32, { catchNumber: 'Catch 26-010', status: 'failed', displayStatus: 'failed' }),
    ] };
    await mockMediaList(page, state);
    await page.goto('media-activity.html');

    const rows = page.locator('#mediaList .media-row');
    await expect(rows).toHaveCount(3);
    // Newest catch number first
    await expect(page.locator('#catchFilter option')).toHaveText(['All catches', 'Catch 26-010', 'Catch 26-009']);
    await page.locator('#catchFilter').selectOption('Catch 26-010');
    await expect(rows).toHaveCount(2);
    // Combines with the status chips
    await page.locator('.filter-chip[data-filter="attention"]').click();
    await expect(rows).toHaveCount(1);
    await page.locator('#catchFilter').selectOption('');
    await page.locator('.filter-chip[data-filter="all"]').click();
    await expect(rows).toHaveCount(3);
  });

  test('delete needs a second tap', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [mediaItem(20, { status: 'failed', displayStatus: 'failed' })] };
    await mockMediaList(page, state);
    let deleted = null;
    await page.route(url => url.pathname.endsWith('/catch-media/delete'), route => {
      deleted = route.request().postDataJSON();
      state.items = [];
      return route.fulfill({ json: { success: true } });
    });
    await page.goto('media-activity.html');

    const del = page.locator('.row-action[data-action="delete"]');
    await del.click();
    await expect(del).toHaveText('Tap again to delete');
    expect(deleted).toBeNull();
    await del.click();
    await expect(page.locator('#mediaList .media-empty')).toBeVisible();
    expect(deleted).toEqual({ mediaId: 20 });
  });

  test('storage check lists files with no record and can attach one to its catch', async ({ page }) => {
    await unlockAdmin(page);
    await mockMediaList(page, { items: [mediaItem(30)] });
    let committed = null;
    await page.route(url => url.pathname.endsWith('/catch-media/admin'), route => route.fulfill({ json: {
      success: true, scannedAt: new Date().toISOString(), fileCount: 2, rowCount: 1,
      orphanFiles: [{ blobPath: 'catches/Catch-26-001/ABCDEFGH12.heic', sizeBytes: 2048, lastModified: 'Tue, 27 Oct 2026 01:00:00 GMT', catchNumber: 'Catch 26-001' }],
      missingFiles: [] } }));
    await page.route(url => url.pathname.endsWith('/catch-media/commit'), route => {
      committed = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, files: [{ id: 31, status: 'submitted' }] } });
    });
    await page.goto('media-activity.html');

    await page.locator('#scanBtn').click();
    await expect(page.locator('#scanResult')).toContainText('Files with no record (1)');
    const attach = page.locator('#scanResult .row-action[data-action="attach"]');
    await attach.click();
    await attach.click();
    await expect.poll(() => committed).toEqual({
      catchNumber: 'Catch 26-001',
      uploads: [{ blobPath: 'catches/Catch-26-001/ABCDEFGH12.heic', originalName: 'ABCDEFGH12.heic', size: 2048 }],
      uploadedByAnglerId: null,
    });
  });

  test('storage check lists profile photo files too, which can be deleted but not attached', async ({ page }) => {
    await unlockAdmin(page);
    await mockMediaList(page, { items: [mediaItem(30)] });
    let deleted = null;
    await page.route(url => url.pathname.endsWith('/catch-media/admin'), route => {
      const body = route.request().postDataJSON();
      if (body.action === 'delete-orphan') { deleted = body; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: {
        success: true, scannedAt: new Date().toISOString(), fileCount: 2, rowCount: 1,
        orphanFiles: deleted ? [] : [{ container: 'angler-media', blobPath: 'anglers/13/ABCDEFGH12.jpg', sizeBytes: 3974,
                                       lastModified: 'Mon, 26 Oct 2026 19:02:16 GMT', anglerId: 13 }],
        missingFiles: [{ container: 'angler-media', anglerId: 7, blobPath: 'anglers/7/ZYXWVUTS98.jpg' }] } });
    });
    await page.goto('media-activity.html');
    await page.locator('#scanBtn').click();

    const row = page.locator('#scanResult .media-row').first();
    await expect(row).toContainText('Angler #13 profile photo');
    await expect(row.locator('[data-action="attach"]')).toHaveCount(0);
    await expect(page.locator('#scanResult')).toContainText("Angler #7's profile photo points at a file that isn't in storage");

    const del = row.locator('[data-action="delete-orphan"]');
    await del.click();
    await del.click();
    await expect.poll(() => deleted).toEqual({ action: 'delete-orphan', container: 'angler-media', blobPath: 'anglers/13/ABCDEFGH12.jpg' });
    await expect(page.locator('#scanResult')).toContainText('Files with no record (0)');
  });
});

test.describe('media badges', () => {
  test('📷 counts viewable media and ⏳ shows while something converts', async ({ page }) => {
    const [first] = await getCatches();
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [
      { ...first, catchMediaCount: 2, catchMediaProcessingCount: 3 },
    ] }));
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.catch-badges');
    await expect(badges).toContainText('📷 2');
    await expect(badges.locator('.badge-media--converting')).toHaveText('⏳ 3');
  });

  test('a count of 1 shows just the icon', async ({ page }) => {
    const [first] = await getCatches();
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [
      { ...first, catchMediaCount: 1, catchMediaProcessingCount: 1 },
    ] }));
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.catch-badges .badge-media');
    await expect(badges).toHaveText(['📷', '⏳']);
  });

  // Answers get-catches with the first catch's counts from `state`; counts every request
  async function mockCounts(page, catches, state) {
    await page.route(url => url.pathname.endsWith('/get-catches'), route => {
      state.requests++;
      return route.fulfill({ json: catches.map((c, i) => i === 0
        ? { ...c, catchMediaCount: state.media, catchMediaProcessingCount: state.converting }
        : { ...c, catchMediaCount: 0, catchMediaProcessingCount: 0 }) });
    });
  }

  test('the listing re-checks badges every 30 s while something converts', async ({ page }) => {
    const [first] = await getCatches();
    const state = { media: 1, converting: 2, requests: 0 };
    await page.clock.install();
    await mockCounts(page, [first], state);
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.catch-badges .badge-media');
    await expect(badges).toHaveText(['📷', '⏳ 2']);

    state.media = 3; state.converting = 0; // both finished
    await page.clock.runFor(31_000);
    await expect(badges).toHaveText(['📷 3']);
    // Nothing converting any more, so it stops checking
    const after = state.requests;
    await page.clock.runFor(120_000);
    expect(state.requests).toBe(after);
  });

  test('coming back to the listing via Back re-reads the badges', async ({ page }) => {
    const [first] = await getCatches();
    const state = { media: 1, converting: 0, requests: 0 };
    await mockCounts(page, [first], state);
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.catch-badges .badge-media');
    await expect(badges).toHaveText(['📷']);

    // What the browser fires when it restores the page from its back/forward cache
    state.media = 1; state.converting = 1;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(badges).toHaveText(['📷', '⏳']);
  });

  test('Fish of Fame re-reads its badges via Back too', async ({ page }) => {
    const catches = await getCatches();
    const state = { media: 2, converting: 0, requests: 0 };
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json:
      catches.map(c => ({ ...c, catchMediaCount: state.media, catchMediaProcessingCount: state.converting })) }));
    await page.goto('fish-of-fame.html');
    const badges = page.locator('#topCatchesList .rank-row').first().locator('.rank-media-badge');
    await expect(badges).toHaveText(['📷 2']);
    state.converting = 2;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(badges).toHaveText(['📷 2', '⏳ 2']);
  });

  test('Fish of Fame shows the same 📷 and ⏳ counts', async ({ page }) => {
    const catches = await getCatches();
    // Every catch gets the counts, so whichever ranks first carries them
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json:
      catches.map(c => ({ ...c, catchMediaCount: 2, catchMediaProcessingCount: 3 })) }));
    await page.goto('fish-of-fame.html');
    const badges = page.locator('#topCatchesList .rank-row').first().locator('.rank-media-badge');
    await expect(badges).toHaveText(['📷 2', '⏳ 3']);
  });
});

test.describe('profile photo HEIC', () => {
  test.use({ allowConsoleErrors: true }); // the failed conversion logs its error

  test('a HEIC opens in the crop box once converted, and a failed conversion says so', async ({ page }) => {
    await unlockAdmin(page);
    const fs = require('fs');
    const state = { fail: true };
    await page.route(url => url.pathname.endsWith('/anglers/get-photo-sas'), route => route.fulfill({ json: {
      uploadUrl: `${FAKE_STORAGE}/put/photo.heic?sig=x`, readUrl: `${FAKE_STORAGE}/photo.heic`,
      blobPath: 'anglers/1/ABCDEFGH12.heic', contentType: 'image/heic' } }));
    await page.route(`${FAKE_STORAGE}/put/**`, route => route.fulfill({ status: 201, body: '' }));
    await page.route(url => url.pathname.endsWith('/anglers/convert-photo'), route => state.fail
      ? route.fulfill({ status: 500, json: { success: false, message: 'Photo conversion failed: boom' } })
      : route.fulfill({ json: { success: true, contentType: 'image/jpeg',
          data: fs.readFileSync(path.join(MEDIA, 'photo.jpg')).toString('base64') } }));
    // Read-only: the angler page loads a real angler, but nothing is saved
    await page.goto('edit-angler.html?id=1');
    await expect(page.locator('#anglerForm')).toBeVisible();

    await page.locator('#profilePhotoInput').setInputFiles(path.join(MEDIA, 'photo.heic'));
    await expect(page.locator('#profilePhotoStatus')).toContainText("Couldn't prepare that photo for cropping");
    await expect(page.locator('#cropModal')).not.toHaveClass(/open/);

    state.fail = false;
    await page.locator('#profilePhotoInput').setInputFiles(path.join(MEDIA, 'photo.heic'));
    await expect(page.locator('#cropModal')).toHaveClass(/open/);
    await page.locator('#cropModalClose').click(); // cancel: nothing is saved
  });
});
