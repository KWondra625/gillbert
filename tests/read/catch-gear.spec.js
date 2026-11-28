// Layer 1, read-only: "Caught on" and "Bait" on Log a Catch, Edit Catch and the catch page
// (gear stage 2). Everything the pages ask for is answered here in the browser, and the save
// is checked by what the page sends; the database side (which setup version a catch gets) is
// tested on Staging by scripts/gear/05_check_catch_gear.sql.
const { test, expect } = require('../support/fixtures');

const ME = 'kurt@example.test';
const ANGLERS = [
  { id: 1, name: 'Kurt W', loginEmails: [ME] },
  { id: 3, name: 'Dave T', loginEmails: [] },
];
const LOOKUPS = {
  anglers: ANGLERS,
  fishSpecies: [{ id: 5, name: 'Northern Pike', displayNameOverride: null }],
  bodiesOfWater: [{ id: 2, name: 'Lake Winnebago' }],
};

function tipUp(id, name, overrides = {}) {
  return {
    id, gearType: 'tip_up', name, ownerAnglerId: 1, ownerName: 'Kurt W', status: 'Active', catchCount: 0,
    setup: { versionNo: 1, line: 'Dacron 30 lb', leader: null, hook: '#8 Octopus', beads: ['Glow'], flash: [] },
    ...overrides,
  };
}
const TIP_UPS = [
  tipUp(7, 'KW 24-01'),
  tipUp(8, 'DT 22-01', { ownerAnglerId: 3, ownerName: 'Dave T', setup: null }),
  tipUp(9, 'KW 24-03', { status: 'Retired' }),
];
const OPTIONS = { bait: ['Not sure', 'Shiner (medium)', 'Sucker (large)'] };

const CATCH = {
  id: 501, catchNumber: 'Catch 26-501', anglerId: 1, anglerName: 'Kurt W', createdByAnglerId: 1,
  fishSpeciesId: 5, fishSpeciesName: 'Northern Pike', bodyOfWaterId: 2, bodyOfWaterName: 'Lake Winnebago',
  caughtWhen: '2027-01-09T14:30:00Z', length: 31, waterDepth: 12, notes: null, verifiedAt: null,
  caughtOn: { gearId: 9, name: 'KW 24-03', status: 'Retired', versionNo: 1, line: 'Dacron 30 lb', leader: null,
              hook: '#10 Treble', beads: ['Red'], flash: ['Gold blade'] },
  bait: 'Sucker (large)',
};

// Answers the lookups, gear/get, the catch and the save; the save's body lands in state.saves
async function mockCatchPages(page, state = {}) {
  state.saves = [];
  await page.route(url => url.pathname.endsWith('/gillbert/get-lookup-data'), route => route.fulfill({ json: LOOKUPS }));
  await page.route(url => url.pathname.endsWith('/gillbert/gear/get'), route => state.gearDown
    ? route.fulfill({ status: 500, body: '' })
    : route.fulfill({ json: { tipUps: TIP_UPS, options: OPTIONS, history: null } }));
  await page.route(url => url.pathname.endsWith('/gillbert/get-catches'), route =>
    route.fulfill({ json: [state.catch || CATCH] }));
  await page.route(url => url.pathname.endsWith('/gillbert/catch-media/get'), route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname.endsWith('/gillbert/catch/commit'), route => {
    state.saves.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, catch_id: 501, catch_number: 'Catch 26-501' } });
  });
  return state;
}

async function fillRequired(page) {
  await page.locator('#anglerId').selectOption('1');
  await page.locator('#fishSpeciesId').selectOption('5');
  await page.locator('#bodyOfWaterId').selectOption('2');
}

test.describe('Log a Catch: Caught on and Bait', () => {
  test('Caught on matches by name or owner, the angler\'s own first, and shows the setup', async ({ page }) => {
    await mockCatchPages(page);
    await page.goto('log-catch.html');
    await expect(page.locator('#gearGroup')).toBeVisible();
    const matches = page.locator('#gearSuggestions .tag-suggestion');
    await page.locator('#anglerId').selectOption('3');
    await page.locator('#gearSearch').focus();
    await expect(matches).toHaveText(['DT 22-01 · Dave T', 'KW 24-01 · Kurt W']); // retired left out
    await page.locator('#gearSearch').fill('kw');
    await expect(matches).toHaveText(['KW 24-01 · Kurt W']);
    await matches.first().click();
    await expect(page.locator('#gearSearch')).toHaveValue('KW 24-01');
    await expect(page.locator('#gearHint')).toHaveText('Setup now: Dacron 30 lb · #8 Octopus · Glow');

    await page.locator('#gearSearch').fill('dave');
    await expect(page.locator('#gearHint')).toBeHidden();
    await matches.first().click();
    await expect(page.locator('#gearHint')).toHaveText('No setup entered yet');

    await page.locator('#gearSearch').fill('zz');
    await expect(page.locator('#gearSuggestions')).toContainText('No tip-up matches "zz"');
    await page.locator('#bait').focus();                         // not a tip-up: goes back to the pick
    await expect(page.locator('#gearSearch')).toHaveValue('DT 22-01');
  });

  test('saving sends the tip-up and the bait, spelled like the existing choice', async ({ page }) => {
    const state = await mockCatchPages(page);
    await page.goto('log-catch.html');
    await fillRequired(page);
    await page.locator('#gearSearch').fill('24-01');
    await page.locator('#gearSuggestions .tag-suggestion').first().click();
    await page.locator('#bait').fill('shiner');
    await page.locator('#baitSuggestions .tag-suggestion', { hasText: 'Shiner (medium)' }).click();
    await page.locator('#saveViewBtn').click();
    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=Catch%2026-501/);
    expect(state.saves[0]).toMatchObject({ anglerId: 1, gearId: 7, bait: 'Shiner (medium)' });
  });

  test('left blank, it sends no tip-up and no bait; Save and Add Another clears them', async ({ page }) => {
    const state = await mockCatchPages(page);
    await page.goto('log-catch.html');
    await fillRequired(page);
    await page.locator('#saveAnotherBtn').click();
    await expect(page.locator('#successBanner')).toBeVisible();
    expect(state.saves[0]).toMatchObject({ gearId: null, bait: null });

    await fillRequired(page);
    await page.locator('#gearSearch').fill('KW 24-01');            // typed in full, no pick: still counts
    await page.locator('#bait').fill('Minnow');
    await page.locator('#saveAnotherBtn').click();
    await expect.poll(() => state.saves.length).toBe(2);
    expect(state.saves[1]).toMatchObject({ gearId: 7, bait: 'Minnow' });
    await expect(page.locator('#gearSearch')).toHaveValue('');
    await expect(page.locator('#bait')).toHaveValue('');
  });

});

test.describe('Log a Catch when the tip-up list is down', () => {
  test.use({ allowConsoleErrors: true }); // the browser logs the 500 it's answered with

  test('the form still works, without Caught on and Bait', async ({ page }) => {
    const state = await mockCatchPages(page, { gearDown: true });
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    await expect(page.locator('#gearGroup')).toBeHidden();
    await expect(page.locator('#baitGroup')).toBeHidden();
    await fillRequired(page);
    await page.locator('#saveViewBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect(state.saves[0]).not.toHaveProperty('gearId');
    expect(state.saves[0]).not.toHaveProperty('bait');
  });
});

test.describe('Edit Catch: Caught on and Bait', () => {
  test.use({ identityEmail: ME });

  test('opens with the catch\'s tip-up (even retired), its setup as caught, and the bait', async ({ page }) => {
    const state = await mockCatchPages(page);
    await page.goto('edit-catch.html?catchNumber=Catch%2026-501');
    await expect(page.locator('#catchForm')).toBeVisible();
    await expect(page.locator('#gearSearch')).toHaveValue('KW 24-03 (retired)');
    await expect(page.locator('#gearHint')).toHaveText('Setup when caught: Dacron 30 lb · #10 Treble · Red · Gold blade');
    await expect(page.locator('#bait')).toHaveValue('Sucker (large)');

    await page.locator('#gearSearch').fill('24-01');
    await page.locator('#gearSuggestions .tag-suggestion').first().click();
    await expect(page.locator('#gearHint')).toHaveText('Setup now: Dacron 30 lb · #8 Octopus · Glow');
    await page.locator('#bait').fill('');
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect(state.saves[0]).toMatchObject({ catchId: 501, gearId: 7, bait: null });
  });

  test('saved untouched, it keeps the retired tip-up and the bait', async ({ page }) => {
    const state = await mockCatchPages(page);
    await page.goto('edit-catch.html?catchNumber=Catch%2026-501');
    await expect(page.locator('#gearSearch')).toHaveValue('KW 24-03 (retired)');
    await page.locator('#gearSearch').focus();
    await expect(page.locator('#gearSuggestions')).toBeHidden();   // its own pick, not "No tip-up matches"
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect(state.saves[0]).toMatchObject({ catchId: 501, gearId: 9, bait: 'Sucker (large)' });
  });

  test('clearing Caught on sends no tip-up; Enter in the empty box picks nothing', async ({ page }) => {
    const state = await mockCatchPages(page);
    await page.goto('edit-catch.html?catchNumber=Catch%2026-501');
    await expect(page.locator('#gearSearch')).toHaveValue('KW 24-03 (retired)');
    await page.locator('#gearSearch').fill('');
    await page.locator('#gearSearch').press('Enter');
    await expect(page.locator('#gearSearch')).toHaveValue('');
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect(state.saves[0]).toMatchObject({ catchId: 501, gearId: null });
  });
});

test.describe('Edit Catch when the tip-up list is down', () => {
  test.use({ identityEmail: ME, allowConsoleErrors: true });

  test('the save leaves the catch\'s tip-up and bait alone (sends neither)', async ({ page }) => {
    const state = await mockCatchPages(page, { gearDown: true });
    await page.goto('edit-catch.html?catchNumber=Catch%2026-501');
    await expect(page.locator('#catchForm')).toBeVisible();
    await expect(page.locator('#gearGroup')).toBeHidden();
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect(state.saves[0]).not.toHaveProperty('gearId');
    expect(state.saves[0]).not.toHaveProperty('bait');
  });
});

test.describe('catch page: Caught on', () => {
  test('shows the tip-up, its setup as caught, and the bait', async ({ page }) => {
    await mockCatchPages(page);
    await page.goto('catch-details.html?catchNumber=Catch%2026-501');
    const row = page.locator('.detail-row', { hasText: 'Caught on' });
    await expect(row.locator('.caught-on-link')).toHaveText('KW 24-03');
    await expect(row.locator('.caught-on-link')).toHaveAttribute('href', './gear-tipup.html?id=9');
    await expect(row.locator('.caught-on-retired')).toHaveText('(retired)');
    await expect(row.locator('.caught-on-setup')).toHaveText('Dacron 30 lb · #10 Treble · Red · Gold blade');
    await expect(page.locator('.detail-row', { hasText: 'Bait' }).locator('.detail-value')).toHaveText('Sucker (large)');
  });

  test('a catch with no tip-up or bait shows neither row', async ({ page }) => {
    await mockCatchPages(page, { catch: { ...CATCH, caughtOn: null, bait: null } });
    await page.goto('catch-details.html?catchNumber=Catch%2026-501');
    await expect(page.locator('.catch-summary')).toBeVisible();
    await expect(page.locator('.detail-row', { hasText: 'Caught on' })).toHaveCount(0);
    await expect(page.locator('.detail-row', { hasText: 'Bait' })).toHaveCount(0);
  });
});

test.describe('tip-up page: View Catches', () => {
  const ON_7 = { ...CATCH, id: 502, catchNumber: 'Catch 26-502', caughtOn: { ...CATCH.caughtOn, gearId: 7, name: 'KW 24-01', status: 'Active' } };
  const NO_GEAR = { ...CATCH, id: 503, catchNumber: 'Catch 26-503', caughtOn: null };

  async function mockTipUpAndList(page, catchCount) {
    await page.route(url => url.pathname.endsWith('/gillbert/get-lookup-data'), route => route.fulfill({ json: LOOKUPS }));
    await page.route(url => url.pathname.endsWith('/gillbert/gear/get'), route =>
      route.fulfill({ json: { tipUps: [{ ...TIP_UPS[0], catchCount }], options: OPTIONS, history: [] } }));
    await page.route(url => url.pathname.endsWith('/gillbert/get-catches'), route =>
      route.fulfill({ json: [ON_7, NO_GEAR, CATCH] }));
  }

  test('opens the catches list filtered to the tip-up; the chip takes the filter off', async ({ page }) => {
    await mockTipUpAndList(page, 1);
    await page.goto('gear-tipup.html?id=7');
    const link = page.locator('#viewCatchesLink');
    await expect(link).toHaveText('🎣 View 1 Catch');
    await link.click();
    await expect(page).toHaveURL(/catches-listing\.html/);
    const cards = page.locator('#catchesContainer .catch-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('26-502');
    await expect(page.locator('#filterGearChip')).toContainText('Caught on');
    await expect(page.locator('#filterGearValue')).toHaveText(': KW 24-01');
    await expect(page.locator('#filterSummaryText')).toContainText('Showing 1 of 3');
    await expect(page.locator('#bottomBackLink')).toHaveText('← Back to KW 24-01');

    await page.locator('#filterGearChip').click();
    await expect(page.locator('#filterGearWrapper')).toBeHidden();
    await expect(cards).toHaveCount(3);
  });

  test('with no catches yet it is greyed out and goes nowhere', async ({ page }) => {
    await mockTipUpAndList(page, 0);
    await page.goto('gear-tipup.html?id=7');
    const link = page.locator('#viewCatchesLink');
    await expect(link).toHaveText('🎣 No Catches Yet');
    await expect(link).toHaveClass(/view-catches-link--empty/);
    await link.click({ force: true });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7$/);
  });

  test('the catches list shows no Caught on chip on a plain visit', async ({ page }) => {
    await mockTipUpAndList(page, 1);
    await page.goto('catches-listing.html');
    await expect(page.locator('#catchesContainer .catch-card')).toHaveCount(3);
    await expect(page.locator('#filterGearWrapper')).toBeHidden();
  });
});
