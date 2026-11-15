// Media Management (formerly Media Activity), admin only. Four tabs: every catch media
// upload with its status, so failed or stuck conversions stand out (with Retry/Delete);
// Media Thumbnails, to make the small copies for files without them (#38); Apple Formats,
// to convert older HEIC/MOV files; and a storage check for files with no record and records
// with no file (#10, #16), which runs by itself on load.

const CATCH_MEDIA_GET_URL    = API_BASE + "catch-media/get";
const CATCH_MEDIA_RETRY_URL  = API_BASE + "catch-media/retry";
const CATCH_MEDIA_DELETE_URL = API_BASE + "catch-media/delete";
const CATCH_MEDIA_COMMIT_URL = API_BASE + "catch-media/commit";
const CATCH_MEDIA_ADMIN_URL  = API_BASE + "catch-media/admin";
const CATCH_MEDIA_THUMBS_URL = API_BASE + "catch-media/thumbnails";

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
  statTotal:          document.getElementById('statTotal'),
  statAttention:      document.getElementById('statAttention'),
  statAttentionTile:  document.getElementById('statAttentionTile'),
  statConverting:     document.getElementById('statConverting'),
  statConvertingTile: document.getElementById('statConvertingTile'),
  statStorage:        document.getElementById('statStorage'),
  statStorageTile:    document.getElementById('statStorageTile'),
  uploadsTabCount:    document.getElementById('uploadsTabCount'),
  storageTabCount:    document.getElementById('storageTabCount'),
  status:       document.getElementById('status'),
  mediaList:    document.getElementById('mediaList'),
  showMoreBtn:  document.getElementById('showMoreBtn'),
  refreshBtn:   document.getElementById('refreshBtn'),
  scanBtn:      document.getElementById('scanBtn'),
  scanResult:   document.getElementById('scanResult'),
  catchFilter:  document.getElementById('catchFilter'),
  statThumbs:       document.getElementById('statThumbs'),
  statThumbsTile:   document.getElementById('statThumbsTile'),
  thumbsTabCount:   document.getElementById('thumbsTabCount'),
  statApple:        document.getElementById('statApple'),
  statAppleTile:    document.getElementById('statAppleTile'),
  appleTabCount:    document.getElementById('appleTabCount'),
};

let allMedia = [];
let filter = 'all';
let catchFilter = ''; // a catch number, or '' for all
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
// Complete photos and videos with no thumbnails yet, or whose last attempt failed (#38).
// The API leaves thumbnailStatus null for files still converting.
const needsThumbnails = m => ['missing', 'failed'].includes(m.thumbnailStatus);

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
  el.statTotal.textContent = allMedia.length;
  el.statAttention.textContent = attention;
  el.statConverting.textContent = converting;
  el.statAttentionTile.classList.toggle('stat-tile--alert', attention > 0);
  el.statConvertingTile.classList.toggle('stat-tile--warn', converting > 0);
  el.uploadsTabCount.textContent = `(${allMedia.length})`;
  const noThumbs = allMedia.filter(needsThumbnails).length;
  el.statThumbs.textContent = noThumbs;
  el.statThumbsTile.classList.toggle('stat-tile--warn', noThumbs > 0);
  el.thumbsTabCount.textContent = `(${noThumbs})`;
  const apple = allMedia.filter(needsConverting).length;
  el.statApple.textContent = apple;
  el.statAppleTile.classList.toggle('stat-tile--warn', apple > 0);
  el.appleTabCount.textContent = `(${apple})`;
}

// ── Tabs + tiles ───────────────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('tab--active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('uploadsPanel').classList.toggle('hidden', name !== 'uploads');
  document.getElementById('storagePanel').classList.toggle('hidden', name !== 'storage');
  document.getElementById('thumbsPanel').classList.toggle('hidden', name !== 'thumbnails');
  document.getElementById('applePanel').classList.toggle('hidden', name !== 'apple');
}

function setFilter(name) {
  filter = name;
  shown = PAGE_SIZE;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('filter-chip--active', c.dataset.filter === name));
  renderList();
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

// Each tile jumps to what it counts: a filter on the Uploads tab, or another tab
const TILE_TABS = ['thumbnails', 'apple', 'storage'];
document.querySelectorAll('.stat-tile').forEach(tile => tile.addEventListener('click', () => {
  if (TILE_TABS.includes(tile.dataset.goto)) return showTab(tile.dataset.goto);
  showTab('uploads');
  setFilter(tile.dataset.goto);
}));

function renderList() {
  const filtered = allMedia.filter(m =>
    (!catchFilter || m.catchNumber === catchFilter) &&
    (filter === 'attention' ? needsAttention(m) : filter === 'converting' ? isConverting(m) : true));

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
    const type = String(m.mediaType || '').toLowerCase();
    const typeIcon = type === 'video' ? '🎬 ' : type === 'photo' ? '📷 ' : '';
    const by = m.uploadedByAnglerName ? ` <span class="row-by">by ${escapeHtml(m.uploadedByAnglerName)}</span>` : '';
    // One markup for both layouts: wide screens lay the cells out as table columns,
    // phones as a card (see media-management.css).
    return `
      <li class="media-row media-row--${status}">
        <span class="row-status">${STATUS_LABELS[status] || escapeHtml(status)}</span>
        <a class="row-catch" href="${catchUrl}">${escapeHtml(m.catchNumber || 'Unknown catch')}</a>
        <div class="row-body">
          <div class="row-file">${escapeHtml(m.originalFileName || m.blobPath || '')}</div>
          ${error}
        </div>
        <div class="row-meta">
          <span class="meta-type">${type ? typeIcon + escapeHtml(type) : ''}</span>
          <span class="meta-size">${formatSize(m.fileSizeInBytes)}</span>
          <span class="meta-when">${escapeHtml(formatDateTime(m.uploadedAt))}${by}</span>
        </div>
        ${actions}
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
  chip.addEventListener('click', () => setFilter(chip.dataset.filter));
});

// Catches that have uploads, newest catch number first; keeps the current pick across refreshes
function renderCatchFilter() {
  const catches = [...new Set(allMedia.map(m => m.catchNumber).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (catchFilter && !catches.includes(catchFilter)) catchFilter = '';
  el.catchFilter.innerHTML = '<option value="">All catches</option>' + catches
    .map(c => `<option value="${escapeHtml(c)}"${c === catchFilter ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

el.catchFilter.addEventListener('change', () => {
  catchFilter = el.catchFilter.value;
  shown = PAGE_SIZE;
  renderList();
});

el.showMoreBtn.addEventListener('click', () => {
  shown += PAGE_SIZE;
  renderList();
});

// ── Storage check (orphans) ────────────────────────────────────────────

// A look at a file with no record, to decide attach or delete: a thumbnail for photos a
// browser can show, a first frame for MP4 videos, and always a link to open the file (HEIC
// and MOV download instead). The scan supplies the link; an older scan without one shows none.
// The thumbnail is a mouse/touch shortcut only: keyboards and screen readers get the one
// "Open file" link per file, named after the file.
const PREVIEW_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function orphanPreview(f) {
  if (!/^https:\/\//.test(f.readUrl || '')) return '';
  const url = escapeHtml(f.readUrl);
  const type = String(f.contentType || '').toLowerCase();
  const thumb = PREVIEW_IMAGE_TYPES.includes(type)
    ? `<img src="${url}" alt="" loading="lazy">`
    : type === 'video/mp4'
      ? `<video src="${url}#t=0.1" preload="metadata" muted playsinline></video>`
      : '';
  return `
      <div class="orphan-preview">
        ${thumb ? `<a class="orphan-thumb" href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}</a>` : ''}
        <a class="orphan-open" href="${url}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(f.blobPath)} (opens in a new tab)">👁️ Open file ↗</a>
      </div>`;
}

let lastScan = null;

// A file written in the last hour may be an upload that's still running (its record is
// written when the upload finishes), so it's shown but not counted as a problem yet.
const RECENT_MS = 60 * 60 * 1000;
const isRecent = f => Boolean(f.lastModified) && Date.now() - new Date(f.lastModified) < RECENT_MS;

// The Storage tile and the tab heading show how the last scan went
function setStorageSummary(state, issues = 0) {
  el.statStorage.textContent = state === 'checking' ? 'Checking…'
    : state === 'error' ? "Couldn't check"
    : issues ? `${issues} ${issues === 1 ? 'issue' : 'issues'}` : 'All clear ✅';
  el.statStorageTile.classList.toggle('stat-tile--alert', state === 'error' || (state === 'done' && issues > 0));
  el.statStorageTile.classList.toggle('stat-tile--ok', state === 'done' && !issues);
  el.storageTabCount.textContent = state === 'checking' ? '…' : state === 'error' ? '(!)' : issues ? `(${issues})` : '✅';
  el.storageTabCount.classList.toggle('tab-count--alert', state === 'error' || issues > 0);
}

function renderScan() {
  const s = lastScan;
  const orphans = s.orphanFiles || [];
  const missing = s.missingFiles || [];

  // Catch media can be attached back to its catch; a profile photo file nothing points at
  // (e.g. from an interrupted save) can only be deleted: re-upload it from the angler page.
  // A leftover thumbnail or viewing copy (#38) can only be deleted too: attaching it would
  // show the same photo twice on its catch.
  const orphanRows = orphans.map((f, i) => {
    const isPhoto = f.container === 'angler-media';
    const isCopy = /-(thumb|view)\.jpg$/i.test(f.blobPath || '');
    const owner = isPhoto ? (f.anglerId ? `Angler #${f.anglerId} profile photo` : 'Profile photo')
      : isCopy ? `${f.catchNumber || 'Catch'} thumbnail copy` : f.catchNumber;
    const recent = isRecent(f);
    const attach = (isPhoto || isCopy) ? '' : `
        <button class="row-action" data-orphan="${i}" data-action="attach" data-label="📎 Attach to ${escapeHtml(f.catchNumber || 'catch')}">📎 Attach to ${escapeHtml(f.catchNumber || 'catch')}</button>`;
    return `
    <li class="media-row ${recent ? 'media-row--recent' : 'media-row--failed'}">
      <div class="row-file">${escapeHtml(f.blobPath)}</div>
      <div class="row-meta">${escapeHtml([owner, formatDateTime(f.lastModified), formatSize(f.sizeBytes)].filter(Boolean).join(' · '))}</div>
      ${recent ? '<div class="row-meta">⏳ Added in the last hour: it may be an upload that is still running. Scan again later before acting on it.</div>' : ''}
      ${orphanPreview(f)}
      <div class="row-actions">${attach}
        <button class="row-action row-action--danger" data-orphan="${i}" data-action="delete-orphan" data-label="🗑️ Delete file">🗑️ Delete file</button>
      </div>
    </li>`;
  }).join('');

  const missingRows = missing.map(m => `
    <li class="media-row media-row--failed">
      <div class="row-file">${escapeHtml(m.blobPath)}</div>
      <div class="row-meta">${m.container === 'angler-media'
        ? `Angler #${escapeHtml(m.anglerId)}'s profile photo points at a file that isn't in storage. Remove or replace it on the angler's page.`
        : `Media record #${escapeHtml(m.id)} points at a file that isn't in storage. Delete it from its catch page.`}</div>
    </li>`).join('');

  el.scanResult.innerHTML = `
    <p class="scan-summary">Scanned ${escapeHtml(formatDateTime(s.scannedAt))}: ${escapeHtml(s.fileCount ?? '?')} files, ${escapeHtml(s.rowCount ?? '?')} records.</p>
    <div class="scan-columns">
      <div>
        <h3>Files with no record (${orphans.length})</h3>
        ${orphans.length ? `<ul class="media-list">${orphanRows}</ul>` : '<p class="muted">None 🎉</p>'}
      </div>
      <div>
        <h3>Records with no file (${missing.length})</h3>
        ${missing.length ? `<ul class="media-list">${missingRows}</ul>` : '<p class="muted">None 🎉</p>'}
      </div>
    </div>`;
  el.scanResult.classList.remove('hidden');
  setStorageSummary('done', orphans.filter(f => !isRecent(f)).length + missing.length);
}

// Numbered like the list loads: only the newest scan may draw its result
let latestScan = 0;

async function scanStorage() {
  const scanId = ++latestScan;
  el.scanBtn.disabled = true;
  el.scanBtn.textContent = '🔍 Scanning…';
  setStorageSummary('checking');
  try {
    const result = await postJson(CATCH_MEDIA_ADMIN_URL, { action: 'scan' });
    if (scanId !== latestScan) return;
    lastScan = result;
    renderScan();
  } catch (err) {
    if (scanId !== latestScan) return;
    console.error(err);
    setStorageSummary('error');
    el.scanResult.innerHTML = `<p class="status--error">Scan failed: ${escapeHtml(err.message)} ❌</p>`;
    el.scanResult.classList.remove('hidden');
  } finally {
    if (scanId === latestScan) {
      el.scanBtn.disabled = false;
      el.scanBtn.textContent = '🔍 Scan Again';
    }
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
      () => postJson(CATCH_MEDIA_ADMIN_URL, { action: 'delete-orphan', container: file.container || 'catch-media', blobPath: file.blobPath })));
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

// ── Batch lists: Media Thumbnails (#38) and Apple Formats ───────────────

// Both tabs work the same way: tick up to 10 files (the rest disable; "Select 10" tops up),
// press the button, and they're done one at a time, each row showing its progress. Up to
// 10 because the work is heavy for the server (a Pi on Staging); one at a time so each
// request is short and every row can show its own result. Stop lets the current one finish
// and skips the rest, which stay selected. A row this visit worked on stays listed with
// its ✅/⚠️ until that tab's Refresh.
const BATCH_MAX = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One batch at a time across the tabs: both are heavy for the server, and a MOV being
// converted shouldn't get its thumbnail made from the old file at the same moment.
let batchBusy = null;          // the key of the tab running a batch, or null
const batchTabs = [];          // each tab's render, so the others can update their buttons

function makeBatchTab(cfg) {
  const $ = suffix => document.getElementById(cfg.key + suffix);
  const ui = { list: $('List'), status: $('Status'), select: $('SelectBtn'), clear: $('ClearBtn'),
               run: $('RunBtn'), stop: $('StopBtn'), refresh: $('RefreshBtn') };
  const selected = new Set();   // media ids, in the order they were checked
  const progress = new Map();   // id → { state: 'queued'|'running'|'done'|'error'|'waiting', message }
  let running = false, stopRequested = false, shownCount = PAGE_SIZE;

  function setBatchStatus(msg, isError = false) {
    ui.status.textContent = msg;
    ui.status.classList.toggle('status--error', isError);
  }

  const candidates = () => allMedia.filter(m => cfg.needs(m) || progress.has(m.id));

  function render() {
    const items = candidates();
    // Drop selections that are no longer listed (deleted, or done by an earlier run)
    for (const id of selected) if (!items.some(m => m.id === id && cfg.needs(m))) selected.delete(id);

    if (!items.length) {
      ui.list.innerHTML = `<li class="media-empty">${cfg.emptyText}</li>`;
    } else {
      const full = selected.size >= BATCH_MAX;
      ui.list.innerHTML = items.slice(0, shownCount).map(m => {
        const p = progress.get(m.id);
        const checked = selected.has(m.id);
        const canPick = cfg.needs(m) && !running && (checked || !full);
        const state = p ? p.state : cfg.lastFailed(m) ? 'error' : null;
        const message = p ? p.message : cfg.lastError(m);
        const isVideo = m.mediaType === 'Video';
        const label = escapeHtml(m.originalFileName || m.blobPath || `${isVideo ? 'Video' : 'Photo'} #${m.id}`);
        const catchUrl = `./catch-details.html?catchNumber=${encodeURIComponent(m.catchNumber || '')}`;
        // A preview only from a file an <img> can show: a thumbnail, or a photo browsers can
        // read (not a video, not a HEIC)
        const previewUrl = m.thumbnailUrl || (cfg.previewOriginal(m) ? m.readUrl : '');
        const preview = /^https:\/\//.test(previewUrl || '')
          ? `<img class="thumbs-preview" src="${escapeHtml(encodeURI(previewUrl))}" alt="" loading="lazy">`
          : `<span class="thumbs-preview thumbs-preview--none" aria-hidden="true">${isVideo ? '🎬' : '📷'}</span>`;
        return `
        <li class="media-row thumbs-row${state ? ` thumbs-row--${state}` : ''}" data-id="${m.id}">
          <label class="thumbs-pick">
            <input type="checkbox" data-id="${m.id}"${checked ? ' checked' : ''}${canPick ? '' : ' disabled'}>
            <span class="visually-hidden">Select ${label}</span>
          </label>
          ${preview}
          <div class="row-body">
            <div class="row-file">${label}</div>
            <div class="row-meta">
              <a class="row-catch" href="${catchUrl}">${escapeHtml(m.catchNumber || 'Unknown catch')}</a>
              · ${formatSize(m.fileSizeInBytes)} · ${escapeHtml(formatDateTime(m.uploadedAt))}
            </div>
            ${state ? `<div class="thumbs-state">${cfg.stateLabels[state]}</div>` : ''}
            ${message && ['error', 'waiting'].includes(state) ? `<div class="row-error">${escapeHtml(message)}</div>` : ''}
          </div>
        </li>`;
      }).join('') + (items.length > shownCount
        ? `<li class="media-empty"><button class="secondary-button" data-more="${cfg.key}">Show more</button></li>` : '');
    }

    const n = selected.size;
    const otherBusy = batchBusy !== null && batchBusy !== cfg.key;
    ui.run.disabled = running || otherBusy || n === 0;
    ui.run.title = otherBusy ? 'Another tab is running: one batch at a time' : '';
    ui.run.textContent = n ? `${cfg.runLabel} (${n})` : cfg.runLabel;
    ui.select.disabled = running || !items.some(cfg.needs);
    ui.clear.disabled = running || n === 0;
    ui.stop.classList.toggle('hidden', !running);
    ui.stop.disabled = stopRequested;
    ui.stop.textContent = stopRequested ? 'Stopping after this one…' : '⏹️ Stop';
  }

  ui.list.addEventListener('change', e => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    const id = Number(box.dataset.id);
    if (box.checked && selected.size < BATCH_MAX) selected.add(id);
    else selected.delete(id);
    render();
  });

  ui.list.addEventListener('click', e => {
    if (e.target.dataset.more !== cfg.key) return;
    shownCount += PAGE_SIZE;
    render();
  });

  ui.select.addEventListener('click', () => {
    for (const m of candidates()) {
      if (selected.size >= BATCH_MAX) break;
      if (cfg.needs(m)) selected.add(m.id);
    }
    render();
  });

  ui.clear.addEventListener('click', () => { selected.clear(); render(); });
  ui.stop.addEventListener('click', () => { stopRequested = true; render(); });

  // Refresh also clears this visit's ✅/⚠️ rows (not during a run)
  ui.refresh.addEventListener('click', () => {
    if (running) return;
    progress.clear();
    setBatchStatus('');
    loadMedia({ keepState: true });
  });

  ui.run.addEventListener('click', async () => {
    const ids = [...selected];
    if (!ids.length || running || batchBusy) return;
    running = true;
    batchBusy = cfg.key;
    batchTabs.forEach(r => r());
    stopRequested = false;
    for (const id of ids) progress.set(id, { state: 'queued' });
    setBatchStatus('');
    render();

    const counts = { done: 0, error: 0, waiting: 0 };
    for (const id of ids) {
      if (stopRequested) break;
      progress.set(id, { state: 'running' });
      render();
      let result;
      try {
        result = (await cfg.runOne(id)) || { state: 'done' };
      } catch (err) {
        console.error(err);
        result = { state: 'error', message: err.message };
      }
      progress.set(id, result);
      counts[result.state]++;
      selected.delete(id);
      renderSummary();
      render();
    }

    // Anything skipped by Stop goes back to plain "needs doing", still selected
    const skipped = ids.filter(id => progress.get(id)?.state === 'queued');
    skipped.forEach(id => progress.delete(id));
    running = false;
    batchBusy = null;
    stopRequested = false;
    setBatchStatus([
      counts.done ? `${counts.done} ${cfg.doneWord}` : '',
      counts.error ? `${counts.error} failed` : '',
      counts.waiting ? `${counts.waiting} still converting` : '',
      skipped.length ? `${skipped.length} skipped (stopped)` : '',
    ].filter(Boolean).join(', ') + '.', counts.error > 0);
    batchTabs.forEach(r => r());
  });

  batchTabs.push(render);
  return { render };
}

// Media Thumbnails (#38): photos and videos without their copies, or whose last try failed
const thumbsTab = makeBatchTab({
  key: 'thumbs',
  needs: needsThumbnails,
  lastFailed: m => m.thumbnailStatus === 'failed',
  lastError: m => m.thumbnailError,
  previewOriginal: m => m.mediaType !== 'Video' && !APPLE_TYPES.includes(m.contentType),
  runLabel: '🖼️ Generate Thumbnails',
  doneWord: 'done',
  emptyText: 'Every photo has its thumbnails 🎉',
  stateLabels: { queued: '⏳ Waiting', running: '⏳ Generating…', done: '✅ Done', error: '⚠️ Failed' },
  async runOne(id) {
    const r = await postJson(CATCH_MEDIA_THUMBS_URL, { mediaId: id });
    const m = allMedia.find(x => x.id === id);
    if (m) Object.assign(m, { thumbnailUrl: r.thumbnailUrl, viewingUrl: r.viewingUrl, thumbnailStatus: 'done', thumbnailError: null });
  },
});

// Apple Formats: complete files still stored as HEIC/HEIF or MOV, from before uploads were
// converted. Convert starts the same conversion as an upload (through Retry, which accepts
// these), then checks the record every few seconds until it's complete or failed: a video
// can take minutes, too long for one request to wait. After 15 minutes it moves on.
const APPLE_TYPES = ['image/heic', 'image/heif', 'video/quicktime'];
const APPLE_POLL_MS = 5000;
const APPLE_WAIT_MS = 15 * 60 * 1000;
const needsConverting = m => mediaStatus(m) === 'complete' && APPLE_TYPES.includes(m.contentType);

async function fetchMediaRow(m) {
  const url = `${CATCH_MEDIA_GET_URL}?catchNumber=${encodeURIComponent(m.catchNumber || '')}`;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : data.media || []).find(x => x && x.id === m.id) || null;
}

const appleTab = makeBatchTab({
  key: 'apple',
  needs: needsConverting,
  lastFailed: () => false,
  lastError: () => null,
  previewOriginal: () => false, // browsers can't all show HEIC or MOV
  runLabel: '🍎 Convert',
  doneWord: 'converted',
  emptyText: 'Nothing left in an Apple format 🎉',
  stateLabels: { queued: '⏳ Waiting', running: '⏳ Converting…', done: '✅ Converted',
                 error: '⚠️ Failed', waiting: '⏳ Still converting' },
  async runOne(id) {
    const first = allMedia.find(x => x.id === id);
    if (!first) throw new Error('This file is no longer listed');
    const catchNumber = first.catchNumber;
    await postJson(CATCH_MEDIA_RETRY_URL, { mediaId: id });
    const started = Date.now();
    while (Date.now() - started < APPLE_WAIT_MS) {
      await sleep(APPLE_POLL_MS);
      let row;
      try { row = await fetchMediaRow({ id, catchNumber }); } catch { continue; } // couldn't check: try again
      if (!row) throw new Error('This file was deleted while converting');
      // The list may have been reloaded meanwhile: update the record it shows now
      const m = allMedia.find(x => x.id === id);
      if (m) Object.assign(m, row);
      const st = mediaStatus(row);
      // Done only when it's complete AND no longer an Apple file
      if (st === 'complete' && !APPLE_TYPES.includes(row.contentType)) return { state: 'done' };
      if (st === 'complete' && Date.now() - started > 60_000) throw new Error('Finished, but the file is still in an Apple format');
      if (st === 'failed' || st === 'stuck') throw new Error(row.errorMessage || "Couldn't convert");
    }
    return { state: 'waiting', message: 'Taking a while: Uploads shows how it ends.' };
  },
});

// ── Load ───────────────────────────────────────────────────────────────

// Numbers each load: a slower, older one (e.g. a Refresh that answers after a delete's reload)
// must not overwrite the newer list and bring back a deleted row.
let latestLoad = 0;

async function loadMedia({ keepState = false } = {}) {
  const loadId = ++latestLoad;
  if (!keepState) showState('loadingState');
  try {
    const res = await fetch(CATCH_MEDIA_GET_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (loadId !== latestLoad) return;
    // Like the other GETs, "no media" comes back as one all-null row
    allMedia = (Array.isArray(data) ? data : data.media || [])
      .filter(m => m && m.id)
      .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0) || b.id - a.id);
    renderSummary();
    renderCatchFilter();
    renderList();
    thumbsTab.render();
    appleTab.render();
    showState('listState');
  } catch (err) {
    if (loadId !== latestLoad) return;
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
  // The storage check takes a few seconds; it runs alongside the list, and the
  // Storage tile and tab heading update when it's done.
  scanStorage();
}

el.retryLoadBtn.addEventListener('click', () => loadMedia());
el.refreshBtn.addEventListener('click', () => { setStatus(''); loadMedia({ keepState: true }); });

init();
