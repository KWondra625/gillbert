// Layer 2, create and clean up (Staging only): seeds a season's worth of gear catches through the
// app and checks the Gear Stats page (gear stage 4) against them.
//
// Five test tip-ups (one never set up), two of them changed mid-season so catches land on two
// setup versions; about 20 catches through Log a Catch (both Save buttons, some with no tip-up,
// which stats leave out), a few changed on Edit Catch, and with CATCH_CHAT_TESTS=1 a few more by
// talking to Catch Chat. Then gear/stats is checked against an independent count made from
// get-catches (each catch reports the setup it was caught on), unfiltered and per species and
// lake, and the page is checked to show it.
//
// Everything is "E2E Test …" or carries NOTES_MARKER; run `npm run cleanup` afterwards to remove it.
// The verify test can be run on its own (-g "match") against whatever is on Staging.
const { test, expect, unlockAdmin } = require('../support/fixtures');
const { apiGet, getCatches, getLookups } = require('../support/staging-api');
const { requireStagingWrites, testName, NOTES_MARKER, RUN_ID, useTestChatSession } = require('../support/test-data');

requireStagingWrites();
test.describe.configure({ mode: 'serial' });

const T = n => testName(`Stats ${n}`);
const TAG = {
  line20: T('Braid 20 lb'), line15: T('Braid 15 lb'), fluoro: T('Fluoro 10 lb'),
  octopus: T('#8 Octopus'), treble: T('#6 Treble'), quick: T('Quick-strike'),
  glow: T('Glow'), red: T('Red'), blade: T('Gold blade'),
  sucker: T('Sucker (medium)'), shiner: T('Shiner (large)'),
};
// v1 for all; v2 (mid-season) for A and D. E is never set up.
const TIPS = {
  A: { name: T('Tip A'), v1: { line: TAG.line20, hook: TAG.octopus, beads: [TAG.glow] },
       v2: { line: TAG.line20, hook: TAG.octopus, beads: [TAG.glow, TAG.red], flash: [TAG.blade] } },
  B: { name: T('Tip B'), v1: { line: TAG.line20, hook: TAG.treble, flash: [TAG.blade] } },
  C: { name: T('Tip C'), v1: { line: TAG.line15, leader: TAG.fluoro, hook: TAG.octopus, beads: [TAG.red] } },
  D: { name: T('Tip D'), v1: { line: TAG.line15, hook: TAG.quick }, v2: { line: TAG.line15, hook: TAG.octopus } },
  E: { name: T('Tip E') },
};
const ids = {};

// Before the mid-season change: dated earlier this season, so they land on v1.
// [tip (or null), bait, length, species index, water index, date]
const EARLY = [
  ['A', TAG.sucker, 34, 0, 0, '2026-11-08'], ['A', TAG.sucker, 22, 1, 0, '2026-11-08'],
  ['A', TAG.shiner, 27.5, 0, 1, '2026-11-12'], ['B', TAG.sucker, 19, 1, 0, '2026-11-08'],
  ['B', TAG.shiner, null, 2, 1, '2026-11-12'], ['C', TAG.sucker, 31, 0, 1, '2026-11-15'],
  ['C', null, 17, 1, 1, '2026-11-15'], ['D', TAG.shiner, 24, 0, 0, '2026-11-20'],
  ['D', TAG.sucker, 21.5, 1, 2, '2026-11-20'], ['E', TAG.sucker, 29, 0, 2, '2026-11-21'],
  [null, TAG.sucker, 40, 0, 0, '2026-11-21'], [null, null, 15, 2, 1, '2026-11-22'],
];
// After it: today, after v2 was saved, so A and D's land on v2.
const LATE = [
  ['A', TAG.sucker, 38, 0, 0], ['A', TAG.shiner, 20, 1, 0], ['A', TAG.sucker, null, 0, 1],
  ['D', TAG.sucker, 33, 0, 2], ['D', TAG.shiner, 18, 1, 2], ['B', TAG.sucker, 26, 0, 1],
  ['C', TAG.shiner, 23, 1, 0], ['E', TAG.shiner, 16, 2, 2], [null, TAG.shiner, 25, 1, 0],
];
let lookups;
const logged = [];   // catch numbers from Log a Catch

const ymd = d => d.toLocaleDateString('en-CA');
const hm = d => d.toTimeString().slice(0, 5);

async function setUp(page, tip, setup) {
  await page.goto(`gear-setup.html?id=${tip}`);
  await page.locator('#formState:not(.hidden)').waitFor();
  for (const f of ['line', 'leader', 'hook']) await page.locator(`#${f}`).fill(setup[f] || '');
  for (const [box, wrap, list] of [['#beadsInput', '#beadsWrapper', setup.beads], ['#flashInput', '#flashWrapper', setup.flash]]) {
    const pills = page.locator(`${wrap} .tag-pill-remove`);
    while (await pills.count()) await pills.first().click();
    for (const v of list || []) { await page.locator(box).fill(v); await page.locator(box).press('Enter'); }
  }
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(new RegExp(`gear-tipup\\.html\\?id=${tip}`));
}

async function logCatch(page, [tip, bait, length, sp, bw, date], when, another) {
  if (!another || !page.url().includes('log-catch.html')) await page.goto('log-catch.html');
  await page.locator('#catchForm').waitFor();
  const a = lookups.anglers[logged.length % Math.min(3, lookups.anglers.length)];
  await page.locator('#anglerId').selectOption(String(a.id));
  await page.locator('#fishSpeciesId').selectOption(String(lookups.species[sp].id));
  await page.locator('#bodyOfWaterId').selectOption(String(lookups.waters[bw].id));
  await page.locator('#catchDate').fill(date || ymd(when));
  await page.locator('#catchTime').fill(date ? '09:30' : hm(when));
  await page.locator('#lengthInInches').fill(length == null ? '' : String(length));
  await page.locator('#gearSearch').fill(tip ? TIPS[tip].name : '');
  if (tip) await page.locator('#gearSuggestions .tag-suggestion', { hasText: TIPS[tip].name }).first().click();
  await page.locator('#bait').fill(bait || '');
  await page.locator('#notes').fill(`${NOTES_MARKER} gear stats seed ${RUN_ID}`);
  if (another) {
    await page.locator('#saveAnotherBtn').click();
    await expect(page.locator('#successBanner')).toBeVisible();
    const href = await page.locator('#successBannerLink').getAttribute('href');
    logged.push(new URL(href, 'http://x/').searchParams.get('catchNumber'));
  } else {
    await page.locator('#saveViewBtn').click();
    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
    logged.push(new URL(page.url()).searchParams.get('catchNumber'));
  }
}

test('set up: five test tip-ups, four with a setup', async ({ page }) => {
  const lk = await getLookups();
  for (const [k, tip] of Object.entries(TIPS)) {
    await page.goto('gear-edit.html');
    await page.locator('#name').fill(tip.name);
    await page.locator('#owner').selectOption({ index: 1 + (k.charCodeAt(0) % Math.max(1, Math.min(3, lk.anglers.length))) });
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/gear-setup\.html\?id=\d+&new=1/);
    ids[k] = new URL(page.url()).searchParams.get('id');
    if (tip.v1) await setUp(page, ids[k], tip.v1);
  }
});

test('log the early-season catches on Log a Catch', async ({ page }) => {
  test.setTimeout(300_000);
  const lk = await getLookups();
  lookups = { anglers: lk.anglers, species: lk.fishSpecies.slice(0, 3), waters: lk.bodiesOfWater.slice(0, 3) };
  for (let i = 0; i < EARLY.length; i++) await logCatch(page, EARLY[i], null, i % 3 !== 0 && i > 0);
  expect(logged).toHaveLength(EARLY.length);
});

test('mid-season: change A (more beads, a flash) and D (new hook)', async ({ page }) => {
  test.setTimeout(150_000);
  await setUp(page, ids.A, TIPS.A.v2);
  await setUp(page, ids.D, TIPS.D.v2);
  // A catch takes the newest setup saved at or before its time (to the minute), so start the
  // late catches in the next minute
  await page.waitForTimeout(61_000 - (Date.now() % 60_000));
});

test('log the late catches on Log a Catch', async ({ page }) => {
  test.setTimeout(300_000);
  for (let i = 0; i < LATE.length; i++) await logCatch(page, LATE[i], new Date(), i % 2 === 1);
  expect(logged).toHaveLength(EARLY.length + LATE.length);
});

test('Edit Catch: move two catches to another tip-up and change a bait', async ({ page }) => {
  await unlockAdmin(page);
  const edits = [[logged[6], 'B', TAG.shiner], [logged[EARLY.length + 8], 'C', null], [logged[0], null, TAG.shiner]];
  for (const [num, tip, bait] of edits) {
    await page.goto(`edit-catch.html?catchNumber=${encodeURIComponent(num)}`);
    await page.locator('#gearGroup:not(.hidden)').waitFor();
    if (tip) {
      await page.locator('#gearSearch').fill(TIPS[tip].name);
      await page.locator('#gearSuggestions .tag-suggestion', { hasText: TIPS[tip].name }).first().click();
    }
    await page.locator('#bait').fill(bait || '');
    await page.locator('#saveBtn').click();
    await expect(page).toHaveURL(/catch-details\.html\?catchNumber=/);
  }
});

test.describe('Catch Chat', () => {
  test.skip(process.env.CATCH_CHAT_TESTS !== '1', 'set CATCH_CHAT_TESTS=1 to add catches through Catch Chat');
  test.skip(!!process.env.SKIP_AI, 'SKIP_AI is set');
  const EMAIL = `e2e-stats-${RUN_ID}@example.com`;
  const ANGLER = testName('Stats Chat Angler');
  const SAYS = [
    ['A', 'sucker (medium)', 30, 'Northern Pike'], ['B', 'shiner (large)', 18, 'Walleye'], ['D', 'sucker (medium)', 28, 'Northern Pike'],
  ];

  test('set up: a test angler with a login email', async ({ page }) => {
    await unlockAdmin(page);
    await page.goto('create-angler.html');
    await page.locator('#name').fill(ANGLER);
    await page.locator('#loginEmails').fill(EMAIL);
    await page.locator('#createBtn').click();
    await expect(page).toHaveURL(/edit-angler\.html\?id=\d+/);
  });

  test.describe('as the test angler', () => {
    test.use({ identityEmail: EMAIL });
    for (const [i, [tip, bait, length, species]] of SAYS.entries()) {
      test(`chat catch ${i + 1}: ${length}" on tip-up ${tip}`, async ({ page }) => {
        test.setTimeout(600_000);
        const angler = (await getLookups()).anglers.find(a => a.name === ANGLER);
        const mine = async () => (await getCatches()).filter(c => c.anglerId === angler.id);
        const had = (await mine()).length;
        const water = lookups ? lookups.waters[0].name : (await getLookups()).bodiesOfWater[0].name;
        await useTestChatSession(page, 'gillbert_chat_session');
        await page.goto('catch-chat.html');
        const replies = page.locator('.message--gillbert:not(.message--thinking):not(.message--error)');
        // Bait the way the tag is spelled, so the chat finds the test tag
        const baitTag = bait.startsWith('sucker') ? TAG.sucker : TAG.shiner;
        let said = `I caught a ${length} inch ${species} on ${water} today about an hour ago, on tip-up ${TIPS[tip].name} with ${baitTag} for bait. No notes, no depth.`;
        for (let turn = 0; turn < 5 && (await mine()).length === had; turn++) {
          const before = await replies.count();
          await page.locator('#chatInput').fill(said);
          await page.locator('#chatSendBtn').click();
          await expect(replies).toHaveCount(before + 1, { timeout: 110_000 });
          const asked = (await replies.last().textContent()).toLowerCase();
          said = /who (caught|gets|landed|reeled)|whose|angler name|your name|which angler/.test(asked)
            ? 'Me, I caught it myself.'
            : /depth|deep/.test(asked) ? "I don't know the depth. Please save it."
            : "Yes, that's all correct. Please save it.";
        }
        const got = (await mine()).find((c, _, all) => all.length > had && c.length === length);
        expect(got, 'the chat saved the catch').toBeTruthy();
        expect(got.caughtOn && got.caughtOn.name).toBe(TIPS[tip].name);
      });
    }
  });
});

// ── Check: gear/stats against a count made from the catches themselves ───────────────────────
function expectedStats(catches, f = {}) {
  const on = catches.filter(c => c.caughtOn && c.caughtOn.gearId
    && (f.speciesId == null || c.fishSpeciesId === f.speciesId)
    && (f.waterId == null || c.bodyOfWaterId === f.waterId));
  const sections = { tipUp: {}, bait: {}, hook: {}, line: {}, leader: {}, bead: {}, flash: {} };
  const add = (sec, key, c) => {
    const r = (sections[sec][key] ||= { fish: 0, biggest: null });
    r.fish++;
    if (c.length != null && (r.biggest == null || c.length > r.biggest)) r.biggest = c.length;
  };
  for (const c of on) {
    const s = c.caughtOn;
    add('tipUp', s.name, c);
    if (c.bait) add('bait', c.bait, c);
    for (const k of ['hook', 'line', 'leader']) if (s[k]) add(k, s[k], c);
    const entered = s.line || s.leader || s.hook || (s.beads || []).length || (s.flash || []).length;
    for (const [k, none] of [['beads', 'No beads'], ['flash', 'No flash']]) {
      const sec = k === 'beads' ? 'bead' : 'flash';
      (s[k] || []).forEach(v => add(sec, v, c));
      if (entered && !(s[k] || []).length) add(sec, none, c);
    }
  }
  return { fish: on.length, tipUps: new Set(on.map(c => c.caughtOn.gearId)).size, sections };
}

function asComparable(stats) {
  const out = {};
  for (const [sec, rows] of Object.entries(stats.sections)) {
    out[sec] = Object.fromEntries(rows.map(r => [r.name, { fish: r.fish, biggest: r.biggest ? Number(r.biggest.length) : null }]));
  }
  return { fish: stats.fish, tipUps: stats.tipUps, sections: out };
}

async function stats(q = '') {
  const raw = await apiGet(`gear/stats${q}`);
  return Array.isArray(raw) ? raw[0] : raw;
}

test('gear/stats match the catches, unfiltered and per species and lake', async () => {
  const catches = await getCatches();
  const all = await stats();
  expect(asComparable(all)).toEqual(expectedStats(catches));
  // Ranked by fish, most first
  for (const rows of Object.values(all.sections)) {
    expect(rows.map(r => r.fish)).toEqual([...rows.map(r => r.fish)].sort((a, b) => b - a));
  }
  for (const s of all.species) {
    expect(asComparable(await stats(`?speciesId=${s.id}`)), `species ${s.name}`).toEqual(expectedStats(catches, { speciesId: s.id }));
  }
  for (const w of all.waters) {
    expect(asComparable(await stats(`?waterId=${w.id}`)), `water ${w.name}`).toEqual(expectedStats(catches, { waterId: w.id }));
  }
});

test('the page shows the seeded tip-ups and versions', async ({ page }) => {
  await page.goto('gear-stats.html');
  await page.locator('#statsState:not(.hidden)').waitFor();
  const tips = page.locator('.stats-section[data-section="tipUp"]');
  if (await tips.locator('.stats-more').count()) await tips.locator('.stats-more').click();
  const rowA = tips.locator('.rank-row', { hasText: TIPS.A.name });
  await expect(rowA).toBeVisible();
  // Tip A's flash came with v2, so only its late catches count under the blade
  const flash = page.locator('.stats-section[data-section="flash"]');
  await expect(flash.locator('.rank-row', { hasText: TAG.blade })).toBeVisible();
  await expect(flash.locator('.rank-row.stat-none')).toContainText('No flash');
});
