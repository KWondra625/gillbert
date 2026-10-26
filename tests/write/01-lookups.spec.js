// Layer 2, create and clean up (Staging only): adding and editing an angler, a fish
// species and a body of water through the admin forms. Everything is named "E2E Test …";
// run `npm run cleanup` afterwards to remove it.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');
const { requireStagingWrites, testName } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const SECTIONS = [
  { kind: 'Angler', create: 'create-angler.html', edit: 'edit-angler.html', endpoint: 'anglers/get',
    form: '#anglerForm', listing: 'anglers-listing.html', rows: '#anglerCardGrid .angler-card', editField: '#aliases' },
  { kind: 'Species', create: 'create-fish-species.html', edit: 'edit-fish-species.html', endpoint: 'fish-species/get',
    form: '#speciesForm', listing: 'fish-species-listing.html', rows: '#speciesTableBody .data-row', editField: '#notes' },
  { kind: 'Lake', create: 'create-body-of-water.html', edit: 'edit-body-of-water.html', endpoint: 'bodies-of-water/get',
    form: '#waterForm', listing: 'bodies-of-water-listing.html', rows: '#waterTableBody .data-row', editField: '#notes' },
];

async function findByName(endpoint, name) {
  const data = await apiGet(endpoint);
  const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
  return list.find(r => r.name === name);
}

for (const s of SECTIONS) {
  test(`create a test ${s.kind.toLowerCase()} and find it in the listing`, async ({ page }) => {
    const name = testName(s.kind);
    await unlockAdmin(page);
    await page.goto(s.create);
    await page.locator('#name').fill(name);
    await page.locator('#createBtn').click();

    // A successful create lands on the new record's edit page.
    await expect(page).toHaveURL(new RegExp(`${s.edit}\\?id=\\d+`));
    await expect(page.locator('#formHeading')).toContainText(name);
    expect(await findByName(s.endpoint, name), 'saved on Staging').toBeTruthy();

    await page.goto(s.listing);
    await page.locator('#searchInput').fill(name);
    await expect(page.locator(s.rows)).toHaveCount(1);
  });

  test(`edit the test ${s.kind.toLowerCase()}`, async ({ page }) => {
    const record = await findByName(s.endpoint, testName(s.kind));
    test.skip(!record, 'the create test did not run or failed');
    await unlockAdmin(page);
    await page.goto(`${s.edit}?id=${record.id}`);
    await expect(page.locator(s.form)).toBeVisible();
    await page.locator(s.editField).fill(`edited by the automated tests ${Date.now()}`);
    await page.locator('#saveBtn').click();
    await expect.poll(async () => (await findByName(s.endpoint, record.name)).updatedAt, { timeout: 20_000 })
      .not.toBe(record.updatedAt);
    await expect(page.locator('#formError')).toBeHidden();
  });
}

test.describe('duplicate names', () => {
  test.use({ allowConsoleErrors: true }); // the page logs the refused save

  test('a duplicate angler name is refused with a friendly message', async ({ page }) => {
    const existing = await findByName('anglers/get', testName('Angler'));
    test.skip(!existing, 'the create test did not run or failed');
    await unlockAdmin(page);
    await page.goto('create-angler.html');
    await page.locator('#name').fill(existing.name);
    await page.locator('#createBtn').click();
    await expect(page.locator('#formError')).toBeVisible();
    await expect(page).toHaveURL(/create-angler\.html/);
  });
});
