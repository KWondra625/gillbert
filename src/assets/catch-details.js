const CATCH_MEDIA_GET_URL = API_BASE + "catch-media/get";
const CATCH_VERIFY_URL    = API_BASE + "catch/verify";
const CATCH_MEDIA_DELETE_URL = API_BASE + "catch-media/delete";
const CATCH_MEDIA_RETRY_URL  = API_BASE + "catch-media/retry";
const LOOKUP_URL          = API_BASE + "get-lookup-data";

// Resolved from the Cloudflare identity once lookups load; null if unmatched
let myAnglerId = null;

// Angler id -> angler record (for the angler photo in the summary),
// populated from the same get-lookup-data call already used for resolveMyAnglerId.
let anglersById = {};

// Primary fields shown in this exact order
const FIELD_ORDER = [
  'anglerName',
  'bodyOfWaterName',
  'fishSpeciesName',
  'length',
  'waterDepth',
  'notes',
  'caughtWhen',
];

// Shown in the summary at the top of the card, so not repeated as detail rows
const SUMMARY_FIELDS = new Set(['anglerName', 'length', 'caughtWhen']);

// Audit fields shown in a separate muted section
const AUDIT_FIELDS = ['id', 'recordSource', 'createdAt', 'updatedAt', 'verifiedAt'];

// Fields whose values are date/times and should be formatted for readability
const DATETIME_FIELDS = new Set(['caughtWhen', 'createdAt', 'verifiedAt', 'updatedAt']);

// Known field label/icon mapping — unknown fields are auto-formatted from camelCase
const FIELD_LABELS = {
  anglerName:      { label: "Angler",          icon: "👤" },
  fishSpeciesName: { label: "Fish Species",    icon: "🐟" },
  bodyOfWaterName: { label: "Body of Water",   icon: "💧" },
  length:          { label: "Length",          icon: "📏" },
  waterDepth:      { label: "Water Depth",     icon: "🌊" },
  caughtWhen:      { label: "Caught When",     icon: "📅" },
  weight:          { label: "Weight",          icon: "⚖️" },
  location:        { label: "Location",        icon: "📍" },
  weather:         { label: "Weather",         icon: "🌤️" },
  gear:            { label: "Gear Used",       icon: "🎿" },
  bait:            { label: "Bait / Lure",     icon: "🪱" },
  waterTemp:       { label: "Water Temp",      icon: "🌡️" },
  notes:           { label: "Notes",           icon: "📝" },
  createdAt:       { label: "Created",         icon: "🕓" },
  verifiedAt:      { label: "Verified",        icon: "✅" },
  updatedAt:       { label: "Last Updated",    icon: "🔄" },
  recordSource:    { label: "Source",          icon: "🗂️" },
  
};

const el = {
  status:           document.getElementById('status'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  detailsContainer: document.getElementById('detailsContainer'),
  lightbox:         document.getElementById('lightbox'),
  lightboxImg:      document.getElementById('lightboxImg'),
  lightboxVideo:    document.getElementById('lightboxVideo'),
  lightboxClose:    document.getElementById('lightboxClose'),
  lightboxPrev:     document.getElementById('lightboxPrev'),
  lightboxNext:     document.getElementById('lightboxNext'),
  lightboxCounter:  document.getElementById('lightboxCounter'),
  backButton:       document.getElementById('backButton'),
};

function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.style.color = isError ? '#ffdddd' : 'white';
}

function showLoading() {
  el.loadingIndicator.classList.add('visible');
}

function hideLoading() {
  el.loadingIndicator.classList.remove('visible');
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

// formatDateLabel/hasExplicitTime come from date-format.js (shared with
// catches-listing.js — see that file for why this is extracted rather than
// duplicated).

function formatDateTime(value) {
  if (!value) return escapeHtml(String(value));
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));

  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return escapeHtml(`${formatDateLabel(d)} at ${time}`);
}

// caughtWhen-only: log-catch.js and the chat n8n workflow both default the
// time to local midnight when none is given (common for legacy/historical
// entries) — that's not a real "caught at 12:00 AM" moment, so omit the time
// entirely rather than display a fabricated one. Doesn't apply to
// createdAt/updatedAt/verifiedAt — those are always real, explicit timestamps.
function formatCaughtWhen(value) {
  if (!value) return escapeHtml(String(value));
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));

  return escapeHtml(formatCaughtWhenFull(d));
}

function formatValue(key, value) {
  if (key === 'caughtWhen') return formatCaughtWhen(value);
  if (DATETIME_FIELDS.has(key)) return formatDateTime(value);
  if (key === 'length') return `${escapeHtml(String(value))}"`;
  if (key === 'waterDepth') return `${escapeHtml(String(value))}'`;
  return escapeHtml(String(value));
}

function buildRow(key, value, extraClass = '', extraContent = '') {
  const meta = FIELD_LABELS[key] || { label: camelToLabel(key), icon: "📌" };
  return `
    <div class="detail-row${extraClass ? ' ' + extraClass : ''}">
      <span class="detail-label">${meta.icon} ${escapeHtml(meta.label)}</span>
      <span class="detail-value">${formatValue(key, value)}${extraContent}</span>
    </div>`;
}

// Combines a timestamp with the angler who caused it, e.g. "June 30, 2026 at 6:04 AM by Kurt".
// Omits the "by ___" suffix entirely when there's no attribution (historical/unmatched-email catches).
function buildAttributionRow(key, dateValue, byName, extraClass = '') {
  const meta = FIELD_LABELS[key] || { label: camelToLabel(key), icon: "📌" };
  const value = byName ? `${formatDateTime(dateValue)} by ${escapeHtml(byName)}` : formatDateTime(dateValue);
  return `
    <div class="detail-row${extraClass ? ' ' + extraClass : ''}">
      <span class="detail-label">${meta.icon} ${escapeHtml(meta.label)}</span>
      <span class="detail-value">${value}</span>
    </div>`;
}

function camelToLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function getCatchNumberFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('catchNumber');
}

// "&from=…" to pass to pages that link back here (Upload Media, Edit), so returning keeps the
// back button pointed where the visitor came from
function fromSuffix() {
  const from = new URLSearchParams(window.location.search).get('from');
  return from ? `&from=${encodeURIComponent(from)}` : '';
}

function setupBackNavigation() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');

  // Allowlist accepted origins so unknown values safely fall back to Home.
  const destinations = {
    'list': {
      href: './catches-listing.html',
      topLabel: 'Catches',
      bottomText: '← Back to Listing',
    },
    'fish-of-fame': {
      href: './fish-of-fame.html',
      topLabel: 'Fish of Fame',
      bottomText: '← Back to Fish of Fame',
    },
    'catch-chat': {
      href: './catch-chat.html',
      topLabel: 'Catch Chat',
      bottomText: '← Back to Catch Chat',
    },
    'ask-gillbert': {
      href: './ask-gillbert.html',
      topLabel: 'Ask Gillbert',
      bottomText: '← Back to Ask Gillbert',
    },
  };

  // Anything else came from Home: no back links, the top bar's wordmark goes home
  const nav = destinations[from];
  if (!nav) {
    if (el.backButton) el.backButton.hidden = true;
    return;
  }

  GillbertTopbar.setBack(nav.href, nav.topLabel);
  if (el.backButton) {
    el.backButton.href = nav.href;
    el.backButton.textContent = nav.bottomText;
  }
}

async function loadCatchDetails(catchNumber) {
  try {
    showLoading();
    setStatus("Loading catch details...");

    const url = `${CATCHES_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const [res, lookupRes] = await Promise.all([
      fetch(url, { headers: { "X-API-Key": API_KEY } }),
      fetch(LOOKUP_URL, { headers: { "X-API-Key": API_KEY } }),
    ]);

    if (!res.ok) throw new Error(`GET failed: ${res.status}`);

    const data = await res.json();

    // Accept: single object, array with one item, or { catch: {...} } / { catches: [...] } envelope
    let catchData;
    if (Array.isArray(data)) {
      catchData = data[0];
    } else if (data && data.catch) {
      catchData = data.catch;
    } else if (data && data.catches) {
      catchData = data.catches[0];
    } else {
      catchData = data;
    }

    // A catch number that doesn't exist comes back as one record with every field empty
    if (!catchData || catchData.id == null || !catchData.catchNumber) {
      hideLoading();
      showLostCatch(catchNumber);
      return false;
    }

    await (window.adminIdentityCheck || Promise.resolve());

    if (lookupRes.ok) {
      const lookupRaw = await lookupRes.json();
      const lookupData = Array.isArray(lookupRaw) ? lookupRaw[0] : lookupRaw;
      const anglers = lookupData.anglers || [];
      myAnglerId = await resolveMyAnglerId(anglers);
      anglersById = Object.fromEntries(anglers.map(a => [a.id, a]));
      setStatus("");
    } else {
      // Owner-edit permission can't be resolved without this — fail closed (no
      // Edit button) same as before, but tell the owner why instead of staying silent.
      setStatus("Couldn't verify edit permissions — try reloading ⚠️", true);
    }

    renderDetails(catchData);
    hideLoading();
    return true;
  } catch (err) {
    console.error(err);
    setStatus("Failed to load catch details ❌", true);
    hideLoading();
  }
}

// Catch not found: one of a few fishing excuses, picked at random, with a way back
const LOST_CATCH_LINES = [
  'That one shook the line! 🎣',
  'Whoops, it jumped off the line! 🐟',
  'Someone forgot to grab the net… 🥅',
];

function showLostCatch(catchNumber) {
  const modal = document.getElementById('lostCatchModal');
  document.getElementById('lostCatchTitle').textContent =
    LOST_CATCH_LINES[Math.floor(Math.random() * LOST_CATCH_LINES.length)];
  // With a number: name it. Without one (a link missing ?catchNumber=), say so.
  const text = document.getElementById('lostCatchText');
  if (catchNumber) {
    const strong = document.createElement('strong');
    strong.id = 'lostCatchNumber';
    strong.textContent = catchNumber;
    text.replaceChildren("We couldn't find ", strong,
      ' in the record books. Maybe it was released, or the link got a little tangled.');
  } else {
    text.textContent = "That link didn't say which catch to show, so there's nothing on the line. Pick one from the catch log instead.";
  }
  document.title = 'Catch not found · Gillbert';
  setStatus('That catch got away. 🎣', true);

  const close = () => modal.classList.remove('open');
  document.getElementById('lostCatchClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  modal.classList.add('open');
  document.getElementById('lostCatchBrowse').focus();
}

function renderDetails(catchData) {
  const catchNumber = catchData.catchNumber || "Unknown";
  const isVerified = !!catchData.verifiedAt;

  const canEdit = canEditCatch(catchData, myAnglerId);
  const isAdmin = isAdminUnlocked();

  document.title = `${catchNumber} · Gillbert`;

  const hasValue = (key) => catchData[key] !== null && catchData[key] !== undefined && catchData[key] !== '';

  document.getElementById('catchTitle').textContent = catchNumber;

  // Review status badge — pending (amber) until verified, then a green confirmation
  const reviewStatusBadgeHtml = isVerified
    ? `<span class="verified-badge">✅ Verified</span>`
    : `<span class="pending-review-badge">⏳ Pending review</span>`;

  // 0. The summary at the top of the card: the fish, who and where, when. (The stored
  // headline isn't shown: it's a template of these same facts.)
  // Same pieces as the catch's card on Browse Catches, bigger.
  const angler = anglersById[catchData.anglerId];
  const avatarHtml = GillbertAvatar.html({ id: catchData.anglerId, profilePhotoReadUrl: angler && angler.profilePhotoReadUrl },
    catchData.anglerName, 'summary-avatar');
  const fish = hasValue('length')
    ? `${escapeHtml(String(catchData.length))}" ${escapeHtml(catchData.fishSpeciesName || 'Fish')}`
    : escapeHtml(catchData.fishSpeciesName || 'Fish');
  const summaryHtml = `
    <div class="catch-summary">
      <div class="summary-by">
        ${avatarHtml}
        <div class="summary-main">
          <div class="summary-fish">${fish}</div>
          <div class="summary-who">Caught by <b>${escapeHtml(catchData.anglerName || 'Unknown angler')}</b>${hasValue('bodyOfWaterName') ? ` on <b>${escapeHtml(catchData.bodyOfWaterName)}</b>` : ''}</div>
          ${hasValue('caughtWhen') ? `<div class="summary-when">${formatCaughtWhen(catchData.caughtWhen)}</div>` : ''}
          <div class="summary-status">${reviewStatusBadgeHtml}</div>
        </div>
      </div>
    </div>`;

  // 1. The detail rows, minus what the summary already shows (species and water stay
  // for their WI DNR links)
  const primaryRows = FIELD_ORDER
    .filter(key => !SUMMARY_FIELDS.has(key))
    .filter(hasValue)
    .map(key => {
      if (key === 'fishSpeciesName' && catchData.fishSpeciesDnrUrl) {
        let dnrHref = null;
        try {
          const u = new URL(catchData.fishSpeciesDnrUrl);
          if (u.protocol === 'http:' || u.protocol === 'https:') dnrHref = u.href;
        } catch {}
        const dnrLink = dnrHref
          ? `<a href="${escapeHtml(dnrHref)}" target="_blank" rel="noopener" class="dnr-link">🔗 WI DNR</a>`
          : '';
        return buildRow(key, catchData[key], '', dnrLink);
      }
      if (key === 'bodyOfWaterName' && catchData.bodyOfWaterWbic && catchData.bodyOfWaterDnrUrlVerified) {
        // bodyOfWaterWbic should always be a plain integer from our own DB,
        // but validate before building the href anyway — same defense in
        // depth as the fish-species DNR link above.
        const wbic = String(catchData.bodyOfWaterWbic).match(/^\d+$/) ? catchData.bodyOfWaterWbic : null;
        const dnrLink = wbic
          ? `<a href="${escapeHtml('https://apps.dnr.wi.gov/lakes/lakepages/LakeDetail.aspx?wbic=' + encodeURIComponent(wbic))}" target="_blank" rel="noopener" class="dnr-link">🔗 WI DNR</a>`
          : '';
        return buildRow(key, catchData[key], '', dnrLink);
      }
      return buildRow(key, catchData[key]);
    })
    .join('');

  // 2. Audit data — stored for the modal, not rendered inline
  const auditRows = AUDIT_FIELDS
    .filter(hasValue)
    .map(key => {
      if (key === 'createdAt') return buildAttributionRow('createdAt', catchData.createdAt, catchData.createdByAnglerName, 'detail-row--audit');
      if (key === 'updatedAt') return buildAttributionRow('updatedAt', catchData.updatedAt, catchData.updatedByAnglerName, 'detail-row--audit');
      return buildRow(key, catchData[key], 'detail-row--audit');
    })
    .join('');

  // Populate the record info modal content
  const recordInfoModal = document.getElementById('recordInfoModal');
  const recordInfoBody  = document.getElementById('recordInfoBody');
  if (recordInfoBody) recordInfoBody.innerHTML = auditRows || '<p style="color:#aaa">No record info available.</p>';

  el.detailsContainer.innerHTML = `
    <div class="detail-card">
      ${summaryHtml}
      <div class="detail-card-section-label">
        <span>Details</span>
      </div>
      <div class="detail-card-body">
        ${primaryRows}
      </div>
      <div id="mediaContainer" class="detail-media-section">
        <div class="detail-section-label">Catch Media</div>
        <div class="media-content"><p class="detail-media-loading">Loading media...</p></div>
      </div>
      <div class="detail-card-footer">
        ${isAdmin
          ? '<button type="button" class="tertiary-button" id="moreBtn" aria-haspopup="dialog">More ▾</button>'
          : '<button type="button" class="tertiary-button" id="recordInfoTrigger">ⓘ Record info</button>'}
      </div>
    </div>
    ${isAdmin ? `
    <!-- More (admins): verify, manage media, record info -->
    <div id="moreModal" class="ri-modal" role="dialog" aria-modal="true" aria-label="More for this catch">
      <div class="ri-modal-sheet">
        <div class="ri-modal-header">
          <span class="ri-modal-title">More for ${escapeHtml(catchNumber)}</span>
          <button type="button" class="ri-modal-close" id="moreClose" aria-label="Close">&times;</button>
        </div>
        <div class="ri-modal-body more-list">
          <button type="button" class="more-item" id="verifyToggle">
            <span class="more-ico" aria-hidden="true">${isVerified ? '↩️' : '✅'}</span>
            <span><b>${isVerified ? 'Unverify' : 'Verify'}</b><span>${isVerified ? 'Send it back to pending review' : 'Mark it reviewed and confirmed'}</span></span>
          </button>
          <button type="button" class="more-item manage-media-trigger" id="manageMediaBtn">
            <span class="more-ico" aria-hidden="true">🗑️</span>
            <span><b>Manage media</b><span>Delete photos and videos</span></span>
          </button>
          <button type="button" class="more-item" id="recordInfoTrigger">
            <span class="more-ico" aria-hidden="true">ⓘ</span>
            <span><b>Record info</b><span>When it was logged, changed and verified, and by whom</span></span>
          </button>
        </div>
      </div>
    </div>` : ''}`;

  // Edit sits in the page heading, for whoever may edit this catch
  const editCatchLink = document.getElementById('editCatchLink');
  editCatchLink.href = `./edit-catch.html?catchNumber=${encodeURIComponent(catchNumber)}${fromSuffix()}`;
  editCatchLink.classList.toggle('hidden', !canEdit);

  document.getElementById('recordInfoTrigger').addEventListener('click', () => {
    document.getElementById('moreModal')?.classList.remove('open');
    recordInfoModal.classList.add('open');
  });

  if (isAdmin) {
    const moreModal = document.getElementById('moreModal');
    const closeMore = () => moreModal.classList.remove('open');
    document.getElementById('moreBtn').addEventListener('click', () => moreModal.classList.add('open'));
    document.getElementById('moreClose').addEventListener('click', closeMore);
    moreModal.addEventListener('click', e => { if (e.target === moreModal) closeMore(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMore(); });

    const verifyToggle = document.getElementById('verifyToggle');
    verifyToggle.addEventListener('click', () => handleVerifyToggle(catchData, verifyToggle));
    document.getElementById('manageMediaBtn').addEventListener('click', () => {
      closeMore();
      handleManageMediaToggle();
    });
  }
}

async function handleVerifyToggle(catchData, button) {
  const newVerified = !catchData.verifiedAt;
  const label = button.querySelector('b');
  const originalLabel = label.textContent;
  button.disabled = true;
  label.textContent = newVerified ? 'Verifying…' : 'Unverifying…';

  try {
    const res = await fetch(CATCH_VERIFY_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ catchId: catchData.id, verified: newVerified }),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Unable to update verification status.');
    }

    catchData.verifiedAt = newVerified ? new Date().toISOString() : null;
    renderDetails(catchData);
    loadCatchMedia(catchData.catchNumber);
  } catch (err) {
    console.error('Verify toggle failed:', err);
    button.disabled = false;
    label.textContent = originalLabel;
    setStatus('Unable to update verification status ❌', true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupBackNavigation();

  const catchNumber = getCatchNumberFromUrl();

  if (!catchNumber) {
    showLostCatch(null);
    return;
  }

  // Render catch details first (card must exist for media container), then fetch media
  loadCatchDetails(catchNumber).then((found) => { if (found) loadCatchMedia(catchNumber); });

  // Lightbox close/navigate handlers
  el.lightboxClose.addEventListener('click', closeLightbox);
  el.lightbox.addEventListener('click', (e) => {
    if (e.target === el.lightbox) closeLightbox();
  });
  el.lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
  el.lightboxNext.addEventListener('click', () => navigateLightbox(1));

  // Swipe left/right to navigate on touch devices. Not on a video: dragging its progress
  // bar to jump ahead is a sideways drag too, and must not flip to the next item.
  let touchStartX = null;
  el.lightbox.addEventListener('touchstart', (e) => {
    touchStartX = e.target === el.lightboxVideo ? null : e.changedTouches[0].clientX;
  }, { passive: true });
  el.lightbox.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    const SWIPE_THRESHOLD = 50;
    if (deltaX > SWIPE_THRESHOLD) navigateLightbox(-1);
    else if (deltaX < -SWIPE_THRESHOLD) navigateLightbox(1);
  }, { passive: true });

  const recordInfoModal = document.getElementById('recordInfoModal');
  const recordInfoClose = document.getElementById('recordInfoClose');
  recordInfoClose.addEventListener('click', () => recordInfoModal.classList.remove('open'));
  recordInfoModal.addEventListener('click', (e) => {
    if (e.target === recordInfoModal) recordInfoModal.classList.remove('open');
  });

  const deleteMediaModal = document.getElementById('deleteMediaModal');
  document.getElementById('deleteMediaClose').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteMediaCancel').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteMediaConfirm').addEventListener('click', handleMediaDelete);
  deleteMediaModal.addEventListener('click', e => { if (e.target === deleteMediaModal) closeDeleteModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      recordInfoModal.classList.remove('open');
      closeDeleteModal();
    }
    if (el.lightbox.classList.contains('open') && e.target.tagName !== 'VIDEO') {
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    }
  });
});

// ─── Admin Media Edit Mode ───────────────────────────────────────

// Turned on from More; while it's on, the media heading shows "Done" in place of
// "Add photos", right where the 🗑️ buttons are.
function handleManageMediaToggle() {
  isMediaEditMode = !isMediaEditMode;
  document.querySelector('#mediaContainer .media-content')?.classList.toggle('media-content--edit-mode', isMediaEditMode);
  document.querySelector('#mediaContainer .detail-upload-btn')?.classList.toggle('hidden', isMediaEditMode);
  document.getElementById('manageMediaDone')?.classList.toggle('hidden', !isMediaEditMode);
}

// ─── Admin Delete State ──────────────────────────────────────────

let pendingDeleteItem = null;
let pendingDeleteTile = null;
let isMediaEditMode   = false;

function openDeleteModal() {
  const preview = document.getElementById('deleteMediaPreview');
  const info    = document.getElementById('deleteMediaInfo');

  if (pendingDeleteItem.notViewable || pendingDeleteItem.contentType === 'image/heic') {
    preview.innerHTML = `<div class="dm-preview-placeholder">📷<br>${escapeHtml(pendingDeleteItem.originalFileName || 'HEIC Photo')}</div>`;
  } else if (pendingDeleteItem.mediaType === 'Video') {
    preview.innerHTML = `<video src="${videoPreviewUrl(pendingDeleteItem.readUrl)}" preload="metadata" muted playsinline></video>`;
    addPreviewFallback(preview.querySelector('video'));
  } else {
    preview.innerHTML = `<img src="${encodeURI(pendingDeleteItem.readUrl)}" alt="Media to delete">`;
  }

  const name = pendingDeleteItem.originalFileName;
  const date = pendingDeleteItem.uploadedAt ? formatUploadedAt(pendingDeleteItem.uploadedAt) : '';
  const parts = [];
  if (name) parts.push(`<strong>${escapeHtml(name)}</strong>`);
  if (date) parts.push(`Uploaded ${escapeHtml(date)}`);
  info.innerHTML = parts.join('<br>');

  const confirmBtn = document.getElementById('deleteMediaConfirm');
  const cancelBtn  = document.getElementById('deleteMediaCancel');
  confirmBtn.disabled = false;
  cancelBtn.disabled  = false;

  document.getElementById('deleteMediaModal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteMediaModal').classList.remove('open');
  document.getElementById('deleteMediaPreview').innerHTML = '';
  document.getElementById('deleteMediaConfirm').textContent = 'Delete';
  pendingDeleteItem = null;
  pendingDeleteTile = null;
}

async function handleMediaDelete() {
  if (!pendingDeleteItem) return;

  const confirmBtn = document.getElementById('deleteMediaConfirm');
  const cancelBtn  = document.getElementById('deleteMediaCancel');
  confirmBtn.disabled = true;
  cancelBtn.disabled  = true;
  confirmBtn.textContent = 'Deleting...';

  try {
    const res = await fetch(CATCH_MEDIA_DELETE_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: pendingDeleteItem.id }),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Delete failed (${res.status})`);
    }

    // Re-fetch and re-render rather than just removing the tile from the DOM:
    // lightboxSequence and each tile's click-bound index are only rebuilt by
    // renderMedia(), so a DOM-only removal would leave them stale (the
    // deleted item still reachable via lightbox nav, counts off by one).
    await loadCatchMedia(getCatchNumberFromUrl());
    closeDeleteModal();
  } catch (err) {
    console.error('Media delete failed:', err);
    confirmBtn.disabled = false;
    cancelBtn.disabled  = false;
    confirmBtn.textContent = 'Delete';
    setStatus('Delete failed ❌', true);
  }
}

// ─── Media ───────────────────────────────────────────────────────

// While any file is still converting, re-check every 10 s and swap tiles in place as they
// finish. Stops when nothing is converting, or after 10 minutes (a file that takes longer
// shows as stuck once 30 minutes pass, with Retry).
const MEDIA_POLL_MS = 10 * 1000;
const MEDIA_POLL_LIMIT_MS = 10 * 60 * 1000;
// A video loaded with preload="metadata" often shows only a black box: the browser reads its length
// and size but draws no picture. "#t=0.1" (a media fragment) asks it to jump to 0.1 s and draw that
// frame. Needs the storage account to answer range requests (default service version 2020-12-06).
// Some browsers refuse a fragment and fail to load the video at all (seen in Playwright's WebKit),
// so on an error the preview reloads without it: at worst the old black box, never a broken video.
function videoPreviewUrl(url) {
  return `${encodeURI(url)}#t=0.1`;
}

function addPreviewFallback(video) {
  video.addEventListener('error', () => {
    if (video.src.includes('#t=')) video.src = video.src.replace(/#t=[^#]*$/, '');
  }, { once: true });
}

let mediaPollTimer = null;
let mediaPollStartedAt = null;
let lastMediaSignature = null;
let latestMediaRequest = 0;  // numbers each load; an older one that answers late is ignored
let mediaLoadedOnce = false;  // after the first good load, a failed refresh keeps what's shown
let mediaRefreshWarned = false;
let mediaRefreshRetries = 0;  // tries after a failed refresh when nothing is converting
const MEDIA_REFRESH_RETRIES = 6; // 10 s apart: about a minute
let lastMediaItems = [];     // the last list the server returned, for polling through a failed check
let deferredMediaItems = null; // a changed list held back while the lightbox was open

function mediaStatus(item) {
  return item.displayStatus || item.status || 'complete';
}

function isConverting(item) {
  const s = mediaStatus(item);
  return s === 'submitted' || s === 'processing';
}

// Returns whether a check was scheduled
function scheduleMediaPoll(catchNumber, items) {
  clearTimeout(mediaPollTimer);
  if (!items.some(isConverting)) { mediaPollStartedAt = null; return false; }
  if (mediaPollStartedAt == null) mediaPollStartedAt = Date.now();
  if (Date.now() - mediaPollStartedAt > MEDIA_POLL_LIMIT_MS) return false;
  mediaPollTimer = setTimeout(() => loadCatchMedia(catchNumber, { quiet: true }), MEDIA_POLL_MS);
  return true;
}

async function loadCatchMedia(catchNumber, { quiet = false } = {}) {
  const requestId = ++latestMediaRequest;
  let items = [];
  let loaded = false;
  try {
    const url = `${CATCH_MEDIA_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`Media GET failed: ${res.status}`);
    const data = await res.json();
    items = Array.isArray(data) ? data
          : Array.isArray(data.media) ? data.media
          : [];
    loaded = true;
  } catch (err) {
    console.error('Media load error:', err);
  }
  // A newer load (e.g. after Retry) started meanwhile: it renders and schedules the next check
  if (requestId !== latestMediaRequest) return;

  // A refresh failed after the media had loaded (a background check, or the reload after Retry
  // or Delete): keep what's on screen and keep checking on the last known list, rather than
  // showing an empty gallery and stopping.
  if (!loaded && mediaLoadedOnce) {
    if (!quiet) {
      mediaRefreshWarned = true;
      setStatus("Couldn't refresh the media just now; still checking.", true);
    }
    if (scheduleMediaPoll(catchNumber, lastMediaItems)) {
      // the usual check while files convert will try again
    } else if (mediaRefreshWarned && mediaRefreshRetries < MEDIA_REFRESH_RETRIES) {
      // The usual polling isn't running (nothing converting, or past its 10 minutes); the
      // list on screen may still be out of date (e.g. a deleted file), so try a few times.
      mediaRefreshRetries++;
      clearTimeout(mediaPollTimer);
      mediaPollTimer = setTimeout(() => loadCatchMedia(catchNumber, { quiet: true }), MEDIA_POLL_MS);
    } else if (mediaRefreshWarned) {
      setStatus("Couldn't refresh the media. Reload the page to see the latest.", true);
    }
    return;
  }
  if (loaded) {
    mediaLoadedOnce = true;
    mediaRefreshRetries = 0;
    if (mediaRefreshWarned) { mediaRefreshWarned = false; setStatus(''); }
  }

  // A background re-check only re-renders when something changed, and never while the
  // lightbox is open (re-rendering rebuilds the sequence it's showing).
  const signature = JSON.stringify(items.map(m => [m.id, mediaStatus(m)]));
  const lightboxOpen = el.lightbox.classList.contains('open');
  if (loaded) lastMediaItems = items;
  if (!quiet || (loaded && signature !== lastMediaSignature && !lightboxOpen)) {
    lastMediaSignature = signature;
    deferredMediaItems = null;
    renderMedia(items);
  } else if (loaded && signature !== lastMediaSignature) {
    deferredMediaItems = items; // shown when the lightbox closes
  }
  scheduleMediaPoll(catchNumber, loaded ? items : []);
}

function formatUploadedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function buildDeleteBtn(item) {
  if (!isAdminUnlocked() || !item.id) return '';
  return `<button class="media-delete-btn"
    data-media-id="${item.id}"
    data-read-url="${encodeURI(item.readUrl || '')}"
    data-media-type="${escapeHtml(item.mediaType || '')}"
    data-content-type="${escapeHtml(item.contentType || '')}"
    data-original-name="${escapeHtml(item.originalFileName || '')}"
    data-uploaded-at="${escapeHtml(item.uploadedAt || '')}"
    aria-label="Delete media">🗑️</button>`;
}

function buildMediaTile(item) {
  const { readUrl, mediaType, contentType, uploadedAt, uploadedByAnglerName } = item;
  const captionText = uploadedAt
    ? (uploadedByAnglerName ? `${formatUploadedAt(uploadedAt)} by ${uploadedByAnglerName}` : formatUploadedAt(uploadedAt))
    : '';
  const caption    = captionText
    ? `<div class="media-tile-caption">${escapeHtml(captionText)}</div>`
    : '';
  const deleteBtn  = buildDeleteBtn(item);
  const status     = mediaStatus(item);

  // Still converting — becomes the photo/video once ready (the page re-checks)
  if (status === 'submitted' || status === 'processing') {
    return `
      <div class="media-tile media-tile--pending" data-media-id="${item.id || ''}">
        <div class="media-tile-placeholder">
          <div class="media-placeholder-icon">⏳</div>
          <div class="media-placeholder-label">Processing</div>
          <div class="media-placeholder-sub">${escapeHtml(item.originalFileName || '')}</div>
        </div>
        ${caption}${deleteBtn}
      </div>`;
  }

  // Conversion failed, or stuck for 30+ minutes — uploader and admin can retry or delete
  if (status === 'failed' || status === 'stuck') {
    const actions = canManageFailedMedia(item) ? `
          <div class="media-tile-actions">
            <button class="media-tile-action" data-action="retry" data-media-id="${item.id}">🔁 Retry</button>
            <button class="media-tile-action" data-action="delete" data-media-id="${item.id}">🗑️ Delete</button>
          </div>` : '';
    return `
      <div class="media-tile media-tile--failed" data-media-id="${item.id || ''}">
        <div class="media-tile-placeholder">
          <div class="media-placeholder-icon">⚠️</div>
          <div class="media-placeholder-label">${status === 'stuck' ? 'Taking too long' : "Couldn't convert"}</div>
          <div class="media-placeholder-sub">${escapeHtml(item.originalFileName || '')}</div>${actions}
        </div>
        ${caption}${deleteBtn}
      </div>`;
  }

  // HEIC — browsers can't render inline; show download placeholder
  if (contentType === 'image/heic') {
    return `
      <div class="media-tile" data-media-id="${item.id || ''}">
        <div class="media-tile-placeholder">
          <div class="media-placeholder-icon">📷</div>
          <div class="media-placeholder-label">HEIC Photo</div>
          <a class="media-placeholder-link" href="${encodeURI(readUrl)}" target="_blank" rel="noopener">Open / Download</a>
        </div>
        ${caption}${deleteBtn}
      </div>`;
  }

  // Video
  if (mediaType === 'Video') {
    return `
      <div class="media-tile media-tile--video" data-media-id="${item.id || ''}">
        <video src="${videoPreviewUrl(readUrl)}" preload="metadata" muted playsinline></video>
        <div class="media-play-overlay">
          <div class="media-play-btn"></div>
          <div class="media-video-label">Video</div>
        </div>
        ${caption}${deleteBtn}
      </div>`;
  }

  // Photo (jpeg, png, etc.)
  return `
    <div class="media-tile media-tile--photo" data-media-id="${item.id || ''}">
      <img
        src="${encodeURI(readUrl)}"
        alt="Catch photo"
        loading="lazy"
        onerror="this.closest('.media-tile').replaceWith(brokenTile())"
      />
      ${caption}${deleteBtn}
    </div>`;
}

function canManageFailedMedia(item) {
  return isAdminUnlocked() || (myAnglerId != null && item.uploadedByAnglerId === myAnglerId);
}

async function handleMediaRetry(mediaId, button) {
  button.disabled = true;
  button.textContent = '🔁 Retrying…';
  try {
    const res = await fetch(CATCH_MEDIA_RETRY_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    });
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.success) throw new Error(data.message || `Retry failed (${res.status})`);
    mediaPollStartedAt = null; // a fresh 10-minute window for this conversion
    // Show it as converting straight away, so it stays that way even if the refresh below fails
    lastMediaItems = lastMediaItems.map(m => String(m.id) === String(mediaId)
      ? { ...m, status: 'submitted', displayStatus: 'submitted', errorMessage: null } : m);
    lastMediaSignature = JSON.stringify(lastMediaItems.map(m => [m.id, mediaStatus(m)]));
    renderMedia(lastMediaItems);
    await loadCatchMedia(getCatchNumberFromUrl());
  } catch (err) {
    console.error('Media retry failed:', err);
    button.disabled = false;
    button.textContent = '🔁 Retry';
    setStatus('Retry failed ❌', true);
  }
}

function brokenTile() {
  const div = document.createElement('div');
  div.className = 'media-tile media-tile-broken';
  div.innerHTML = `
    <div class="media-tile-placeholder">
      <div class="media-placeholder-icon" style="opacity:0.4">🖼️</div>
      <div class="media-placeholder-label" style="opacity:0.5">Media unavailable</div>
    </div>`;
  return div;
}

function wireManageMediaDone(container) {
  container.querySelector('#manageMediaDone')?.addEventListener('click', () => {
    if (isMediaEditMode) handleManageMediaToggle();
  });
}

function renderMedia(items) {
  const container = document.getElementById('mediaContainer');
  if (!container) return;

  const catchNumber = getCatchNumberFromUrl();
  // The section heading carries "＋ Add photos" (anyone), or "Done" while an admin is
  // managing media, so neither hides at the bottom of a long gallery
  const heading = `
    <div class="detail-section-label">
      <span>Catch Media</span>
      <a href="./media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}${fromSuffix()}" class="detail-upload-btn secondary-button button-small button-raised${isMediaEditMode ? ' hidden' : ''}">＋ Add photos</a>
      <button type="button" id="manageMediaDone" class="secondary-button button-small button-raised${isMediaEditMode ? '' : ' hidden'}">✖ Done</button>
    </div>`;

  const photos = items.filter(m => m.mediaType === 'Photo');
  const videos = items.filter(m => m.mediaType === 'Video');

  // Matches DOM order below (photos section, then videos section). HEIC
  // items have no inline preview to swipe to, so they're excluded — their
  // tiles keep their own "Open / Download" link and never join the lightbox.
  lightboxSequence = [...photos, ...videos]
    .filter(m => mediaStatus(m) === 'complete' && m.contentType !== 'image/heic');

  if (!photos.length && !videos.length) {
    container.innerHTML = `${heading}
      <div class="media-content">
        <div class="detail-media-empty">
          <span class="detail-media-empty-icon">📷</span>
          <p class="detail-media-empty-text">No photos or videos yet for this catch.</p>
        </div>
      </div>`;
    wireManageMediaDone(container);
    return;
  }

  let html = `${heading}<div class="media-content">`;

  if (photos.length) {
    html += `
      <div class="media-section">
        <h3 class="media-section-title">📸 Photos (${photos.length})</h3>
        <div class="media-grid">${photos.map(buildMediaTile).join('')}</div>
      </div>`;
  }

  if (videos.length) {
    html += `
      <div class="media-section">
        <h3 class="media-section-title">🎬 Videos (${videos.length})</h3>
        <div class="media-grid">${videos.map(buildMediaTile).join('')}</div>
      </div>`;
  }

  html += '</div>';
  container.innerHTML = html;
  wireManageMediaDone(container);

  if (isMediaEditMode) {
    container.querySelector('.media-content')?.classList.add('media-content--edit-mode');
  }

  // Wire up lightbox clicks — photo and video tiles both open the same
  // swipeable viewer, at this tile's position in lightboxSequence (DOM
  // order here matches that array's order, see above).
  container.querySelectorAll('.media-tile--video video').forEach(addPreviewFallback);
  container.querySelectorAll('.media-tile--photo, .media-tile--video').forEach((tile, i) => {
    tile.addEventListener('click', () => openLightbox(i));
  });

  // Retry / Delete on ⚠️ tiles (uploader or admin; the buttons only render for them)
  const itemsById = Object.fromEntries(items.map(m => [String(m.id), m]));
  container.querySelectorAll('.media-tile-action').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = itemsById[btn.dataset.mediaId];
      if (!item) return;
      if (btn.dataset.action === 'retry') {
        handleMediaRetry(item.id, btn);
      } else {
        pendingDeleteItem = {
          id:               item.id,
          readUrl:          item.readUrl,
          mediaType:        item.mediaType,
          contentType:      item.contentType,
          originalFileName: item.originalFileName,
          uploadedAt:       item.uploadedAt,
          notViewable:      true,
        };
        pendingDeleteTile = btn.closest('.media-tile');
        openDeleteModal();
      }
    });
  });

  // Wire up admin delete buttons
  if (isAdminUnlocked()) {
    container.querySelectorAll('.media-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        pendingDeleteItem = {
          id:               parseInt(btn.dataset.mediaId) || null,
          readUrl:          btn.dataset.readUrl,
          mediaType:        btn.dataset.mediaType,
          contentType:      btn.dataset.contentType,
          originalFileName: btn.dataset.originalName,
          uploadedAt:       btn.dataset.uploadedAt,
        };
        pendingDeleteTile = btn.closest('.media-tile');
        openDeleteModal();
      });
    });
  }
}

// ─── Lightbox ────────────────────────────────────────────────────
// A single swipeable/arrow-navigable viewer shared by photos and videos —
// lightboxSequence is rebuilt on every renderMedia() call (see above),
// lightboxIndex tracks the currently-shown item's position in it.

let lightboxSequence = [];
let lightboxIndex = -1;

function openLightbox(index) {
  lightboxIndex = index;
  el.lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
  showLightboxItem(lightboxIndex);
}

function showLightboxItem(index) {
  const item = lightboxSequence[index];
  if (!item) return;

  if (item.mediaType === 'Video') {
    el.lightboxVideo.src = item.readUrl;
    el.lightboxVideo.classList.remove('hidden');
    el.lightboxImg.classList.add('hidden');
    el.lightboxImg.src = '';
  } else {
    el.lightboxImg.src = item.readUrl;
    el.lightboxImg.classList.remove('hidden');
    el.lightboxVideo.classList.add('hidden');
    el.lightboxVideo.pause();
    el.lightboxVideo.removeAttribute('src');
    el.lightboxVideo.load();
  }

  const multiple = lightboxSequence.length > 1;
  el.lightboxPrev.classList.toggle('hidden', !multiple || index === 0);
  el.lightboxNext.classList.toggle('hidden', !multiple || index === lightboxSequence.length - 1);
  el.lightboxCounter.textContent = multiple ? `${index + 1} / ${lightboxSequence.length}` : '';
}

function navigateLightbox(delta) {
  const next = lightboxIndex + delta;
  if (next < 0 || next >= lightboxSequence.length) return;
  lightboxIndex = next;
  showLightboxItem(lightboxIndex);
}

function closeLightbox() {
  el.lightbox.classList.remove('open');
  el.lightboxImg.src = '';
  el.lightboxVideo.pause();
  el.lightboxVideo.removeAttribute('src');
  el.lightboxVideo.load();
  document.body.style.overflow = '';
  lightboxIndex = -1;
  if (deferredMediaItems) {
    const items = deferredMediaItems;
    deferredMediaItems = null;
    lastMediaSignature = JSON.stringify(items.map(m => [m.id, mediaStatus(m)]));
    renderMedia(items);
  }
}
