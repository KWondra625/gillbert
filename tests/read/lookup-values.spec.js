// Layer 1, read-only: lookups treat what they're given purely as data. A catch number
// or search text with punctuation in it matches only what it literally says.
// (Add to tests/read/ together with the n8n query-parameter fix, not before.)
const { test, expect } = require('../support/fixtures');
const { apiGet, getCatches, getCatchMedia } = require('../support/staging-api');

const rows = data => (Array.isArray(data) ? data : data.catches || data.media || []).filter(r => r && r.id);

test('a catch lookup returns only that catch', async () => {
  const [first] = await getCatches();
  const found = rows(await apiGet(`get-catches?catchNumber=${encodeURIComponent(first.catchNumber)}`));
  expect(found.map(c => c.catchNumber)).toEqual([first.catchNumber]);
});

test('a catch number with punctuation that matches no catch returns nothing', async () => {
  for (const odd of ["Catch 99-999'", "x' OR 'a'='a", 'Catch 26-1%']) {
    expect(rows(await apiGet(`get-catches?catchNumber=${encodeURIComponent(odd)}`)), odd).toEqual([]);
    expect(await getCatchMedia(odd), odd).toEqual([]);
  }
});

test('search text with punctuation is matched literally', async () => {
  const all = await getCatches();
  const found = rows(await apiGet(`get-catches?search=${encodeURIComponent("zz' OR 'a'='a")}`));
  expect(found.length).toBe(0);
  expect(all.length).toBeGreaterThan(0);
});

test('a media lookup returns only that catch\'s media', async () => {
  const withMedia = (await getCatches()).find(c => Number(c.catchMediaCount) > 0);
  test.skip(!withMedia, 'no Staging catch has media');
  const media = await getCatchMedia(withMedia.catchNumber);
  expect(media.length).toBe(Number(withMedia.catchMediaCount));
  for (const m of media) expect(m.catchNumber).toBe(withMedia.catchNumber);
});
