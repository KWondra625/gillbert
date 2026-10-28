// Media Activity: admin-only list of every catch media upload with its status, so failed
// or stuck conversions stand out (with Retry/Delete), plus an on-demand storage check for
// files that have no media record (#10, #16).

const CATCH_MEDIA_GET_URL    = API_BASE + "catch-media/get";
const CATCH_MEDIA_RETRY_URL  = API_BASE + "catch-media/retry";
const CATCH_MEDIA_DELETE_URL = API_BASE + "catch-media/delete";
const CATCH_MEDIA_COMMIT_URL = API_BASE + "catch-media/commit";
const CATCH_MEDIA_ADMIN_URL  = API_BASE + "catch-media/admin";

const PAGE_SIZE = 50;
const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const STATUS_LABELS = {
  complete:   '✅ Complete',
  submitted:  '⏳ Submitted',
  processing: '⏳ Processing',
  failed:     '⚠️ Failed',
  stuck:      '⚠️ Stuck',
};

const el = {
  errorMsg:     document.getElementById('errorMsg'),
  retryLoadBtn: document.getElementById('retryLoadBtn'),
  summary:      document.getElementById('summary'),
  status:       document.getElementById('status'),
  mediaList:    document.getElementById('mediaList'),
  showMoreBtn:  document.getElementById('showMoreBtn'),
  refreshBtn:   document.getElementById('refreshBtn'),
  scanBtn:      document.getElementById('scanBtn'),
  scanResult:   document.getElementById('scanResult'),
};

let allMedia = [];
let filter = 'all';
let shown = PAGE_SIZE;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function showState(stateId) {
  STATE_IDS.forEach(id => document.getElementById(id).classList.toggle('hidden', id !== stateId));
}

function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle('status--error', isError);
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaStatus(m) {
  return m.displayStatus || m.status || 'complete';
}

const needsAttention = m => ['failed', 'stuck'].includes(mediaStatus(m));
const isConverting = m => ['submitted', 'processing'].includes(mediaStatus(m));

// POSTs JSON and only accepts an explicit `success: true` (an empty 200 is a failed workflow).
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

// Two-step confirm on the button itself (no browser dialog): first tap arms it, second runs.
function armOrRun(button, label, run) {
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = `Tap again to ${label}`;
    button.classList.add('row-action--armed');
    setTimeout(() => {
      if (button.isConnected && button.dataset.armed === 'true') {
        button.dataset.armed = 'false';
        button.textContent = button.dataset.label;
        button.classList.remove('row-action--armed');
      }
    }, 4000);
    return;
  }
  button.dataset.armed = 'false';
  run();
}

// ── Upload list ────────────────────────────────────────────────────────

function renderSummary() {
  const attention = allMedia.filter(needsAttention).length;
  const converting = allMedia.filter(isConverting).length;
  el.summary.innerHTML = `
    <span><strong>${allMedia.length}</strong> uploads</span>
    <span class="${attention ? 'summary-alert' : ''}"><strong>${attention}</strong> need attention</span>
    <span><strong>${converting}</strong> converting</span>`;
}

function renderList() {
  const filtered = allMedia.filter(m =>
    filter === 'attention' ? needsAttention(m) : filter === 'converting' ? isConverting(m) : true);

  if (!filtered.length) {
    el.mediaList.innerHTML = `<li class="media-empty">${filter === 'all' ? 'No uploads yet.' : 'Nothing here right now.'}</li>`;
    el.showMoreBtn.classList.add('hidden');
    return;
  }

  el.mediaList.innerHTML = filtered.slice(0, shown).map(m => {
    const status = mediaStatus(m);
    const catchUrl = `./catch-details.html?catchNumber=${encodeURIComponent(m.catchNumber || '')}`;
    const actions = needsAttention(m) ? `
      <div class="row-actions">
        <button class="row-action" data-action="retry" data-id="${m.id}" data-label="🔁 Retry">🔁 Retry</button>
        <button class="row-action row-action--danger" data-action="delete" data-id="${m.id}" data-label="🗑️ Delete">🗑️ Delete</button>
      </div>` : '';
    const error = m.errorMessage && status !== 'complete'
      ? `<div class="row-error">${escapeHtml(m.errorMessage)}</div>` : '';
    return `
      <li class="media-row media-row--${status}">
        <div class="row-main">
          <a class="row-catch" href="${catchUrl}">${escapeHtml(m.catchNumber || 'Unknown catch')}</a>
          <span class="row-status">${STATUS_LABELS[status] || escapeHtml(status)}</span>
        </div>
        <div class="row-file">${escapeHtml(m.originalFileName || m.blobPath || '')}</div>
        <div class="row-meta">${escapeHtml([
          formatDateTime(m.uploadedAt),
          m.uploadedByAnglerName ? `by ${m.uploadedByAnglerName}` : '',
          m.mediaType,
          formatSize(m.fileSizeInBytes),
        ].filter(Boolean).join(' · '))}</div>
        ${error}${actions}
      </li>`;
  }).join('');

  el.showMoreBtn.classList.toggle('hidden', filtered.length <= shown);
}

el.mediaList.addEventListener('click', e => {
  const button = e.target.closest('.row-action');
  if (!button) return;
  const id = Number(button.dataset.id);

  if (button.dataset.action === 'retry') {
    runRowAction(button, 'Retrying…', () => postJson(CATCH_MEDIA_RETRY_URL, { mediaId: id }), 'Retry started.');
  } else {
    armOrRun(button, 'delete', () =>
      runRowAction(button, 'Deleting…', () => postJson(CATCH_MEDIA_DELETE_URL, { mediaId: id }), 'Deleted.'));
  }
});

async function runRowAction(button, busyLabel, action, doneMsg) {
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await action();
    setStatus(doneMsg);
    await loadMedia({ keepState: true });
  } catch (err) {
    console.error(err);
    setStatus(`${err.message} ❌`, true);
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
}

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    filter = chip.dataset.filter;
    shown = PAGE_SIZE;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('filter-chip--active', c === chip));
    renderList();
  });
});

el.showMoreBtn.addEventListener('click', () => {
  shown += PAGE_SIZE;
  renderList();
});

// ── Storage check (orphans) ────────────────────────────────────────────

let lastScan = null;

function renderScan() {
  const s = lastScan;
  const orphans = s.orphanFiles || [];
  const missing = s.missingFiles || [];

  const orphanRows = orphans.map((f, i) => `
    <li class="media-row media-row--failed">
      <div class="row-file">${escapeHtml(f.blobPath)}</div>
      <div class="row-meta">${escapeHtml([f.catchNumber, formatDateTime(f.lastModified), formatSize(f.sizeBytes)].filter(Boolean).join(' · '))}</div>
      <div class="row-actions">
        <button class="row-action" data-orphan="${i}" data-action="attach" data-label="📎 Attach to ${escapeHtml(f.catchNumber || 'catch')}">📎 Attach to ${escapeHtml(f.catchNumber || 'catch')}</button>
        <button class="row-action row-action--danger" data-orphan="${i}" data-action="delete-orphan" data-label="🗑️ Delete file">🗑️ Delete file</button>
      </div>
    </li>`).join('');

  const missingRows = missing.map(m => `
    <li class="media-row media-row--failed">
      <div class="row-file">${escapeHtml(m.blobPath)}</div>
      <div class="row-meta">Media record #${escapeHtml(m.id)} points at a file that isn't in storage. Delete it from its catch page.</div>
    </li>`).join('');

  el.scanResult.innerHTML = `
    <p class="scan-summary">Scanned ${formatDateTime(s.scannedAt)}: ${s.fileCount} files, ${s.rowCount} records.</p>
    <h3>Files with no record (${orphans.length})</h3>
    ${orphans.length ? `<ul class="media-list">${orphanRows}</ul>` : '<p class="muted">None 🎉</p>'}
    <h3>Records with no file (${missing.length})</h3>
    ${missing.length ? `<ul class="media-list">${missingRows}</ul>` : '<p class="muted">None 🎉</p>'}`;
  el.scanResult.classList.remove('hidden');
}

async function scanStorage() {
  el.scanBtn.disabled = true;
  el.scanBtn.textContent = '🔍 Scanning…';
  try {
    lastScan = await postJson(CATCH_MEDIA_ADMIN_URL, { action: 'scan' });
    renderScan();
  } catch (err) {
    console.error(err);
    el.scanResult.innerHTML = `<p class="status--error">Scan failed: ${escapeHtml(err.message)} ❌</p>`;
    el.scanResult.classList.remove('hidden');
  } finally {
    el.scanBtn.disabled = false;
    el.scanBtn.textContent = '🔍 Scan Storage';
  }
}

el.scanBtn.addEventListener('click', scanStorage);

el.scanResult.addEventListener('click', e => {
  const button = e.target.closest('.row-action');
  if (!button || !lastScan) return;
  const file = lastScan.orphanFiles[Number(button.dataset.orphan)];
  if (!file) return;

  if (button.dataset.action === 'attach') {
    // Attaching records the file the same way an upload does (commit), so HEIC/MOV get
    // converted as usual. The uploader is unknown.
    armOrRun(button, 'attach', () => runScanAction(button, 'Attaching…', () => postJson(CATCH_MEDIA_COMMIT_URL, {
      catchNumber: file.catchNumber,
      uploads: [{ blobPath: file.blobPath, originalName: file.blobPath.split('/').pop(), size: file.sizeBytes || 0 }],
      uploadedByAnglerId: null,
    })));
  } else {
    armOrRun(button, 'delete', () => runScanAction(button, 'Deleting…',
      () => postJson(CATCH_MEDIA_ADMIN_URL, { action: 'delete-orphan', blobPath: file.blobPath })));
  }
});

async function runScanAction(button, busyLabel, action) {
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await action();
    await Promise.all([scanStorage(), loadMedia({ keepState: true })]);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = button.dataset.label;
    el.scanResult.insertAdjacentHTML('afterbegin', `<p class="status--error">${escapeHtml(err.message)} ❌</p>`);
  }
}

// ── Load ───────────────────────────────────────────────────────────────

async function loadMedia({ keepState = false } = {}) {
  if (!keepState) showState('loadingState');
  try {
    const res = await fetch(CATCH_MEDIA_GET_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Like the other GETs, "no media" comes back as one all-null row
    allMedia = (Array.isArray(data) ? data : data.media || [])
      .filter(m => m && m.id)
      .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0) || b.id - a.id);
    renderSummary();
    renderList();
    showState('listState');
  } catch (err) {
    console.error(err);
    if (keepState) {
      setStatus('Could not refresh the list ❌', true);
    } else {
      el.errorMsg.textContent = 'Unable to load media.';
      showState('errorState');
    }
  }
}

async function init() {
  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryLoadBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  loadMedia();
}

el.retryLoadBtn.addEventListener('click', () => loadMedia());
el.refreshBtn.addEventListener('click', () => { setStatus(''); loadMedia({ keepState: true }); });

init();
