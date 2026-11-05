// Layer 2, create and clean up (Staging only): the upload steps only accept what they
// should. Upload slots are only issued for real catch numbers and known file types, and
// a commit only accepts the exact path shape the slot step issues, for that catch, with
// the public link set by the server. Both servers have these checks since 2026-11-04.
const { test, expect } = require('../support/fixtures');
const { getCatchMedia } = require('../support/staging-api');
const { requireStagingWrites, ensureTestCatch, apiPost } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const rejected = promise => promise.then(() => 'accepted', () => 'rejected');
const file = (name, type) => ({ name, size: 1000, type });

let target;
test.beforeAll(async () => { target = await ensureTestCatch(); });

test('upload slots: issued for a real catch and a known file type', async () => {
  const data = await apiPost('catch-media/get-sas', { catchNumber: target.catchNumber, files: [file('a.jpg', 'image/jpeg')] });
  const [slot] = data.uploads;
  expect(slot.blobPath).toMatch(new RegExp(`^catches/${target.catchNumber.replace(/\s+/g, '-')}/[A-Z0-9]{8,24}\\.jpg$`));
});

test('upload slots: refused for unknown file types and malformed catch numbers', async () => {
  for (const name of ['a.exe', 'a.svg', 'no-extension', "a.jp'g"]) {
    expect(await rejected(apiPost('catch-media/get-sas', { catchNumber: target.catchNumber, files: [file(name, '')] })), name)
      .toBe('rejected');
  }
  for (const catchNumber of ['Catch 26-14x', 'Catch 26-146/../x', 'Not a catch']) {
    expect(await rejected(apiPost('catch-media/get-sas', { catchNumber, files: [file('a.jpg', 'image/jpeg')] })), catchNumber)
      .toBe('rejected');
  }
});

test('commit: refused for a path the slot step would never issue', async () => {
  const folder = target.catchNumber.replace(/\s+/g, '-');
  const bad = [
    `catches/${folder}/../E2EBADPATH0001.jpg`,
    `catches/${folder}/E2E BAD PATH.jpg`,
    `catches/${folder}/E2EBADPATH0002.exe`,
    `catches/Catch-99-999/E2EBADPATH0003.jpg`,          // someone else's catch
    `elsewhere/${folder}/E2EBADPATH0004.jpg`,
  ];
  const before = (await getCatchMedia(target.catchNumber)).length;
  for (const blobPath of bad) {
    const upload = { blobPath, readUrl: 'https://example.com/x.jpg', contentType: 'image/jpeg', originalName: 'x.jpg', size: 1, mediaType: 'Photo' };
    expect(await rejected(apiPost('catch-media/commit', { catchNumber: target.catchNumber, uploadedByAnglerId: null, uploads: [upload] })), blobPath)
      .toBe('rejected');
  }
  expect((await getCatchMedia(target.catchNumber)).length, 'no media rows were created').toBe(before);
});

test('commit: the server sets the public link and type, whatever the browser sends', async () => {
  const folder = target.catchNumber.replace(/\s+/g, '-');
  const blobPath = `catches/${folder}/E2ESERVERLINK01.png`;
  await apiPost('catch-media/commit', {
    catchNumber: target.catchNumber, uploadedByAnglerId: null,
    uploads: [{ blobPath, readUrl: 'https://example.com/elsewhere.png', contentType: 'text/html', originalName: 'x.png', size: 1, mediaType: 'Video' }],
  });
  const row = (await getCatchMedia(target.catchNumber)).find(m => m.blobPath === blobPath);
  expect(row.readUrl).toBe(`https://${process.env.STAGING_STORAGE_ACCOUNT}.blob.core.windows.net/catch-media/${blobPath}`);
  expect(row.contentType).toBe('image/png');
  expect(row.mediaType).toBe('Photo');

  // The record points at a file that was never uploaded: remove it through the app, so the
  // delete layer's media test (which looks for real photos and videos) doesn't pick it up
  await apiPost('catch-media/delete', { mediaId: row.id });
  expect((await getCatchMedia(target.catchNumber)).some(m => m.blobPath === blobPath), 'the test record is gone').toBe(false);
});
