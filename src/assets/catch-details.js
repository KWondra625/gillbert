const CATCH_MEDIA_GET_URL = API_BASE + "catch-media/get";
const CATCH_VERIFY_URL    = API_BASE + "catch/verify";
const CATCH_MEDIA_DELETE_URL = API_BASE + "catch-media/delete";
const LOOKUP_URL          = API_BASE + "get-lookup-data";

// Resolved from the Cloudflare identity once lookups load; null if unmatched
let myAnglerId = null;

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

// Fields excluded from all loops (handled explicitly)
const EXCLUDE_FIELDS = new Set(['catchNumber', 'fullSummary', 'headline', 'catchMediaCount', 'anglerId', 'bodyOfWaterId', 'fishSpeciesId', 'createdByAnglerId', 'createdByAnglerName', 'updatedByAnglerId','updatedByAnglerName', ...FIELD_ORDER, ...AUDIT_FIELDS]);

const el = {
  status:           document.getElementById('status'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  detailsContainer: document.getElementById('detailsContainer'),
  lightbox:         document.getElementById('lightbox'),
  lightboxImg:      document.getElementById('lightboxImg'),
  lightboxClose:    document.getElementById('lightboxClose'),
  topHomeLink:      document.querySelector('.top-home-link'),
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

  return hasExplicitTime(d) ? formatDateTime(value) : escapeHtml(formatDateLabel(d));
}

function formatValue(key, value) {
  if (key === 'caughtWhen') return formatCaughtWhen(value);
  if (DATETIME_FIELDS.has(key)) return formatDateTime(value);
  if (key === 'length') return `${escapeHtml(String(value))}"`;
  if (key === 'waterDepth') return `${escapeHtml(String(value))}'`;
  return escapeHtml(String(value));
}

function buildRow(key, value, extraClass = '') {
  const meta = FIELD_LABELS[key] || { label: camelToLabel(key), icon: "📌" };
  return `
    <div class="detail-row${extraClass ? ' ' + extraClass : ''}">
      <span class="detail-label">${meta.icon} ${escapeHtml(meta.label)}</span>
      <span class="detail-value">${formatValue(key, value)}</span>
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

function setupBackNavigation() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');

  // Allowlist accepted origins so unknown values safely fall back to Home.
  const destinations = {
    'list': {
      href: './catches-listing.html',
      topText: '← Catches',
      topAria: 'Go back to Catches',
      bottomText: '← Back to Listing',
    },
    'fish-of-fame': {
      href: './fish-of-fame.html',
      topText: '← Fish of Fame',
      topAria: 'Go back to Fish of Fame',
      bottomText: '← Back to Fish of Fame',
    },
    'catch-chat': {
      href: './catch-chat.html',
      topText: '← Catch Chat',
      topAria: 'Go back to Catch Chat',
      bottomText: '← Back to Catch Chat',
    },
    'ask-gillbert': {
      href: './ask-gillbert.html',
      topText: '← Ask Gillbert',
      topAria: 'Go back to Ask Gillbert',
      bottomText: '← Back to Ask Gillbert',
    },
  };

  const fallback = {
    href: './index.html',
    topText: '← Home',
    topAria: 'Go back to Home',
    bottomText: '← Back to Home',
  };

  const nav = destinations[from] || fallback;

  if (el.topHomeLink) {
    el.topHomeLink.href = nav.href;
    el.topHomeLink.textContent = nav.topText;
    el.topHomeLink.setAttribute('aria-label', nav.topAria);
  }

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

    if (!catchData) {
      setStatus("Catch not found.", true);
      hideLoading();
      return;
    }

    await (window.adminIdentityCheck || Promise.resolve());

    if (lookupRes.ok) {
      const lookupRaw = await lookupRes.json();
      const lookupData = Array.isArray(lookupRaw) ? lookupRaw[0] : lookupRaw;
      myAnglerId = await resolveMyAnglerId(lookupData.anglers || []);
    }

    setStatus("");
    renderDetails(catchData);
    hideLoading();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load catch details ❌", true);
    hideLoading();
  }
}

function renderDetails(catchData) {
  const catchNumber = catchData.catchNumber || "Unknown";
  const isVerified = !!catchData.verifiedAt;

  // Owner-edit: either the angler who caught the fish or whoever logged it, until verified.
  // Admin PIN always overrides.
  const isOwner = myAnglerId != null && (myAnglerId === catchData.anglerId || myAnglerId === catchData.createdByAnglerId);
  const canEdit = isAdminUnlocked() || (isOwner && !isVerified);

  document.title = `${catchNumber} · Gillbert`;

  const hasValue = (key) => catchData[key] !== null && catchData[key] !== undefined && catchData[key] !== '';

  // 0. Headline block — top of card
  const headlineHtml = catchData.headline ? `
    <div class="detail-summary">
      <div class="detail-summary-label">🎣 Headline</div>
      <p>${escapeHtml(catchData.headline)}</p>
    </div>` : '';

  // Review status badge — pending (amber) until verified, then a green confirmation
  const reviewStatusBadgeHtml = isVerified
    ? `<span class="verified-badge">✅ Verified</span>`
    : `<span class="pending-review-badge">⏳ Pending Review</span>`;

  // 1. Primary ordered fields
  const primaryRows = FIELD_ORDER
    .filter(hasValue)
    .map(key => buildRow(key, catchData[key]))
    .join('');

  // 2. Any extra fields the API returned that aren't in our known lists
  const extraRows = Object.keys(catchData)
    .filter(key => !EXCLUDE_FIELDS.has(key) && !AUDIT_FIELDS.includes(key) && hasValue(key))
    .map(key => buildRow(key, catchData[key]))
    .join('');

  // 3. Audit data — stored for the modal, not rendered inline
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
      <div class="detail-card-header">
        <h2>${escapeHtml(catchNumber)} 🎣</h2>
      </div>
      <div class="detail-card-section-label">
        <span>Catch Details</span>
        ${reviewStatusBadgeHtml}
      </div>
      <div class="detail-card-body">
        ${headlineHtml}
        ${primaryRows}
        ${extraRows}
      </div>
      <div id="mediaContainer" class="detail-media-section">
        <div class="detail-section-label">Catch Media</div>
        <div class="media-content"><p class="detail-media-loading">Loading media...</p></div>
      </div>
      <div class="detail-card-footer">
        <div class="detail-card-footer-admin">
          <a href="./edit-catch.html?catchNumber=${encodeURIComponent(catchNumber)}" id="editCatchLink" class="edit-catch-trigger hidden">✏️ Edit</a>
          <button id="verifyToggle" class="verify-toggle-trigger hidden ${isVerified ? 'verify-toggle-trigger--verified' : 'verify-toggle-trigger--pending'}">${isVerified ? '🔓 ↩️ Unverify' : '🔓 ✅ Verify'}</button>
          <button id="manageMediaBtn" class="manage-media-trigger hidden">🔓 🗑️ Manage Media</button>
        </div>
        <button class="record-info-trigger" id="recordInfoTrigger">ⓘ Record Info</button>
      </div>
    </div>`;

  document.getElementById('recordInfoTrigger').addEventListener('click', () => {
    recordInfoModal.classList.add('open');
  });

  const editCatchLink = document.getElementById('editCatchLink');
  if (canEdit) editCatchLink.classList.remove('hidden');

  const verifyToggle = document.getElementById('verifyToggle');
  if (isAdminUnlocked()) {
    verifyToggle.classList.remove('hidden');
    verifyToggle.addEventListener('click', () => handleVerifyToggle(catchData, verifyToggle));
  }

  const manageMediaBtn = document.getElementById('manageMediaBtn');
  if (isAdminUnlocked()) {
    manageMediaBtn.classList.remove('hidden');
    manageMediaBtn.addEventListener('click', handleManageMediaToggle);
  }
}

async function handleVerifyToggle(catchData, button) {
  const newVerified = !catchData.verifiedAt;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = newVerified ? '🔓 Verifying…' : '🔓 Unverifying…';

  try {
    const res = await fetch(CATCH_VERIFY_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ catchId: catchData.id, verified: newVerified }),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Unable to update verification status.');
    }

    catchData.verifiedAt = newVerified ? new Date().toISOString() : null;
    renderDetails(catchData);
    loadCatchMedia(catchData.catchNumber);
  } catch (err) {
    console.error('Verify toggle failed:', err);
    button.disabled = false;
    button.textContent = originalLabel;
    setStatus('Unable to update verification status ❌', true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupBackNavigation();

  const catchNumber = getCatchNumberFromUrl();

  if (!catchNumber) {
    setStatus("No catch number provided.", true);
    el.detailsContainer.innerHTML = `
      <div class="detail-card">
        <div class="detail-card-body">
          <p style="text-align:center;color:#999;">Please return to the listing and select a catch.</p>
        </div>
      </div>`;
    return;
  }

  // Render catch details first (card must exist for media container), then fetch media
  loadCatchDetails(catchNumber).then(() => loadCatchMedia(catchNumber));

  // Lightbox close handlers
  el.lightboxClose.addEventListener('click', closeLightbox);
  el.lightbox.addEventListener('click', (e) => {
    if (e.target === el.lightbox) closeLightbox();
  });

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
  });
});

// ─── Admin Media Edit Mode ───────────────────────────────────────

function handleManageMediaToggle() {
  isMediaEditMode = !isMediaEditMode;
  const btn         = document.getElementById('manageMediaBtn');
  const mediaContent = document.querySelector('#mediaContainer .media-content');

  if (isMediaEditMode) {
    btn.textContent = '✖ Done';
    btn.classList.add('manage-media-trigger--active');
    mediaContent?.classList.add('media-content--edit-mode');
  } else {
    btn.textContent = '🔓 🗑️ Manage Media';
    btn.classList.remove('manage-media-trigger--active');
    mediaContent?.classList.remove('media-content--edit-mode');
  }
}

// ─── Admin Delete State ──────────────────────────────────────────

let pendingDeleteItem = null;
let pendingDeleteTile = null;
let isMediaEditMode   = false;

function openDeleteModal() {
  const preview = document.getElementById('deleteMediaPreview');
  const info    = document.getElementById('deleteMediaInfo');

  if (pendingDeleteItem.contentType === 'image/heic') {
    preview.innerHTML = `<div class="dm-preview-placeholder">📷<br>${escapeHtml(pendingDeleteItem.originalFileName || 'HEIC Photo')}</div>`;
  } else if (pendingDeleteItem.mediaType === 'Video') {
    preview.innerHTML = `<video src="${encodeURI(pendingDeleteItem.readUrl)}" preload="metadata" muted playsinline></video>`;
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

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Delete failed: ${res.status} ${text}`);
    }

    if (pendingDeleteTile) {
      const grid    = pendingDeleteTile.closest('.media-grid');
      const section = grid?.closest('.media-section');
      pendingDeleteTile.remove();
      if (grid && !grid.children.length) {
        section?.remove();
      } else if (section) {
        const title = section.querySelector('.media-section-title');
        if (title) title.textContent = title.textContent.replace(/\(\d+\)/, `(${grid.children.length})`);
      }
    }
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

async function loadCatchMedia(catchNumber) {
  let items = [];
  try {
    const url = `${CATCH_MEDIA_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`Media GET failed: ${res.status}`);
    const data = await res.json();
    items = Array.isArray(data) ? data
          : Array.isArray(data.media) ? data.media
          : [];
  } catch (err) {
    console.error('Media load error:', err);
  } finally {
    renderMedia(items);
  }
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
        <video preload="metadata" playsinline>
          <source src="${encodeURI(readUrl)}" type="${escapeHtml(contentType)}">
        </video>
        <div class="media-play-overlay">
          <div class="media-play-btn"></div>
          <div class="media-video-label">Video</div>
        </div>
        ${caption}${deleteBtn}
      </div>`;
  }

  // Photo (jpeg, png, etc.)
  return `
    <div class="media-tile media-tile--photo" data-url="${encodeURI(readUrl)}" data-media-id="${item.id || ''}">
      <img
        src="${encodeURI(readUrl)}"
        alt="Catch photo"
        loading="lazy"
        onerror="this.closest('.media-tile').replaceWith(brokenTile())"
      />
      ${caption}${deleteBtn}
    </div>`;
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

function renderMedia(items) {
  const container = document.getElementById('mediaContainer');
  if (!container) return;

  const catchNumber = getCatchNumberFromUrl();
  const uploadBtn = `<a href="./media-upload.html?catchNumber=${encodeURIComponent(catchNumber)}" class="detail-upload-btn">⬆️ Upload Media</a>`;

  const photos = items.filter(m => m.mediaType === 'Photo');
  const videos = items.filter(m => m.mediaType === 'Video');

  if (!photos.length && !videos.length) {
    container.innerHTML = `
      <div class="detail-section-label">Catch Media</div>
      <div class="media-content">
        <div class="detail-media-empty">
          <span class="detail-media-empty-icon">📷</span>
          <p class="detail-media-empty-text">No photos or videos yet for this catch.</p>
        </div>
        ${uploadBtn}
      </div>`;
    return;
  }

  let html = '<div class="detail-section-label">Catch Media</div><div class="media-content">';

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

  html += uploadBtn;
  html += '</div>';
  container.innerHTML = html;

  if (isMediaEditMode) {
    container.querySelector('.media-content')?.classList.add('media-content--edit-mode');
  }

  // Wire up photo lightbox clicks
  container.querySelectorAll('.media-tile--photo').forEach(tile => {
    tile.addEventListener('click', () => openLightbox(tile.dataset.url));
  });

  // Wire up video play overlay clicks
  container.querySelectorAll('.media-tile--video').forEach(tile => {
    const overlay = tile.querySelector('.media-play-overlay');
    const video   = tile.querySelector('video');
    overlay.addEventListener('click', () => {
      overlay.style.display = 'none';
      video.controls = true;
      video.play();
    });
    // Re-show overlay when video ends or is paused externally
    video.addEventListener('pause', () => {
      if (video.ended || video.paused) {
        overlay.style.display = '';
        video.controls = false;
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

function openLightbox(url) {
  el.lightboxImg.src = url;
  el.lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  el.lightbox.classList.remove('open');
  el.lightboxImg.src = '';
  document.body.style.overflow = '';
}
