const LOOKUP_URL    = API_BASE + 'get-lookup-data';
const SAVE_CATCH_URL = API_BASE + 'catch/commit';

// Tracks which save button was last clicked
let actionIntent = 'view'; // 'view' | 'another'

// Prevents showing validation errors before the user tries to submit
let hasAttemptedSubmit = false;

// Resolved from the Cloudflare identity once lookups load; null if unmatched
let myAnglerId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const el = {
  loadingState:      document.getElementById('loadingState'),
  lookupErrorState:  document.getElementById('lookupErrorState'),
  formState:         document.getElementById('formState'),
  submittingState:   document.getElementById('submittingState'),
  lookupErrorMsg:    document.getElementById('lookupErrorMsg'),
  retryBtn:          document.getElementById('retryBtn'),
  successBanner:     document.getElementById('successBanner'),
  successBannerLink: document.getElementById('successBannerLink'),
  anglerId:          document.getElementById('anglerId'),
  fishSpeciesId:     document.getElementById('fishSpeciesId'),
  bodyOfWaterId:     document.getElementById('bodyOfWaterId'),
  catchDate:         document.getElementById('catchDate'),
  catchTime:         document.getElementById('catchTime'),
  lengthInInches:    document.getElementById('lengthInInches'),
  waterDepthInFeet:  document.getElementById('waterDepthInFeet'),
  notes:             document.getElementById('notes'),
  formError:         document.getElementById('formError'),
  saveViewBtn:       document.getElementById('saveViewBtn'),
  saveAnotherBtn:    document.getElementById('saveAnotherBtn'),
};

// ── State management ──────────────────────────────────────────────────────────

function showState(stateId) {
  ['loadingState', 'lookupErrorState', 'formState', 'submittingState'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}

// ── Lookup data ───────────────────────────────────────────────────────────────

async function fetchLookups() {
  showState('loadingState');
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const data = Array.isArray(raw) ? raw[0] : raw;
    console.log('Lookup response:', data);
    populateSelect(el.anglerId,       data.anglers       || []);
    const sortedSpecies = [...(data.fishSpecies || [])].sort((a, b) => a.name.localeCompare(b.name));
    populateSelect(el.fishSpeciesId,  sortedSpecies);
    populateSelect(el.bodyOfWaterId,  data.bodiesOfWater || []);
    myAnglerId = await resolveMyAnglerId(data.anglers || []);
    applyMode(getMode());
    showState('formState');
  } catch (err) {
    console.error('Lookup failed:', err);
    el.lookupErrorMsg.textContent = 'Unable to load options. Please check your connection and try again.';
    showState('lookupErrorState');
  }
}

function populateSelect(selectEl, items) {
  // Remove all options after the first placeholder option
  while (selectEl.options.length > 1) selectEl.remove(1);
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    selectEl.appendChild(opt);
  });
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

function getMode() {
  return document.querySelector('input[name="catchMode"]:checked').value;
}

function todayStr() {
  // Returns YYYY-MM-DD in local timezone (en-CA locale forces this format)
  return new Date().toLocaleDateString('en-CA');
}

function applyMode(mode) {
  if (mode === 'now') {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    el.catchDate.value = fiveMinAgo.toLocaleDateString('en-CA');
    el.catchTime.value = fiveMinAgo.toTimeString().slice(0, 5); // HH:MM
  } else {
    el.catchDate.value = todayStr();
    el.catchTime.value = '';
  }
}

document.querySelectorAll('input[name="catchMode"]').forEach(radio => {
  radio.addEventListener('change', () => applyMode(getMode()));
});

// ── caughtWhen construction ───────────────────────────────────────────────────

function buildCaughtWhen() {
  const date = el.catchDate.value; // YYYY-MM-DD
  if (!date) return null;

  // Default to midnight when no time is given (full datetime string avoids UTC parsing gotcha)
  const time = el.catchTime.value || '00:00';

  // No trailing "Z" → JS parses as local time → .toISOString() converts to UTC
  return new Date(`${date}T${time}:00`).toISOString();
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate() {
  const errors = {};

  if (!el.anglerId.value)      errors.anglerId      = 'Please select an angler.';
  if (!el.fishSpeciesId.value) errors.fishSpeciesId = 'Please select a fish species.';
  if (!el.bodyOfWaterId.value) errors.bodyOfWaterId = 'Please select a body of water.';
  if (!el.catchDate.value)     errors.catchDate     = 'Please select a date.';

  const length = parseFloat(el.lengthInInches.value);
  if (el.lengthInInches.value !== '' && (isNaN(length) || length <= 0)) {
    errors.lengthInInches = 'Length must be greater than 0.';
  }

  const depth = parseFloat(el.waterDepthInFeet.value);
  if (el.waterDepthInFeet.value !== '' && (isNaN(depth) || depth <= 0)) {
    errors.waterDepthInFeet = 'Water depth must be greater than 0.';
  }

  return errors;
}

function showErrors(errors) {
  ['anglerId', 'fishSpeciesId', 'bodyOfWaterId', 'catchDate', 'lengthInInches', 'waterDepthInFeet'].forEach(id => {
    const errEl = document.getElementById(`${id}Error`);
    if (!errEl) return;
    if (errors[id]) {
      errEl.textContent = errors[id];
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  });
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(e => e.classList.add('hidden'));
  el.formError.textContent = '';
  el.formError.classList.add('hidden');
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
  el.successBanner.classList.add('hidden');

  const errors = validate();
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    document.querySelector('.field-error:not(.hidden)')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  clearErrors();
  showState('submittingState');

  const payload = {
    anglerId:       parseInt(el.anglerId.value, 10),
    fishSpeciesId:  parseInt(el.fishSpeciesId.value, 10),
    bodyOfWaterId:  parseInt(el.bodyOfWaterId.value, 10),
    caughtWhen:     buildCaughtWhen(),
    recordSource:   'Web Form',
    conversationId: null,
    createdByAnglerId: myAnglerId,
    updatedByAnglerId: myAnglerId,
  };

  const length = parseFloat(el.lengthInInches.value);
  if (!isNaN(length) && length > 0) payload.lengthInInches = length;

  const depth = parseFloat(el.waterDepthInFeet.value);
  if (!isNaN(depth) && depth > 0) payload.waterDepthInFeet = depth;

  const notes = el.notes.value.trim();
  if (notes) payload.notes = notes;

  try {
    const res = await fetch(SAVE_CATCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Unable to save catch. Please try again.');
    }

    // Response uses snake_case: catch_number
    const catchNumber = data.catch_number;
    const detailsUrl  = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;

    if (actionIntent === 'view') {
      window.location.href = detailsUrl;
    } else {
      resetForm();
      showState('formState');
      el.successBannerLink.href        = detailsUrl;
      el.successBannerLink.textContent = `View ${catchNumber} →`;
      el.successBanner.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

  } catch (err) {
    console.error('Save catch failed:', err);
    showState('formState');
    el.formError.textContent = err.message || 'Something went wrong. Please try again.';
    el.formError.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

el.saveViewBtn.addEventListener('click', () => {
  actionIntent = 'view';
  submit();
});

el.saveAnotherBtn.addEventListener('click', () => {
  actionIntent = 'another';
  submit();
});

// ── Reset form ────────────────────────────────────────────────────────────────

function resetForm() {
  hasAttemptedSubmit = false;
  clearErrors();

  // Reset dropdowns to placeholder
  [el.anglerId, el.fishSpeciesId, el.bodyOfWaterId].forEach(sel => { sel.value = ''; });

  // Reset to historical mode
  document.querySelector('input[name="catchMode"][value="historical"]').checked = true;
  applyMode('historical');

  // Clear optional fields
  el.lengthInInches.value  = '';
  el.waterDepthInFeet.value = '';
  el.notes.value            = '';
}

// ── Init ──────────────────────────────────────────────────────────────────────

el.retryBtn.addEventListener('click', fetchLookups);

window.addEventListener('DOMContentLoaded', fetchLookups);
