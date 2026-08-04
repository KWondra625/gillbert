const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:         document.getElementById('loadingState'),
  errorState:           document.getElementById('errorState'),
  formState:            document.getElementById('formState'),
  submittingState:      document.getElementById('submittingState'),
  errorMsg:             document.getElementById('errorMsg'),
  retryBtn:             document.getElementById('retryBtn'),
  formHeading:          document.getElementById('formHeading'),
  displayNameOverride:  document.getElementById('displayNameOverride'),
  statusPills:           document.getElementById('statusPills'),
  aliases:               document.getElementById('aliases'),
  familyDisplayName:    document.getElementById('familyDisplayName'),
  familyScientificName: document.getElementById('familyScientificName'),
  dnrUrl:                document.getElementById('dnrUrl'),
  notes:                 document.getElementById('notes'),
  formError:             document.getElementById('formError'),
  saveBtn:               document.getElementById('saveBtn'),
  recordInfoTrigger:     document.getElementById('recordInfoTrigger'),
  recordInfoModal:       document.getElementById('recordInfoModal'),
  recordInfoClose:       document.getElementById('recordInfoClose'),
  recordInfoBody:        document.getElementById('recordInfoBody'),
  viewCatchesLink:       document.getElementById('viewCatchesLink'),
};

let speciesId = null;
let originalData = null;
let selectedStatus = 'Active';
let currentCatchCount = 0;

function renderViewCatchesLink(s, count) {
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

function buildRecordInfoRow(icon, label, value) {
  return `
    <div class="detail-row">
      <span class="detail-label">${icon} ${escapeHtml(label)}</span>
      <span class="detail-value">${value}</span>
    </div>`;
}

function renderRecordInfo(s) {
  el.recordInfoBody.innerHTML = [
    buildRecordInfoRow('🆔', 'ID', escapeHtml(String(s.id))),
    buildRecordInfoRow('🕓', 'Created', formatDateTime(s.createdAt)),
    buildRecordInfoRow('🔄', 'Updated', formatDateTime(s.updatedAt)),
  ].join('');
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
  speciesId = getIdFromUrl();

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  if (!speciesId) {
    el.errorMsg.textContent = 'No species specified to edit.';
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  try {
    const [speciesRes, counts] = await Promise.all([
      fetch(FISH_SPECIES_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchCatchCounts(),
    ]);
    if (!speciesRes.ok) throw new Error(`HTTP ${speciesRes.status}`);
    const raw = await speciesRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const all = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    originalData = all.find(s => String(s.id) === String(speciesId));
    if (!originalData) throw new Error('Species not found.');

    prefillForm(originalData);
    renderRecordInfo(originalData);
    renderViewCatchesLink(originalData, counts[originalData.id] || 0);
    el.formHeading.textContent = `✏️ Edit ${originalData.name}`;
    showState('formState');
  } catch (err) {
    console.error('Failed to load species:', err);
    el.errorMsg.textContent = 'Unable to load this species. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

function prefillForm(s) {
  el.displayNameOverride.value = s.displayNameOverride || '';
  setStatus(s.status === 'Inactive' ? 'Inactive' : 'Active');
  el.aliases.value = (s.aliases || []).join(', ');
  el.familyDisplayName.value = s.familyDisplayName || '';
  el.familyScientificName.value = s.familyScientificName || '';
  el.dnrUrl.value = s.dnrUrl || '';
  el.notes.value = s.notes || '';
}

async function submit() {
  el.formError.classList.add('hidden');
  showState('submittingState');

  const aliasesArr = el.aliases.value.split(',').map(a => a.trim()).filter(Boolean);

  const payload = {
    id: parseInt(speciesId, 10),
    name: originalData.name, // not user-editable — see edit-fish-species.html
    status: selectedStatus,
    aliases: aliasesArr,
    displayNameOverride: el.displayNameOverride.value.trim() || null,
    familyDisplayName: el.familyDisplayName.value.trim() || null,
    familyScientificName: el.familyScientificName.value.trim() || null,
    dnrUrl: el.dnrUrl.value.trim() || null,
    notes: el.notes.value.trim() || null,
  };

  try {
    const res = await fetch(FISH_SPECIES_UPDATE_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to save changes. Please try again.');
    }

    window.location.href = './fish-species-listing.html';
  } catch (err) {
    console.error('Save species failed:', err);
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
  if (e.key === 'Escape') el.recordInfoModal.classList.remove('open');
});

el.viewCatchesLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentCatchCount === 0 || !originalData) return;
  const displayName = originalData.displayNameOverride || originalData.name;
  goToFilteredCatches(displayName, {
    href: `./edit-fish-species.html?id=${encodeURIComponent(originalData.id)}`,
    label: displayName,
  });
});

window.addEventListener('DOMContentLoaded', load);
