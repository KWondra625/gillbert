const STATE_IDS = ['loadingState', 'errorState', 'formState', 'submittingState'];

const el = {
  loadingState:      document.getElementById('loadingState'),
  errorState:        document.getElementById('errorState'),
  formState:         document.getElementById('formState'),
  submittingState:   document.getElementById('submittingState'),
  errorMsg:          document.getElementById('errorMsg'),
  retryBtn:          document.getElementById('retryBtn'),
  formHeading:       document.getElementById('formHeading'),
  name:              document.getElementById('name'),
  nameError:         document.getElementById('nameError'),
  useDnrNameAction:  document.getElementById('useDnrNameAction'),
  statusPills:       document.getElementById('statusPills'),
  notes:             document.getElementById('notes'),
  dnrInfoPanel:      document.getElementById('dnrInfoPanel'),
  dnrInfoBody:       document.getElementById('dnrInfoBody'),
  dnrUrlVerified:    document.getElementById('dnrUrlVerified'),
  formError:         document.getElementById('formError'),
  saveBtn:           document.getElementById('saveBtn'),
  recordInfoTrigger: document.getElementById('recordInfoTrigger'),
  recordInfoModal:   document.getElementById('recordInfoModal'),
  recordInfoClose:   document.getElementById('recordInfoClose'),
  recordInfoBody:    document.getElementById('recordInfoBody'),
  viewCatchesLink:   document.getElementById('viewCatchesLink'),
  dnrSearchInput:    document.getElementById('dnrSearchInput'),
  dnrSearchBtn:      document.getElementById('dnrSearchBtn'),
  dnrSearchStatus:   document.getElementById('dnrSearchStatus'),
  dnrSearchResults:  document.getElementById('dnrSearchResults'),
};

const HYDROTYPE_LABELS = {
  706: 'Lake/Pond', 707: 'Reservoir Flowage', 602: 'Stream/River', 601: 'Ditch/Canal',
  702: 'Fish Hatchery', 703: 'Flooded Excavation', 701: 'Backwater', 610: 'Cranberry Bog',
  704: 'Inundation Area', 705: 'Industrial Waste Pond', 708: 'Sewage Disposal Pond',
  709: 'Tailings Pond', 710: 'Unspecified Open Water',
};

const LANDLOCK_LABELS = { 0: 'Not landlocked', 1: 'Landlocked', 3: 'N/A (no flow)' };

// shape_area/shape_len come from the DNR's WTM (WKID 3071) projection,
// confirmed meters-based via that ArcGIS service's own metadata
// (service-level "units": "esriMeters"). Converted here for display only —
// the stored value stays in native square meters/meters, full precision.
const SQUARE_METERS_PER_ACRE = 4046.8564224;
const METERS_PER_FOOT = 0.3048;

const TWO_DECIMAL_LOCALE_OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatAcres(shapeAreaSqMeters) {
  return (shapeAreaSqMeters / SQUARE_METERS_PER_ACRE).toLocaleString('en-US', TWO_DECIMAL_LOCALE_OPTS) + ' acres';
}

function formatFeet(shapeLenMeters) {
  return (shapeLenMeters / METERS_PER_FOOT).toLocaleString('en-US', TWO_DECIMAL_LOCALE_OPTS) + ' ft';
}

function buildDnrPageUrl(wbic) {
  return `https://apps.dnr.wi.gov/lakes/lakepages/LakeDetail.aspx?wbic=${encodeURIComponent(wbic)}`;
}

let waterId = null;
let originalData = null;
let selectedStatus = 'Active';
let currentCatchCount = 0;

// DNR fields currently attached to this record — either loaded from
// originalData on page load, or replaced wholesale by a fresh search pick.
// Null means "not linked."
let linkedDnr = null;

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

function getIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
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

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return escapeHtml(d.toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }));
}

function buildRecordInfoRow(icon, label, value, extraValueClass = '') {
  return `
    <div class="detail-row">
      <span class="detail-label">${icon} ${escapeHtml(label)}</span>
      <span class="detail-value${extraValueClass ? ' ' + extraValueClass : ''}">${value}</span>
    </div>`;
}

function renderRecordInfo(w) {
  el.recordInfoBody.innerHTML = [
    buildRecordInfoRow('🆔', 'ID', escapeHtml(String(w.id))),
    buildRecordInfoRow('🕓', 'Created', formatDateTime(w.createdAt)),
    buildRecordInfoRow('🔄', 'Updated', formatDateTime(w.updatedAt)),
  ].join('');
}

// ── DNR link state ──────────────────────────────────────────────────────

function renderDnrInfoPanel() {
  if (!linkedDnr || !linkedDnr.wbic) {
    el.dnrInfoPanel.classList.add('hidden');
    return;
  }

  const hydroLabel = linkedDnr.hydrotype != null ? (HYDROTYPE_LABELS[linkedDnr.hydrotype] || `Code ${linkedDnr.hydrotype}`) : '—';
  const landlockLabel = linkedDnr.landlockCode != null ? (LANDLOCK_LABELS[linkedDnr.landlockCode] ?? `Code ${linkedDnr.landlockCode}`) : '—';
  const dnrPageUrl = buildDnrPageUrl(linkedDnr.wbic);

  const rows = [
    buildRecordInfoRow('🏷️', 'DNR Name', escapeHtml(linkedDnr.dnrOfficialName || '—')),
    buildRecordInfoRow('🆔', 'WBIC', escapeHtml(String(linkedDnr.wbic))),
    buildRecordInfoRow('💧', 'Type', escapeHtml(hydroLabel)),
    buildRecordInfoRow('🔒', 'Landlocked', escapeHtml(landlockLabel)),
  ];
  if (linkedDnr.shapeArea != null) rows.push(buildRecordInfoRow('📐', 'Area', escapeHtml(formatAcres(linkedDnr.shapeArea))));
  if (linkedDnr.shapeLen != null) rows.push(buildRecordInfoRow('📏', 'Perimeter', escapeHtml(formatFeet(linkedDnr.shapeLen))));
  if (linkedDnr.latitude != null && linkedDnr.longitude != null) {
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(linkedDnr.latitude)},${encodeURIComponent(linkedDnr.longitude)}`;
    const coordsValue = `<span>${escapeHtml(`${linkedDnr.latitude.toFixed(5)}, ${linkedDnr.longitude.toFixed(5)}`)}</span><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener" class="dnr-result-map">📍 View on Map</a>`;
    rows.push(buildRecordInfoRow('📍', 'Coordinates', coordsValue, 'dnr-coords-value'));
  }
  if (linkedDnr.riverSysName) rows.push(buildRecordInfoRow('🌊', 'River System', escapeHtml(linkedDnr.riverSysName)));
  rows.push(buildRecordInfoRow('🔗', 'DNR Page', `<a href="${escapeHtml(dnrPageUrl)}" target="_blank" rel="noopener" class="dnr-page-link">View on WI DNR ↗</a>`));

  el.dnrInfoBody.innerHTML = rows.join('');
  el.dnrUrlVerified.checked = linkedDnr.dnrUrlVerified !== false;
  el.dnrInfoPanel.classList.remove('hidden');

  renderUseDnrNameAction();
}

function renderUseDnrNameAction() {
  if (linkedDnr && linkedDnr.dnrOfficialName && linkedDnr.dnrOfficialName !== el.name.value.trim()) {
    el.useDnrNameAction.innerHTML = `<button type="button" id="useDnrNameBtn" class="use-dnr-name-btn">↳ Use DNR name ("${escapeHtml(linkedDnr.dnrOfficialName)}")</button>`;
    el.useDnrNameAction.classList.remove('hidden');
    document.getElementById('useDnrNameBtn').addEventListener('click', () => {
      el.name.value = linkedDnr.dnrOfficialName;
      renderUseDnrNameAction();
    });
  } else {
    el.useDnrNameAction.innerHTML = '';
    el.useDnrNameAction.classList.add('hidden');
  }
}

// ── DNR search ──────────────────────────────────────────────────────────

async function runDnrSearch() {
  const q = el.dnrSearchInput.value.trim();
  el.dnrSearchResults.classList.add('hidden');
  el.dnrSearchResults.innerHTML = '';
  if (!q) return;

  el.dnrSearchStatus.textContent = 'Searching WI DNR…';
  el.dnrSearchStatus.classList.remove('hidden');

  try {
    const res = await fetch(`${BODIES_OF_WATER_DNR_SEARCH_URL}?q=${encodeURIComponent(q)}`, {
      headers: { 'X-API-Key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const unwrapped = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    // n8n's "Always Output Data" (needed so a zero-result search doesn't
    // return an empty body) injects a placeholder {} item when there are no
    // real candidates — filter those out rather than treating one as a
    // genuine result.
    const results = unwrapped.filter(r => r && r.waterbodyWbic != null);

    if (!results.length) {
      el.dnrSearchStatus.textContent = 'No matches found on WI DNR.';
      return;
    }

    el.dnrSearchStatus.classList.add('hidden');
    renderDnrResults(results);
  } catch (err) {
    console.error('DNR search failed:', err);
    el.dnrSearchStatus.textContent = 'Unable to search WI DNR right now. Please try again.';
  }
}

function renderDnrResults(results) {
  el.dnrSearchResults.innerHTML = results.map((r, i) => {
    const mapLink = (r.latitude != null && r.longitude != null)
      ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(r.latitude)},${encodeURIComponent(r.longitude)}" target="_blank" rel="noopener" class="dnr-result-map">📍 View on Map</a>`
      : '';
    return `
    <div class="dnr-result" data-index="${i}">
      <div class="dnr-result-main">
        <span class="dnr-result-name">${escapeHtml(r.waterbodyName || '(unnamed)')}</span>
        <span class="dnr-result-wbic">WBIC ${escapeHtml(String(r.waterbodyWbic))}</span>
      </div>
      <div class="dnr-result-actions">
        ${mapLink}
        <button type="button" class="dnr-result-select" data-index="${i}">Use this</button>
      </div>
    </div>`;
  }).join('');

  el.dnrSearchResults.classList.remove('hidden');

  el.dnrSearchResults.querySelectorAll('.dnr-result-select').forEach(btn => {
    btn.addEventListener('click', () => selectDnrResult(results[Number(btn.dataset.index)]));
  });
}

function selectDnrResult(r) {
  linkedDnr = {
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

  el.dnrSearchResults.classList.add('hidden');
  el.dnrSearchInput.value = '';
  renderDnrInfoPanel();
  el.dnrInfoPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Load ──────────────────────────────────────────────────────────────────

async function load() {
  showState('loadingState');
  waterId = getIdFromUrl();

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  if (!waterId) {
    el.errorMsg.textContent = 'No body of water specified to edit.';
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  try {
    const [waterRes, counts] = await Promise.all([
      fetch(BODIES_OF_WATER_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchCatchCounts(),
    ]);
    if (!waterRes.ok) throw new Error(`HTTP ${waterRes.status}`);
    const raw = await waterRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const all = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    originalData = all.find(w => String(w.id) === String(waterId));
    if (!originalData) throw new Error('Body of water not found.');

    prefillForm(originalData);
    renderRecordInfo(originalData);
    renderViewCatchesLink(counts[originalData.id] || 0);
    el.formHeading.textContent = `✏️ Edit ${originalData.name}`;
    showState('formState');
  } catch (err) {
    console.error('Failed to load body of water:', err);
    if (err.message === 'Body of water not found.') {
      el.errorMsg.textContent = 'This record no longer exists. It may have been removed.';
      el.retryBtn.classList.add('hidden');
    } else {
      el.errorMsg.textContent = 'Unable to load this record. Please check your connection and try again.';
      el.retryBtn.classList.remove('hidden');
    }
    showState('errorState');
  }
}

function prefillForm(w) {
  el.name.value = w.name || '';
  setStatus(w.status === 'Inactive' ? 'Inactive' : 'Active');
  el.notes.value = w.notes || '';

  linkedDnr = w.wbic ? {
    wbic: w.wbic,
    dnrOfficialName: w.dnrOfficialName || null,
    hydrotype: w.hydrotype ?? null,
    landlockCode: w.landlockCode ?? null,
    shapeArea: w.shapeArea ?? null,
    shapeLen: w.shapeLen ?? null,
    riverSysName: w.riverSysName || null,
    riverSysWbic: w.riverSysWbic ?? null,
    riverRowName: w.riverRowName || null,
    waterbodyRowName: w.waterbodyRowName || null,
    latitude: w.latitude ?? null,
    longitude: w.longitude ?? null,
    dnrUrlVerified: w.dnrUrlVerified !== false,
  } : null;

  renderDnrInfoPanel();
}

// ── Submit ────────────────────────────────────────────────────────────────

function validate() {
  return { name: !el.name.value.trim() };
}

async function submit() {
  el.formError.classList.add('hidden');

  const errors = validate();
  el.nameError.classList.toggle('hidden', !errors.name);
  if (errors.name) {
    el.name.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  showState('submittingState');

  const dnrFields = linkedDnr
    ? { ...linkedDnr, dnrUrlVerified: el.dnrUrlVerified.checked }
    : {
        wbic: null, dnrOfficialName: null, hydrotype: null, landlockCode: null,
        shapeArea: null, shapeLen: null, riverSysName: null, riverSysWbic: null,
        riverRowName: null, waterbodyRowName: null, latitude: null, longitude: null,
        dnrUrlVerified: true,
      };

  const payload = {
    id: parseInt(waterId, 10),
    name: el.name.value.trim(),
    status: selectedStatus,
    notes: el.notes.value.trim() || null,
    ...dnrFields,
  };

  try {
    const res = await fetch(`${BODIES_OF_WATER_SAVE_URL}?action=update`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to save changes. Please try again.');
    }

    window.location.href = './bodies-of-water-listing.html';
  } catch (err) {
    console.error('Save body of water failed:', err);
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
  if (el.name.value.trim()) el.nameError.classList.add('hidden');
  renderUseDnrNameAction();
});

el.dnrSearchBtn.addEventListener('click', runDnrSearch);
el.dnrSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runDnrSearch(); }
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
  goToFilteredCatches(originalData.name, {
    href: `./edit-body-of-water.html?id=${encodeURIComponent(originalData.id)}`,
    label: originalData.name,
  });
});

window.addEventListener('DOMContentLoaded', load);
