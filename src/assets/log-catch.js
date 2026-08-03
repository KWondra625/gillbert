const LOOKUP_URL    = API_BASE + 'get-lookup-data';
const SAVE_CATCH_URL = API_BASE + 'catch/commit';
const STATE_IDS = ['loadingState', 'lookupErrorState', 'formState', 'submittingState'];

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

// ── Lookup data ───────────────────────────────────────────────────────────────

async function fetchLookups() {
  showState('loadingState', STATE_IDS);
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const data = Array.isArray(raw) ? raw[0] : raw;
    console.log('Lookup response:', data);
    populateSelect(el.anglerId,       data.anglers       || []);
    populateSelect(el.fishSpeciesId,  data.fishSpecies       || []);
    populateSelect(el.bodyOfWaterId,  data.bodiesOfWater || []);
    myAnglerId = await resolveMyAnglerId(data.anglers || []);
    setDefaultCatchTime();
    showState('formState', STATE_IDS);
  } catch (err) {
    console.error('Lookup failed:', err);
    el.lookupErrorMsg.textContent = 'Unable to load options. Please check your connection and try again.';
    showState('lookupErrorState', STATE_IDS);
  }
}

// ── Default catch time ───────────────────────────────────────────────────────

function setDefaultCatchTime() {
  const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
  el.catchDate.value = threeMinAgo.toLocaleDateString('en-CA'); // en-CA forces YYYY-MM-DD
  el.catchTime.value = threeMinAgo.toTimeString().slice(0, 5); // HH:MM
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
    anglerId:       parseInt(el.anglerId.value, 10),
    fishSpeciesId:  parseInt(el.fishSpeciesId.value, 10),
    bodyOfWaterId:  parseInt(el.bodyOfWaterId.value, 10),
    caughtWhen:     buildCaughtWhen(el),
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
      showState('formState', STATE_IDS);
      el.successBannerLink.href        = detailsUrl;
      el.successBannerLink.textContent = `View ${catchNumber} →`;
      el.successBanner.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

  } catch (err) {
    console.error('Save catch failed:', err);
    showState('formState', STATE_IDS);
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
  clearErrors(el);

  // Reset dropdowns to placeholder
  [el.anglerId, el.fishSpeciesId, el.bodyOfWaterId].forEach(sel => { sel.value = ''; });

  setDefaultCatchTime();

  // Clear optional fields
  el.lengthInInches.value  = '';
  el.waterDepthInFeet.value = '';
  el.notes.value            = '';
}

// ── Init ──────────────────────────────────────────────────────────────────────

el.retryBtn.addEventListener('click', fetchLookups);

window.addEventListener('DOMContentLoaded', fetchLookups);
