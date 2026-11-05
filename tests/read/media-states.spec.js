// Layer 1, read-only: the upload page's per-file results and the catch page's media
// states (#10). Every media call these pages make is answered here in the browser
// (upload slots, the storage upload, commit, retry and the media list), so nothing is
// written anywhere; only the catch itself is read from Staging.
const path = require('path');
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getCatches, getLookups } = require('../support/staging-api');

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

  test.describe('when the refresh after Retry fails', () => {
    test.use({ allowConsoleErrors: true }); // the failed refresh logs its error

    test('the tile stays ⏳ (not an empty gallery) and checking carries on', async ({ page }) => {
      await unlockAdmin(page);
      const state = { items: [mediaItem(1), mediaItem(2, { status: 'failed', displayStatus: 'failed' })], fail: 0 };
      await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
        if (state.fail > 0) { state.fail--; return route.fulfill({ status: 500, body: '' }); }
        return route.fulfill({ json: state.items });
      });
      await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
      await page.route(url => url.pathname.endsWith('/catch-media/retry'), route => {
        state.fail = 1; // the refresh right after Retry fails
        state.items = [mediaItem(1), mediaItem(2)]; // ...and the conversion then finishes
        return route.fulfill({ json: { success: true, mediaId: 2, status: 'submitted' } });
      });
      await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
      await expect(page.locator('.media-tile--failed')).toHaveCount(1);

      await page.locator('.media-tile-action[data-action="retry"]').click();
      await expect(page.locator('.media-tile--pending')).toHaveCount(1);
      await expect(page.locator('.media-tile--photo')).toHaveCount(1); // the other file is still shown
      await expect(page.locator('#status')).toContainText("Couldn't refresh the media");
      // The next check (10 s) finds it finished
      await expect(page.locator('.media-tile--photo')).toHaveCount(2, { timeout: 20_000 });
      await expect(page.locator('#status')).not.toContainText("Couldn't refresh");
    });
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
    await expect.poll(() => retried).toEqual({ mediaId: 5 });
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

    test('if the reload after a delete fails, the page tries again and the file goes', async ({ page }) => {
      await unlockAdmin(page);
      const state = { items: [mediaItem(7), mediaItem(8)], fail: 0 };
      await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
        if (state.fail > 0) { state.fail--; return route.fulfill({ status: 500, body: '' }); }
        return route.fulfill({ json: state.items });
      });
      await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
      await page.route(url => url.pathname.endsWith('/catch-media/delete'), route => {
        state.items = [mediaItem(7)];
        state.fail = 1; // the reload right after the delete fails
        return route.fulfill({ json: { success: true } });
      });
      await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
      await expect(page.locator('.media-tile--photo')).toHaveCount(2);

      await page.locator('#manageMediaBtn').click(); // Manage Media shows the delete buttons
      await page.locator('.media-delete-btn[data-media-id="8"]').click();
      await page.locator('#deleteMediaConfirm').click();
      await expect(page.locator('#status')).toContainText("Couldn't refresh the media");
      // Nothing is converting, yet the page checks again (10 s) and the deleted file goes
      await expect(page.locator('.media-tile--photo')).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator('#status')).not.toContainText("Couldn't refresh");
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

  test('each file gets its own result, and the page hands off with a 10 s countdown', async ({ page }) => {
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
    await expect(page.locator('#countdown')).toHaveText(/^([5-9]|10)$/);
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

  test('Go to Catch and Stay Here are full-width with space between them', async ({ page }) => {
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

  test('leaving mid-upload asks first; leaving once everything is recorded does not', async ({ page }) => {
    await mockUploadFlow(page);
    // Registered last: holds the storage upload until released
    let release;
    const held = new Promise(r => { release = r; });
    await page.route(`${FAKE_STORAGE}/put/**`, async route => { await held; return route.fallback(); });
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); }); // dismiss = stay on the page

    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#fileList .file-row').first()).toContainText('Uploading');

    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(['beforeunload']);
    expect(page.isClosed(), 'stayed on the page').toBe(false);

    release();
    await expect(page.locator('#successState')).toBeVisible();
    await page.locator('#stayHereBtn').click();
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs, 'no second prompt').toEqual(['beforeunload']);
  });

  test('a screen-on lock that arrives after the upload ended is released', async ({ page }) => {
    // A fake wake lock whose request resolves only when the test says so
    await page.addInitScript(() => {
      window.__lock = { released: false, resolve: null };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
        request: () => new Promise(r => { window.__lock.resolve = () => r({ release: async () => { window.__lock.released = true; } }); }),
      } });
    });
    await page.route(url => url.pathname.endsWith('/catch-media/get-sas'), route => route.fulfill({ status: 500, body: '' }));
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#fileList .file-row').first()).toContainText('❌ Failed'); // the upload has ended

    await page.evaluate(() => window.__lock.resolve()); // the lock finally arrives
    await expect.poll(() => page.evaluate(() => window.__lock.released)).toBe(true);
  });

  test('the way back to the catch keeps where you came from (?from=)', async ({ page }) => {
    await mockUploadFlow(page);
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}&from=list`);
    const expected = `catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}&from=list`;
    await expect(page.locator('#backToCatch')).toHaveAttribute('href', `./${expected}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#successBackBtn')).toHaveText('← Go to Catch');
    await expect(page.locator('#successBackBtn')).toHaveAttribute('href', `./${expected}`);
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

test.describe('upload page Retry edge cases', () => {
  test.use({ allowConsoleErrors: true }); // the failures below log their errors

  test('Retry does not record a file twice when the first answer was lost', async ({ page }) => {
    const calls = await mockUploadFlow(page);
    let firstCommit = true;
    let recordedRow = null;
    // The first commit writes the row, but its answer never arrives
    await page.route(url => url.pathname.endsWith('/catch-media/commit'), route => {
      if (!firstCommit) return route.fallback();
      firstCommit = false;
      const u = route.request().postDataJSON().uploads[0];
      recordedRow = { id: 77, blobPath: u.blobPath.replace(/\.heic$/, '.jpg'), status: 'complete', displayStatus: 'complete' };
      return route.abort('connectionreset');
    });
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route =>
      route.fulfill({ json: recordedRow ? [recordedRow] : [] }));
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.heic'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#fileList .file-row').first()).toContainText('❌ Failed');

    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    // Found the row the lost answer had written (converted to .jpg meanwhile): no second commit
    expect(calls.commits).toEqual([]);
    expect(calls.puts).toEqual(['photo.heic']);
    await page.locator('#stayHereBtn').click();
  });

  test('a refused upload link (403) gets a new one on Retry', async ({ page }) => {
    const calls = await mockUploadFlow(page);
    let refused = false;
    await page.route(`${FAKE_STORAGE}/put/**`, route => {
      if (refused) return route.fallback();
      refused = true;
      return route.fulfill({ status: 403, body: 'AuthenticationFailed' });
    });
    await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}`);
    await page.locator('#files').setInputFiles(path.join(MEDIA, 'photo.jpg'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#fileList .file-row').first()).toContainText('❌ Failed');
    expect(calls.slotRequests).toHaveLength(1);

    await page.locator('#retryBtn').click();
    await expect(page.locator('#successState')).toBeVisible();
    expect(calls.slotRequests).toHaveLength(2);
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
        return route.fulfill({ status: 400, body: 'InvalidHeaderValue' }); // a 4xx isn't retried on its own
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

// The storage check runs by itself when Media Activity opens. Tests that care about its
// result add their own answer (Playwright tries the newest route first).
const cleanScan = { success: true, scannedAt: new Date().toISOString(), fileCount: 1, rowCount: 1, orphanFiles: [], missingFiles: [] };

test.describe('media activity page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.pathname.endsWith('/catch-media/admin'), route => route.fulfill({ json: cleanScan }));
  });

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
    await expect(page.locator('#statAttention')).toHaveText('2');
    await expect(page.locator('#statAttentionTile')).toHaveClass(/stat-tile--alert/);
    await expect(page.locator('#statConverting')).toHaveText('1');
    await expect(page.locator('#uploadsTabCount')).toHaveText('(4)');

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

  test('a slow, older refresh does not bring back a deleted row', async ({ page }) => {
    await unlockAdmin(page);
    const state = { items: [mediaItem(40, { status: 'failed', displayStatus: 'failed' }), mediaItem(41)], hold: false };
    let held = null;
    await page.route(url => url.pathname.endsWith('/catch-media/get'), route => {
      if (state.hold) { state.hold = false; held = { route, items: state.items }; return; }
      return route.fulfill({ json: state.items });
    });
    await page.route(url => url.pathname.endsWith('/catch-media/delete'), route => {
      state.items = [mediaItem(41)];
      return route.fulfill({ json: { success: true } });
    });
    await page.goto('media-activity.html');
    const rows = page.locator('#mediaList .media-row');
    await expect(rows).toHaveCount(2);

    state.hold = true; // the Refresh below answers late, with the old list
    await page.locator('#refreshBtn').click();
    await expect.poll(() => held).not.toBeNull();
    const del = page.locator('.row-action[data-action="delete"][data-id="40"]');
    await del.click();
    await del.click();
    await expect(rows).toHaveCount(1);

    await held.route.fulfill({ json: held.items }); // the old answer arrives after the delete
    await page.waitForTimeout(500);
    await expect(rows, 'the deleted row stays gone').toHaveCount(1);
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

    // Ran by itself; the tab heading and tile show the result
    await expect(page.locator('#storageTabCount')).toHaveText('(1)');
    await expect(page.locator('#statStorage')).toHaveText('1 issue');
    await page.locator('#storageTab').click();
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
    await page.locator('#storageTab').click();

    const row = page.locator('#scanResult .media-row').first();
    await expect(row).toContainText('Angler #13 profile photo');
    await expect(row.locator('[data-action="attach"]')).toHaveCount(0);
    await expect(page.locator('#scanResult')).toContainText("Angler #7's profile photo points at a file that isn't in storage");

    const del = row.locator('[data-action="delete-orphan"]');
    await del.click();
    await del.click();
    await expect.poll(() => deleted).toEqual({ action: 'delete-orphan', container: 'angler-media', blobPath: 'anglers/13/ABCDEFGH12.jpg' });
    await expect(page.locator('#scanResult')).toContainText('Files with no record (0)');
    // Still one record with no file
    await expect(page.locator('#statStorage')).toHaveText('1 issue');
  });

  test('the storage check runs on load, and a file from the last hour isn\'t counted as a problem yet', async ({ page }) => {
    await unlockAdmin(page);
    await mockMediaList(page, { items: [mediaItem(30)] });
    let scans = 0;
    await page.route(url => url.pathname.endsWith('/catch-media/admin'), async route => {
      scans++;
      await new Promise(r => setTimeout(r, 300)); // a scan takes a moment
      return route.fulfill({ json: { ...cleanScan, orphanFiles: [
        { blobPath: 'catches/Catch-26-001/NEWNEWNEW1.mov', sizeBytes: 4096, lastModified: new Date().toUTCString(), catchNumber: 'Catch 26-001' },
      ] } });
    });
    await page.goto('media-activity.html');

    // The list shows straight away, on the Uploads tab; the storage tile catches up
    await expect(page.locator('#mediaList .media-row')).toHaveCount(1);
    await expect(page.locator('#statStorage')).toHaveText('All clear ✅');
    await expect(page.locator('#storageTabCount')).toHaveText('✅');
    await expect(page.locator('#uploadsPanel')).toBeVisible();
    expect(scans).toBe(1);

    await page.locator('#statStorageTile').click();
    await expect(page.locator('#storagePanel')).toBeVisible();
    await expect(page.locator('#uploadsPanel')).toBeHidden();
    const row = page.locator('#scanResult .media-row');
    await expect(row).toHaveClass(/media-row--recent/);
    await expect(row).toContainText('Added in the last hour');

    await page.locator('#scanBtn').click();
    await expect.poll(() => scans).toBe(2);
    await expect(page.locator('#scanBtn')).toHaveText('🔍 Scan Again');
  });

  test('the summary tiles jump to their filter, and the uploader\'s name is set apart', async ({ page }) => {
    await unlockAdmin(page);
    await mockMediaList(page, { items: [
      mediaItem(50, { uploadedByAnglerName: 'Kent S' }),
      mediaItem(51, { status: 'failed', displayStatus: 'failed' }),
      mediaItem(52, { status: 'processing', displayStatus: 'processing' }),
    ] });
    await page.goto('media-activity.html');
    const rows = page.locator('#mediaList .media-row');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('#mediaList .row-by')).toHaveText('by Kent S');

    await page.locator('#storageTab').click();
    await page.locator('#statAttentionTile').click();
    await expect(page.locator('#uploadsPanel')).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('.filter-chip[data-filter="attention"]')).toHaveClass(/filter-chip--active/);
    await page.locator('#statConvertingTile').click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Processing');
    await page.locator('.stat-tile[data-goto="all"]').click();
    await expect(rows).toHaveCount(3);
  });
});

test.describe('media badges', () => {
  test('📷 counts viewable media and ⏳ shows while something converts', async ({ page }) => {
    const [first] = await getCatches();
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [
      { ...first, catchMediaCount: 2, catchMediaProcessingCount: 3 },
    ] }));
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.card-button');
    await expect(badges).toContainText('📷 2');
    await expect(badges.locator('.badge-media--converting')).toHaveText('⏳ 3');
  });

  test('a count of 1 shows just the icon', async ({ page }) => {
    const [first] = await getCatches();
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [
      { ...first, catchMediaCount: 1, catchMediaProcessingCount: 1 },
    ] }));
    await page.goto('catches-listing.html');
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.card-button .badge-media');
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
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.card-button .badge-media');
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
    const badges = page.locator('#catchesContainer .catch-card').first().locator('.card-button .badge-media');
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

  test("each card shows its angler's photo in the header and 📷 / ⏳ inside View Details (#27)", async ({ page }) => {
    const [first] = await getCatches();
    const lookups = await getLookups();
    await page.route(url => url.pathname.endsWith('/get-lookup-data'), route => route.fulfill({ json: [{ ...lookups,
      anglers: [{ id: 901, name: 'With Photo', groups: [], profilePhotoReadUrl: `${FAKE_STORAGE}/face.jpg` },
                { id: 902, name: 'No Photo', groups: [], profilePhotoReadUrl: null }] }] }));
    await page.route(`${FAKE_STORAGE}/**`, route => route.fulfill({ contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [
      { ...first, catchNumber: 'Catch 99-001', anglerId: 901, anglerName: 'With Photo', catchMediaCount: 3, catchMediaProcessingCount: 1,
        createdAt: new Date().toISOString() },
      { ...first, catchNumber: 'Catch 99-002', anglerId: 902, anglerName: 'No Photo', catchMediaCount: 0, catchMediaProcessingCount: 0 },
    ] }));
    await page.goto('catches-listing.html');

    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.catch-angler-photo')).toHaveAttribute('src', `${FAKE_STORAGE}/face.jpg`);
    await expect(cards.nth(1).locator('.catch-angler-photo'), 'no empty circle without a photo').toHaveCount(0);
    // Badges ride inside the View Details button; the header keeps only 🆕
    await expect(cards.nth(0).locator('.card-button .badge-media')).toHaveText(['📷 3', '⏳']);
    await expect(cards.nth(0).locator('.catch-badges .badge-media')).toHaveCount(0);
    await expect(cards.nth(0).locator('.catch-badges')).toContainText('🆕');
    // Headers line up whether or not there's a photo
    const h = await Promise.all([0, 1].map(i => cards.nth(i).locator('.catch-card-header').evaluate(e => e.offsetHeight)));
    expect(Math.abs(h[0] - h[1]), `header heights ${h.join(' vs ')}`).toBeLessThanOrEqual(1);
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

test.describe('upload page catch card', () => {
  test('shows Caught When like the catch detail page, without a made-up 12:00 AM', async ({ page }) => {
    const [first] = await getCatches();
    const dates = await page.evaluate(() => {
      const at = (daysAgo, h, m) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(h, m, 0, 0); return d.toISOString(); };
      return { withTime: at(40, 12, 27), dateOnly: at(40, 0, 0) };
    });
    const when = page.locator('.catch-card-row:has(.catch-card-label:text("Caught When")) .catch-card-value');
    for (const [kind, caughtWhen] of Object.entries(dates)) {
      await page.unroute(url => url.pathname.endsWith('/get-catches')).catch(() => {});
      await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json: [{ ...first, caughtWhen }] }));
      await page.goto(`media-upload.html?catchNumber=${encodeURIComponent(first.catchNumber)}`);
      const text = (await when.textContent()).trim();
      if (kind === 'withTime') expect(text).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4} at 12:27 PM$/); // e.g. "September 23, 2026 at 12:27 PM"
      else expect(text, 'no time for a date-only catch').toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    }
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

// The crop tool (cropperjs 2) saves the crop at the size it's shown on screen (256 px here), not
// the photo's full resolution, so profile photos stay small. This guards that: a cropperjs
// upgrade (#29) that changed it would quietly start saving multi-megabyte profile photos.
test.describe('profile photo size', () => {
  test('a crop from a big photo is saved small (at most 800 px on its long side)', async ({ page }) => {
    await unlockAdmin(page);
    await page.route(url => url.pathname.endsWith('/anglers/get-photo-sas'), route => route.fulfill({ json: {
      uploadUrl: `${FAKE_STORAGE}/put/crop.jpg?sig=x`, readUrl: `${FAKE_STORAGE}/crop.jpg`,
      blobPath: 'anglers/1/ABCDEFGH12.jpg', contentType: 'image/jpeg' } }));
    await page.route(`${FAKE_STORAGE}/put/**`, route => route.fulfill({ status: 201, body: '' }));
    // Measures the uploaded image in the page (WebKit doesn't expose file request bodies to the test)
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      window.fetch = async (url, opts = {}) => {
        if (opts.method === 'PUT' && opts.body instanceof Blob) {
          const bmp = await createImageBitmap(opts.body);
          window.__uploadedSize = { w: bmp.width, h: bmp.height };
        }
        return realFetch(url, opts);
      };
    });
    // Read-only: answers the save itself, so nothing reaches Staging
    await page.route(url => url.pathname.endsWith('/anglers/save-photo'), route =>
      route.fulfill({ json: { success: true, readUrl: `${FAKE_STORAGE}/crop.jpg` } }));
    await page.route(`${FAKE_STORAGE}/crop.jpg`, route => route.fulfill({ contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
    await page.goto('edit-angler.html?id=1');
    await expect(page.locator('#anglerForm')).toBeVisible();

    // A 4000 x 3000 photo, made in the page (a phone camera's size)
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 4000; c.height = 3000;
      const g = c.getContext('2d');
      g.fillStyle = '#2a6'; g.fillRect(0, 0, 4000, 3000);
      g.fillStyle = '#fff'; g.fillRect(1000, 750, 2000, 1500);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'big.jpg', { type: 'image/jpeg' }));
      const input = document.getElementById('profilePhotoInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#cropModal')).toHaveClass(/open/);
    await page.locator('#cropConfirmBtn').click();
    await expect.poll(() => page.evaluate(() => window.__uploadedSize || null)).not.toBeNull();
    const { w, h } = await page.evaluate(() => window.__uploadedSize);
    expect(Math.max(w, h), `saved crop is ${w}x${h}`).toBeLessThanOrEqual(800);
    expect(Math.min(w, h)).toBeGreaterThan(100);
  });
});

