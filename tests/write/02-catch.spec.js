// Layer 2, create and clean up (Staging only): logging a catch through the form, finding
// it, and editing it. The catch is credited to the test angler, species and lake from
// 01-lookups when they exist, and carries the [E2E Test] notes marker for cleanup.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getCatches, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID, findTestCatches } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const NOTES = `${NOTES_MARKER} logged through the form, run ${RUN_ID}`;

async function pickOptions() {
  const { anglers, fishSpecies, bodiesOfWater } = await getLookups();
  const pick = (list, kind) => list.find(r => r.name === testName(kind)) || list[0];
  return { angler: pick(anglers, 'Angler'), species: pick(fishSpecies, 'Species'), water: pick(bodiesOfWater, 'Lake') };
}

test('log a catch through the form and land on its detail page', async ({ page }) => {
  const { angler, species, water } = await pickOptions();
  await page.goto('log-catch.html');
  await expect(page.locator('#catchForm')).toBeVisible();
  await page.locator('#anglerId').selectOption(String(angler.id));
  await page.locator('#fishSpeciesId').selectOption(String(species.id));
  await page.locator('#bodyOfWaterId').selectOption(String(water.id));
  await page.locator('#lengthInInches').fill('17.5');
  await page.locator('#waterDepthInFeet').fill('9');
  await page.locator('#notes').fill(NOTES);
  await page.locator('#saveViewBtn').click();

  await expect(page).toHaveURL(/catch-details\.html\?catchNumber=Catch%20\d{2}-\d+/);
  const details = page.locator('#detailsContainer');
  await expect(details).toContainText(angler.name);
  await expect(details).toContainText(water.name);
  await expect(details).toContainText('17.5');
});

test('the new catch shows up in the listing, marked pending review', async ({ page }) => {
  const [mine] = (await findTestCatches()).filter(c => c.notes === NOTES);
  test.skip(!mine, 'the log test did not run or failed');
  await page.goto('catches-listing.html');
  const card = page.locator('#catchesContainer .catch-card', { hasText: mine.catchNumber });
  await expect(card).toBeVisible();
  await expect(card.locator('.badge-pending')).toBeVisible();
  await expect(card.locator('.badge-new')).toBeVisible();
});

test('Save & Log Another keeps the form open with a link to the saved catch', async ({ page }) => {
  const { angler, species, water } = await pickOptions();
  await page.goto('log-catch.html');
  await expect(page.locator('#catchForm')).toBeVisible();
  await page.locator('#anglerId').selectOption(String(angler.id));
  await page.locator('#fishSpeciesId').selectOption(String(species.id));
  await page.locator('#bodyOfWaterId').selectOption(String(water.id));
  await page.locator('#notes').fill(`${NOTES_MARKER} save-another, run ${RUN_ID}`);
  await page.locator('#saveAnotherBtn').click();

  await expect(page.locator('#successBanner')).toBeVisible();
  await expect(page.locator('#successBannerLink')).toHaveText(/View Catch \d{2}-\d+/);
  await expect(page.locator('#notes')).toHaveValue('');
});

test('an admin can edit the catch, and the change shows on its detail page', async ({ page }) => {
  const [mine] = (await findTestCatches()).filter(c => c.notes === NOTES);
  test.skip(!mine, 'the log test did not run or failed');
  await unlockAdmin(page);
  await page.goto(`edit-catch.html?catchNumber=${encodeURIComponent(mine.catchNumber)}`);
  await expect(page.locator('#catchForm')).toBeVisible();
  await expect(page.locator('#notes')).toHaveValue(NOTES);
  await page.locator('#lengthInInches').fill('18.25');
  await page.locator('#saveBtn').click();

  await expect(page).toHaveURL(/catch-details\.html/);
  await expect(page.locator('#detailsContainer')).toContainText('18.25');
  const updated = (await getCatches()).find(c => c.catchNumber === mine.catchNumber);
  expect(updated.length).toBe(18.25);
  expect(updated.notes).toBe(NOTES);
});
