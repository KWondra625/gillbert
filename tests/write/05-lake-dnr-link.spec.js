// Layer 2, create and clean up (Staging only): linking a body of water to its WI DNR
// record, and the "DNR link is working" checkbox the create and edit pages share
// (dnrUrlVerified: true/false when linked, null when not). The DNR search goes
// through n8n to DNR's own servers, so it can be slow.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, testName } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const DNR_SEARCH = 'Moon Lake';

async function findLake(name) {
  return (await apiGet('bodies-of-water/get')).find(w => w.name === name);
}

// Searches DNR on the create page and picks the first result; returns its WBIC.
async function pickFirstDnrResult(page) {
  await page.locator('#dnrSearchInput').fill(DNR_SEARCH);
  await page.locator('#dnrSearchBtn').click();
  const first = page.locator('#dnrSearchResults .dnr-result').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const wbic = Number((await first.locator('.dnr-result-wbic').textContent()).replace(/\D/g, ''));
  await first.locator('.dnr-result-select').click();
  await expect(page.locator('#dnrLinkedChip')).toContainText(`WBIC ${wbic}`);
  return wbic;
}

test('create a lake linked to DNR: the checkbox shows, checked, and saves true', async ({ page }) => {
  const name = testName('Lake DNR');
  await unlockAdmin(page);
  await page.goto('create-body-of-water.html');
  await expect(page.locator('#dnrUrlVerifiedGroup')).toBeHidden();
  await page.locator('#name').fill(name);
  const wbic = await pickFirstDnrResult(page);

  await expect(page.locator('#dnrUrlVerifiedGroup')).toBeVisible();
  await expect(page.locator('#dnrUrlVerified')).toBeChecked();
  await expect(page.locator('#name')).toHaveValue(name); // a DNR pick never overwrites a typed name
  await page.locator('#createBtn').click();

  await expect(page).toHaveURL(/edit-body-of-water\.html\?id=\d+/);
  const saved = await findLake(name);
  expect(saved.wbic).toBe(wbic);
  expect(saved.dnrUrlVerified).toBe(true);
});

test('unticking "DNR link is working" on the edit page saves false', async ({ page }) => {
  const lake = await findLake(testName('Lake DNR'));
  test.skip(!lake, 'the linked create test did not run or failed');
  await unlockAdmin(page);
  await page.goto(`edit-body-of-water.html?id=${lake.id}`);
  await expect(page.locator('#dnrInfoPanel')).toBeVisible();
  await expect(page.locator('#dnrUrlVerified')).toBeChecked();
  await page.locator('#dnrUrlVerified').uncheck();
  await page.locator('#saveBtn').click();

  await expect.poll(async () => (await findLake(lake.name)).dnrUrlVerified, { timeout: 20_000 }).toBe(false);
  expect((await findLake(lake.name)).wbic).toBe(lake.wbic);
});

test('picking a DNR lake, then Change, saves an unlinked lake (null)', async ({ page }) => {
  const name = testName('Lake DNR Cleared');
  await unlockAdmin(page);
  await page.goto('create-body-of-water.html');
  await page.locator('#name').fill(name);
  await pickFirstDnrResult(page);
  await page.locator('#dnrLinkedClear').click();
  await expect(page.locator('#dnrLinkedChip')).toBeHidden();
  await expect(page.locator('#dnrUrlVerifiedGroup')).toBeHidden();
  await page.locator('#createBtn').click();

  await expect(page).toHaveURL(/edit-body-of-water\.html\?id=\d+/);
  const saved = await findLake(name);
  expect(saved.wbic).toBeNull();
  expect(saved.dnrUrlVerified).toBeNull();
});
