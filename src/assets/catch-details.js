const CATCH_MEDIA_GET_URL = API_BASE + "get-catch-media";

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
const AUDIT_FIELDS = ['id', 'recordSource', 'createdAt', 'updatedAt'];

// Fields whose values are date/times and should be formatted for readability
const DATETIME_FIELDS = new Set(['caughtWhen', 'createdAt', 'updatedAt']);

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
  updatedAt:       { label: "Last Updated",    icon: "🔄" },
  recordSource:    { label: "Record Source",   icon: "🗂️" },
};

// Fields excluded from all loops (handled explicitly)
const EXCLUDE_FIELDS = new Set(['catchNumber', 'fullSummary', 'headline', ...FIELD_ORDER, ...AUDIT_FIELDS]);

const el = {
  status:           document.getElementById('status'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  detailsContainer: document.getElementById('detailsContainer'),
  lightbox:         document.getElementById('lightbox'),
  lightboxImg:      document.getElementById('lightboxImg'),
  lightboxClose:    document.getElementById('lightboxClose'),
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

function formatDateTime(value) {
  if (!value) return escapeHtml(String(value));
  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return escapeHtml(
    d.toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  );
}

function formatValue(key, value) {
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

async function loadCatchDetails(catchNumber) {
  try {
    showLoading();
    setStatus("Loading catch details...");

    const url = `${CATCHES_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": API_KEY },
    });

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

  document.title = `${catchNumber} · Gillbert`;

  const hasValue = (key) => catchData[key] !== null && catchData[key] !== undefined && catchData[key] !== '';

  // 0. Headline block — top of card
  const headlineHtml = catchData.headline ? `
    <div class="detail-summary">
      <div class="detail-summary-label">🎣 Headline</div>
      <p>${escapeHtml(catchData.headline)}</p>
    </div>` : '';

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
    .map(key => buildRow(key, catchData[key], 'detail-row--audit'))
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
      <div class="detail-card-section-label">Catch Details</div>
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
        <button class="record-info-trigger" id="recordInfoTrigger">ⓘ Record Info</button>
      </div>
    </div>`;

  document.getElementById('recordInfoTrigger').addEventListener('click', () => {
    recordInfoModal.classList.add('open');
  });
}

window.addEventListener("DOMContentLoaded", () => {
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      recordInfoModal.classList.remove('open');
    }
  });
});

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

function buildMediaTile(item) {
  const { readUrl, mediaType, contentType, uploadedAt } = item;
  const caption = uploadedAt
    ? `<div class="media-tile-caption">${escapeHtml(formatUploadedAt(uploadedAt))}</div>`
    : '';

  // HEIC — browsers can't render inline; show download placeholder
  if (contentType === 'image/heic') {
    return `
      <div class="media-tile">
        <div class="media-tile-placeholder">
          <div class="media-placeholder-icon">📷</div>
          <div class="media-placeholder-label">HEIC Photo</div>
          <a class="media-placeholder-link" href="${encodeURI(readUrl)}" target="_blank" rel="noopener">Open / Download</a>
        </div>
        ${caption}
      </div>`;
  }

  // Video
  if (mediaType === 'Video') {
    return `
      <div class="media-tile media-tile--video">
        <video preload="metadata" playsinline>
          <source src="${encodeURI(readUrl)}" type="${escapeHtml(contentType)}">
        </video>
        <div class="media-play-overlay">
          <div class="media-play-btn"></div>
          <div class="media-video-label">Video</div>
        </div>
        ${caption}
      </div>`;
  }

  // Photo (jpeg, png, etc.)
  return `
    <div class="media-tile media-tile--photo" data-url="${encodeURI(readUrl)}">
      <img
        src="${encodeURI(readUrl)}"
        alt="Catch photo"
        loading="lazy"
        onerror="this.closest('.media-tile').replaceWith(brokenTile())"
      />
      ${caption}
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
