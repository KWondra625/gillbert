// Layer 0, screenshots: every page on a laptop and a phone, compared with a saved baseline.
// The point is to prove that styling refactors (shared colors, shared base styles) change
// nothing visible, and to show exactly what a deliberate redesign changed.
//
// Determinism: the Staging answers are recorded once into visual/fixtures/ and replayed,
// photos are swapped for visual/placeholder.png, and the clock is frozen. Fixtures and
// baseline images hold real catch data, so both stay on this machine (gitignored); only
// this file and the placeholder are in the repo.
//
//   npm run test:visual:record   record the Staging answers and (re)write the baselines
//   npm run test:visual          compare every page with its baseline
//   npm run test:visual -- -g catch-details   one page
//
// After an intended visual change: look at the diff in the report, then re-baseline that
// page with `npx playwright test visual/ -g <page> --update-snapshots`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('../support/fixtures');

const RECORD = process.env.VISUAL_RECORD === '1';
const FIXTURES = path.join(__dirname, 'fixtures');
const PLACEHOLDER = fs.readFileSync(path.join(__dirname, 'placeholder.png'));
const FROZEN_NOW = new Date('2026-11-08T12:00:00-06:00');

// Stable Staging records (chosen 2026-11-08): a catch with media, and the first angler,
// species and body of water. Replays don't depend on them still existing on Staging.
const CATCH = 'Catch 26-147';
const PAGES = [
  ['index', 'index.html'],
  ['catches-listing', 'catches-listing.html'],
  ['catch-details', `catch-details.html?catchNumber=${encodeURIComponent(CATCH)}`],
  ['edit-catch', `edit-catch.html?catchNumber=${encodeURIComponent(CATCH)}`],
  ['media-upload', `media-upload.html?catchNumber=${encodeURIComponent(CATCH)}`],
  ['log-catch', 'log-catch.html'],
  ['catch-chat', 'catch-chat.html'],
  ['ask-gillbert', 'ask-gillbert.html'],
  ['fish-of-fame', 'fish-of-fame.html'],
  ['anglers-listing', 'anglers-listing.html'],
  ['create-angler', 'create-angler.html'],
  ['edit-angler', 'edit-angler.html?id=1'],
  ['fish-species-listing', 'fish-species-listing.html'],
  ['create-fish-species', 'create-fish-species.html'],
  ['edit-fish-species', 'edit-fish-species.html?id=1'],
  ['bodies-of-water-listing', 'bodies-of-water-listing.html'],
  ['create-body-of-water', 'create-body-of-water.html'],
  ['edit-body-of-water', 'edit-body-of-water.html?id=1'],
  ['me', 'me.html'],
  ['under-the-hood', 'under-the-hood.html'],
  ['media-activity', 'media-activity.html'],
  ['whats-new', 'whats-new.html'],
  ['features-functionality', 'features-functionality.html'],
  ['notifications', 'notifications.html'],
];

// Keep photo links (and their access signatures) out of the fixtures entirely.
const BLOB_URL = /https:\/\/[a-z0-9-]+\.blob\.core\.windows\.net\/[^"\\\s]*/g;
const scrub = text => text.replace(BLOB_URL, 'https://fixture.blob.core.windows.net/placeholder.png');

function requestKey(req) {
  const url = new URL(req.url());
  const body = req.postData() || '';
  const bodyHash = body ? ' #' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 10) : '';
  return `${req.method()} ${url.pathname}${url.search}${bodyHash}`;
}

test.describe.configure({ mode: 'parallel' });
test.use({ allowConsoleErrors: true }); // a replayed page may log about the placeholder video

for (const [name, url] of PAGES) {
  test(`${name} looks the same`, async ({ page }, testInfo) => {
    test.skip(RECORD && testInfo.project.name !== 'desktop-chrome', 'record once, on the desktop project');
    const fixtureFile = path.join(FIXTURES, `${name}.json`);
    const recorded = RECORD ? {} : JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));

    // Photos and videos: always the placeholder
    await page.route(u => u.hostname.endsWith('.blob.core.windows.net'), route =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER }));

    // Gillbert API: record from Staging, or replay what was recorded
    await page.route('**/webhook/**', async route => {
      const key = requestKey(route.request());
      if (RECORD) {
        const res = await route.fetch();
        const body = scrub(await res.text());
        recorded[key] = { status: res.status(), contentType: res.headers()['content-type'] || 'application/json', body };
        return route.fulfill({ status: res.status(), contentType: recorded[key].contentType, body });
      }
      const hit = recorded[key];
      if (!hit) return route.fulfill({ status: 599, body: `no recording for ${key}` });
      return route.fulfill({ status: hit.status, contentType: hit.contentType, body: hit.body });
    });

    await page.clock.setFixedTime(FROZEN_NOW);
    await page.addInitScript(until => {
      try { localStorage.setItem('gillbert_admin_unlock_expires', String(until)); } catch {}
    }, FROZEN_NOW.getTime() + 7 * 24 * 3600 * 1000);

    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(400);

    if (RECORD) {
      fs.mkdirSync(FIXTURES, { recursive: true });
      fs.writeFileSync(fixtureFile, JSON.stringify(recorded, null, 1));
    }
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' });
  });
}
