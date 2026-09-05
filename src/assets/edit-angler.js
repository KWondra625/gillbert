const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:      document.getElementById('loadingState'),
  errorState:        document.getElementById('errorState'),
  formState:         document.getElementById('formState'),
  submittingState:   document.getElementById('submittingState'),
  errorMsg:          document.getElementById('errorMsg'),
  retryBtn:          document.getElementById('retryBtn'),
  formHeading:       document.getElementById('formHeading'),
  profilePhotoImg:         document.getElementById('profilePhotoImg'),
  profilePhotoPlaceholder: document.getElementById('profilePhotoPlaceholder'),
  profilePhotoInput:       document.getElementById('profilePhotoInput'),
  profilePhotoUploadBtn:   document.getElementById('profilePhotoUploadBtn'),
  profilePhotoRemoveBtn:   document.getElementById('profilePhotoRemoveBtn'),
  profilePhotoStatus:      document.getElementById('profilePhotoStatus'),
  name:              document.getElementById('name'),
  nameError:         document.getElementById('nameError'),
  statusPills:       document.getElementById('statusPills'),
  aliases:           document.getElementById('aliases'),
  loginEmails:       document.getElementById('loginEmails'),
  loginEmailsError:  document.getElementById('loginEmailsError'),
  statsPanel:        document.getElementById('statsPanel'),
  statsBody:         document.getElementById('statsBody'),
  formError:         document.getElementById('formError'),
  saveBtn:           document.getElementById('saveBtn'),
  recordInfoTrigger: document.getElementById('recordInfoTrigger'),
  recordInfoModal:   document.getElementById('recordInfoModal'),
  recordInfoClose:   document.getElementById('recordInfoClose'),
  recordInfoBody:    document.getElementById('recordInfoBody'),
  viewCatchesLink:   document.getElementById('viewCatchesLink'),
  cropModal:         document.getElementById('cropModal'),
  cropModalClose:    document.getElementById('cropModalClose'),
  cropCancelBtn:     document.getElementById('cropCancelBtn'),
  cropConfirmBtn:    document.getElementById('cropConfirmBtn'),
  cropperImage:      document.getElementById('cropperImage'),
  cropperSelection:  document.getElementById('cropperSelection'),
};

let anglerId = null;
let originalData = null;
let selectedStatus = 'Active';
let currentCatchCount = 0;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Defined locally, matching media-upload.js's own SAS/commit endpoint
// constants rather than adding these to config.js — only this page uses them.
const ANGLER_MEDIA_SAS_URL    = API_BASE + 'anglers/get-photo-sas';
const ANGLER_MEDIA_COMMIT_URL = API_BASE + 'anglers/save-photo';
const ANGLER_MEDIA_REMOVE_URL = API_BASE + 'anglers/delete-photo';

function parseLoginEmails() {
  return el.loginEmails.value.split(',').map(e => e.trim()).filter(Boolean);
}

function renderViewCatchesLink(count) {
  currentCatchCount = count;
  if (count > 0) {
    el.viewCatchesLink.textContent = `🎣 View ${count} Catch${count === 1 ? '' : 'es'}`;
    el.viewCatchesLink.classList.remove('view-catches-link--empty');
  } else {
    el.viewCatchesLink.textContent = '🎣 No Catches Yet';
    el.viewCatchesLink.classList.add('view-catches-link--empty');
  }
}

// ── Profile photo ────────────────────────────────────────────────────────

function renderProfilePhoto(readUrl) {
  if (readUrl) {
    el.profilePhotoImg.src = readUrl;
    el.profilePhotoImg.classList.remove('hidden');
    el.profilePhotoPlaceholder.classList.add('hidden');
    el.profilePhotoRemoveBtn.classList.remove('hidden');
  } else {
    el.profilePhotoImg.classList.add('hidden');
    el.profilePhotoImg.removeAttribute('src');
    el.profilePhotoPlaceholder.classList.remove('hidden');
    el.profilePhotoRemoveBtn.classList.add('hidden');
  }
}

async function uploadProfilePhoto(file) {
  el.profilePhotoStatus.textContent = 'Uploading…';
  el.profilePhotoUploadBtn.disabled = true;

  // Instant local preview while the real upload happens in the background.
  const previewUrl = URL.createObjectURL(file);
  el.profilePhotoImg.src = previewUrl;
  el.profilePhotoImg.classList.remove('hidden');
  el.profilePhotoPlaceholder.classList.add('hidden');

  try {
    const sasRes = await fetch(ANGLER_MEDIA_SAS_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anglerId: parseInt(anglerId, 10),
        file: { name: file.name, size: file.size, type: file.type },
      }),
    });
    if (!sasRes.ok) throw new Error(`HTTP ${sasRes.status}`);
    const { uploadUrl, readUrl, blobPath, contentType } = await sasRes.json();

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType || file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Azure PUT failed: ${putRes.status}`);

    const commitRes = await fetch(ANGLER_MEDIA_COMMIT_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anglerId: parseInt(anglerId, 10),
        blobPath, readUrl,
        contentType: contentType || file.type,
        originalName: file.name,
      }),
    });
    if (!commitRes.ok) throw new Error(`HTTP ${commitRes.status}`);
    const commitData = await commitRes.json();

    renderProfilePhoto(commitData.readUrl || readUrl);
    el.profilePhotoStatus.textContent = 'Photo updated.';
  } catch (err) {
    console.error('Profile photo upload failed:', err);
    el.profilePhotoStatus.textContent = 'Upload failed. Please try again.';
    renderProfilePhoto((originalData && originalData.profilePhotoReadUrl) || null);
  } finally {
    URL.revokeObjectURL(previewUrl);
    el.profilePhotoUploadBtn.disabled = false;
    el.profilePhotoInput.value = '';
  }
}

async function removeProfilePhoto() {
  el.profilePhotoStatus.textContent = 'Removing…';
  el.profilePhotoRemoveBtn.disabled = true;

  try {
    const res = await fetch(ANGLER_MEDIA_REMOVE_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ anglerId: parseInt(anglerId, 10) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderProfilePhoto(null);
    el.profilePhotoStatus.textContent = 'Photo removed.';
  } catch (err) {
    console.error('Remove profile photo failed:', err);
    el.profilePhotoStatus.textContent = 'Unable to remove photo. Please try again.';
  } finally {
    el.profilePhotoRemoveBtn.disabled = false;
  }
}

// ── Crop modal ───────────────────────────────────────────────────────────
// Browsers generally can't decode HEIC into an <img>/canvas at all (the same
// reason the server-side conversion step exists), so cropping only applies
// to formats the browser can actually render — HEIC skips straight to the
// existing upload-as-is flow and lets the server-side conversion handle it.

let cropObjectUrl = null;
let pendingOriginalFile = null;

function openCropModal(file) {
  pendingOriginalFile = file;
  cropObjectUrl = URL.createObjectURL(file);
  el.cropperImage.src = cropObjectUrl;
  el.cropModal.classList.add('open');
  // Setting .src via a JS property (rather than a parse-time HTML attribute)
  // doesn't auto-trigger the selection's initial sizing — has to be done
  // explicitly once the new image has actually loaded.
  el.cropperImage.$ready().then(() => el.cropperSelection.$initSelection());
}

function closeCropModal() {
  el.cropModal.classList.remove('open');
  if (cropObjectUrl) {
    URL.revokeObjectURL(cropObjectUrl);
    cropObjectUrl = null;
  }
  pendingOriginalFile = null;
  // Reset so picking the same file again still fires 'change'.
  el.profilePhotoInput.value = '';
}

async function confirmCrop() {
  const originalFile = pendingOriginalFile;
  try {
    const canvas = await el.cropperSelection.$toCanvas();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const croppedName = (originalFile.name || 'photo').replace(/\.[^.]+$/, '') + '-cropped.jpg';
    const croppedFile = new File([blob], croppedName, { type: 'image/jpeg' });
    closeCropModal();
    uploadProfilePhoto(croppedFile);
  } catch (err) {
    console.error('Crop failed:', err);
    closeCropModal();
    el.profilePhotoStatus.textContent = 'Crop failed. Please try again.';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return escapeHtml(d.toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }));
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return escapeHtml(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
}

function buildRecordInfoRow(icon, label, value) {
  return `
    <div class="detail-row">
      <span class="detail-label">${icon} ${escapeHtml(label)}</span>
      <span class="detail-value">${value}</span>
    </div>`;
}

function renderRecordInfo(a) {
  el.recordInfoBody.innerHTML = [
    buildRecordInfoRow('🆔', 'ID', escapeHtml(String(a.id))),
    buildRecordInfoRow('🕓', 'Created', formatDateTime(a.createdAt)),
    buildRecordInfoRow('🔄', 'Updated', formatDateTime(a.updatedAt)),
  ].join('');
}

function catchLink(c) {
  return `<a href="./catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=edit-angler" class="stats-catch-link">${escapeHtml(String(c.length))}" ${escapeHtml(c.fishSpeciesName || 'Unknown')} · ${formatDate(c.caughtWhen)}</a>`;
}

function renderStatsPanel(stats) {
  if (!stats || !stats.count) {
    el.statsPanel.classList.add('hidden');
    return;
  }

  const rows = [buildRecordInfoRow('🎣', 'Total Catches', escapeHtml(String(stats.count)))];
  if (stats.biggestCatch) rows.push(buildRecordInfoRow('🏆', 'Biggest Catch', catchLink(stats.biggestCatch)));
  if (stats.lastCatch) rows.push(buildRecordInfoRow('🕓', 'Last Catch', catchLink(stats.lastCatch)));

  el.statsBody.innerHTML = rows.join('');
  el.statsPanel.classList.remove('hidden');
}

function setStatus(status) {
  selectedStatus = status;
  el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === status);
  });
}

function showState(stateId) {
  STATE_IDS.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}

function getIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

async function load() {
  showState('loadingState');
  anglerId = getIdFromUrl();

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  if (!anglerId) {
    el.errorMsg.textContent = 'No angler specified to edit.';
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  try {
    const [anglersRes, stats] = await Promise.all([
      fetch(ANGLERS_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchAnglerStats(),
    ]);
    if (!anglersRes.ok) throw new Error(`HTTP ${anglersRes.status}`);
    const raw = await anglersRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const all = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    originalData = all.find(a => String(a.id) === String(anglerId));
    if (!originalData) throw new Error('Angler not found.');

    const anglerStats = stats[originalData.id] || null;
    prefillForm(originalData);
    renderRecordInfo(originalData);
    renderStatsPanel(anglerStats);
    renderViewCatchesLink((anglerStats && anglerStats.count) || 0);
    el.formHeading.textContent = `✏️ Edit ${originalData.name}`;
    showState('formState');
  } catch (err) {
    console.error('Failed to load angler:', err);
    if (err.message === 'Angler not found.') {
      el.errorMsg.textContent = 'This angler no longer exists. It may have been removed.';
      el.retryBtn.classList.add('hidden');
    } else {
      el.errorMsg.textContent = 'Unable to load this angler. Please check your connection and try again.';
      el.retryBtn.classList.remove('hidden');
    }
    showState('errorState');
  }
}

function prefillForm(a) {
  renderProfilePhoto(a.profilePhotoReadUrl || null);
  el.name.value = a.name || '';
  setStatus(a.status === 'Inactive' ? 'Inactive' : 'Active');
  el.aliases.value = (a.aliases || []).join(', ');
  el.loginEmails.value = (a.loginEmails || []).join(', ');
}

// ── Submit ────────────────────────────────────────────────────────────────

function validate() {
  return {
    name: !el.name.value.trim(),
    loginEmails: parseLoginEmails().some(e => !EMAIL_PATTERN.test(e)),
  };
}

async function submit() {
  el.formError.classList.add('hidden');

  const errors = validate();
  el.nameError.classList.toggle('hidden', !errors.name);
  el.loginEmailsError.classList.toggle('hidden', !errors.loginEmails);
  if (errors.name) {
    el.name.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (errors.loginEmails) {
    el.loginEmails.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  showState('submittingState');

  const aliasesArr = el.aliases.value.split(',').map(a => a.trim()).filter(Boolean);
  const loginEmailsArr = parseLoginEmails();

  const payload = {
    id: parseInt(anglerId, 10),
    name: el.name.value.trim(),
    status: selectedStatus,
    aliases: aliasesArr,
    loginEmails: loginEmailsArr,
  };

  try {
    const res = await fetch(`${ANGLERS_SAVE_URL}?action=update`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to save changes. Please try again.');
    }

    window.location.href = './anglers-listing.html';
  } catch (err) {
    console.error('Save angler failed:', err);
    showState('formState');
    el.formError.textContent = err.message || 'Something went wrong. Please try again.';
    el.formError.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

el.profilePhotoUploadBtn.addEventListener('click', () => el.profilePhotoInput.click());
el.profilePhotoInput.addEventListener('change', () => {
  const file = el.profilePhotoInput.files && el.profilePhotoInput.files[0];
  if (!file) return;
  if (file.type === 'image/heic') {
    // Can't preview/crop HEIC in-browser — upload as-is, server-side
    // conversion handles it same as before.
    uploadProfilePhoto(file);
  } else {
    openCropModal(file);
  }
});
el.profilePhotoRemoveBtn.addEventListener('click', removeProfilePhoto);

el.cropModalClose.addEventListener('click', closeCropModal);
el.cropCancelBtn.addEventListener('click', closeCropModal);
el.cropConfirmBtn.addEventListener('click', confirmCrop);
el.cropModal.addEventListener('click', (e) => {
  if (e.target === el.cropModal) closeCropModal();
});

el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
  btn.addEventListener('click', () => setStatus(btn.dataset.status));
});

el.saveBtn.addEventListener('click', submit);
el.retryBtn.addEventListener('click', load);

el.recordInfoTrigger.addEventListener('click', () => {
  el.recordInfoModal.classList.add('open');
});
el.recordInfoClose.addEventListener('click', () => {
  el.recordInfoModal.classList.remove('open');
});
el.recordInfoModal.addEventListener('click', (e) => {
  if (e.target === el.recordInfoModal) el.recordInfoModal.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  el.recordInfoModal.classList.remove('open');
  if (el.cropModal.classList.contains('open')) closeCropModal();
});

el.viewCatchesLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentCatchCount === 0 || !originalData) return;
  goToFilteredCatches(originalData.name, {
    href: `./edit-angler.html?id=${encodeURIComponent(originalData.id)}`,
    label: originalData.name,
  });
});

window.addEventListener('DOMContentLoaded', load);
