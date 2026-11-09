// Layer 1, read-only: the catches listing and catch detail pages, checked against
// what the Staging API says the data is.
const { test, expect, unlockAdmin, STAGING_STORAGE_HOST } = require('../support/fixtures');
const { getCatches, getLookups, getCatchMedia } = require('../support/staging-api');

const PER_PAGE = 24;
let catches;

test.beforeAll(async () => {
  catches = await getCatches();
  expect(catches.length, 'Staging should have catches to test with').toBeGreaterThan(0);
});

// Searches once the first page has rendered, and waits for the search's own response.
// (Searching while the initial load is still in flight lets that slower, unfiltered
// response land last and replace the search results.)
async function search(page, term) {
  const response = page.waitForResponse(r => r.url().includes('get-catches?search='));
  await page.locator('#searchInput').fill(term);
  await page.locator('#searchBtn').click();
  await response;
}

test.describe('catches listing', () => {
  test('shows the first page of catches and pages through them', async ({ page }) => {
    await page.goto('catches-listing.html');
    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards).toHaveCount(Math.min(PER_PAGE, catches.length));

    const pages = Math.ceil(catches.length / PER_PAGE);
    test.skip(pages < 2, 'Staging has only one page of catches');
    await expect(page.locator('#pageInfo')).toHaveText(`Page 1 of ${pages}`);
    await expect(page.locator('#prevBtn')).toBeDisabled();

    await page.locator('#nextBtn').click();
    await expect(page.locator('#pageInfo')).toHaveText(`Page 2 of ${pages}`);
    await expect(cards).toHaveCount(Math.min(PER_PAGE, catches.length - PER_PAGE));
  });

  test('search narrows the list to matching catches', async ({ page }) => {
    // Search for an angler name with fewer catches than the whole set.
    const counts = {};
    for (const c of catches) counts[c.anglerName] = (counts[c.anglerName] || 0) + 1;
    const [name] = Object.entries(counts).sort((a, b) => a[1] - b[1])[0];

    await page.goto('catches-listing.html');
    await expect(page.locator('#catchesContainer .catch-card').first()).toBeVisible();
    await search(page, name);

    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards).toHaveCount(Math.min(PER_PAGE, counts[name]));
    for (const card of await cards.all()) await expect(card).toContainText(name);
  });

  test('a search typed during the first load still shows its own results', async ({ page }) => {
    // Hold back the first, unfiltered load so it lands after the search does.
    await page.route(url => url.pathname.endsWith('/get-catches') && !url.search, async route => {
      await new Promise(r => setTimeout(r, 3_000));
      await route.continue();
    });
    const firstLoad = page.waitForResponse(r => /\/get-catches$/.test(r.url()), { timeout: 30_000 });
    const searched = page.waitForResponse(r => r.url().includes('get-catches?search='), { timeout: 30_000 });
    await page.goto('catches-listing.html');
    await page.locator('#searchInput').fill('zzqx-no-such-catch');
    await page.locator('#searchBtn').click();
    await Promise.all([firstLoad, searched]);

    await expect(page.locator('.no-results-banner')).toContainText('No catches match');
    await expect(page.locator('#catchesContainer .catch-card')).toHaveCount(0);
  });

  test('a search with no matches says so', async ({ page }) => {
    await page.goto('catches-listing.html');
    await expect(page.locator('#catchesContainer .catch-card').first()).toBeVisible();
    await search(page, 'zzqx-no-such-catch');
    await expect(page.locator('.no-results-banner')).toContainText('No catches match');
  });

  test('the angler filter shows only that angler\'s catches', async ({ page }) => {
    const name = catches[0].anglerName;
    const expected = catches.filter(c => c.anglerName === name).length;

    await page.goto('catches-listing.html');
    await expect(page.locator('#catchesContainer .catch-card').first()).toBeVisible();
    await page.locator('#filterAnglerChip').click();
    await page.locator(`#filterAnglerDropdown .filter-option[data-value="${name}"]`).click();

    await expect(page.locator('#filterSummary')).toBeVisible();
    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards).toHaveCount(Math.min(PER_PAGE, expected));
    for (const card of await cards.all()) await expect(card).toContainText(name);

    await page.locator('#filterClearAll').click();
    await expect(cards).toHaveCount(Math.min(PER_PAGE, catches.length));
  });

  test('the species filter offers every species that has catches, by its display name', async ({ page }) => {
    // Catches carry a species' display name (e.g. an override like "Musky"), so the
    // filter has to use the same names or those species can't be picked at all.
    const expected = [...new Set(catches.map(c => c.fishSpeciesName))].sort();
    await page.goto('catches-listing.html');
    await expect(page.locator('#catchesContainer .catch-card').first()).toBeVisible();
    const options = page.locator('#filterSpeciesDropdown .filter-option:not([data-value=""])');
    await expect.poll(async () => (await options.evaluateAll(os => os.map(o => o.dataset.value))).sort())
      .toEqual(expected);

    // Picking a species shows exactly its catches: one with an override name and one
    // without, when Staging's catches include both kinds.
    const { fishSpecies } = await getLookups();
    const caught = fishSpecies.filter(s => expected.includes(s.displayNameOverride || s.name));
    const picks = [
      caught.find(s => s.displayNameOverride)?.displayNameOverride,
      caught.find(s => !s.displayNameOverride)?.name,
    ];
    if (!picks[0]) test.info().annotations.push({ type: 'note', description: 'no caught species has an override name' });
    for (const name of picks.filter(Boolean)) {
      await page.locator('#filterSpeciesChip').click();
      await page.locator(`#filterSpeciesDropdown .filter-option[data-value="${name}"]`).click();
      await expect(page.locator('#catchesContainer .catch-card'), name)
        .toHaveCount(Math.min(PER_PAGE, catches.filter(c => c.fishSpeciesName === name).length));
    }
  });

  test('tapping a card opens that catch', async ({ page }) => {
    await page.goto('catches-listing.html');
    const first = page.locator('#catchesContainer .catch-card').first();
    const number = (await first.locator('.catch-id').textContent()).trim();
    await first.click();

    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
    await expect(page.locator('#catchTitle')).toContainText(number);
  });
});

test.describe('catch card dates', () => {
  // Built in the browser's own time zone, so "Today"/"Yesterday" and the time match what it shows
  test('cards sit in day groups and show only what the heading doesn\'t', async ({ page }) => {
    const dates = await page.evaluate(() => {
      const at = (daysAgo, h, m) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(h, m, 0, 0); return d.toISOString(); };
      return { today: at(0, 0, 5), todayNoTime: at(0, 0, 0), yesterday: at(1, 6, 10), old: at(400, 13, 15) };
    });
    const [first] = catches;
    const order = ['today', 'todayNoTime', 'yesterday', 'old'];
    await page.route(url => url.pathname.endsWith('/get-catches'), route => route.fulfill({ json:
      order.map((k, i) => ({ ...first, catchNumber: `Catch 99-00${i}`, caughtWhen: dates[k] })) }));
    await page.goto('catches-listing.html');

    const groups = page.locator('#catchesContainer .catch-group');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0).locator('.catch-group-head')).toHaveText(/^Today\s*2 catches$/);
    await expect(groups.nth(1).locator('.catch-group-head')).toHaveText(/^Yesterday\s*1 catch$/);
    await expect(groups.nth(2).locator('.catch-group-head')).toHaveText(/^[A-Z][a-z]+ \d{4}\s*1 catch$/); // e.g. "October 2025"

    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards.nth(0).locator('.catch-when')).toHaveText('· 12:05 AM');            // today: just the time
    await expect(cards.nth(1).locator('.catch-when')).toHaveCount(0);                      // no time given: nothing made up
    await expect(cards.nth(2).locator('.catch-when')).toHaveText('· 6:10 AM');
    await expect(cards.nth(3).locator('.catch-when')).toHaveText(/^· [A-Z][a-z]{2} \d{1,2}$/); // older: the day; the year is in the heading
  });
});

test.describe('catch detail', () => {
  test('shows the catch\'s angler, species and water', async ({ page }) => {
    const c = catches[0];
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`);
    await expect(page.locator('#catchTitle')).toContainText(c.catchNumber);
    const details = page.locator('#detailsContainer');
    await expect(details).toContainText(c.anglerName);
    await expect(details).toContainText(c.fishSpeciesName);
    await expect(details).toContainText(c.bodyOfWaterName);
    // The summary leads with who, the fish and where; its rows aren't repeated below
    const summary = page.locator('.catch-summary');
    await expect(summary.locator('.summary-who')).toHaveText(`Caught by ${c.anglerName} on ${c.bodyOfWaterName}`);
    await expect(summary.locator('.summary-fish')).toContainText(c.fishSpeciesName);
    await expect(page.locator('.detail-row .detail-label', { hasText: 'Angler' })).toHaveCount(0);
  });

  test('shows its photos and opens one in the lightbox', async ({ page }) => {
    const withMedia = catches.find(c => Number(c.catchMediaCount) > 0);
    test.skip(!withMedia, 'no Staging catch has media');
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(withMedia.catchNumber)}`);

    // One tile per file, including ⏳ converting and ⚠️ failed ones
    const all = await getCatchMedia(withMedia.catchNumber);
    const tiles = page.locator('.media-tile');
    await expect(tiles.first()).toBeVisible();
    await expect(tiles).toHaveCount(all.length);

    const photo = page.locator('.media-tile--photo').first();
    test.skip(await photo.count() === 0, 'that catch only has videos');
    await photo.click();
    await expect(page.locator('#lightbox')).toBeVisible();
    await page.locator('#lightboxClose').click();
    await expect(page.locator('#lightbox')).toBeHidden();
  });

  test('a video opens in the lightbox and starts playing', async ({ page }) => {
    // The smallest MP4 on Staging, so each run downloads as little as possible.
    let best = null;
    for (const c of catches.filter(c => Number(c.catchMediaCount) > 0)) {
      for (const m of await getCatchMedia(c.catchNumber)) {
        if (m.contentType === 'video/mp4' && m.displayStatus === 'complete' && (!best || m.fileSizeInBytes < best.m.fileSizeInBytes)) best = { c, m };
      }
    }
    test.skip(!best, 'no Staging catch has an MP4 video');
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(best.c.catchNumber)}`);
    await page.locator(`.media-tile--video[data-media-id="${best.m.id}"]`).click();

    const video = page.locator('#lightboxVideo');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', best.m.readUrl);
    // Ready to play means the browser fetched and decoded it, not just showed the box.
    await expect.poll(() => video.evaluate(v => v.error ? `error ${v.error.code}` : v.readyState), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    expect(await video.evaluate(v => v.duration)).toBeGreaterThan(0);
    await page.locator('#lightboxClose').click();
    await expect(page.locator('#lightbox')).toBeHidden();
  });

  test("a video's delete preview shows a frame, not a black box", async ({ page }) => {
    // A video in Staging's own storage (which answers range requests); read-only: cancelled
    let target = null;
    for (const c of catches.filter(c => Number(c.catchMediaCount) > 0)) {
      const v = (await getCatchMedia(c.catchNumber)).find(m => m.mediaType === 'Video' && m.displayStatus === 'complete'
        && m.readUrl.includes(STAGING_STORAGE_HOST));
      if (v) { target = { c, v }; break; }
    }
    test.skip(!target, 'no video in Staging storage');
    await unlockAdmin(page);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(target.c.catchNumber)}`);
    const tile = page.locator(`.media-tile--video[data-media-id="${target.v.id}"]`);
    await page.locator('#moreBtn').click();
    await page.locator('#manageMediaBtn').click(); // Manage Media (under More) shows the delete buttons
    await tile.locator('.media-delete-btn').click();

    const preview = page.locator('#deleteMediaModal video');
    // Every browser: the preview loads (a browser that refuses "#t=0.1" falls back to the plain URL)
    await expect.poll(() => preview.evaluate(v => v.error ? `error ${v.error.code}` : v.readyState >= 1),
      { timeout: 30_000 }).toBe(true);
    // Chrome (desktop + Android): it jumped to 0.1 s and has that frame ready, so no black box.
    // Playwright's WebKit refuses the fragment; real Safari supports it but can't be checked here.
    if (test.info().project.name !== 'iphone-safari') {
      await expect.poll(() => preview.evaluate(v => v.readyState >= 2 && v.currentTime > 0), { timeout: 30_000 }).toBe(true);
    }
    await page.locator('#deleteMediaCancel').click();
  });

  test('Upload Media and Edit pass along where you came from, so the way back keeps it', async ({ page }) => {
    const c = catches[0];
    await unlockAdmin(page);
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=list`);
    await expect(page.locator('.detail-upload-btn')).toHaveAttribute('href', /&from=list$/);
    await expect(page.locator('#editCatchLink')).toHaveAttribute('href', /&from=list$/);
    // Edit's Cancel leads back to the catch with the same back button target
    await page.goto(`edit-catch.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=list`);
    await expect(page.locator('#cancelLink')).toHaveAttribute('href', /catch-details\.html\?catchNumber=.*&from=list$/);
    await page.locator('#cancelLink').click();
    await expect(page.locator('.topbar-back')).toHaveAttribute('href', './catches-listing.html');
    await expect(page.locator('.topbar-back')).toHaveText('‹ Catches');
  });

  test('hides Edit from a visitor and shows it to an admin', async ({ page }) => {
    const c = catches[0];
    const url = `catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`;
    // Let the media load finish too: reloading mid-request cancels it, which logs an error.
    const media = page.waitForResponse(r => r.url().includes('catch-media/get'));
    await page.goto(url);
    await expect(page.locator('#catchTitle')).toBeVisible();
    await expect(page.locator('#editCatchLink')).toBeHidden();
    await (await media).finished();

    await unlockAdmin(page);
    await page.goto(url);
    await expect(page.locator('#editCatchLink')).toBeVisible();
  });

  test('a visitor gets Record info at the bottom; an admin gets More with verify, manage media and record info', async ({ page }) => {
    const c = catches[0];
    const url = `catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`;
    const media = page.waitForResponse(r => r.url().includes('catch-media/get'));
    await page.goto(url);
    // Anyone: "Add photos" in the media heading, Record info straight away, no More
    await expect(page.locator('#mediaContainer .detail-section-label .detail-upload-btn')).toBeVisible();
    await expect(page.locator('#moreBtn')).toHaveCount(0);
    await page.locator('#recordInfoTrigger').click();
    await expect(page.locator('#recordInfoModal')).toHaveClass(/open/);
    await page.locator('#recordInfoClose').click();
    await (await media).finished();

    await unlockAdmin(page);
    await page.goto(url);
    await expect(page.locator('#recordInfoTrigger')).toBeHidden(); // it lives inside More now
    await page.locator('#moreBtn').click();
    await expect(page.locator('#moreModal')).toHaveClass(/open/);
    await expect(page.locator('#moreModal .more-item b')).toHaveText([/^(Verify|Unverify)$/, 'Manage media', 'Record info']);
    // Manage media closes More and swaps "Add photos" for "Done" in the media heading
    await page.locator('#manageMediaBtn').click();
    await expect(page.locator('#moreModal')).not.toHaveClass(/open/);
    await expect(page.locator('#manageMediaDone')).toBeVisible();
    await expect(page.locator('#mediaContainer .detail-upload-btn')).toBeHidden();
    await page.locator('#manageMediaDone').click();
    await expect(page.locator('#mediaContainer .detail-upload-btn')).toBeVisible();
  });

  test('Edit Catch lists each species by its override name if it has one, else its DNR name', async ({ page }) => {
    const { fishSpecies } = await getLookups();
    await unlockAdmin(page);
    await page.goto(`edit-catch.html?catchNumber=${encodeURIComponent(catches[0].catchNumber)}`);
    await expect(page.locator('#catchForm')).toBeVisible();
    for (const s of fishSpecies) {
      await expect(page.locator(`#fishSpeciesId option[value="${s.id}"]`), s.name)
        .toHaveText(s.displayNameOverride || s.name);
    }
  });

  test('an unknown catch number shows an error, not a blank page', async ({ page }) => {
    await page.goto('catch-details.html?catchNumber=Catch%2099-999');
    await expect(page.locator('#status')).not.toBeEmpty();
  });
});
