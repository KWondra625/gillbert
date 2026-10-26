// Layer 3, deletes (Staging only): removing media from the TEST catch through the
// admin UI, then checking the file is really gone from storage (issue #14 is about
// the page reporting success when the file delete fails). Only ever touches media on
// catches carrying the [E2E Test] marker.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, findTestCatches } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

async function mediaFor(catchNumber) {
  const data = await apiGet(`catch-media/get?catchNumber=${encodeURIComponent(catchNumber)}`);
  return Array.isArray(data) ? data : data.media || [];
}

test('delete one photo and one video from the test catch', async ({ page }) => {
  const withMedia = [];
  for (const c of await findTestCatches()) if ((await mediaFor(c.catchNumber)).length) withMedia.push(c);
  test.skip(!withMedia.length, 'no test catch has media; run write/03-media-upload first');
  const target = withMedia[0];
  const media = await mediaFor(target.catchNumber);

  await unlockAdmin(page);
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(target.catchNumber)}`);
  await expect(page.locator('.media-tile')).toHaveCount(media.length);
  await page.locator('.manage-media-trigger').click();

  for (const kind of ['Photo', 'Video']) {
    const item = media.find(m => m.mediaType === kind);
    if (!item) continue;
    const count = await page.locator('.media-tile').count();
    await page.locator(`.media-delete-btn[data-media-id="${item.id}"]`).click();
    await expect(page.locator('#deleteMediaModal')).toBeVisible();
    await page.locator('#deleteMediaConfirm').click();
    await expect(page.locator('.media-tile')).toHaveCount(count - 1);

    expect((await mediaFor(target.catchNumber)).some(m => m.id === item.id), `${kind} row removed`).toBe(false);
    await expect.poll(async () => (await fetch(item.readUrl)).status, { message: `${kind} file removed from storage`, timeout: 20_000 })
      .toBe(404);
  }
});
