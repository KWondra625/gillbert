// Layer 2, create and clean up (Staging only): who may edit a catch, and admin
// verification. An angler can edit a catch they caught or logged, without the admin
// PIN, until it's verified; after that only an admin can. Uses a test angler with a
// made-up login email, so a test can "be" that angler through the identity fixture.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getCatches, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID, apiPost } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const OWNER_EMAIL = `e2e-owner-${RUN_ID}@example.com`;
const OWNER_NAME = testName('Owner');
const NOTES = `${NOTES_MARKER} owner-edit test, run ${RUN_ID}`;

async function owner() {
  return (await getLookups()).anglers.find(a => a.name === OWNER_NAME);
}
async function ownersCatch() {
  return (await getCatches()).find(c => c.notes === NOTES || (c.notes || '').startsWith(NOTES));
}
const detailUrl = c => `catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}`;
const editUrl = c => `edit-catch.html?catchNumber=${encodeURIComponent(c.catchNumber)}`;

test('set up: a test angler with a login email, and a catch they caught', async ({ page }) => {
  await unlockAdmin(page);
  await page.goto('create-angler.html');
  await page.locator('#name').fill(OWNER_NAME);
  await page.locator('#loginEmails').fill(OWNER_EMAIL);
  await page.locator('#createBtn').click();
  await expect(page).toHaveURL(/edit-angler\.html\?id=\d+/);

  const angler = await owner();
  expect(angler.loginEmails).toEqual([OWNER_EMAIL]);
  const [any] = await getCatches();
  await apiPost('catch/commit', {
    anglerId: angler.id, fishSpeciesId: any.fishSpeciesId, bodyOfWaterId: any.bodyOfWaterId,
    caughtWhen: new Date().toISOString(), recordSource: 'Web Form', conversationId: null,
    createdByAnglerId: null, updatedByAnglerId: null, notes: NOTES,
  });
  expect(await ownersCatch()).toBeTruthy();
});

test.describe('someone who is neither the owner nor an admin', () => {
  test.use({ identityEmail: `e2e-stranger-${RUN_ID}@example.com` });

  test('sees no Edit link, and the edit page refuses them', async ({ page }) => {
    const c = await ownersCatch();
    await page.goto(detailUrl(c));
    await expect(page.locator('.detail-card-header h2')).toContainText(c.catchNumber);
    await expect(page.locator('#editCatchLink')).toBeHidden();
    await expect(page.locator('#verifyToggle')).toBeHidden();

    await page.goto(editUrl(c));
    await expect(page.locator('#errorMsg')).toHaveText("You don't have permission to edit this catch.");
  });
});

test.describe('the angler who caught it, before it is verified', () => {
  test.use({ identityEmail: OWNER_EMAIL });

  test('sees Edit (but not Verify) and can save a change without the PIN', async ({ page }) => {
    const c = await ownersCatch();
    await page.goto(detailUrl(c));
    await expect(page.locator('#editCatchLink')).toBeVisible();
    await expect(page.locator('#verifyToggle')).toBeHidden();

    await page.locator('#editCatchLink').click();
    await expect(page.locator('#catchForm')).toBeVisible();
    await page.locator('#notes').fill(`${NOTES} (edited by owner)`);
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html/);
    expect((await ownersCatch()).notes).toBe(`${NOTES} (edited by owner)`);
  });
});

test('an admin verifies it', async ({ page }) => {
  const c = await ownersCatch();
  await unlockAdmin(page);
  await page.goto(detailUrl(c));
  await expect(page.locator('.pending-review-badge')).toBeVisible();
  await page.locator('#verifyToggle').click();
  await expect(page.locator('.verified-badge')).toBeVisible();
  await expect.poll(async () => (await ownersCatch()).verifiedAt, { timeout: 20_000 }).toBeTruthy();
});

test.describe('the angler who caught it, after it is verified', () => {
  test.use({ identityEmail: OWNER_EMAIL });

  test('can no longer edit it', async ({ page }) => {
    const c = await ownersCatch();
    await page.goto(detailUrl(c));
    await expect(page.locator('.verified-badge')).toBeVisible();
    await expect(page.locator('#editCatchLink')).toBeHidden();
    await page.goto(editUrl(c));
    await expect(page.locator('#errorMsg')).toHaveText("You don't have permission to edit this catch.");
  });
});

test('an admin can still edit a verified catch, and can unverify it', async ({ page }) => {
  const c = await ownersCatch();
  await unlockAdmin(page);
  await page.goto(detailUrl(c));
  await expect(page.locator('#editCatchLink')).toBeVisible();
  await page.locator('#verifyToggle').click();
  await expect(page.locator('.pending-review-badge')).toBeVisible();
  await expect.poll(async () => (await ownersCatch()).verifiedAt, { timeout: 20_000 }).toBeNull();
});

test.describe('an angler who logged a catch for someone else', () => {
  test.use({ identityEmail: OWNER_EMAIL });

  test('is recorded as its logger, and can edit it', async ({ page }) => {
    const me = await owner();
    const someoneElse = (await getLookups()).anglers.find(a => a.id !== me.id && !a.name.startsWith('E2E Test'));
    await page.goto('log-catch.html');
    await expect(page.locator('#catchForm')).toBeVisible();
    await page.locator('#anglerId').selectOption(String(someoneElse.id));
    await page.locator('#fishSpeciesId').selectOption({ index: 1 });
    await page.locator('#bodyOfWaterId').selectOption({ index: 1 });
    await page.locator('#notes').fill(`${NOTES_MARKER} logged by the owner for someone else, run ${RUN_ID}`);
    await page.locator('#saveViewBtn').click();

    await expect(page).toHaveURL(/catch-details\.html/);
    await expect(page.locator('#editCatchLink')).toBeVisible();
    const logged = (await getCatches()).find(c => (c.notes || '').includes('logged by the owner for someone else') && c.notes.includes(RUN_ID));
    expect(logged.anglerId).toBe(someoneElse.id);
    expect(logged.createdByAnglerId).toBe(me.id);
  });
});
