// Layer 1, read-only: the gear pages (stage 1: list, one tip-up, add/edit, change setup).
// Every gear call is answered here in the browser, and so is the angler list, so these run
// before the gear endpoints exist anywhere and nothing is written. The saves are checked by
// what the page sends; the database rules behind them are tested on Staging
// (scripts/gear/03_check_gear_functions.sql).
const { test, expect, unlockAdmin } = require('../support/fixtures');

const ME = 'kurt@example.test';
const ANGLERS = [
  { id: 1, name: 'Kurt W', loginEmails: [ME] },
  { id: 3, name: 'Dave T', loginEmails: [] },
  { id: 4, name: 'Mike R', loginEmails: [] },
];

function tipUp(id, name, overrides = {}) {
  return {
    id, gearType: 'tip_up', name, ownerAnglerId: 1, ownerName: 'Kurt W', model: null, color: null,
    status: 'Active', retiredNote: null, catchCount: 0, anyCatch: false,
    setup: { versionNo: 1, line: 'Dacron 30 lb', leader: 'Fluoro 10 lb', hook: '#8 Octopus',
             beads: ['Glow'], flash: [], photo: null, since: '2026-12-06T19:12:00Z', fixable: false },
    ...overrides,
  };
}

const TIP_UPS = [
  tipUp(7, 'KW 24-01', { model: 'Frabill Pro-Thermal', color: 'Blue', notes: 'Trigger sticks in the cold' }),
  tipUp(8, 'DT 22-01', { ownerAnglerId: 3, ownerName: 'Dave T', setup: null }),
  tipUp(9, 'KW 24-03', { status: 'Retired', retiredNote: 'Lost down the hole, Jan 2026' }),
];
const OPTIONS = {
  line: ['Dacron 20 lb', 'Dacron 30 lb'], leader: ['Fluoro 10 lb'], hook: ['#10 Treble', '#8 Octopus'],
  bead: ['Glow', 'Red'], flash: ['Gold blade'], model: ['Beaver Dam', 'Frabill Pro-Thermal'], color: ['Blue', 'Orange'],
  bait: ['Not sure', 'Shiner (medium)'],
};
const HISTORY = [
  { id: 103, at: '2026-12-20T16:30:00Z', byName: 'Dave T', eventType: 'fix', field: 'leader', oldValue: 'Fluoro 12 lb', newValue: 'Fluoro 10 lb' },
  { id: 102, at: '2026-12-20T16:05:00Z', byName: 'Dave T', eventType: 'setup', field: 'hook', oldValue: '#8 Octopus', newValue: '#10 Treble' },
  { id: 101, at: '2026-12-06T19:12:00Z', byName: 'Kurt W', eventType: 'created', field: null, oldValue: null, newValue: 'KW 24-01' },
];

// Answers gear/get (all, or one with history), the angler list, and the two saves.
// Each save's body is kept in state.saves; state.reply decides the answer.
async function mockGear(page, state = {}) {
  state.saves = [];
  const tips = state.tipUps || TIP_UPS;
  await page.route(url => url.pathname.endsWith('/gillbert/gear/get'), route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    const one = tips.filter(t => String(t.id) === id);
    return route.fulfill({ json: id
      ? { tipUps: one, options: OPTIONS, history: state.history || HISTORY }
      : { tipUps: tips, options: OPTIONS, history: null } });
  });
  await page.route(url => url.pathname.endsWith('/gillbert/get-lookup-data'), route =>
    route.fulfill({ json: { anglers: ANGLERS, fishSpecies: [], bodiesOfWater: [] } }));
  await page.route(url => /\/gillbert\/gear\/(save|setup-save)$/.test(url.pathname), route => {
    const body = route.request().postDataJSON();
    state.saves.push({ path: new URL(route.request().url()).pathname.split('/').pop(), body });
    return route.fulfill({ json: state.reply ? state.reply(body) : { success: true, id: body.id || 12 } });
  });
  return state;
}

test.describe('Gear list', () => {
  test('active tip-ups as cards by name, with owner and setup, then the retired ones', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear.html');
    const active = page.locator('#activeList .gear-card');
    await expect(active).toHaveCount(2);
    await expect(page.locator('#activeCount')).toHaveText('2');
    await expect(active.nth(0).locator('.gear-card-name')).toHaveText('KW 24-01');
    await expect(active.nth(0).locator('.gear-card-owner')).toHaveText('Kurt W');
    await expect(active.nth(0).locator('.gear-card-meta')).toHaveText('#8 Octopus · Glow');
    await expect(active.nth(1).locator('.gear-card-name')).toHaveText('DT 22-01');
    await expect(active.nth(1).locator('.gear-card-meta')).toHaveText('No setup yet');
    await expect(page.locator('#retiredList .gear-card')).toHaveCount(1);
    await expect(page.locator('#retiredList')).toContainText('Lost down the hole');
    await expect(active.nth(0)).toHaveAttribute('href', './gear-tipup.html?id=7');
  });

  test('the owner pills and the search box narrow the list', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear.html');
    const pills = page.locator('#ownerFilter .status-filter-btn');
    await expect(pills).toHaveText(['All', 'Dave T', 'Kurt W']);
    await pills.filter({ hasText: 'Dave T' }).click();
    await expect(page.locator('#activeList .gear-card')).toHaveCount(1);
    await expect(page.locator('#activeList')).toContainText('DT 22-01');
    await expect(page.locator('#retiredSection')).toBeHidden();
    await pills.filter({ hasText: 'All' }).click();
    await page.locator('#searchInput').fill('octopus');           // matches a setup part
    await expect(page.locator('#activeList .gear-card')).toHaveCount(1);
    await expect(page.locator('#activeList')).toContainText('KW 24-01');
    await page.locator('#searchInput').fill('nothing like this');
    await expect(page.locator('#activeEmpty')).toHaveText('No tip-ups match.');
  });

  test('no tip-ups yet says how to start, and hides the retired section', async ({ page }) => {
    await mockGear(page, { tipUps: [] });
    await page.goto('gear.html');
    await expect(page.locator('#activeEmpty')).toBeVisible();
    await expect(page.locator('#retiredSection')).toBeHidden();
    await expect(page.locator('#addBtn')).toHaveAttribute('href', './gear-edit.html');
  });

  test('the shack menu links to Gear for everyone', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear.html');
    await expect(page.locator('#shack a[href="./gear.html"]')).toHaveCount(1);
    await expect(page.locator('#adminSectionGrid a[href="./gear.html"]')).toHaveCount(0);
  });
});

test.describe('One tip-up', () => {
  test('shows its parts and its history in words', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-tipup.html?id=7');
    await expect(page.locator('#tipName')).toHaveText('KW 24-01');
    await expect(page.locator('#tipSub')).toHaveText("Kurt W's · Active");
    const parts = page.locator('#tipParts');
    for (const text of ['Frabill Pro-Thermal', 'Blue', 'Dacron 30 lb', 'Fluoro 10 lb', '#8 Octopus', 'Glow']) {
      await expect(parts).toContainText(text);
    }
    const rows = page.locator('#historyList li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Leader fixed: Fluoro 12 lb → Fluoro 10 lb');
    await expect(rows.nth(1)).toContainText('Dave T');
    await expect(rows.nth(1)).toContainText('Hook: #8 Octopus → #10 Treble');
    await expect(rows.nth(2)).toContainText('Added KW 24-01');
    await expect(page.locator('#tipNotes')).toHaveText('Trigger sticks in the cold');
    await expect(page.locator('#setupLink')).toHaveAttribute('href', './gear-setup.html?id=7');
  });

  test('a retired tip-up shows why, and offers no setup change', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-tipup.html?id=9');
    await expect(page.locator('#retiredNote')).toContainText('Lost down the hole');
    await expect(page.locator('#setupLink')).toBeHidden();
    await expect(page.locator('#editLink')).toHaveText('Rename, owner or bring back');
  });

  test('a tip-up that is gone says so', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-tipup.html?id=999');
    await expect(page.locator('#errorMsg')).toContainText("isn't here any more");
  });
});

test.describe('Add and edit', () => {
  test.use({ identityEmail: ME });

  test('a taken name is caught while typing, ignoring capitals and spaces', async ({ page }) => {
    const state = await mockGear(page);
    await page.goto('gear-edit.html');
    await page.locator('#name').fill('kw   24-01');
    await expect(page.locator('#nameError')).toHaveText('"KW 24-01" is already taken (Kurt W\'s). Names must be unique.');
    await page.locator('#saveBtn').click();
    await page.waitForTimeout(500);                        // give a save the time it would take
    expect(state.saves).toEqual([]);
    await expect(page).toHaveURL(/gear-edit\.html$/);
    await expect(page.locator('#formState')).toBeVisible();
  });

  test('adding sends name, owner (you, by default), model and color, then opens the setup', async ({ page }) => {
    const state = await mockGear(page);
    await page.goto('gear-edit.html');
    await expect(page.locator('#owner')).toHaveValue('1');
    await expect(page.locator('#statusGroup')).toBeHidden();
    await page.locator('#name').fill('KW 25-01');
    await page.locator('#model').fill('frabill');
    await page.locator('#modelSuggestions .tag-suggestion').first().click();
    await expect(page.locator('#model')).toHaveValue('Frabill Pro-Thermal');
    await page.locator('#notes').fill('Bought at the swap meet');
    await page.locator('#color').fill('Black');
    await expect(page.locator('#colorSuggestions')).toContainText('Use "Black" as a new color');
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-setup\.html\?id=12&new=1/);
    expect(state.saves[0]).toEqual({ path: 'save', body: {
      id: null, name: 'KW 25-01', ownerAnglerId: 1, model: 'Frabill Pro-Thermal', color: 'Black',
      notes: 'Bought at the swap meet', status: 'Active', retiredNote: '', byAnglerId: 1 } });
  });

  test('editing fills the form; retiring asks what happened', async ({ page }) => {
    const state = await mockGear(page);
    await page.goto('gear-edit.html?id=7');
    await expect(page.locator('#formHeading')).toHaveText('Edit KW 24-01');
    await expect(page.locator('#name')).toHaveValue('KW 24-01');
    await expect(page.locator('#color')).toHaveValue('Blue');
    await expect(page.locator('#notes')).toHaveValue('Trigger sticks in the cold');
    await expect(page.locator('#noteGroup')).toBeHidden();
    await page.locator('#statusPills [data-status="Retired"]').click();
    await page.locator('#retiredNote').fill('Lost down the hole');
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[0].body).toMatchObject({ id: 7, status: 'Retired', retiredNote: 'Lost down the hole' });
  });

  test('the server\'s message is shown when a save is refused', async ({ page }) => {
    await mockGear(page, { reply: () => ({ success: false, message: '"KW 25-01" is already taken (Dave T\'s). Names must be unique.' }) });
    await page.goto('gear-edit.html');
    await page.locator('#name').fill('KW 25-01');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formError')).toHaveText('"KW 25-01" is already taken (Dave T\'s). Names must be unique.');
  });

  test('delete takes two taps, and is offered only before any catch (a deleted one counts)', async ({ page }) => {
    const state = await mockGear(page, { tipUps: [TIP_UPS[0], tipUp(10, 'MR 25-01', { catchCount: 3, anyCatch: true }),
                                                  tipUp(11, 'MR 25-02', { catchCount: 0, anyCatch: true })] });
    await page.goto('gear-edit.html?id=10');
    await expect(page.locator('#formState')).toBeVisible();
    await expect(page.locator('#deleteGroup')).toBeHidden();
    await page.goto('gear-edit.html?id=11');                 // its only catch was deleted
    await expect(page.locator('#formState')).toBeVisible();
    await expect(page.locator('#deleteGroup')).toBeHidden();
    await page.goto('gear-edit.html?id=7');
    await page.locator('#deleteBtn').click();
    await expect(page.locator('#deleteConfirm')).toBeVisible();
    expect(state.saves).toEqual([]);
    await page.locator('#deleteYes').click();
    await expect(page).toHaveURL(/gear\.html$/);
    expect(state.saves[0].body).toEqual({ id: 7, delete: true, byAnglerId: 1 });
  });
});

test.describe('Change setup', () => {
  test('starts from the current setup; matches show, and new values are offered', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-setup.html?id=7');
    await expect(page.locator('#formHeading')).toHaveText('Change setup');
    await expect(page.locator('#headLabel')).toHaveText('Gear · KW 24-01');
    await expect(page.locator('#line')).toHaveValue('Dacron 30 lb');
    await expect(page.locator('#beadsWrapper .tag-pill')).toHaveCount(1);
    await page.locator('#line').fill('dac');
    const box = page.locator('#lineSuggestions .tag-suggestion');
    await expect(box).toHaveText(['Dacron 20 lb', 'Dacron 30 lb', '＋ Use "dac" as a new line']);
  });

  test('saving sends every part, spelled like the existing choices', async ({ page }) => {
    const state = await mockGear(page);
    await page.goto('gear-setup.html?id=7');
    await page.locator('#hook').fill('#10 TREBLE');
    await page.locator('#hook').blur();
    await expect(page.locator('#hook')).toHaveValue('#10 Treble');
    await page.locator('#beadsInput').fill('red');
    await page.locator('#beadsInput').press('Enter');
    await page.locator('#flashInput').fill('gold blade');   // typed but not entered: still counts
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[0]).toEqual({ path: 'setup-save', body: {
      gearId: 7, line: 'Dacron 30 lb', leader: 'Fluoro 10 lb', hook: '#10 Treble',
      beads: ['Glow', 'Red'], flash: ['Gold blade'], byAnglerId: null, mode: 'new' } });   // saved long ago: no question
  });

  // Saved again within 2 hours: "fixing a mistake, or did the rig change?"
  // fixable: the database's own "saved under 2 hours ago" (the page never uses this device's clock)
  const fixable = yes => TIP_UPS.map(t => t.id === 7 ? { ...t, setup: { ...t.setup, fixable: yes } } : t);

  test('saved again within 2 hours, Save asks why; "Fixing a mistake" sends a fix', async ({ page }) => {
    const state = await mockGear(page, { tipUps: fixable(true) });
    await page.goto('gear-setup.html?id=7');
    await page.locator('#hook').fill('#10 Treble');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#setupChoice')).toBeVisible();
    await expect(page.locator('#setupChoiceText')).toHaveText('This setup was saved less than 2 hours ago. Are you fixing a mistake in it, or did the rig change? '
      + "(Fish already logged keep the setup they were caught on, unless it's a fix.)");
    expect(state.saves).toEqual([]);                       // nothing saved until they answer
    await page.locator('#fixBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[0].body).toMatchObject({ hook: '#10 Treble', mode: 'fix' });
    expect(state.saves[0].body).not.toHaveProperty('admin');
  });

  test('"The rig changed" sends a new setup; an unchanged save or an old one asks nothing', async ({ page }) => {
    const state = await mockGear(page, { tipUps: fixable(true) });
    await page.goto('gear-setup.html?id=7');
    await page.locator('#saveBtn').click();                // nothing changed
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[0].body.mode).toBe('new');
    await page.goto('gear-setup.html?id=7');
    await page.locator('#hook').fill('#10 Treble');
    await page.locator('#saveBtn').click();
    await page.locator('#newSetupBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[1].body).toMatchObject({ hook: '#10 Treble', mode: 'new' });
  });

  test('an admin is asked even after 2 hours, and the fix says so', async ({ page }) => {
    const state = await mockGear(page, { tipUps: fixable(false) });
    await unlockAdmin(page);
    await page.goto('gear-setup.html?id=7');
    await page.locator('#hook').fill('#10 Treble');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#setupChoiceText')).toContainText('As an admin, you can fix the current setup at any time.');
    await page.locator('#fixBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves[0].body).toMatchObject({ mode: 'fix', admin: true });
  });

  test('a fix the server refuses shows why, and the next Save makes a new setup without asking', async ({ page }) => {
    const state = await mockGear(page, { tipUps: fixable(true),
      reply: body => body.mode === 'fix'
        ? { success: false, message: 'This setup was saved more than 2 hours ago, so a change is saved as a new setup.' }
        : { success: true } });
    await page.goto('gear-setup.html?id=7');
    await page.locator('#hook').fill('#10 Treble');
    await page.locator('#saveBtn').click();
    await page.locator('#fixBtn').click();
    await expect(page.locator('#formError')).toContainText('more than 2 hours ago');
    await expect(page.locator('#formState')).toBeVisible();
    await expect(page.locator('#hook')).toHaveValue('#10 Treble');   // what they typed is kept
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tipup\.html\?id=7/);
    expect(state.saves.map(x => x.body.mode)).toEqual(['fix', 'new']);
  });

  test('a new tip-up gets a first-setup heading and note', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-setup.html?id=8&new=1');
    await expect(page.locator('#formHeading')).toHaveText('First setup');
    await expect(page.locator('#headLabel')).toHaveText('Gear · DT 22-01');
    await expect(page.locator('#newNote')).toBeVisible();
    await expect(page.locator('#line')).toHaveValue('');
  });

  test('a retired tip-up can\'t be set up', async ({ page }) => {
    await mockGear(page);
    await page.goto('gear-setup.html?id=9');
    await expect(page.locator('#errorMsg')).toContainText('is retired');
  });
});
