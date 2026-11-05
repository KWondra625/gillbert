// Layer 2, create and clean up (Staging only): making an angler, species or body of
// water Inactive. It should drop out of the choices for new catches (the lookup data
// only returns Active records), while catches already using it keep showing it.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet, getCatches, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID, apiPost } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const NOTES = `${NOTES_MARKER} inactive-records test, run ${RUN_ID}`;
const KINDS = [
  { key: 'angler', name: testName('Inactive Angler'), create: 'create-angler.html', edit: 'edit-angler.html',
    get: 'anglers/get', lookup: 'anglers', select: '#anglerId', listing: 'anglers-listing.html', rows: '#anglerCardGrid .angler-card' },
  { key: 'species', name: testName('Inactive Species'), create: 'create-fish-species.html', edit: 'edit-fish-species.html',
    get: 'fish-species/get', lookup: 'fishSpecies', select: '#fishSpeciesId', listing: 'fish-species-listing.html', rows: '#speciesTableBody .data-row' },
  { key: 'water', name: testName('Inactive Lake'), create: 'create-body-of-water.html', edit: 'edit-body-of-water.html',
    get: 'bodies-of-water/get', lookup: 'bodiesOfWater', select: '#bodyOfWaterId', listing: 'bodies-of-water-listing.html', rows: '#waterTableBody .data-row' },
];

async function record(k) {
  return (await apiGet(k.get)).find(r => r.name === k.name);
}
async function theCatch() {
  return (await getCatches()).find(c => c.notes === NOTES);
}

test('set up: an active test angler, species and lake, and a catch that uses all three', async ({ page }) => {
  await unlockAdmin(page);
  for (const k of KINDS) {
    await page.goto(k.create);
    await page.locator('#name').fill(k.name);
    await page.locator('#createBtn').click();
    await expect(page).toHaveURL(new RegExp(`${k.edit}\\?id=\\d+`));
  }
  const [angler, species, water] = await Promise.all(KINDS.map(record));
  await apiPost('catch/commit', {
    anglerId: angler.id, fishSpeciesId: species.id, bodyOfWaterId: water.id,
    caughtWhen: new Date().toISOString(), recordSource: 'Web Form', conversationId: null,
    createdByAnglerId: null, updatedByAnglerId: null, notes: NOTES,
  });
  expect(await theCatch()).toBeTruthy();
});

for (const k of KINDS) {
  test(`make the test ${k.key} Inactive on its edit page`, async ({ page }) => {
    const r = await record(k);
    await unlockAdmin(page);
    await page.goto(`${k.edit}?id=${r.id}`);
    await expect(page.locator('#statusPills')).toBeVisible();
    await page.locator('#statusPills .status-pill[data-status="Inactive"]').click();
    await page.locator('#saveBtn').click();
    await expect.poll(async () => (await record(k)).status, { timeout: 20_000 }).toBe('Inactive');
  });
}

test('inactive records drop out of the lookup data and the Log a Catch dropdowns', async ({ page }) => {
  const lookups = await getLookups();
  const ids = await Promise.all(KINDS.map(async k => (await record(k)).id));
  KINDS.forEach((k, i) => expect(lookups[k.lookup].some(r => r.id === ids[i]), `${k.key} in lookup data`).toBe(false));

  await page.goto('log-catch.html');
  await expect(page.locator('#catchForm')).toBeVisible();
  for (const [i, k] of KINDS.entries()) {
    await expect(page.locator(`${k.select} option[value="${ids[i]}"]`), k.key).toHaveCount(0);
  }
});

test('the existing catch still shows its inactive angler, species and lake', async ({ page }) => {
  const c = await theCatch();
  expect([c.anglerName, c.fishSpeciesName, c.bodyOfWaterName]).toEqual(KINDS.map(k => k.name));
  await page.goto(`catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`);
  const details = page.locator('#detailsContainer');
  for (const k of KINDS) await expect(details).toContainText(k.name);
});

test('the admin listings show them under the Inactive filter', async ({ page }) => {
  await unlockAdmin(page);
  for (const k of KINDS) {
    await page.goto(k.listing);
    await page.locator('#statusFilter .status-filter-btn[data-status="Inactive"]').click();
    await page.locator('#searchInput').fill(k.name);
    await expect(page.locator(k.rows), k.key).toHaveCount(1);
  }
});

test('Edit Catch keeps the catch\'s inactive angler, species and lake selected', async ({ page }) => {
  // The dropdowns only list Active records, so the catch's own (now inactive) choices
  // must still be offered, or the form opens blank and can't be saved unchanged.
  const c = await theCatch();
  const ids = await Promise.all(KINDS.map(async k => (await record(k)).id));
  await unlockAdmin(page);
  await page.goto(`edit-catch.html?catchNumber=${encodeURIComponent(c.catchNumber)}`);
  await expect(page.locator('#catchForm')).toBeVisible();
  for (const [i, k] of KINDS.entries()) {
    await expect(page.locator(k.select), k.key).toHaveValue(String(ids[i]));
    await expect(page.locator(`${k.select} option[value="${ids[i]}"]`)).toHaveText(`${k.name} (inactive)`);
  }

  // Saving an unrelated change keeps all three as they were.
  await page.locator('#notes').fill(`${NOTES} (edited)`);
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/catch-details\.html/);
  const saved = (await getCatches()).find(x => x.id === c.id);
  expect(saved.notes).toBe(`${NOTES} (edited)`);
  expect([saved.anglerId, saved.fishSpeciesId, saved.bodyOfWaterId]).toEqual(ids);
});
