// Layer 1, read-only: setup photos (gear stage 3) on the tip-up page, the Gear list and Catch
// Details. Every call is answered here in the browser, uploads go to a fake storage host, and the
// saves are checked by what the page sends. The database side (versions, which files go) is
// checked on Staging by scripts/gear/12_check_gear_photos.sql; the real upload by write/14.
const { test, expect } = require('../support/fixtures');

const FAKE_STORAGE = 'https://upload.test.invalid';
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const PHOTO = { thumbnailUrl: `${FAKE_STORAGE}/gear/7/ABCDEFGH-thumb.jpg`, viewingUrl: `${FAKE_STORAGE}/gear/7/ABCDEFGH-view.jpg`,
                originalUrl: `${FAKE_STORAGE}/gear/7/ABCDEFGH.heic` };
const ANGLERS = [{ id: 1, name: 'Kurt W', loginEmails: [] }];

function tipUp(id, name, photo, extra = {}) {
  return { id, gearType: 'tip_up', name, ownerAnglerId: 1, ownerName: 'Kurt W', model: null, color: null,
    status: 'Active', retiredNote: null, catchCount: 0,
    setup: { versionNo: 1, line: 'Dacron 30 lb', leader: null, hook: '#8 Octopus', beads: [], flash: [], photo,
             since: '2026-12-06T19:12:00Z' }, ...extra };
}
const TIPS = [tipUp(7, 'KW 24-01', PHOTO), tipUp(8, 'KW 24-02', null), tipUp(9, 'KW 24-03', null, { status: 'Retired' })];
const HISTORY = [{ id: 3, at: '2026-12-23T16:05:00Z', byName: 'Kurt W', eventType: 'photo', field: 'photo', oldValue: null, newValue: 'added' }];

// gear/get (list or one), the anglers, and the three photo calls; bodies land in state.calls
async function mockPhotos(page, state = {}) {
  state.calls = [];
  state.tips = state.tips || TIPS.map(t => structuredClone(t));
  await page.route(u => u.pathname.endsWith('/gillbert/get-lookup-data'), r => r.fulfill({ json: { anglers: ANGLERS } }));
  await page.route(u => u.pathname.endsWith('/gillbert/gear/get'), r => {
    const id = new URL(r.request().url()).searchParams.get('id');
    return r.fulfill({ json: id ? { tipUps: state.tips.filter(t => String(t.id) === id), options: {}, history: HISTORY }
                                : { tipUps: state.tips, options: {}, history: null } });
  });
  await page.route(`${FAKE_STORAGE}/**`, r => {
    if (r.request().method() === 'PUT') state.calls.push(['PUT', r.request().url().split('?')[0], r.request().headers()['x-ms-blob-type']]);
    return r.fulfill(r.request().method() === 'PUT' ? { status: 201, body: '' } : { contentType: 'image/gif', body: GIF });
  });
  for (const ep of ['photo-sas', 'photo-save', 'photo-remove']) {
    await page.route(u => u.pathname.endsWith(`/gillbert/gear/${ep}`), r => {
      const body = r.request().postDataJSON();
      state.calls.push([ep, body]);
      if (ep === 'photo-sas') return r.fulfill({ json: { success: true, uploadUrl: `${FAKE_STORAGE}/gear/${body.gearId}/NEWPHOTO1.jpg?sig=x`,
                                                         blobPath: `gear/${body.gearId}/NEWPHOTO1.jpg`, contentType: 'image/jpeg' } });
      if (state.refuse) return r.fulfill({ json: { success: false, message: state.refuse } });
      const t = state.tips.find(x => x.id === body.gearId);
      t.setup.photo = ep === 'photo-save' ? { ...PHOTO, thumbnailUrl: `${FAKE_STORAGE}/gear/${t.id}/NEWPHOTO1-thumb.jpg` } : null;
      return r.fulfill({ json: { success: true } });
    });
  }
  return state;
}

test.describe('tip-up page', () => {
  test('a photo shows first, opens full size, and offers the original', async ({ page }) => {
    await mockPhotos(page);
    await page.goto('gear-tipup.html?id=7');
    await expect(page.locator('#photoImg')).toHaveAttribute('src', PHOTO.thumbnailUrl);
    await expect(page.locator('#photoActions')).toBeVisible();
    await expect(page.locator('#photoAddBtn')).toBeHidden();
    await expect(page.locator('#historyList')).toContainText('Photo added');
    await page.locator('#photoView').click();
    await expect(page.locator('#photoLightbox')).toBeVisible();
    await expect(page.locator('#photoLightboxImg')).toHaveAttribute('src', PHOTO.viewingUrl);
    await expect(page.locator('#photoOriginal')).toHaveAttribute('href', PHOTO.originalUrl);
    await expect(page.locator('#photoOriginal')).toHaveAttribute('target', '_blank');   // leaves the app's tab alone
    await expect(page.locator('#photoClose')).toBeFocused();                              // focus moves into the photo
    await page.keyboard.press('Tab');
    await expect(page.locator('#photoOriginal')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#photoClose')).toBeFocused();                              // and stays there
    await page.keyboard.press('Escape');
    await expect(page.locator('#photoLightbox')).toBeHidden();
  });

  test('add: slot, upload the original, then save; the page shows the new photo', async ({ page }) => {
    const state = await mockPhotos(page);
    await page.goto('gear-tipup.html?id=8');
    await expect(page.locator('#photoAddBtn')).toBeVisible();
    await page.locator('#photoInput').setInputFiles({ name: 'rig.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2048, 1) });
    await expect(page.locator('#photoImg')).toHaveAttribute('src', `${FAKE_STORAGE}/gear/8/NEWPHOTO1-thumb.jpg`);
    expect(state.calls).toEqual([
      ['photo-sas', { gearId: 8, file: { name: 'rig.jpg', size: 2048, type: 'image/jpeg' } }],
      ['PUT', `${FAKE_STORAGE}/gear/8/NEWPHOTO1.jpg`, 'BlockBlob'],
      ['photo-save', { gearId: 8, blobPath: 'gear/8/NEWPHOTO1.jpg', originalName: 'rig.jpg', byAnglerId: null }],
    ]);
  });

  test('a file of the wrong type is turned away before any upload', async ({ page }) => {
    const state = await mockPhotos(page);
    await page.goto('gear-tipup.html?id=8');
    await page.locator('#photoInput').setInputFiles({ name: 'rig.gif', mimeType: 'image/gif', buffer: GIF });
    await expect(page.locator('#photoStatus')).toHaveText("That file type isn't supported. Choose a JPG, PNG, WebP or HEIC photo.");
    expect(state.calls).toEqual([]);
  });

  test('a refused save shows the server\'s message', async ({ page }) => {
    await mockPhotos(page, { refuse: 'This tip-up is retired, so its setup can\'t change.' });
    await page.goto('gear-tipup.html?id=8');
    await page.locator('#photoInput').setInputFiles({ name: 'rig.heic', mimeType: 'image/heic', buffer: Buffer.alloc(100, 1) });
    await expect(page.locator('#photoStatus')).toHaveText('This tip-up is retired, so its setup can\'t change.');
    await expect(page.locator('#photoAddBtn')).toBeEnabled();
  });

  test('remove asks first, then takes it off', async ({ page }) => {
    const state = await mockPhotos(page);
    await page.goto('gear-tipup.html?id=7');
    await page.locator('#photoRemoveBtn').click();
    await expect(page.locator('#photoRemoveConfirm')).toContainText('Catches made with this setup keep it.');
    expect(state.calls).toEqual([]);
    await page.locator('#photoRemoveYes').click();
    await expect(page.locator('#photoAddBtn')).toBeVisible();
    expect(state.calls).toEqual([['photo-remove', { gearId: 7, byAnglerId: null }]]);
  });

  test('a retired tip-up shows no photo buttons', async ({ page }) => {
    await mockPhotos(page);
    await page.goto('gear-tipup.html?id=9');
    await expect(page.locator('#tipParts')).toBeVisible();
    await expect(page.locator('#photoAddBtn')).toBeHidden();
    await expect(page.locator('#photoActions')).toBeHidden();
  });
});

test('the Gear list badges only tip-ups whose current setup has a photo', async ({ page }) => {
  await mockPhotos(page);
  await page.goto('gear.html');
  await expect(page.locator('.gear-card[data-id="7"] .gear-card-photo-badge')).toHaveCount(1);
  await expect(page.locator('.gear-card[data-id="8"] .gear-card-photo-badge')).toHaveCount(0);
});

test('Catch Details shows the photo of the setup it was caught on, small, opening the viewing copy', async ({ page }) => {
  const CATCH = {
    id: 501, catchNumber: 'Catch 26-501', anglerId: 1, anglerName: 'Kurt W', createdByAnglerId: 1,
    fishSpeciesId: 5, fishSpeciesName: 'Northern Pike', bodyOfWaterId: 2, bodyOfWaterName: 'Lake Kegonsa',
    caughtWhen: '2027-01-09T14:30:00Z', length: 31, waterDepth: 12, notes: null, verifiedAt: null,
    caughtOn: { gearId: 7, name: 'KW 24-01', status: 'Active', versionNo: 1, line: 'Dacron 30 lb', leader: null,
                hook: '#8 Octopus', beads: [], flash: [], photo: PHOTO },
    bait: null,
  };
  await mockPhotos(page);
  await page.route(u => u.pathname.endsWith('/gillbert/get-catches'), r => r.fulfill({ json: [CATCH] }));
  await page.route(u => u.pathname.endsWith('/gillbert/catch-media/get'), r => r.fulfill({ json: [] }));
  await page.goto('catch-details.html?catchNumber=' + encodeURIComponent(CATCH.catchNumber));
  const link = page.locator('.caught-on-photo');
  await expect(link).toHaveAttribute('href', PHOTO.viewingUrl);
  await expect(link.locator('img')).toHaveAttribute('src', PHOTO.thumbnailUrl);
  expect((await link.locator('img').boundingBox()).width).toBeLessThanOrEqual(100);
});
