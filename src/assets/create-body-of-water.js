const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:      document.getElementById('loadingState'),
  errorState:        document.getElementById('errorState'),
  formState:         document.getElementById('formState'),
  submittingState:   document.getElementById('submittingState'),
  errorMsg:          document.getElementById('errorMsg'),
  retryBtn:          document.getElementById('retryBtn'),
  name:              document.getElementById('name'),
  nameError:         document.getElementById('nameError'),
  statusPills:       document.getElementById('statusPills'),
  notes:             document.getElementById('notes'),
  formError:         document.getElementById('formError'),
  createBtn:         document.getElementById('createBtn'),
  dnrSearchInput:    document.getElementById('dnrSearchInput'),
  dnrSearchResults:  document.getElementById('dnrSearchResults'),
  dnrLinkedChip:     document.getElementById('dnrLinkedChip'),
  dnrLinkedText:     document.getElementById('dnrLinkedText'),
  dnrLinkedClear:    document.getElementById('dnrLinkedClear'),
};

let selectedStatus = 'Active';
let hasAttemptedSubmit = false;

// Fields pulled from a picked DNR search result, merged into the create
// payload as-is on submit. Cleared via the "Change" action on the linked
// chip. Never touched by manual form fields — Name stays independently
// editable even after a DNR pick (see selectDnrResult).
let pendingDnrFields = null;

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

// ── DNR search ──────────────────────────────────────────────────────────
// runDnrSearch()/renderDnrResults() live in dnr-search.js, shared with
// edit-body-of-water.js. This page only needs to supply selectDnrResult().

function selectDnrResult(r) {
  pendingDnrFields = {
    wbic: r.waterbodyWbic,
    dnrOfficialName: r.waterbodyName || null,
    hydrotype: r.hydrotype ?? null,
    landlockCode: r.landlockCode ?? null,
    shapeArea: r.shapeArea ?? null,
    shapeLen: r.shapeLen ?? null,
    riverSysName: r.riverSysName || null,
    riverSysWbic: r.riverSysWbic ?? null,
    riverRowName: r.riverRowName || null,
    waterbodyRowName: r.waterbodyRowName || null,
    // Latitude/longitude are purely DNR-derived for now — no manual pin
    // entry (that'd be a separate "custom pin" feature, not part of this).
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    dnrUrlVerified: true,
  };

  // Prefill Name only if the admin hasn't already typed something — never
  // silently overwrite manual entry.
  if (!el.name.value.trim() && r.waterbodyName) {
    el.name.value = r.waterbodyName;
  }

  el.dnrSearchResults.classList.add('hidden');
  el.dnrSearchInput.value = '';
  el.dnrLinkedText.textContent = `✓ Linked to ${r.waterbodyName || '(unnamed)'} (WBIC ${r.waterbodyWbic})`;
  el.dnrLinkedChip.classList.remove('hidden');
}

function clearDnrLink() {
  pendingDnrFields = null;
  el.dnrLinkedChip.classList.add('hidden');
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

  setStatus('Active');
  showState('formState');
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

  const payload = {
    name: el.name.value.trim(),
    status: selectedStatus,
    latitude: null,
    longitude: null,
    notes: el.notes.value.trim() || null,
    ...(pendingDnrFields || {}),
  };

  try {
    const res = await fetch(`${BODIES_OF_WATER_SAVE_URL}?action=create`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to create this body of water. Please try again.');
    }

    window.location.href = data.id
      ? `./edit-body-of-water.html?id=${encodeURIComponent(data.id)}`
      : './bodies-of-water-listing.html';
  } catch (err) {
    console.error('Create body of water failed:', err);
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
  if (hasAttemptedSubmit && el.name.value.trim()) el.nameError.classList.add('hidden');
});

el.dnrLinkedClear.addEventListener('click', clearDnrLink);

el.createBtn.addEventListener('click', submit);
el.retryBtn.addEventListener('click', load);

window.addEventListener('DOMContentLoaded', load);
