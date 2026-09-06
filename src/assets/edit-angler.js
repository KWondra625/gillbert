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
  groupsWrapper:     document.getElementById('groupsWrapper'),
  groupsInput:       document.getElementById('groupsInput'),
  groupsSuggestions: document.getElementById('groupsSuggestions'),
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

const photoWidget = createProfilePhotoWidget({
  getAnglerId: () => anglerId,
  elements: {
    img: el.profilePhotoImg,
    placeholder: el.profilePhotoPlaceholder,
    input: el.profilePhotoInput,
    uploadBtn: el.profilePhotoUploadBtn,
    removeBtn: el.profilePhotoRemoveBtn,
    status: el.profilePhotoStatus,
    cropModal: el.cropModal,
    cropModalClose: el.cropModalClose,
    cropCancelBtn: el.cropCancelBtn,
    cropConfirmBtn: el.cropConfirmBtn,
    cropperImage: el.cropperImage,
    cropperSelection: el.cropperSelection,
  },
});

// Populated once all anglers load, so the tag input can suggest existing
// group values instead of everyone typing slightly different spellings.
let allKnownGroups = [];

const groupsTagInput = createTagInput({
  wrapper: el.groupsWrapper,
  input: el.groupsInput,
  suggestionsBox: el.groupsSuggestions,
  getSuggestionPool: () => allKnownGroups,
});

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
    allKnownGroups = Array.from(new Set(all.flatMap(a => a.groups || [])));

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
  photoWidget.setPhoto(a.profilePhotoReadUrl || null);
  el.name.value = a.name || '';
  setStatus(a.status === 'Inactive' ? 'Inactive' : 'Active');
  el.aliases.value = (a.aliases || []).join(', ');
  groupsTagInput.setTags(a.groups || []);
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
    groups: groupsTagInput.getTags(),
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
