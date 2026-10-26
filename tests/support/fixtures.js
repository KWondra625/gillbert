// Shared test setup. Every test imports `test` and `expect` from here, not from
// @playwright/test, so the production guard and error checks always apply.
const base = require('@playwright/test');
const { STAGING_HOST, PRODUCTION_HOSTS } = require('./site-config');

// Uploads and deletes may only go to the Staging storage account (from tests/.env).
// Reads from any account are fine: Staging's copied data shows production images.
const STAGING_STORAGE_HOST = process.env.STAGING_STORAGE_ACCOUNT
  ? `${process.env.STAGING_STORAGE_ACCOUNT}.blob.core.windows.net` : null;

// Endpoints that change data. Tests under read/ may not call them at all.
// (Ask Gillbert is a POST but only reads; Catch Chat's catch-conversation can save a
// catch, so it's here.)
const WRITE_ENDPOINT = /\/gillbert\/(.*\/)?(commit|save|delete|verify|get-sas|save-photo|delete-photo|get-photo-sas|catch-conversation)$/;

const test = base.test.extend({
  // Cloudflare Access identity to pretend to be. null = no Cloudflare session,
  // which is what a local copy normally sees.
  identityEmail: [null, { option: true }],

  // Set to true in a test (test.use) when console errors are expected there.
  allowConsoleErrors: [false, { option: true }],

  context: async ({ context, identityEmail }, use, testInfo) => {
    // Production guard, layer 1: no request may reach a production host.
    const productionRequests = [];
    await context.route(url => PRODUCTION_HOSTS.includes(url.hostname), route => {
      productionRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    // Storage guard: no upload or delete to any storage account but Staging's.
    const storageWrites = [];
    await context.route(url => url.hostname.endsWith('.blob.core.windows.net'), route => {
      const method = route.request().method();
      if (['GET', 'HEAD', 'OPTIONS'].includes(method) || new URL(route.request().url()).hostname === STAGING_STORAGE_HOST) {
        return route.continue();
      }
      storageWrites.push(`${method} ${route.request().url().split('?')[0]}`);
      return route.abort('blockedbyclient');
    });

    // Read-only guard: a read/ test that tries to change data is stopped and fails.
    const blockedWrites = [];
    if (/[\\/]read[\\/]/.test(testInfo.file)) {
      await context.route(url => WRITE_ENDPOINT.test(url.pathname), route => {
        blockedWrites.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort('blockedbyclient');
      });
    }

    // The local server has no Cloudflare Access in front of it, so answer the
    // identity check here instead of letting it 404.
    await context.route('**/cdn-cgi/access/get-identity', route => identityEmail
      ? route.fulfill({ json: { email: identityEmail } })
      : route.fulfill({ status: 401, body: '' }));

    context.productionRequests = productionRequests;
    await use(context);

    base.expect(productionRequests, 'requests to a production host were blocked').toEqual([]);
    base.expect(blockedWrites, 'a read-only test tried to change data').toEqual([]);
    base.expect(storageWrites, 'a write to a non-Staging storage account was blocked').toEqual([]);
  },

  page: async ({ page, allowConsoleErrors }, use) => {
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      // The expected "no Cloudflare session" answer to the identity check above.
      if (msg.location().url.includes('/cdn-cgi/access/get-identity')) return;
      // Safari doesn't know the interactive-widget viewport key the mobile keyboard
      // fix uses; it ignores it, as intended.
      if (msg.text().includes('"interactive-widget" not recognized')) return;
      errors.push(`console: ${msg.text()} (${msg.location().url})`);
    });

    // When a Staging API call fails, record how: the status code and Cloudflare's ray ID
    // tell a Cloudflare-edge rejection apart from an n8n error (whose execution would
    // show up in n8n's log). Browsers hide this behind a generic CORS error otherwise.
    page.on('response', res => {
      if (new URL(res.url()).hostname !== STAGING_HOST || res.status() < 400) return;
      errors.push(`staging: HTTP ${res.status()} ${res.request().method()} ${res.url().split('?')[0]} cf-ray=${res.headers()['cf-ray'] || '-'} at ${new Date().toISOString()}`);
    });
    page.on('requestfailed', req => {
      if (new URL(req.url()).hostname !== STAGING_HOST) return;
      const failure = req.failure()?.errorText || '';
      if (/abort|cancel/i.test(failure)) return; // the page navigated away mid-request
      errors.push(`staging: request failed (${failure}) ${req.method()} ${req.url().split('?')[0]} at ${new Date().toISOString()}`);
    });

    // Production guard, layer 2: every page must report that it talks to Staging.
    page.on('load', async () => {
      const server = await page.evaluate(() => typeof N8N_BASE_URL === 'undefined' ? null : N8N_BASE_URL)
        .catch(() => null);
      if (server && new URL(server).hostname !== STAGING_HOST) {
        errors.push(`GUARD: page is configured for ${server}, not Staging`);
      }
    });

    await use(page);

    // Storage upload URLs carry a short-lived write token; keep it out of reports.
    for (let i = 0; i < errors.length; i++) errors[i] = errors[i].replace(/([?&]sig=)[^&s'"]+/g, '$1***');

    // Let in-flight requests finish so their errors are counted, and so a test that
    // ends mid-load doesn't leave a half-finished fetch behind.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const guardErrors = errors.filter(e => e.startsWith('GUARD'));
    base.expect(guardErrors, 'page pointed at a non-Staging server').toEqual([]);
    if (!allowConsoleErrors) base.expect(errors, 'browser errors during the test').toEqual([]);
  },
});

// Unlocks admin for every page this test opens afterwards (call before page.goto),
// using the same storage key a correct PIN sets.
async function unlockAdmin(page) {
  await page.addInitScript(() => localStorage.setItem('gillbert_admin_unlock_expires',
    String(Date.now() + 24 * 60 * 60 * 1000)));
}

module.exports = { test, expect: base.expect, unlockAdmin, STAGING_HOST, PRODUCTION_HOSTS, STAGING_STORAGE_HOST, WRITE_ENDPOINT };
