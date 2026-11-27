// Layer 2, create and clean up (Staging only): a tip-up through the gear pages, end to end.
// Add one, set it up, change the setup, log a catch on it (stage 2), change the setup again,
// rename and retire it, and check its history on the way.
// The tip-up and its tags are named "E2E Test …"; run `npm run cleanup` afterwards to remove them
// (its versions and history go with it).
// Needs the gear tables, functions and endpoints on Staging (scripts/gear, tools/n8n-migration/gear).
const { test, expect } = require('../support/fixtures');
const { apiGet, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const NAME = testName('Tip-up');
const LINE = testName('Line');
const HOOK_1 = testName('Hook A');
const HOOK_2 = testName('Hook B');
const BEAD = testName('Bead');
const BAIT = testName('Bait');
let tipId;
let catchNumber;

async function findTip() {
  const raw = await apiGet('gear/get');
  const data = Array.isArray(raw) ? raw[0] : raw;
  return (data.tipUps || []).find(t => t.name === NAME);
}

test('add a tip-up; it opens its first setup', async ({ page }) => {
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(NAME);
  // Nobody is signed in on a local copy, so pick an owner
  await page.locator('#owner').selectOption({ index: 1 });
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
  tipId = new URL(page.url()).searchParams.get('id');
  expect((await findTip()).id).toBe(Number(tipId));
});

test('a second tip-up with the same name, in other capitals, is refused', async ({ page }) => {
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(NAME.toUpperCase());
  await expect(page.locator('#nameError')).toContainText('already taken');
});

test('set up its line, hook and a bead; the page shows them', async ({ page }) => {
  await page.goto(`gear-setup.html?id=${tipId}`);
  await page.locator('#line').fill(LINE);
  await page.locator('#hook').fill(HOOK_1);
  await page.locator('#beadsInput').fill(BEAD);
  await page.locator('#beadsInput').press('Enter');
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tipId}`));
  await expect(page.locator('#tipParts')).toContainText(HOOK_1);
  await expect(page.locator('#tipParts')).toContainText(BEAD);
  const tip = await findTip();
  expect(tip.setup).toMatchObject({ versionNo: 1, line: LINE, hook: HOOK_1, beads: [BEAD] });
});

test('change the hook before any catch: still version 1, and the history says so', async ({ page }) => {
  await page.goto(`gear-setup.html?id=${tipId}`);
  await page.locator('#hook').fill(HOOK_2);
  await page.locator('#saveBtn').click();
  await expect(page.locator('#historyList')).toContainText(`Hook: ${HOOK_1} → ${HOOK_2}`);
  expect((await findTip()).setup.versionNo).toBe(1);
});

test('log a catch on it with a new bait; the catch page shows the setup as caught', async ({ page }) => {
  const { anglers, fishSpecies, bodiesOfWater } = await getLookups();
  await page.goto('log-catch.html');
  await expect(page.locator('#gearGroup')).toBeVisible();
  await page.locator('#anglerId').selectOption(String(anglers[0].id));
  await page.locator('#fishSpeciesId').selectOption(String(fishSpecies[0].id));
  await page.locator('#bodyOfWaterId').selectOption(String(bodiesOfWater[0].id));
  await page.locator('#gearSearch').fill(NAME);
  await page.locator('#gearSuggestions .tag-suggestion').first().click();
  await page.locator('#bait').fill(BAIT);
  await page.locator('#notes').fill(`${NOTES_MARKER} gear catch, run ${RUN_ID}`);
  await page.locator('#saveViewBtn').click();
  await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
  const row = page.locator('.detail-row', { hasText: 'Caught on' });
  await expect(row.locator('.caught-on-link')).toHaveText(NAME);
  await expect(row.locator('.caught-on-setup')).toContainText(HOOK_2);
  await expect(page.locator('.detail-row', { hasText: 'Bait' })).toContainText(BAIT);
  catchNumber = new URL(page.url()).searchParams.get('catchNumber');
});

test('a setup change after the catch adds version 2; the catch keeps version 1', async ({ page }) => {
  await page.goto(`gear-setup.html?id=${tipId}`);
  await page.locator('#hook').fill(HOOK_1);
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tipId}`));
  expect((await findTip()).setup.versionNo).toBe(2);
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`);
  await expect(page.locator('.detail-row', { hasText: 'Caught on' }).locator('.caught-on-setup')).toContainText(HOOK_2);
});

test('rename and retire; the history shows both and the setup is locked', async ({ page }) => {
  await page.goto(`gear-edit.html?id=${tipId}`);
  await page.locator('#name').fill(`${NAME} b`);
  await page.locator('#statusPills [data-status="Retired"]').click();
  await page.locator('#retiredNote').fill('E2E test: lost down the hole');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#historyList')).toContainText(`Renamed ${NAME} → ${NAME} b`);
  await expect(page.locator('#historyList')).toContainText('Retired: E2E test: lost down the hole');
  await expect(page.locator('#setupLink')).toBeHidden();
});
