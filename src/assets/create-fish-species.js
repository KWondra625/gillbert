const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:         document.getElementById('loadingState'),
  errorState:           document.getElementById('errorState'),
  formState:            document.getElementById('formState'),
  submittingState:      document.getElementById('submittingState'),
  errorMsg:             document.getElementById('errorMsg'),
  retryBtn:             document.getElementById('retryBtn'),
  name:                  document.getElementById('name'),
  nameError:             document.getElementById('nameError'),
  duplicateWarning:      document.getElementById('duplicateWarning'),
  displayNameOverride:  document.getElementById('displayNameOverride'),
  statusPills:           document.getElementById('statusPills'),
  aliases:               document.getElementById('aliases'),
  familyDisplayName:    document.getElementById('familyDisplayName'),
  familyScientificName: document.getElementById('familyScientificName'),
  dnrUrl:                document.getElementById('dnrUrl'),
  notes:                 document.getElementById('notes'),
  formError:             document.getElementById('formError'),
  createBtn:             document.getElementById('createBtn'),
};

let allSpecies = []; // existing roster, loaded once for the duplicate check
let selectedStatus = 'Active';
let hasAttemptedSubmit = false;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function showState(stateId) {
  STATE_IDS.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}

function setStatus(status) {
  selectedStatus = status;
  el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === status);
  });
}

// ── Duplicate check ──────────────────────────────────────────────────────
// Soft, non-blocking warning only — never stops submission. Combines a
// substring check (catches "Bass" vs "Largemouth Bass") with Levenshtein
// similarity (catches typos like "Muskie" vs "Muskee"). No library; this is
// small enough to hand-roll rather than pull in a dependency for it.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function checkForDuplicates() {
  const typed = el.name.value.trim().toLowerCase();
  if (typed.length < 3) {
    el.duplicateWarning.classList.add('hidden');
    return;
  }

  const matches = new Set();
  allSpecies.forEach(s => {
    const candidates = [s.name, s.displayNameOverride, ...(s.aliases || [])].filter(Boolean);
    const isMatch = candidates.some(c => {
      const cLower = c.toLowerCase();
      const isSubstring = cLower.includes(typed) || typed.includes(cLower);
      return isSubstring || similarity(typed, cLower) >= 0.65;
    });
    if (isMatch) matches.add(s.displayNameOverride || s.name);
  });

  if (matches.size > 0) {
    el.duplicateWarning.innerHTML = `⚠️ Looks similar to existing species: <strong>${[...matches].map(escapeHtml).join(', ')}</strong>. Double-check this isn't already tracked before creating a new entry.`;
    el.duplicateWarning.classList.remove('hidden');
  } else {
    el.duplicateWarning.classList.add('hidden');
  }
}

// ── Load ──────────────────────────────────────────────────────────────────

async function load() {
  showState('loadingState');

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  try {
    const res = await fetch(FISH_SPECIES_GET_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    allSpecies = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    setStatus('Active');
    showState('formState');
  } catch (err) {
    console.error('Failed to load existing species:', err);
    el.errorMsg.textContent = 'Unable to load this page. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

// ── Submit ────────────────────────────────────────────────────────────────

function validate() {
  return { name: !el.name.value.trim() };
}

async function submit() {
  hasAttemptedSubmit = true;
  el.formError.classList.add('hidden');

  const errors = validate();
  el.nameError.classList.toggle('hidden', !errors.name);
  if (errors.name) {
    el.name.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  showState('submittingState');

  const aliasesArr = el.aliases.value.split(',').map(a => a.trim()).filter(Boolean);

  const payload = {
    name: el.name.value.trim(),
    status: selectedStatus,
    aliases: aliasesArr,
    displayNameOverride: el.displayNameOverride.value.trim() || null,
    familyDisplayName: el.familyDisplayName.value.trim() || null,
    familyScientificName: el.familyScientificName.value.trim() || null,
    dnrUrl: el.dnrUrl.value.trim() || null,
    notes: el.notes.value.trim() || null,
  };

  try {
    const res = await fetch(`${FISH_SPECIES_SAVE_URL}?action=create`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to create this species. Please try again.');
    }

    // Jump straight into editing the new record so the admin can keep going
    window.location.href = data.id
      ? `./edit-fish-species.html?id=${encodeURIComponent(data.id)}`
      : './fish-species-listing.html';
  } catch (err) {
    console.error('Create species failed:', err);
    showState('formState');
    el.formError.textContent = err.message || 'Something went wrong. Please try again.';
    el.formError.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

el.statusPills.querySelectorAll('.status-pill').forEach(btn => {
  btn.addEventListener('click', () => setStatus(btn.dataset.status));
});

el.name.addEventListener('input', () => {
  checkForDuplicates();
  if (hasAttemptedSubmit && el.name.value.trim()) el.nameError.classList.add('hidden');
});

el.createBtn.addEventListener('click', submit);
el.retryBtn.addEventListener('click', load);

window.addEventListener('DOMContentLoaded', load);
