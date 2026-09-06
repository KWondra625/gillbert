const LOOKUP_URL     = API_BASE + 'get-lookup-data';
const SAVE_CATCH_URL = API_BASE + 'catch/commit';
const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

let hasAttemptedSubmit = false;
let lookups = null;
let catchNumber = null;
let catchId = null;

// Resolved from the Cloudflare identity once lookups load; null if unmatched
let myAnglerId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const el = {
  loadingState:     document.getElementById('loadingState'),
  errorState:       document.getElementById('errorState'),
  formState:        document.getElementById('formState'),
  submittingState:  document.getElementById('submittingState'),
  errorMsg:         document.getElementById('errorMsg'),
  retryBtn:         document.getElementById('retryBtn'),
  formSubtitle:     document.getElementById('formSubtitle'),
  anglerId:         document.getElementById('anglerId'),
  fishSpeciesId:    document.getElementById('fishSpeciesId'),
  bodyOfWaterId:    document.getElementById('bodyOfWaterId'),
  catchDate:        document.getElementById('catchDate'),
  catchTime:        document.getElementById('catchTime'),
  lengthInInches:   document.getElementById('lengthInInches'),
  waterDepthInFeet: document.getElementById('waterDepthInFeet'),
  notes:            document.getElementById('notes'),
  formError:        document.getElementById('formError'),
  saveBtn:          document.getElementById('saveBtn'),
  cancelLink:       document.getElementById('cancelLink'),
};

function getCatchNumberFromUrl() {
  return new URLSearchParams(window.location.search).get('catchNumber');
}

// ── Load catch + lookups ─────────────────────────────────────────────────────

async function loadEditCatch() {
  showState('loadingState', STATE_IDS);
  catchNumber = getCatchNumberFromUrl();

  if (!catchNumber) {
    el.errorMsg.textContent = 'No catch specified to edit.';
    el.retryBtn.classList.add('hidden');
    showState('errorState', STATE_IDS);
    return;
  }

  el.retryBtn.classList.remove('hidden');
  el.cancelLink.href = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;

  try {
    const [lookupRes, catchRes] = await Promise.all([
      fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetch(`${CATCHES_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`, { headers: { 'X-API-Key': API_KEY } }),
    ]);

    if (!lookupRes.ok) throw new Error(`Lookup HTTP ${lookupRes.status}`);
    if (!catchRes.ok) throw new Error(`Catch HTTP ${catchRes.status}`);

    const lookupRaw = await lookupRes.json();
    lookups = Array.isArray(lookupRaw) ? lookupRaw[0] : lookupRaw;

    const catchRaw = await catchRes.json();
    const catchData = Array.isArray(catchRaw) ? catchRaw[0]
      : catchRaw.catch ? catchRaw.catch
      : catchRaw.catches ? catchRaw.catches[0]
      : catchRaw;

    if (!catchData || !catchData.catchNumber) {
      throw new Error('Catch not found.');
    }

    catchId = catchData.id;

    populateSelect(el.anglerId,      lookups.anglers       || []);
    const speciesForDropdown = (lookups.fishSpecies || []).map(s => ({ id: s.id, name: s.displayNameOverride || s.name }));
    const sortedSpecies = speciesForDropdown.sort((a, b) => a.name.localeCompare(b.name));
    populateSelect(el.fishSpeciesId, sortedSpecies);
    populateSelect(el.bodyOfWaterId, lookups.bodiesOfWater || []);
    myAnglerId = await resolveMyAnglerId(lookups.anglers || []);

    if (!canEditCatch(catchData, myAnglerId)) {
      el.errorMsg.textContent = "You don't have permission to edit this catch.";
      el.retryBtn.classList.add('hidden');
      showState('errorState', STATE_IDS);
      return;
    }

    prefillForm(catchData);

    el.formSubtitle.textContent = `Editing ${catchData.catchNumber}`;
    showState('formState', STATE_IDS);
  } catch (err) {
    console.error('Failed to load catch for editing:', err);
    el.errorMsg.textContent = 'Unable to load this catch. Please check your connection and try again.';
    showState('errorState', STATE_IDS);
  }
}

function prefillForm(c) {
  el.anglerId.value      = c.anglerId != null ? String(c.anglerId) : '';
  el.fishSpeciesId.value = c.fishSpeciesId != null ? String(c.fishSpeciesId) : '';
  el.bodyOfWaterId.value = c.bodyOfWaterId != null ? String(c.bodyOfWaterId) : '';

  if (c.caughtWhen) {
    const d = new Date(c.caughtWhen);
    el.catchDate.value = d.toLocaleDateString('en-CA');
    el.catchTime.value = d.toTimeString().slice(0, 5);
  }

  el.lengthInInches.value   = c.length != null ? c.length : '';
  el.waterDepthInFeet.value = c.waterDepth != null ? c.waterDepth : '';
  el.notes.value            = c.notes || '';
}

// Clear individual field error as soon as the user corrects it
['anglerId', 'fishSpeciesId', 'bodyOfWaterId', 'catchDate', 'lengthInInches', 'waterDepthInFeet'].forEach(id => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('change', () => {
    if (!hasAttemptedSubmit) return;
    const errEl = document.getElementById(`${id}Error`);
    if (errEl) errEl.classList.add('hidden');
  });
});

// ── Submit ────────────────────────────────────────────────────────────────────

async function submit() {
  hasAttemptedSubmit = true;

  const errors = validate(el);
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    document.querySelector('.field-error:not(.hidden)')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  clearErrors(el);
  showState('submittingState', STATE_IDS);

  const payload = {
    catchNumber,
    catchId,
    anglerId:      parseInt(el.anglerId.value, 10),
    fishSpeciesId: parseInt(el.fishSpeciesId.value, 10),
    bodyOfWaterId: parseInt(el.bodyOfWaterId.value, 10),
    caughtWhen:    buildCaughtWhen(el),
    updatedByAnglerId: myAnglerId,
  };

  const lengthStr = el.lengthInInches.value.trim();
  payload.lengthInInches = lengthStr === '' ? null : parseFloat(lengthStr);

  const depthStr = el.waterDepthInFeet.value.trim();
  payload.waterDepthInFeet = depthStr === '' ? null : parseFloat(depthStr);

  const notes = el.notes.value.trim();
  payload.notes = notes === '' ? null : notes;

  try {
    const res = await fetch(SAVE_CATCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Unable to save changes. Please try again.');
    }

    window.location.href = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
  } catch (err) {
    console.error('Save catch failed:', err);
    showState('formState', STATE_IDS);
    el.formError.textContent = err.message || 'Something went wrong. Please try again.';
    el.formError.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

el.saveBtn.addEventListener('click', submit);
el.retryBtn.addEventListener('click', loadEditCatch);

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', loadEditCatch);
