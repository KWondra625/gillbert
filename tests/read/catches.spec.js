// Layer 1, read-only: the catches listing and catch detail pages, checked against
// what the Staging API says the data is.
const { test, expect, unlockAdmin } = require('../support/fixtures');
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

  test('View Details opens that catch', async ({ page }) => {
    await page.goto('catches-listing.html');
    const first = page.locator('#catchesContainer .catch-card').first();
    const number = (await first.locator('.catch-id').textContent()).trim();
    await first.locator('.card-button').click();

    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
    await expect(page.locator('.detail-card-header h2')).toContainText(number);
  });
});

test.describe('catch detail', () => {
  test('shows the catch\'s angler, species and water', async ({ page }) => {
    const c = catches[0];
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`);
    await expect(page.locator('.detail-card-header h2')).toContainText(c.catchNumber);
    const details = page.locator('#detailsContainer');
    await expect(details).toContainText(c.anglerName);
    await expect(details).toContainText(c.fishSpeciesName);
    await expect(details).toContainText(c.bodyOfWaterName);
  });

  test('shows its photos and opens one in the lightbox', async ({ page }) => {
    const withMedia = catches.find(c => Number(c.catchMediaCount) > 0);
    test.skip(!withMedia, 'no Staging catch has media');
    await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(withMedia.catchNumber)}`);

    const tiles = page.locator('.media-tile');
    await expect(tiles.first()).toBeVisible();
    await expect(tiles).toHaveCount(Number(withMedia.catchMediaCount));

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
        if (m.contentType === 'video/mp4' && (!best || m.fileSizeInBytes < best.m.fileSizeInBytes)) best = { c, m };
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

  test('hides Edit from a visitor and shows it to an admin', async ({ page }) => {
    const c = catches[0];
    const url = `catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`;
    // Let the media load finish too: reloading mid-request cancels it, which logs an error.
    const media = page.waitForResponse(r => r.url().includes('catch-media/get'));
    await page.goto(url);
    await expect(page.locator('.detail-card-header h2')).toBeVisible();
    await expect(page.locator('#editCatchLink')).toBeHidden();
    await (await media).finished();

    await unlockAdmin(page);
    await page.goto(url);
    await expect(page.locator('#editCatchLink')).toBeVisible();
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
