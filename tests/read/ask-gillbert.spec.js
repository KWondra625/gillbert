// Layer 1, read-only: Ask Gillbert answers questions about the record book correctly,
// checked against the Staging data itself. These call Claude, so they spend API
// tokens. They run by default; set SKIP_AI=1 to skip them. Desktop only: one set of
// AI calls per run is enough. Each question uses a test chat session, which leaves
// chat-memory rows on Staging for `npm run cleanup` to remove.
const { test, expect } = require('../support/fixtures');
const { getCatches } = require('../support/staging-api');
const { useTestChatSession } = require('../support/test-data');

test.skip(!!process.env.SKIP_AI, 'SKIP_AI is set');

let catches;
test.beforeAll(async () => { catches = await getCatches(); });

// Asks one question in a fresh chat and returns Gillbert's reply text.
async function ask(page, question) {
  test.skip(test.info().project.name !== 'desktop-chrome', 'AI questions run on desktop only');
  test.setTimeout(120_000);
  await useTestChatSession(page, 'gillbert_ask_session');
  await page.goto('ask-gillbert.html');
  await page.locator('#chatInput').fill(question);
  await page.locator('#chatSendBtn').click();
  const reply = page.locator('.message--gillbert:not(.message--thinking):not(.message--error)').last();
  await expect(reply).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.message--error')).toHaveCount(0);
  return (await reply.textContent()).trim();
}

const numbersIn = text => (text.replace(/,/g, '').match(/\d+(\.\d+)?/g) || []).map(Number);

test('knows how many catches are in the record book', async ({ page }) => {
  const reply = await ask(page, 'How many catches are in the record book? Answer with just the number.');
  expect(numbersIn(reply), reply).toContain(catches.length);
});

test('counts one angler\'s catches correctly', async ({ page }) => {
  const counts = {};
  for (const c of catches) counts[c.anglerName] = (counts[c.anglerName] || 0) + 1;
  // An angler with a middling number of catches: not trivially 1, not the whole book.
  const [name, count] = Object.entries(counts).sort((a, b) => a[1] - b[1])[Math.floor(Object.keys(counts).length / 2)];
  const reply = await ask(page, `How many catches does ${name} have? Answer with just the number.`);
  expect(numbersIn(reply), reply).toContain(count);
});

test('knows the longest catch of the most-caught species', async ({ page }) => {
  const bySpecies = {};
  for (const c of catches) (bySpecies[c.fishSpeciesName] ||= []).push(c);
  const [species, list] = Object.entries(bySpecies).sort((a, b) => b[1].length - a[1].length)[0];
  const longest = Math.max(...list.map(c => c.length || 0));
  const reply = await ask(page, `What is the longest ${species} in the record book, in inches? Answer with just the length.`);
  expect(numbersIn(reply), reply).toContain(longest);
});
