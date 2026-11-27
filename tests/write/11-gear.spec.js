// Layer 2, create and clean up (Staging only): a tip-up through the gear pages, end to end.
// Add one, set it up, change the setup, rename and retire it, and check its history on the way.
// The tip-up and its tags are named "E2E Test …"; run `npm run cleanup` afterwards to remove them
// (its versions and history go with it).
// Needs the gear tables, functions and endpoints on Staging (scripts/gear, tools/n8n-migration/gear).
const { test, expect } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, testName } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const NAME = testName('Tip-up');
const LINE = testName('Line');
const HOOK_1 = testName('Hook A');
const HOOK_2 = testName('Hook B');
const BEAD = testName('Bead');
let tipId;

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
