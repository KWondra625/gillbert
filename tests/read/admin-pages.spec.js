// Layer 1, read-only: the admin pages for anglers, fish species and bodies of water.
// Nothing here saves; edit forms are only checked for loading the right record.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet } = require('../support/staging-api');

const SECTIONS = [
  { label: 'anglers', endpoint: 'anglers/get', listing: 'anglers-listing.html',
    rows: '#anglerCardGrid .angler-card', edit: 'edit-angler.html', create: 'create-angler.html',
    form: '#anglerForm', nameOf: r => r.name },
  { label: 'fish species', endpoint: 'fish-species/get', listing: 'fish-species-listing.html',
    rows: '#speciesTableBody .data-row', edit: 'edit-fish-species.html', create: 'create-fish-species.html',
    form: '#speciesForm', nameOf: r => r.displayNameOverride || r.name },
  { label: 'bodies of water', endpoint: 'bodies-of-water/get', listing: 'bodies-of-water-listing.html',
    rows: '#waterTableBody .data-row', edit: 'edit-body-of-water.html', create: 'create-body-of-water.html',
    form: '#waterForm', nameOf: r => r.name },
];

function asList(data) {
  if (Array.isArray(data)) return data;
  return Object.values(data).find(Array.isArray) || [];
}

for (const s of SECTIONS) {
  test.describe(s.label, () => {
    let records;
    test.beforeAll(async () => { records = asList(await apiGet(s.endpoint)); });

    for (const path of [s.listing, s.create, `${s.edit}?id=1`]) {
      test(`${path.split('?')[0]} turns away a visitor who isn't admin`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('#errorMsg')).toHaveText("You don't have permission to access this page.");
      });
    }

    test('the listing shows every record, and the status filter narrows it', async ({ page }) => {
      await unlockAdmin(page);
      await page.goto(s.listing);
      const rows = page.locator(s.rows);
      await expect(rows).toHaveCount(records.length);

      const active = records.filter(r => r.status === 'Active').length;
      await page.locator('#statusFilter .status-filter-btn[data-status="Active"]').click();
      await expect(rows).toHaveCount(active);
      await page.locator('#statusFilter .status-filter-btn[data-status="Inactive"]').click();
      await expect(rows).toHaveCount(records.length - active);
    });

    test('search narrows the listing', async ({ page }) => {
      await unlockAdmin(page);
      await page.goto(s.listing);
      const target = s.nameOf(records[records.length - 1]);
      await expect(page.locator(s.rows).first()).toBeVisible();
      await page.locator('#searchInput').fill(target);
      const rows = page.locator(s.rows);
      await expect(rows.first()).toContainText(target);
      expect(await rows.count()).toBeLessThan(records.length + (records.length === 1 ? 1 : 0));
    });

    test('opening a record fills the edit form with it', async ({ page }) => {
      await unlockAdmin(page);
      await page.goto(s.listing);
      const record = records[0];
      await page.locator(s.rows).locator(`a.row-edit-link[href*="id=${record.id}"]`).first().click();

      await expect(page).toHaveURL(new RegExp(`${s.edit}\\?id=${record.id}`));
      await expect(page.locator(s.form)).toBeVisible();
      await expect(page.locator('#formHeading')).toContainText(s.nameOf(record));
    });

    test('the create form opens empty', async ({ page }) => {
      await unlockAdmin(page);
      await page.goto(s.create);
      await expect(page.locator(s.form)).toBeVisible();
      await expect(page.locator('#name')).toHaveValue('');
    });
  });
}
