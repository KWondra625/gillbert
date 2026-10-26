// Shared rules for tests that change Staging data (write/ and delete/).
//
// - They only run when STAGING_WRITES=1 is set, so a plain `npm test` never writes.
// - Everything they create is marked, so cleanup/cleanup-staging.js can find it:
//   anglers, species and bodies of water are named "E2E Test …", and catches carry
//   NOTES_MARKER in their notes (catches have no name of their own).
const { test, STAGING_STORAGE_HOST } = require('./fixtures');
const { config, getCatches } = require('./staging-api');

const NAME_PREFIX = 'E2E Test';
const NOTES_MARKER = '[E2E Test]';
const RUN_ID = process.env.E2E_RUN_ID || String(Date.now()).slice(-6);

function requireStagingWrites() {
  test.skip(process.env.STAGING_WRITES !== '1', 'set STAGING_WRITES=1 to run tests that change Staging data');
  if (process.env.STAGING_WRITES === '1' && !STAGING_STORAGE_HOST) {
    throw new Error('Set STAGING_STORAGE_ACCOUNT in tests/.env (see .env.example) before running write tests');
  }
}

// Catch media uploads (and their deletes) are off unless MEDIA_TESTS=1: conversions are
// heavy, and the Staging Pi can run out of memory under them. Real phone files are a
// further opt-in (PHONE_MEDIA=1); a 24 MP iPhone HEIC has failed to convert there.
function requireMediaTests() {
  test.skip(process.env.MEDIA_TESTS !== '1', 'set MEDIA_TESTS=1 to run the catch media upload tests');
}

function testName(kind) {
  return `${NAME_PREFIX} ${kind} ${RUN_ID}`;
}

async function apiPost(endpoint, body) {
  const res = await fetch(config.API_BASE + endpoint, {
    method: 'POST',
    headers: { 'X-API-Key': config.API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data.success === false) throw new Error(`POST ${endpoint} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// The test catches currently on Staging (newest first).
async function findTestCatches() {
  return (await getCatches())
    .filter(c => (c.notes || '').includes(NOTES_MARKER))
    .sort((a, b) => b.id - a.id);
}

// A test catch to hang media on: the newest existing one, or a fresh one saved through
// the same endpoint the Log a Catch form uses, credited to a real angler (species and
// water too), since the catch row itself is what gets cleaned up.
async function ensureTestCatch() {
  const [existing] = await findTestCatches();
  if (existing) return existing;
  const [any] = await getCatches();
  const data = await apiPost('catch/commit', {
    anglerId: any.anglerId,
    fishSpeciesId: any.fishSpeciesId,
    bodyOfWaterId: any.bodyOfWaterId,
    caughtWhen: new Date().toISOString(),
    recordSource: 'Web Form',
    conversationId: null,
    createdByAnglerId: null,
    updatedByAnglerId: null,
    notes: `${NOTES_MARKER} media upload target, run ${RUN_ID}`,
  });
  return (await findTestCatches()).find(c => c.catchNumber === data.catch_number);
}

module.exports = { NAME_PREFIX, NOTES_MARKER, RUN_ID, requireStagingWrites, requireMediaTests, testName, apiPost, findTestCatches, ensureTestCatch };
