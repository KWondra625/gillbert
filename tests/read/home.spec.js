// Layer 1, read-only: the home page's moving parts (the shack / tackle box, the ticker,
// Remember when?, the hard-water / open-water looks and the admin settings they read).
// These tests feed the page made-up catches, so they check behavior exactly instead of
// depending on what's on Staging today.
const { test, expect } = require('../support/fixtures');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-08T12:00:00-06:00'); // a Sunday in November: hard water

let nextId = 1;
function aCatch({ angler = 'Dave T', anglerId = 1, species = 'Walleye', length = 22, water = 'Pine Lake',
  loggedAgo = 2 * HOUR, caught = null, media = 0 } = {}) {
  const id = nextId++;
  const createdAt = new Date(NOW.getTime() - loggedAgo).toISOString();
  return {
    id, catchNumber: `Catch 26-${900 + id}`, anglerId, anglerName: angler, fishSpeciesName: species,
    bodyOfWaterName: water, length, caughtWhen: (caught || new Date(createdAt)).toISOString(), createdAt,
    catchMediaCount: media,
  };
}

async function homeWith(page, catches, { water = 'auto', settings = {}, admin = false, now = NOW } = {}) {
  await page.route('**/webhook/gillbert/get-catches', r => r.fulfill({ json: catches }));
  await page.route('**/webhook/gillbert/get-lookup-data', r => r.fulfill({ json: [{ anglers: [
    { id: 1, name: 'Dave T', profilePhotoReadUrl: null }, { id: 2, name: 'Mike R', profilePhotoReadUrl: null },
  ] }] }));
  await page.route('**/webhook/gillbert/catch-media/get*', r => r.fulfill({ json: [] }));
  await page.clock.setFixedTime(now);
  await page.addInitScript(([w, s, unlock]) => {
    localStorage.setItem('gillbert_setting_waterOverride', JSON.stringify(w));
    for (const [k, v] of Object.entries(s)) localStorage.setItem('gillbert_setting_' + k, JSON.stringify(v));
    if (unlock) localStorage.setItem('gillbert_admin_unlock_expires', String(Date.now() + 9e8));
  }, [water, settings, admin]);
  await page.goto('index.html');
}

test.describe('the shack / tackle box', () => {
  test('opens and closes with its button, the close button and Escape', async ({ page }) => {
    await homeWith(page, [aCatch()]);
    const open = page.locator('#shackOpen');
    await expect(page.locator('#shack')).toBeHidden();
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: /Catch notifications/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#shack')).toBeHidden();
    await open.click();
    await page.locator('#shackClose').click();
    await expect(page.locator('#shack')).toBeHidden();
  });

  test('is the ice shack in hard water and the tackle box in open water', async ({ page }) => {
    await homeWith(page, [aCatch()], { water: 'hard' });
    await expect(page.locator('#shackOpen')).toContainText('The shack');
    await expect(page.locator('#heroTitle')).toContainText("Flag's up? Log it.");
    await homeWith(page, [aCatch()], { water: 'open' });
    await expect(page.locator('#shackOpen')).toContainText('Tackle box');
    await expect(page.locator('#heroTitle')).toContainText('Fish on? Log it.');
  });

  test('shows the admin tray only to an unlocked admin', async ({ page }) => {
    await homeWith(page, [aCatch()]);
    await page.locator('#shackOpen').click();
    await expect(page.getByRole('link', { name: /Anglers/ })).toBeHidden();
    await homeWith(page, [aCatch()], { admin: true });
    await page.locator('#shackOpen').click();
    await expect(page.getByRole('link', { name: /Anglers/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Under the hood/ })).toBeVisible();
  });
});

test.describe('the season', () => {
  for (const [date, water] of [['2026-11-01T12:00:00', 'hard'], ['2026-03-31T12:00:00', 'hard'],
    ['2026-04-01T12:00:00', 'open'], ['2026-10-31T12:00:00', 'open'], ['2026-01-15T12:00:00', 'hard']]) {
    test(`${date.slice(0, 10)} is ${water} water`, async ({ page }) => {
      await homeWith(page, [], { now: new Date(date) });
      await expect(page.locator('html')).toHaveAttribute('data-water', water);
    });
  }

  test('the admin override wins over the calendar', async ({ page }) => {
    await homeWith(page, [], { water: 'open' }); // November, forced to open water
    await expect(page.locator('html')).toHaveAttribute('data-water', 'open');
  });
});

test.describe('On the line ticker', () => {
  test('shows the last 24 hours, newest first, at most 5, each linking to its catch', async ({ page }) => {
    const fresh = [1, 3, 5, 7, 9, 11].map(h => aCatch({ loggedAgo: h * HOUR, species: `Fish ${h}h` }));
    await homeWith(page, [...fresh, aCatch({ loggedAgo: 30 * HOUR, species: 'Too old' })]);
    const items = page.locator('#tickerRun .tk:not([tabindex="-1"])');
    await expect(items).toHaveCount(5);
    await expect(items.first()).toContainText('Fish 1h');
    await expect(page.locator('#tickerRun')).not.toContainText('Too old');
    await expect(page.locator('#tickerRun')).not.toContainText('No catches in the last 24 hours');
    await expect(items.first()).toHaveAttribute('href', /catch-details\.html\?catchNumber=Catch%2026-\d+&from=home/);
  });

  test('on a quiet day says so, then shows the latest 5 with their ages', async ({ page }) => {
    await homeWith(page, [3, 4, 9, 20, 40, 80].map(d => aCatch({ loggedAgo: d * DAY })));
    await expect(page.locator('#tickerRun')).toContainText("No catches in the last 24 hours. Here's what's been biting lately:");
    await expect(page.locator('#tickerRun .tk:not([tabindex="-1"])')).toHaveCount(5);
    await expect(page.locator('#tickerRun')).toContainText('3 days ago');
  });

  test('stays hidden when there are no catches at all', async ({ page }) => {
    await homeWith(page, []);
    await expect(page.locator('#ticker')).toBeHidden();
  });
});

test.describe('Remember when?', () => {
  const year = y => new Date(`${y}-11-06T09:00:00-06:00`); // two days from "today", earlier years

  test('prefers this week in an earlier year, and gives everyone the same pick all day', async ({ page }) => {
    const catches = [
      aCatch({ caught: new Date('2026-07-04T09:00:00-05:00'), species: 'Summer bass' }),
      aCatch({ caught: year(2024), species: 'This-week pike' }),
      aCatch({ caught: new Date('2026-02-10T09:00:00-06:00'), species: 'February perch' }),
    ];
    await homeWith(page, catches);
    const card = page.locator('#rememberWhen');
    await expect(card).toContainText('This-week pike');
    await expect(card).toContainText('This week, 2 years ago');
    await page.reload();
    await expect(card).toContainText('This-week pike');
  });

  test('otherwise sticks to the same season', async ({ page }) => {
    const catches = [
      aCatch({ caught: new Date('2026-07-04T09:00:00-05:00'), species: 'Summer bass' }),
      aCatch({ caught: new Date('2026-02-10T09:00:00-06:00'), species: 'February perch' }),
    ];
    await homeWith(page, catches, { water: 'hard' });
    await expect(page.locator('#rememberWhen')).toContainText('February perch');
    await expect(page.locator('#rememberWhen')).toContainText('Back in February 2026');
    await homeWith(page, catches, { water: 'open' });
    await expect(page.locator('#rememberWhen')).toContainText('Summer bass');
  });

  test('skips catches from the last 30 days, and hides when nothing qualifies', async ({ page }) => {
    await homeWith(page, [aCatch({ loggedAgo: 10 * DAY }), aCatch({ loggedAgo: 2 * HOUR })]);
    await expect(page.locator('#rememberWhen')).toBeHidden();
  });

  test('"pick another" moves to a different catch', async ({ page }) => {
    const catches = [1, 2, 3, 4].map(n => aCatch({ caught: new Date(`2026-0${n}-10T09:00:00-06:00`), species: `Pick ${n}` }));
    await homeWith(page, catches, { water: 'hard' });
    const first = await page.locator('#rememberWhen .rw-what').textContent();
    await homeWith(page, catches, { water: 'hard', settings: { rememberWhenSkip: 1 } });
    await expect(page.locator('#rememberWhen .rw-what')).not.toHaveText(first);
  });

  test('opens the catch and shows the day\'s tease line', async ({ page }) => {
    await homeWith(page, [aCatch({ caught: year(2025) })], { settings: { teaseLines: ['Only line today'] } });
    const card = page.locator('#rememberWhen');
    await expect(card).toContainText('Only line today');
    await expect(card).toHaveAttribute('href', /catch-details\.html\?catchNumber=Catch%2026-\d+&from=home/);
    await expect(card).toContainText('Dave T');
  });
});

test('the welcome line comes from the settings', async ({ page }) => {
  await homeWith(page, [], { settings: { welcomeLine: 'Tight lines, boys.' } });
  await expect(page.locator('#welcomeLine')).toHaveText('Tight lines, boys.');
});
