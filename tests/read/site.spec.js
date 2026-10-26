// Layer 1, read-only: home, the log-catch form, Fish of Fame, Under the Hood, the
// "me" page, and page layout at phone sizes.
const { test, expect, unlockAdmin, STAGING_HOST } = require('../support/fixtures');
const { getLookups } = require('../support/staging-api');

test.describe('home', () => {
  test('every main link opens a page that exists', async ({ page, request }) => {
    await page.goto('index.html');
    const hrefs = await page.locator('a[href$=".html"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });

  test('the Admin section stays hidden until the PIN is entered', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('#adminSection')).toBeHidden();

    const target = page.locator('#adminTapTarget');
    for (let i = 0; i < 5; i++) await target.click();
    await expect(page.locator('#adminPinModal')).toHaveClass(/open/);

    await page.locator('#adminPinInput').fill('0000');
    await page.locator('#adminPinSubmit').click();
    await expect(page.locator('#adminPinError')).toBeVisible();
    await expect(page.locator('#adminSection')).toBeHidden();

    const pin = await page.evaluate(() => ADMIN_PIN);
    await page.locator('#adminPinInput').fill(pin);
    await page.locator('#adminPinSubmit').click();
    await expect(page.locator('#adminSection')).toBeVisible();
    await expect(page.locator('#adminUnlockToast')).toBeVisible();
  });
});

test.describe('log a catch form', () => {
  test('fills its dropdowns from the lookup data', async ({ page }) => {
    const lookups = await getLookups();
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    for (const [id, list] of [['anglerId', lookups.anglers], ['fishSpeciesId', lookups.fishSpecies], ['bodyOfWaterId', lookups.bodiesOfWater]]) {
      const options = page.locator(`#${id} option:not([value=""])`);
      await expect.poll(() => options.count(), id).toBeGreaterThan(0);
      expect(await options.count(), id).toBeLessThanOrEqual(list.length);
    }
  });

  test('lists each species by its override name if it has one, else its DNR name', async ({ page }) => {
    const { fishSpecies } = await getLookups();
    expect(fishSpecies.some(s => 'displayNameOverride' in s), 'lookup data has a displayNameOverride field').toBe(true);
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    for (const s of fishSpecies) {
      await expect(page.locator(`#fishSpeciesId option[value="${s.id}"]`), s.name)
        .toHaveText(s.displayNameOverride || s.name);
    }
  });

  test('an empty form shows what\'s missing and saves nothing', async ({ page }) => {
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    await page.locator('#catchDate').fill('');
    await page.locator('#saveViewBtn').click();
    await expect(page.locator('#anglerIdError')).toHaveText('Please select an angler.');
    await expect(page.locator('#fishSpeciesIdError')).toHaveText('Please select a fish species.');
    await expect(page.locator('#bodyOfWaterIdError')).toHaveText('Please select a body of water.');
    await expect(page.locator('#catchDateError')).toHaveText('Please select a date.');
  });

  test('a zero length or depth is rejected', async ({ page }) => {
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    await page.locator('#lengthInInches').fill('0');
    await page.locator('#waterDepthInFeet').fill('0');
    await page.locator('#saveViewBtn').click();
    await expect(page.locator('#lengthInInchesError')).toHaveText('Length must be greater than 0.');
    await expect(page.locator('#waterDepthInFeetError')).toHaveText('Water depth must be greater than 0.');
  });
});

test.describe('Fish of Fame', () => {
  test('shows the top catches, species records and top anglers', async ({ page }) => {
    await page.goto('fish-of-fame.html');
    for (const list of ['#topCatchesList', '#fishSpeciesRecordsList', '#topAnglersList']) {
      await expect(page.locator(`${list} .rank-row`).first(), list).toBeVisible();
    }
  });

  test('a top catch links to its detail page', async ({ page }) => {
    await page.goto('fish-of-fame.html');
    await page.locator('#topCatchesList .rank-row').first().click();
    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
    await expect(page.locator('.detail-card-header h2')).toBeVisible();
  });

  test('the group pills switch which anglers count', async ({ page }) => {
    await page.goto('fish-of-fame.html');
    const pills = page.locator('#groupFilter .group-filter-btn');
    await expect(page.locator('#topCatchesList .rank-row').first()).toBeVisible();
    test.skip(await pills.count() < 2, 'no angler groups on Staging');
    await pills.nth(1).click();
    await expect(pills.nth(1)).toHaveClass(/active/);
    await pills.first().click();
    await expect(pills.first()).toHaveClass(/active/);
  });
});

test.describe('Under the Hood', () => {
  test('reports the Staging server as healthy', async ({ page }) => {
    await unlockAdmin(page);
    await page.goto('under-the-hood.html');
    await expect(page.locator('#verdict')).toHaveClass(/verdict--pass/);
    await expect(page.locator('#verdict')).toContainText(STAGING_HOST);
  });
});

test.describe('me page', () => {
  test('says there\'s no Cloudflare login on a local copy', async ({ page }) => {
    await page.goto('me.html');
    await expect(page.locator('#identityContent')).not.toHaveText('Checking…');
  });
});

test.describe('phone layout', () => {
  for (const path of ['index.html', 'catches-listing.html', 'fish-of-fame.html', 'log-catch.html', 'catch-chat.html', 'ask-gillbert.html']) {
    test(`${path} doesn't scroll sideways`, async ({ page }) => {
      test.skip(!test.info().project.name.match(/android|iphone/), 'phone projects only');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
