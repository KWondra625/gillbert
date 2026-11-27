// Layer 1, read-only: the admin's Gear Tags pages (gear stage 6). Everything the pages ask for
// is answered here in the browser, and saves are checked by what the page sends; what a merge
// does in the database is tested on Staging by scripts/gear/08_check_gear_tags_admin.sql.
const { test, expect, unlockAdmin } = require('../support/fixtures');

const TAGS = [
  { id: 11, kind: 'hook', name: '#8 Octopus', status: 'Active', tipUps: 3, catches: 0 },
  { id: 12, kind: 'hook', name: 'octopus #8', status: 'Active', tipUps: 1, catches: 0 },
  { id: 13, kind: 'hook', name: '#10 Treble', status: 'Hidden', tipUps: 0, catches: 0 },
  { id: 21, kind: 'bait', name: 'Sucker (medium)', status: 'Active', tipUps: 0, catches: 5 },
  { id: 31, kind: 'line', name: 'Sufix Metered Tip-Up Ice Braid 20 lb', status: 'Active', tipUps: 2, catches: 0 },
];

async function mockTags(page, state = {}) {
  state.saves = [];
  await page.route(url => url.pathname.endsWith('/gillbert/gear/tags'), route => route.fulfill({ json: TAGS }));
  await page.route(url => url.pathname.endsWith('/gillbert/gear/tag-save'), route => {
    const body = route.request().postDataJSON();
    state.saves.push(body);
    return route.fulfill({ json: state.answer || { success: true, id: body.intoId || body.id } });
  });
  return state;
}

test.describe('Gear Tags list', () => {
  test('turns away a visitor who isn\'t admin', async ({ page }) => {
    await mockTags(page);
    await page.goto('gear-tags.html');
    await expect(page.locator('#errorMsg')).toHaveText("You don't have permission to access this page.");
  });

  test('lists every tag with its uses; kind pills and search narrow it', async ({ page }) => {
    await unlockAdmin(page);
    await mockTags(page);
    await page.goto('gear-tags.html');
    const rows = page.locator('#tagsTableBody .data-row');
    await expect(rows).toHaveCount(5);
    await expect(page.locator('#kindFilter .status-filter-btn')).toHaveText(['All', 'Line', 'Hook', 'Bait']);
    await expect(rows.filter({ hasText: 'octopus #8' })).toContainText('1 tip-up');
    await expect(rows.filter({ hasText: 'Sucker (medium)' })).toContainText('5 catches');
    await expect(rows.filter({ hasText: '#10 Treble' })).toContainText('Not used');
    await expect(rows.filter({ hasText: '#10 Treble' })).toContainText('Hidden');

    await page.locator('#kindFilter [data-kind="hook"]').click();
    await expect(rows).toHaveCount(3);
    await page.locator('#searchInput').fill('octo');
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasText: 'octopus #8' }).locator('td').nth(1).click();
    await expect(page).toHaveURL(/gear-tag-edit\.html\?id=12/);
  });
});

test.describe('Gear tag page', () => {
  test.beforeEach(async ({ page }) => { await unlockAdmin(page); });

  test('rename and hide send one change each, then go back to the list', async ({ page }) => {
    const state = await mockTags(page);
    await page.goto('gear-tag-edit.html?id=12');
    await expect(page.locator('#tagName')).toHaveText('octopus #8');
    await expect(page.locator('#kindLabel')).toHaveText('Admin · Hook');
    await expect(page.locator('#tagUses')).toHaveText('Used on: 1 tip-up');
    await page.locator('#name').fill('  Octopus   #8 ');
    await page.locator('#statusPills [data-status="Hidden"]').click();
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    expect(state.saves).toEqual([{ id: 12, action: 'rename', name: 'Octopus #8' }, { id: 12, action: 'hide' }]);
  });

  test('a refused rename shows the database\'s message', async ({ page }) => {
    await mockTags(page, { answer: { success: false, message: '"#8 Octopus" is already there. Merge into it instead.' } });
    await page.goto('gear-tag-edit.html?id=12');
    await page.locator('#name').fill('#8 octopus');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formError')).toHaveText('"#8 Octopus" is already there. Merge into it instead.');
  });

  test('merge offers only the same kind, asks first, then opens the tag it merged into', async ({ page }) => {
    const state = await mockTags(page);
    await page.goto('gear-tag-edit.html?id=12');
    const options = page.locator('#mergeInto option');
    await expect(options).toHaveText(['Merge into…', '#8 Octopus (3 tip-ups)', '#10 Treble (Not used)']);
    await expect(page.locator('#mergeBtn')).toBeDisabled();
    await page.locator('#mergeInto').selectOption('11');
    await page.locator('#mergeBtn').click();
    await expect(page.locator('#mergeConfirmText')).toContainText('will use "#8 Octopus" instead');
    expect(state.saves).toHaveLength(0);
    await page.locator('#mergeYes').click();
    await expect(page).toHaveURL(/gear-tag-edit\.html\?id=11/);
    expect(state.saves[0]).toEqual({ id: 12, action: 'merge', intoId: 11 });
  });

  test('delete is offered only for an unused tag', async ({ page }) => {
    const state = await mockTags(page);
    await page.goto('gear-tag-edit.html?id=12');
    await expect(page.locator('#formState')).toBeVisible();
    await expect(page.locator('#deleteGroup')).toBeHidden();

    await page.goto('gear-tag-edit.html?id=13');
    await expect(page.locator('#deleteGroup')).toBeVisible();
    await page.locator('#deleteBtn').click();
    await page.locator('#deleteYes').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    expect(state.saves).toEqual([{ id: 13, action: 'delete' }]);
  });

  test('a tag that\'s gone says so', async ({ page }) => {
    await mockTags(page);
    await page.goto('gear-tag-edit.html?id=99');
    await expect(page.locator('#errorMsg')).toContainText("isn't here any more");
  });
});
