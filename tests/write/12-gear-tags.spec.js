// Layer 2, create and clean up (Staging only): the admin's Gear Tags pages (gear stage 6), end
// to end. Two test tip-ups get two spellings of a hook; the admin renames one, merges it into
// the other, hides and shows a tag, and deletes one nothing uses.
// Everything is named "E2E Test …" (its tags "E2E Test Tags …", so they never meet 11-gear's
// tags: a tag is matched without capitals, so "hook a" would land on 11's "Hook A").
// Run `npm run cleanup` afterwards to remove it.
// Needs scripts/gear/07 and the gear/tags + gear/tag-save endpoints on Staging.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, testName } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const TIP_1 = testName('Tags Tip-up 1');
const TIP_2 = testName('Tags Tip-up 2');
const HOOK_A = testName('Tags hook a');
const HOOK_B = testName('Tags Hook B');
const FLASH = testName('Tags Flash');
let tip1;

async function tags() {
  const raw = await apiGet('gear/tags');
  return Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
}
const tagNamed = async name => (await tags()).find(t => t.name === name);

async function addTipUp(page, name, hook, flash) {
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(name);
  await page.locator('#owner').selectOption({ index: 1 });
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
  const id = new URL(page.url()).searchParams.get('id');
  await page.locator('#hook').fill(hook);
  if (flash) {
    await page.locator('#flashInput').fill(flash);
    await page.locator('#flashInput').press('Enter');
  }
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${id}`));
  return id;
}

test('set up: two tip-ups with two spellings of a hook, one with a flash', async ({ page }) => {
  tip1 = await addTipUp(page, TIP_1, HOOK_A, FLASH);
  await addTipUp(page, TIP_2, HOOK_B);
  expect(await tagNamed(HOOK_A)).toMatchObject({ kind: 'hook', tipUps: 1 });
});

test.describe('as admin', () => {
  test.beforeEach(async ({ page }) => { await unlockAdmin(page); });

  test('the list shows the test tags with their uses', async ({ page }) => {
    await page.goto('gear-tags.html');
    await page.locator('#searchInput').fill(HOOK_A);
    const row = page.locator('#tagsTableBody .data-row', { hasText: HOOK_A });
    await expect(row).toContainText('Hook');
    await expect(row).toContainText('1 tip-up');
  });

  test('rename onto the other spelling is refused; a new spelling saves', async ({ page }) => {
    const a = await tagNamed(HOOK_A);
    await page.goto(`gear-tag-edit.html?id=${a.id}`);
    await page.locator('#name').fill(HOOK_B.toUpperCase());
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formError')).toContainText('Merge into it instead');
    await page.locator('#name').fill(`${HOOK_A} x`);
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    expect(await tagNamed(`${HOOK_A} x`)).toBeTruthy();
  });

  test('merge moves the tip-up onto the other tag and removes the old one', async ({ page }) => {
    const a = await tagNamed(`${HOOK_A} x`);
    const b = await tagNamed(HOOK_B);
    await page.goto(`gear-tag-edit.html?id=${a.id}`);
    await page.locator('#mergeInto').selectOption(String(b.id));
    await page.locator('#mergeBtn').click();
    await page.locator('#mergeYes').click();
    await expect(page).toHaveURL(new RegExp(`gear-tag-edit\\.html\\?id=${b.id}`));
    await expect(page.locator('#tagUses')).toHaveText('Used on: 2 tip-ups');
    expect(await tagNamed(`${HOOK_A} x`)).toBeUndefined();
    await page.goto(`gear-tipup.html?id=${tip1}`);
    await expect(page.locator('#tipParts')).toContainText(HOOK_B);
  });

  test('hide takes a tag off the type-ahead; show puts it back', async ({ page }) => {
    const b = await tagNamed(HOOK_B);
    await page.goto(`gear-tag-edit.html?id=${b.id}`);
    await page.locator('#statusPills [data-status="Hidden"]').click();
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    let gear = await apiGet('gear/get');
    gear = Array.isArray(gear) ? gear[0] : gear;
    expect(gear.options.hook || []).not.toContain(HOOK_B);

    await page.goto(`gear-tag-edit.html?id=${b.id}`);
    await page.locator('#statusPills [data-status="Active"]').click();
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    expect((await tagNamed(HOOK_B)).status).toBe('Active');
  });

  test('a tag nothing uses any more can be deleted', async ({ page }) => {
    // Take the flash off the tip-up: a fix (saved minutes ago), so the setup changes in place
    await page.goto(`gear-setup.html?id=${tip1}`);
    await page.locator('#flashWrapper .tag-pill-remove').first().click();
    await page.locator('#saveBtn').click();
    await page.locator('#fixBtn').click();
    await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tip1}`));

    const f = await tagNamed(FLASH);
    expect(f).toMatchObject({ tipUps: 0, catches: 0 });
    await page.goto(`gear-tag-edit.html?id=${f.id}`);
    await page.locator('#deleteBtn').click();
    await page.locator('#deleteYes').click();
    await expect(page).toHaveURL(/gear-tags\.html$/);
    expect(await tagNamed(FLASH)).toBeUndefined();
  });
});
