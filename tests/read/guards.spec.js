// Proves the safety guards in support/fixtures.js actually work, so a quiet pass of
// the rest of the suite can be trusted. Uses @playwright/test directly on purpose:
// these tests trip the guards and check what happened.
const base = require('@playwright/test');
const { WRITE_ENDPOINT } = require('../support/fixtures');
const { STAGING_HOST, PRODUCTION_HOSTS } = require('../support/site-config');
const { config } = require('../support/staging-api');

base.test('a local copy of the site is configured for Staging', async ({ page }) => {
  await page.goto('index.html');
  const server = await page.evaluate(() => N8N_BASE_URL);
  base.expect(new URL(server).hostname).toBe(STAGING_HOST);
  base.expect(new URL(config.N8N_BASE_URL).hostname).toBe(STAGING_HOST);
});

base.test('the write-endpoint pattern matches every endpoint that changes data', () => {
  const writes = ['catch/commit', 'catch/verify', 'anglers/save', 'fish-species/save',
    'bodies-of-water/save', 'catch-media/delete', 'catch-media/get-sas', 'catch-media/commit',
    'anglers/get-photo-sas', 'anglers/save-photo', 'anglers/delete-photo', 'catch-conversation'];
  const reads = ['get-catches', 'get-lookup-data', 'anglers/get', 'fish-species/get',
    'bodies-of-water/get', 'catch-media/get', 'system-info', 'ask-gillbert', 'bodies-of-water/dnr-search'];
  for (const w of writes) base.expect(WRITE_ENDPOINT.test(`/webhook/gillbert/${w}`), w).toBe(true);
  for (const r of reads) base.expect(WRITE_ENDPOINT.test(`/webhook/gillbert/${r}`), r).toBe(false);
});

base.test('the production hosts are the ones the site would use for production', async ({ page }) => {
  await page.goto('index.html');
  const prod = await page.evaluate(() => [new URL(API_SERVERS.production).hostname, PRODUCTION_HOSTNAME]);
  for (const host of prod) base.expect(PRODUCTION_HOSTS).toContain(host);
});

// These two use the guarded `test` and deliberately trip a guard. test.fail() means
// "this test must fail": if a guard ever stops catching these, the suite goes red.
const guarded = require('../support/fixtures');

guarded.test('a request to production is blocked and fails the test', async ({ page }) => {
  guarded.test.fail();
  await page.goto('index.html');
  await page.evaluate(url => fetch(url).catch(() => {}), `https://${PRODUCTION_HOSTS[0]}/`);
});

guarded.test('an upload to a non-Staging storage account is blocked and fails the test', async ({ page }) => {
  guarded.test.fail();
  await page.goto('index.html');
  await page.evaluate(() => fetch('https://not-staging-e2e.blob.core.windows.net/catch-media/x.jpg',
    { method: 'PUT', body: 'x' }).catch(() => {}));
});
