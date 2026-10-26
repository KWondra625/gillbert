// Layer 1, read-only: the Staging API still returns the fields the pages depend on.
// A renamed or dropped field here would break a page quietly, so it fails loudly instead.
const { test, expect } = require('../support/fixtures');
const { apiGet, getCatches, getLookups } = require('../support/staging-api');

function expectFields(record, fields, what) {
  for (const f of fields) expect(record, `${what} is missing "${f}"`).toHaveProperty(f);
}

test('get-catches returns catches with every field the listing and detail pages use', async () => {
  const catches = await getCatches();
  expect(catches.length).toBeGreaterThan(0);
  expectFields(catches[0], ['id', 'catchNumber', 'anglerId', 'anglerName', 'fishSpeciesId', 'fishSpeciesName',
    'bodyOfWaterId', 'bodyOfWaterName', 'length', 'caughtWhen', 'waterDepth', 'notes', 'verifiedAt',
    'createdByAnglerId', 'createdAt', 'updatedAt', 'catchMediaCount'], 'a catch');
  for (const c of catches) expect(c.catchNumber).toMatch(/^Catch \d{2}-\d{3,}$/);
});

test('get-catches can look up a single catch by number', async () => {
  const [first] = await getCatches();
  const data = await apiGet(`get-catches?catchNumber=${encodeURIComponent(first.catchNumber)}`);
  const rows = (Array.isArray(data) ? data : data.catches || []).filter(c => c && c.catchNumber);
  expect(rows.map(c => c.catchNumber)).toEqual([first.catchNumber]);
});

test('get-lookup-data returns anglers, species and bodies of water', async () => {
  const lookups = await getLookups();
  expectFields(lookups.anglers[0], ['id', 'name', 'loginEmails', 'groups'], 'an angler');
  expectFields(lookups.fishSpecies[0], ['id', 'name'], 'a species');
  expectFields(lookups.bodiesOfWater[0], ['id', 'name'], 'a body of water');
});

test('the admin GET endpoints return full records', async () => {
  const shapes = {
    'anglers/get': ['id', 'name', 'status', 'aliases', 'loginEmails', 'groups'],
    'fish-species/get': ['id', 'name', 'status', 'aliases', 'displayNameOverride'],
    'bodies-of-water/get': ['id', 'name', 'status', 'wbic', 'dnrUrlVerified'],
  };
  for (const [endpoint, fields] of Object.entries(shapes)) {
    const data = await apiGet(endpoint);
    const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray);
    expect(list.length, endpoint).toBeGreaterThan(0);
    expectFields(list[0], fields, endpoint);
  }
});

test('catch-media/get returns the media of a catch that has some', async () => {
  const withMedia = (await getCatches()).find(c => Number(c.catchMediaCount) > 0);
  test.skip(!withMedia, 'no Staging catch has media');
  const data = await apiGet(`catch-media/get?catchNumber=${encodeURIComponent(withMedia.catchNumber)}`);
  const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
  expect(list.length).toBe(Number(withMedia.catchMediaCount));
});
