// Layer 1, read-only: the Gear Stats page (gear stage 4). The stats call is answered here in the
// browser; what the numbers mean (versions, No beads, filters) is checked in the database by
// scripts/gear/10_check_gear_stats.sql.
const { test, expect } = require('../support/fixtures');

const big = (length, species, angler) => ({ catchNumber: 'Catch 26-101', length, species, angler, caughtWhen: '2026-12-14T15:00:00Z' });
const row = (id, name, fish, extra = {}) => ({ id, name, owner: null, none: false, fish, biggest: null, ...extra });

const STATS = {
  fish: 9, tipUps: 3,
  waters: [{ id: 5, name: 'Lake Kegonsa' }, { id: 6, name: 'Lake Waubesa' }],
  species: [{ id: 2, name: 'Northern Pike' }, { id: 3, name: 'Walleye' }],
  sections: {
    tipUp: [
      row(7, 'KW 24-01', 4, { owner: 'Kurt W', biggest: big(36, 'Northern Pike', 'Kurt W') }),
      row(9, 'DT 22-03', 3, { owner: 'Dave T' }),
      row(8, 'KW 24-02', 2, { owner: 'Kurt W' }),
    ],
    bait: [row(21, 'Sucker (medium)', 6), row(22, 'Shiner (large)', 2), row(23, 'Not sure', 1)],
    hook: [1, 2, 3, 4, 5, 6, 7].map(n => row(30 + n, `Hook ${n}`, 8 - n)),
    line: [], leader: [],
    bead: [row(null, 'No beads', 5, { none: true }), row(41, 'Glow', 4)],
    flash: [],
  },
};

async function mockStats(page, data = STATS) {
  const calls = [];
  await page.route(url => url.pathname.endsWith('/gillbert/gear/stats'), route => {
    calls.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({ json: data });
  });
  return calls;
}

test('the Gear page links to Stats', async ({ page }) => {
  await page.route(url => url.pathname.endsWith('/gillbert/gear/get'), route => route.fulfill({ json: { tipUps: [], options: {} } }));
  await page.goto('gear.html');
  await expect(page.locator('#statsBtn')).toHaveAttribute('href', './gear-stats.html');
});

test('ranks each section by fish, with the biggest fish, and skips empty sections', async ({ page }) => {
  const calls = await mockStats(page);
  await page.goto('gear-stats.html');
  await expect(page.locator('#statsSummary')).toHaveText('All time · 9 fish logged on 3 tip-ups');
  expect(calls[0]).toEqual({});                                   // no filters, all time
  await expect(page.locator('#seasonFilter [data-season="all"]')).toHaveClass(/active/);

  await expect(page.locator('.stats-section')).toHaveCount(4);     // tip-ups, bait, hooks, beads
  const tips = page.locator('.stats-section[data-section="tipUp"] .rank-row');
  await expect(tips).toHaveCount(3);
  await expect(tips.first()).toContainText('KW 24-01');
  await expect(tips.first()).toContainText('Kurt W');
  await expect(tips.first().locator('.stat-count')).toHaveText('4fish');
  await expect(tips.first().locator('.stat-best')).toContainText('Biggest: 36" Northern Pike · Kurt W');
  await expect(tips.nth(1).locator('.stat-best')).toHaveCount(0);  // no lengths, no line
  await expect(tips.first()).toHaveAttribute('href', './gear-tipup.html?id=7');
  await expect(page.locator('.stats-section[data-section="bait"] .rank-row').first()).not.toHaveAttribute('href', /./);
});

test('No beads ranks like the rest, in italics', async ({ page }) => {
  await mockStats(page);
  await page.goto('gear-stats.html');
  const beads = page.locator('.stats-section[data-section="bead"]');
  await expect(beads.locator('.section-label')).toHaveText('🫧 Beads');
  await expect(beads.locator('.stats-note')).toHaveText('A fish on two beads counts for both.');
  const rows = beads.locator('.rank-row');
  await expect(rows.first()).toHaveClass(/stat-none/);
  await expect(rows.first()).toHaveClass(/rank-1/);               // most fish: the gold
  await expect(rows.nth(1)).toHaveClass(/rank-2/);
});

test('long sections show the top 5, then all', async ({ page }) => {
  await mockStats(page);
  await page.goto('gear-stats.html');
  const hooks = page.locator('.stats-section[data-section="hook"]');
  await expect(hooks.locator('.rank-row')).toHaveCount(5);
  await hooks.locator('.stats-more').click();
  await expect(hooks.locator('.rank-row')).toHaveCount(7);
  await expect(hooks.locator('.stats-more')).toHaveText('Show top 5');
});

test('species and water chips filter on the server and are remembered', async ({ page }) => {
  const calls = await mockStats(page);
  await page.goto('gear-stats.html');
  await page.locator('#filterSpeciesChip').click();
  await page.locator('#filterSpeciesDropdown .filter-option', { hasText: 'Walleye' }).click();
  await expect(page.locator('#filterSpeciesChip')).toHaveClass(/active/);
  await expect(page.locator('#filterSpeciesValue')).toHaveText(': Walleye');
  await page.locator('#filterWaterChip').click();
  await page.locator('#filterWaterDropdown .filter-option', { hasText: 'Lake Waubesa' }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ speciesId: '3', waterId: '6' });

  await page.reload();
  await expect(page.locator('#filterWaterValue')).toHaveText(': Lake Waubesa');
  await expect.poll(() => calls.at(-1)).toEqual({ speciesId: '3', waterId: '6' });

  await page.locator('#filterSpeciesChip').click();
  await page.locator('#filterSpeciesDropdown .filter-option', { hasText: 'All Species' }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ waterId: '6' });
  await expect(page.locator('#filterSpeciesChip')).not.toHaveClass(/active/);
});

test('nothing logged yet says how to get there', async ({ page }) => {
  await mockStats(page, { fish: 0, tipUps: 0, waters: [], species: [], sections: {} });
  await page.goto('gear-stats.html');
  await expect(page.locator('#statsEmpty')).toContainText('Pick the tip-up when you log a catch');
  await expect(page.locator('.stats-section')).toHaveCount(0);
});

test.describe('when the server fails', () => {
  test.use({ allowConsoleErrors: true }); // the browser logs the 500 it's answered with
  test('a failed load offers a retry', async ({ page }) => {
    await page.route(url => url.pathname.endsWith('/gillbert/gear/stats'), route => route.fulfill({ status: 500, body: '' }));
    await page.goto('gear-stats.html');
    await expect(page.locator('#errorState')).toBeVisible();
  });
});

test('This Season asks for the current season, and says so', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-01-15T12:00:00'));
  const calls = await mockStats(page);
  await page.goto('gear-stats.html');
  await expect(page.locator('#statsSummary')).toContainText('All time');
  await page.locator('#seasonFilter [data-season="this"]').click();
  await expect(page.locator('#statsSummary')).toContainText('Hard water 2026–27');
  expect(calls.at(-1)).toEqual({ from: '2026-11-01', to: '2027-03-31' });
  await page.locator('#seasonFilter [data-season="all"]').click();
  await expect(page.locator('#statsSummary')).toContainText('All time');
  expect(calls.at(-1)).toEqual({});
});
