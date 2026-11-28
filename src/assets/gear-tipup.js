// One tip-up: its model, color and current setup (with its photo), the ways to change it, and
// its history.
const STATE_IDS = ['loadingState', 'errorState', 'viewState'];
const tipId = new URLSearchParams(location.search).get('id');

const el = {
  tipName:     document.getElementById('tipName'),
  tipSub:      document.getElementById('tipSub'),
  retiredNote: document.getElementById('retiredNote'),
  tipParts:    document.getElementById('tipParts'),
  tipNotes:    document.getElementById('tipNotes'),
  setupLink:   document.getElementById('setupLink'),
  editLink:    document.getElementById('editLink'),
  historyList: document.getElementById('historyList'),
  viewCatches: document.getElementById('viewCatchesLink'),
  errorMsg:    document.getElementById('errorMsg'),
  photoView:   document.getElementById('photoView'),
  photoImg:    document.getElementById('photoImg'),
  photoActions: document.getElementById('photoActions'),
  photoAdd:    document.getElementById('photoAddBtn'),
  photoReplace: document.getElementById('photoReplaceBtn'),
  photoRemove: document.getElementById('photoRemoveBtn'),
  photoConfirm: document.getElementById('photoRemoveConfirm'),
  photoStatus: document.getElementById('photoStatus'),
  photoInput:  document.getElementById('photoInput'),
  lightbox:    document.getElementById('photoLightbox'),
  lightboxImg: document.getElementById('photoLightboxImg'),
  original:    document.getElementById('photoOriginal'),
  retryBtn:    document.getElementById('retryBtn'),
};

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function part(label, value) {
  const shown = Array.isArray(value) ? value.join(', ') : value;
  return `<dt>${label}</dt><dd>${shown ? gearEsc(shown) : '<span class="gear-none">—</span>'}</dd>`;
}

let shown = null;  // the tip-up on the page, for the View Catches link

// "View 3 Catches" opens the catches list filtered to this tip-up; with none it's greyed out
function renderViewCatches(t) {
  const n = Number(t.catchCount) || 0;
  el.viewCatches.textContent = n > 0 ? `🎣 View ${n} Catch${n === 1 ? '' : 'es'}` : '🎣 No Catches Yet';
  el.viewCatches.classList.toggle('view-catches-link--empty', n === 0);
}

function render(t, history) {
  shown = t;
  renderViewCatches(t);
  document.title = `${t.name} · Gillbert`;
  el.tipName.textContent = t.name;
  el.tipSub.textContent = [`${t.ownerName}'s`, t.status].join(' · ');

  const retired = t.status === 'Retired';
  el.retiredNote.classList.toggle('hidden', !retired);
  el.retiredNote.textContent = retired ? `Retired${t.retiredNote ? `: ${t.retiredNote}` : ''}. Its history and catches are kept.` : '';

  const s = t.setup || {};
  el.tipParts.innerHTML = [
    part('Model', t.model), part('Color', t.color),
    part('Line', s.line), part('Leader', s.leader), part('Hook', s.hook),
    part('Beads', s.beads), part('Flash', s.flash),
  ].join('');

  renderPhoto(t);

  el.tipNotes.textContent = t.notes || '';
  el.tipNotes.classList.toggle('hidden', !t.notes);

  el.setupLink.href = `./gear-setup.html?id=${encodeURIComponent(t.id)}`;
  el.setupLink.textContent = t.setup ? 'Change setup' : 'Set up its line, leader and hook';
  el.setupLink.classList.toggle('hidden', retired);
  el.editLink.href = `./gear-edit.html?id=${encodeURIComponent(t.id)}`;
  el.editLink.textContent = retired ? 'Rename, owner or bring back' : 'Rename, owner or retire';

  el.historyList.innerHTML = history.map(h => `
    <li>
      <span class="gear-history-when">${gearEsc(gearShortDate(h.at))} · ${gearEsc(h.byName || 'Someone')}</span>
      ${gearEsc(gearHistoryText(h))}
    </li>`).join('');
}

// ── Setup photo (stage 3) ──────────────────────────────────────────────────────────────────
// The current setup's photo: the thumbnail here, the viewing copy full size, and the original
// to download. Adding, replacing or removing one saves straight away and never makes a new
// setup version; catches keep the photo of the setup they were caught on.
const PHOTO_MAX_BYTES = 25 * 1024 * 1024;   // same limits as the upload slot (gear/photo-sas)
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
let myAnglerId = null;
let busy = false;
let lightboxOpener = null;
// Only a storage link goes into an href or src (the server builds them; this is belt and braces)
const httpsUrl = u => (/^https:\/\//.test(u || '') ? u : '');

function renderPhoto(t) {
  const photo = t.setup && t.setup.photo;
  const retired = t.status === 'Retired';
  el.photoView.classList.toggle('hidden', !photo);
  if (photo) el.photoImg.src = httpsUrl(photo.thumbnailUrl);
  el.photoActions.classList.toggle('hidden', !photo || retired);
  el.photoAdd.classList.toggle('hidden', !!photo || retired);
  el.photoConfirm.classList.add('hidden');
}

function photoStatus(text, isError) {
  el.photoStatus.textContent = text || '';
  el.photoStatus.classList.toggle('hidden', !text);
  el.photoStatus.classList.toggle('form-error', !!isError);
}

function photoRejectReason(file) {
  const ext = (file.name || '').includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!PHOTO_EXTENSIONS.includes(ext)) return "That file type isn't supported. Choose a JPG, PNG, WebP or HEIC photo.";
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > PHOTO_MAX_BYTES) return `That photo is too large (${Math.round(file.size / (1024 * 1024))} MB); the limit is 25 MB.`;
  return null;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = gearUnwrap(await res.json().catch(() => ({})));
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { shown: !!data.message });
  return data;
}

function setBusy(on) {
  busy = on;
  [el.photoAdd, el.photoReplace, el.photoRemove].forEach(b => { b.disabled = on; });
}

// The original goes straight to storage; the server then makes the thumbnail and viewing copy
// (like catch photos) and puts the photo on the current setup.
async function uploadPhoto(file) {
  const why = photoRejectReason(file);
  if (why) return photoStatus(why, true);
  if (!shown || busy) return;
  setBusy(true);
  try {
    photoStatus('Uploading…');
    const slot = await postJson(GEAR_PHOTO_SAS_URL, { gearId: shown.id, file: { name: file.name, size: file.size, type: file.type } });
    const put = await fetch(slot.uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': slot.contentType || file.type || 'application/octet-stream' },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
    photoStatus('Making copies…');
    await anglerReady;
    await postJson(GEAR_PHOTO_SAVE_URL, { gearId: shown.id, blobPath: slot.blobPath, originalName: file.name, byAnglerId: myAnglerId });
    photoStatus('');
    await load({ quiet: true });
  } catch (err) {
    if (!err.shown) console.error('Setup photo upload failed:', err);   // a refusal is said on the page
    photoStatus(err.shown ? err.message : "The photo didn't save. Please check your connection and try again.", true);
  } finally {
    setBusy(false);
    el.photoInput.value = '';
  }
}

async function removePhoto() {
  setBusy(true);
  el.photoConfirm.classList.add('hidden');
  try {
    photoStatus('Removing…');
    await anglerReady;
    await postJson(GEAR_PHOTO_REMOVE_URL, { gearId: shown.id, byAnglerId: myAnglerId });
    photoStatus('');
    await load({ quiet: true });
  } catch (err) {
    if (!err.shown) console.error('Setup photo remove failed:', err);
    photoStatus(err.shown ? err.message : "The photo wasn't removed. Please try again.", true);
  } finally {
    setBusy(false);
  }
}

function openLightbox() {
  const photo = shown && shown.setup && shown.setup.photo;
  if (!photo) return;
  el.lightboxImg.src = httpsUrl(photo.viewingUrl) || httpsUrl(photo.thumbnailUrl);
  const original = httpsUrl(photo.originalUrl);
  el.original.classList.toggle('hidden', !original);
  if (original) el.original.href = original;
  lightboxOpener = document.activeElement;
  el.lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('photoClose').focus();
}

function closeLightbox() {
  el.lightbox.classList.add('hidden');
  el.lightboxImg.removeAttribute('src');
  document.body.style.overflow = '';
  if (lightboxOpener && lightboxOpener.focus) lightboxOpener.focus();
  lightboxOpener = null;
}

// Tab stays inside the open photo (Close and Download original)
function trapLightboxTab(e) {
  if (e.key !== 'Tab' || el.lightbox.classList.contains('hidden')) return;
  const items = [document.getElementById('photoClose'), el.original].filter(x => !x.classList.contains('hidden'));
  const i = items.indexOf(document.activeElement);
  e.preventDefault();
  items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
}

el.photoAdd.addEventListener('click', () => { if (!busy) el.photoInput.click(); });
el.photoReplace.addEventListener('click', () => { if (!busy) el.photoInput.click(); });
el.photoInput.addEventListener('change', () => { if (el.photoInput.files[0]) uploadPhoto(el.photoInput.files[0]); });
el.photoRemove.addEventListener('click', () => { if (!busy) el.photoConfirm.classList.remove('hidden'); });
document.getElementById('photoRemoveNo').addEventListener('click', () => el.photoConfirm.classList.add('hidden'));
document.getElementById('photoRemoveYes').addEventListener('click', removePhoto);
el.photoView.addEventListener('click', openLightbox);
document.getElementById('photoClose').addEventListener('click', closeLightbox);
el.lightbox.addEventListener('click', e => { if (e.target === el.lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.lightbox.classList.contains('hidden')) closeLightbox(); });
document.addEventListener('keydown', trapLightboxTab);

// Who's adding the photo, for the history (null when unknown, like the setup page). The photo
// calls wait for it, so a quick upload isn't credited to "Someone".
const anglerReady = gearLoadAnglers().then(p => { myAnglerId = p.myAnglerId; }).catch(() => {});

async function load({ quiet = false } = {}) {
  if (!quiet) showState('loadingState');
  if (!/^\d+$/.test(tipId || '')) {
    el.errorMsg.textContent = "This link doesn't say which tip-up to show.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  try {
    const { tipUps, history } = await gearLoad(tipId);
    const t = tipUps[0];
    if (!t) {
      el.errorMsg.textContent = "That tip-up isn't here any more. It may have been deleted.";
      el.retryBtn.classList.add('hidden');
      showState('errorState');
      return;
    }
    render(t, history);
    showState('viewState');
  } catch (err) {
    console.error('Failed to load tip-up:', err);
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

el.viewCatches.addEventListener('click', e => {
  e.preventDefault();
  if (!shown || !(Number(shown.catchCount) > 0)) return;
  goToGearCatches(shown.id, shown.name, { href: `./gear-tipup.html?id=${encodeURIComponent(shown.id)}`, label: shown.name });
});
el.retryBtn.addEventListener('click', () => load());
window.addEventListener('DOMContentLoaded', () => load());
