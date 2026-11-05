// Layer 2, create and clean up (Staging only): a fish species shows under its display-
// name override when it has one, and under its DNR name when it doesn't. Creates one
// species of each kind, so both cases are covered whatever Staging's data looks like.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const WITH = { name: testName('Species Override'), override: testName('Species Nickname') };
const WITHOUT = { name: testName('Species Plain') };

for (const s of [WITH, WITHOUT]) {
  test(`create "${s.name}" ${s.override ? 'with' : 'without'} an override name`, async ({ page }) => {
    await unlockAdmin(page);
    await page.goto('create-fish-species.html');
    await page.locator('#name').fill(s.name);
    if (s.override) await page.locator('#displayNameOverride').fill(s.override);
    await page.locator('#createBtn').click();
    await expect(page).toHaveURL(/edit-fish-species\.html\?id=\d+/);
  });
}

test('lookup data and Log a Catch use the override name only where one is set', async ({ page }) => {
  const { fishSpecies } = await getLookups();
  const withOverride = fishSpecies.find(s => s.name === WITH.name);
  const without = fishSpecies.find(s => s.name === WITHOUT.name);
  expect(withOverride, 'species with an override is in the lookup data').toBeTruthy();
  expect(without, 'species without an override is in the lookup data').toBeTruthy();
  expect(withOverride.displayNameOverride).toBe(WITH.override);
  expect(without.displayNameOverride).toBeNull();

  await page.goto('log-catch.html');
  await expect(page.locator('#catchForm')).toBeVisible();
  await expect(page.locator(`#fishSpeciesId option[value="${withOverride.id}"]`)).toHaveText(WITH.override);
  await expect(page.locator(`#fishSpeciesId option[value="${without.id}"]`)).toHaveText(WITHOUT.name);
});
