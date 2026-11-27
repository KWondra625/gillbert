// Layer 2, create and clean up (Staging only), OPT-IN: logging a catch by talking to
// Gillbert in Catch Chat. It calls Claude several times, so it only runs with
// CATCH_CHAT_TESTS=1 (and not with SKIP_AI=1). The chat runs as a test angler, through
// the identity fixture, on a test chat session; cleanup removes the catch, the
// conversation and the chat memory. Gear stage 5: the angler also names a test tip-up and a
// test bait, and both land on the catch (cleanup removes the tip-up and the bait choice too).
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { getCatches, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, RUN_ID, useTestChatSession } = require('../support/test-data');

requireStagingWrites();
test.skip(process.env.CATCH_CHAT_TESTS !== '1', 'set CATCH_CHAT_TESTS=1 to run the Catch Chat test');
test.skip(!!process.env.SKIP_AI, 'SKIP_AI is set');
test.describe.configure({ mode: 'serial' });

const EMAIL = `e2e-chat-${RUN_ID}@example.com`;
const ANGLER = testName('Chat Angler');
const TIP_UP = testName('Chat Tip-up');
const BAIT = testName('Chat Bait');
const MAX_TURNS = 5;

async function me() {
  return (await getLookups()).anglers.find(a => a.name === ANGLER);
}
async function myCatch() {
  const angler = await me();
  return angler && (await getCatches()).find(c => c.anglerId === angler.id);
}

test('set up: a test angler with a login email', async ({ page }) => {
  await unlockAdmin(page);
  await page.goto('create-angler.html');
  await page.locator('#name').fill(ANGLER);
  await page.locator('#loginEmails').fill(EMAIL);
  await page.locator('#createBtn').click();
  await expect(page).toHaveURL(/edit-angler\.html\?id=\d+/);
});

test('set up: a test tip-up for the angler to name', async ({ page }) => {
  await page.goto('gear-edit.html');
  await page.locator('#name').fill(TIP_UP);
  await page.locator('#owner').selectOption({ label: ANGLER });
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
});

test.describe('logged in as the test angler', () => {
  test.use({ identityEmail: EMAIL });

  test('describe a catch in plain words, confirm it, and it is saved correctly', async ({ page }) => {
    test.setTimeout(MAX_TURNS * 120_000);
    const { fishSpecies, bodiesOfWater } = await getLookups();
    const species = fishSpecies.find(s => s.name === 'Northern Pike') || fishSpecies[0];
    const water = bodiesOfWater.find(w => w.name === 'Pine Lake') || bodiesOfWater[0];
    const speciesName = species.displayNameOverride || species.name;

    await useTestChatSession(page, 'gillbert_chat_session');
    await page.goto('catch-chat.html');
    const replies = page.locator('.message--gillbert:not(.message--thinking):not(.message--error)');
    let said = `I caught a 21 inch ${speciesName} on ${water.name} today at 2pm, in 8 feet of water, on tip-up ${TIP_UP} with ${BAIT} for bait. No notes.`;

    // Answer like a person would: Gillbert sometimes takes "I" to mean the logged-in
    // angler and sometimes asks who caught it, so reply to what it actually asked.
    for (let turn = 0; turn < MAX_TURNS && !(await myCatch()); turn++) {
      const before = await replies.count();
      await page.locator('#chatInput').fill(said);
      await page.locator('#chatSendBtn').click();
      await expect(replies).toHaveCount(before + 1, { timeout: 110_000 });
      await expect(page.locator('.message--error')).toHaveCount(0);
      const asked = (await replies.last().textContent()).toLowerCase();
      said = /who (caught|gets|landed|reeled)|whose|angler name|your name|which angler/.test(asked)
        ? 'Me, I caught it myself.'
        : "Yes, that's all correct. Please save it.";
    }

    const saved = await myCatch();
    expect(saved, `a catch was saved within ${MAX_TURNS} turns`).toBeTruthy();
    expect(saved.fishSpeciesName).toBe(speciesName);
    expect(saved.bodyOfWaterName).toBe(water.name);
    expect(saved.length).toBe(21);
    expect(saved.waterDepth).toBe(8);
    expect(saved.recordSource).toBe('Gillbert Chat');
    expect(saved.createdByAnglerId).toBe((await me()).id);
    expect(saved.caughtOn && saved.caughtOn.name).toBe(TIP_UP);
    expect(saved.bait).toBe(BAIT);
    // Gillbert's reply names the new catch, and the page turns that into a link.
    await expect(page.locator(`a.chat-catch-link`, { hasText: saved.catchNumber })).toBeVisible();
  });
});
