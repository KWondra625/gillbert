const SAS_WEBHOOK_URL    = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/catch-media/get-sas";
const COMMIT_WEBHOOK_URL = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/catch-media/commit";
const LOOKUP_URL         = API_BASE + 'get-lookup-data';
const CATCH_MEDIA_GET_URL = API_BASE + "catch-media/get";

const REDIRECT_DELAY = 10; // seconds, starting once every file is uploaded and recorded
const PARALLEL_UPLOADS = 3; // files sent to storage at once

// Same rules as the upload-slot workflow (POST Generate SAS Token). Checked here first so one
// file it would refuse doesn't fail the whole batch; keep the two in step.
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
const SLOTS_PER_REQUEST = 10; // MAX_FILES there
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'mov', 'mp4'];

function formatSize(bytes) {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Why a file can't be uploaded at all, or null if it's fine
function rejectReason(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) return "This file type isn't supported (photos and videos only).";
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > MAX_FILE_BYTES) return `Too large (${formatSize(file.size)}); the limit is ${formatSize(MAX_FILE_BYTES)} per file.`;
  return null;
}

// The anglers list, fetched once: for who's uploading, and for the catch card's angler photo.
const anglersPromise = (async () => {
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return [];
    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    return data.anglers || [];
  } catch {
    return [];
  }
})();

// Fired immediately so it's resolved (or in flight) by the time the user hits Upload.
// Multiple files in one upload are always attributed to the same person.
const uploadedByAnglerIdPromise = anglersPromise
  .then(anglers => resolveMyAnglerId(anglers))
  .catch(() => null);

const el = {
  noCatchState:     document.getElementById('noCatchState'),
  uploadState:      document.getElementById('uploadState'),
  successState:     document.getElementById('successState'),
  catchCard:        document.getElementById('catchCard'),
  files:            document.getElementById('files'),
  uploadBtn:        document.getElementById('uploadBtn'),
  status:           document.getElementById('status'),
  log:              document.getElementById('log'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  loadingMsg:       document.getElementById('loadingMsg'),
  backToCatch:      document.getElementById('backToCatch'),
  successBackBtn:   document.getElementById('successBackBtn'),
  countdown:        document.getElementById('countdown'),
  fileList:         document.getElementById('fileList'),
  retryBtn:         document.getElementById('retryBtn'),
  stayHereBtn:      document.getElementById('stayHereBtn'),
  successMsg:       document.getElementById('successMsg'),
  successRedirect:  document.getElementById('successRedirect'),
  successFiles:     document.getElementById('successFiles'),
};

function getCatchNumberFromUrl() {
  return new URLSearchParams(window.location.search).get('catchNumber');
}

// The catch page's back button goes where you came from (?from=list etc.); pass it through
// so a round trip via this page doesn't reset it to Home. The catch page allowlists values.
function catchDetailsUrl(catchNumber) {
  const from = new URLSearchParams(window.location.search).get('from');
  return `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
}

function setStatus(msg) {
  el.status.textContent = msg;
}

function log(msg) {
  el.log.textContent += msg + "\n";
}

function getContentType(file) {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop().toLowerCase();
  const types = {
    heic: 'image/heic', heif: 'image/heic',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// "Caught When" exactly as the catch detail page shows it (formatCaughtWhenFull, date-format.js)
function formatCaughtWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : formatCaughtWhenFull(d);
}

// --- Catch Context Card -------------------------------------------------------

async function loadCatchDetails(catchNumber) {
  try {
    const url = `${CATCHES_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`GET failed: ${res.status}`);
    const data = await res.json();
    const catchData = Array.isArray(data) ? data[0] : data;
    renderCatchCard(catchNumber, catchData, await anglersPromise);
    document.title = `Upload to ${catchNumber} · Gillbert`;
  } catch (err) {
    console.error(err);
    el.catchCard.innerHTML = `<div class="catch-card-id">${escapeHtml(catchNumber)}</div><p class="catch-card-error">Could not load catch details.</p>`;
  }
}

// A smaller copy of the summary at the top of Catch Details: the angler's photo, the fish,
// "Caught by … on …" and the date, so the catch looks the same on both pages.
function renderCatchCard(catchNumber, data, anglers = []) {
  if (!data) {
    el.catchCard.innerHTML = `<div class="catch-card-id">${escapeHtml(catchNumber)}</div>`;
    return;
  }

  const angler = anglers.find(a => a.id === data.anglerId);
  const avatar = GillbertAvatar.html({ id: data.anglerId, profilePhotoReadUrl: angler && angler.profilePhotoReadUrl },
    data.anglerName, 'catch-card-avatar');
  const species = data.fishSpeciesName || 'Fish';
  const fish = data.length != null && data.length !== '' ? `${data.length}" ${species}` : species;

  el.catchCard.innerHTML = `
    <div class="catch-card-id">${escapeHtml(catchNumber)}</div>
    <div class="catch-card-summary">
      ${avatar}
      <div class="catch-card-main">
        <div class="catch-card-fish">${escapeHtml(fish)}</div>
        <div class="catch-card-who">Caught by <b>${escapeHtml(data.anglerName || 'Unknown angler')}</b>${data.bodyOfWaterName ? ` on <b>${escapeHtml(data.bodyOfWaterName)}</b>` : ''}</div>
        ${data.caughtWhen ? `<div class="catch-card-when">${escapeHtml(formatCaughtWhen(data.caughtWhen))}</div>` : ''}
      </div>
    </div>`;
}

// --- Upload ------------------------------------------------------------------

async function getSasUrls(catchNumber, files) {
  const res = await fetch(SAS_WEBHOOK_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      catchNumber,
      files: files.map(f => ({ name: f.name, size: f.size, type: getContentType(f) })),
    }),
  });
  if (!res.ok) throw new Error(`SAS request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Files bigger than one block go up in 8 MB blocks (Azure Put Block), then get stitched
// together (Put Block List). A dropped connection or a locked phone only costs the block in
// flight: each block is retried, and "Retry" picks up from the last block that made it.
// Blocks that never get stitched are discarded by Azure after a week, so nothing is left over.
const BLOCK_SIZE = 8 * 1024 * 1024;
const BLOCK_TRIES = 5;
const SLOT_REUSE_MS = 45 * 60 * 1000; // upload links last 60 min; a retry after 45 asks for a new one

const blockId = i => btoa(`block-${String(i).padStart(6, '0')}`); // same length for every block

// Waits until the page is on screen again (a hidden tab's uploads stall or get cut off)
function whenVisible() {
  if (!document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    const onChange = () => {
      if (!document.hidden) { document.removeEventListener('visibilitychange', onChange); resolve(); }
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

async function putToStorage(url, body, headers) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', headers, body });
      if (res.ok) return;
      const text = await res.text();
      // 4xx (other than a timeout or throttling) won't get better by trying again
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        // 401/403: storage refused the upload link itself, so a retry needs a new one
        throw Object.assign(new Error(`Azure PUT failed: ${res.status} ${text}`),
          { final: true, linkRefused: res.status === 401 || res.status === 403 });
      }
      throw new Error(`Azure PUT failed: ${res.status}`);
    } catch (err) {
      if (err.final || attempt >= BLOCK_TRIES) throw err;
      await whenVisible();
      await new Promise(r => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 30000)));
    }
  }
}

// Uploads job.file to job.slot.uploadUrl, keeping progress on the job so a retry resumes
async function uploadOne(job, onProgress) {
  const { file } = job;
  const url = job.slot.uploadUrl;
  const contentType = getContentType(file);

  if (file.size <= BLOCK_SIZE) {
    await putToStorage(url, file, { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType });
    onProgress(1);
    return;
  }

  const count = Math.ceil(file.size / BLOCK_SIZE);
  job.blocksDone = job.blocksDone || new Set();
  for (let i = 0; i < count; i++) {
    if (job.blocksDone.has(i)) continue;
    const chunk = file.slice(i * BLOCK_SIZE, Math.min((i + 1) * BLOCK_SIZE, file.size));
    await putToStorage(`${url}&comp=block&blockid=${encodeURIComponent(blockId(i))}`, chunk, {});
    job.blocksDone.add(i);
    onProgress(job.blocksDone.size / count);
  }

  const list = Array.from({ length: count }, (_, i) => `<Latest>${blockId(i)}</Latest>`).join('');
  await putToStorage(`${url}&comp=blocklist`,
    `<?xml version="1.0" encoding="utf-8"?><BlockList>${list}</BlockList>`,
    { 'Content-Type': 'application/xml', 'x-ms-blob-content-type': contentType });
}

// Keeps the phone's screen on while files upload, where the browser allows it
let wakeLock = null;
let uploadsRunning = false;

async function keepScreenOn() {
  try {
    if (!('wakeLock' in navigator) || document.hidden) return;
    const lock = await navigator.wakeLock.request('screen');
    // The upload may have ended (e.g. the slot request failed fast) while this was pending
    if (!uploadsRunning) { lock.release().catch(() => {}); return; }
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = lock;
  } catch { /* not allowed (e.g. battery saver): uploads still resume */ }
}

document.addEventListener('visibilitychange', () => {
  // The browser drops the lock whenever the page is hidden; take it back on return
  if (uploadsRunning && !document.hidden) keepScreenOn();
});

// Leaving while files are still going up loses them, so ask first. Browsers show their own
// "Leave site?" wording; the message here is only used by older ones. Once every file is
// recorded it's safe to leave: conversions carry on on the server.
window.addEventListener('beforeunload', e => {
  if (!uploadsRunning) return;
  e.preventDefault();
  e.returnValue = 'Your upload is not finished yet.';
  return e.returnValue;
});

// Records one uploaded file. Only an explicit `success: true` counts: n8n answers an
// empty 200 when a workflow fails before replying, which must not read as success.
async function commitUpload(catchNumber, upload, uploadedByAnglerId) {
  const res = await fetch(COMMIT_WEBHOOK_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ catchNumber, uploads: [upload], uploadedByAnglerId }),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || !data.success || !Array.isArray(data.files) || !data.files[0]) {
    throw new Error(data.message || `Couldn't record the upload (${res.status})`);
  }
  return data.files[0]; // { id, status: 'complete' | 'submitted' }
}

// Before recording a file again on Retry: was it recorded after all? The answer to the first
// try can be lost (a dropped connection, an error after the row was written), and recording
// it twice would show two tiles for one file. Matched by its path without the extension,
// since conversion changes only the extension. null = not found, or couldn't check.
async function findRecorded(catchNumber, blobPath) {
  try {
    const url = `${CATCH_MEDIA_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    const items = Array.isArray(data) ? data : Array.isArray(data.media) ? data.media : [];
    const stem = p => String(p || '').replace(/\.[^./]+$/, '');
    const item = items.find(m => m && m.id && stem(m.blobPath) === stem(blobPath));
    return item ? { id: item.id, status: item.displayStatus || item.status } : null;
  } catch {
    return null;
  }
}

// Runs fn over items with at most `limit` in flight at once.
async function runPool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- Per-file list ------------------------------------------------------------

// One entry per picked file. stage: 'waiting' → 'uploading' → 'recording' → 'complete' |
// 'converting' | 'failed'; a converting file then ends 'complete' or 'convertFailed'.
// 'rejected' = refused before upload (too large, wrong type); retrying won't help it.
// `uploaded` remembers a file already in storage, so a retry only re-records it instead of
// uploading it again under a new name. `mediaId` is its record, for watching the conversion.
let fileJobs = [];

const STAGE_LABELS = {
  waiting:    '⏸️ Waiting',
  uploading:  '⬆️ Uploading',
  recording:  '📝 Recording…',
  complete:   '✅ Done',
  converting: '⏳ Converting',
  failed:     '❌ Failed',
  rejected:   "🚫 Can't upload",
  convertFailed: "⚠️ Couldn't convert",
};

function renderFileList() {
  el.fileList.innerHTML = fileJobs.map(job => `
    <li class="file-row file-row--${job.stage}">
      <span class="file-row-name">${escapeHtml(job.file.name)}</span>
      <span class="file-row-status">${STAGE_LABELS[job.stage]}${job.stage === 'uploading' ? ` ${Math.floor((job.progress || 0) * 100)}%` : ''}</span>
      ${(job.stage === 'failed' || job.stage === 'rejected') && job.error ? `<span class="file-row-error">${escapeHtml(job.error)}</span>` : ''}
    </li>`).join('');
  el.fileList.classList.toggle('hidden', !fileJobs.length);
}

function setStage(job, stage, error) {
  job.stage = stage;
  job.error = error || null;
  renderFileList();
}

// --- Success & Redirect -------------------------------------------------------

let countdownTimer = null;

function updateSuccessMessage() {
  const converting = fileJobs.filter(j => j.stage === 'converting').length;
  const notConverted = fileJobs.filter(j => j.stage === 'convertFailed').length;
  el.successMsg.textContent = converting
    ? `Your media is in Gillbert's digital live well. ${converting} file${converting === 1 ? ' is' : 's are'} still converting and will show up on your catch shortly.`
    : notConverted
      ? `${notConverted} file${notConverted === 1 ? '' : 's'} couldn't be converted. Open the catch to retry or delete ${notConverted === 1 ? 'it' : 'them'}; the rest are on your catch.`
      : "Your media has been dropped in Gillbert's digital live well and linked to the catch.";
}

function startSuccessCountdown(catchNumber) {
  const detailsUrl = catchDetailsUrl(catchNumber);
  el.successBackBtn.href = detailsUrl;
  updateSuccessMessage();

  let remaining = REDIRECT_DELAY;
  el.countdown.textContent = remaining;
  el.successRedirect.classList.remove('hidden');
  el.stayHereBtn.classList.remove('hidden');

  countdownTimer = setInterval(() => {
    remaining--;
    el.countdown.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      window.location.href = detailsUrl;
    }
  }, 1000);
}

// While the page stays open, re-check converting files and flip their rows to ✅ Done (or ⚠️)
// as they finish, like the catch page does. Watching starts as soon as a file is recorded as
// converting (not after the whole batch): the loop's first check is after 2 s (a photo often
// converts in a few seconds, well before the 10 s hand-off), then every 10 s. Gives up after 10 minutes; the
// catch page and Media Activity have the final word after that. One loop at a time: files
// that start converting later (another in the batch, or a retry) join the loop already running,
// at its next 10 s check.
const CONVERT_FIRST_CHECK_MS = 2 * 1000;
const CONVERT_POLL_MS = 10 * 1000;
const CONVERT_POLL_LIMIT_MS = 10 * 60 * 1000;
let watchingConversions = false;
let watchStartedAt = 0;

function watchConversions(catchNumber) {
  if (!fileJobs.some(j => j.stage === 'converting')) return;
  // Newly converting files (after a Retry) get the full 10 minutes too
  watchStartedAt = Date.now();
  if (watchingConversions) return;
  watchingConversions = true;
  const check = async () => {
    const pending = fileJobs.filter(j => j.stage === 'converting');
    if (!pending.length || Date.now() - watchStartedAt > CONVERT_POLL_LIMIT_MS) { watchingConversions = false; return; }
    try {
      const url = `${CATCH_MEDIA_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
      const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
      if (!res.ok) throw new Error(`Media GET failed: ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data.media) ? data.media : [];
      const byId = new Map(items.map(m => [String(m.id), m]));
      for (const job of pending) {
        const item = byId.get(String(job.mediaId));
        const status = item && (item.displayStatus || item.status);
        if (status === 'complete') {
          setStage(job, 'complete');
          log(`✅ ${job.file.name} is ready.`);
        } else if (status === 'failed' || status === 'stuck') {
          setStage(job, 'convertFailed');
          log(`⚠️ ${job.file.name} couldn't be converted. Retry it from the catch page.`);
        }
      }
      updateSuccessMessage();
    } catch (err) {
      console.error('Conversion check failed:', err);
    }
    setTimeout(check, CONVERT_POLL_MS);
  };
  setTimeout(check, CONVERT_FIRST_CHECK_MS);
}

el.stayHereBtn.addEventListener('click', () => {
  clearInterval(countdownTimer);
  el.successRedirect.classList.add('hidden');
  el.stayHereBtn.classList.add('hidden');
});

// --- Upload -------------------------------------------------------------------

// Uploads and records each job that isn't done yet, 3 at a time. Files that need converting
// (HEIC, MOV, some MP4s) come back as 'converting' and are watched until they finish.
async function processJobs(catchNumber, jobs) {
  const uploadedByAnglerId = await uploadedByAnglerIdPromise;

  // Upload slots only for files not already in storage from an earlier attempt. A file that
  // got partway keeps its slot (and its finished blocks) unless the link is about to expire.
  const needSlots = jobs.filter(j => !j.uploaded && !(j.slot && Date.now() - j.slotAt < SLOT_REUSE_MS));
  // The slot workflow takes at most 10 files per request
  for (let start = 0; start < needSlots.length; start += SLOTS_PER_REQUEST) {
    const batch = needSlots.slice(start, start + SLOTS_PER_REQUEST);
    const { uploads } = await getSasUrls(catchNumber, batch.map(j => j.file));
    batch.forEach((job, i) => { job.slot = uploads[i]; job.slotAt = Date.now(); job.blocksDone = null; });
  }

  await runPool(jobs, PARALLEL_UPLOADS, async job => {
    try {
      if (!job.uploaded) {
        setStage(job, 'uploading');
        await uploadOne(job, fraction => { job.progress = fraction; renderFileList(); });
        job.uploaded = true;
        log(`🐟 ${job.file.name} is in the boat!`);
      }
      setStage(job, 'recording');
      const { uploadUrl, ...upload } = job.slot;
      let recorded = job.commitTried ? await findRecorded(catchNumber, upload.blobPath) : null;
      if (!recorded) {
        job.commitTried = true;
        recorded = await commitUpload(catchNumber, upload, uploadedByAnglerId);
      }
      job.mediaId = recorded.id;
      if (recorded.status === 'failed' || recorded.status === 'stuck') {
        setStage(job, 'convertFailed');
        log(`⚠️ ${job.file.name} couldn't be converted. Retry it from the catch page.`);
        return;
      }
      setStage(job, recorded.status === 'complete' ? 'complete' : 'converting');
      if (recorded.status !== 'complete') {
        log(`⏳ ${job.file.name} is converting so everyone can see it.`);
        watchConversions(catchNumber); // while the rest of the batch is still uploading
      }
    } catch (err) {
      console.error(err);
      // Retry asks for a new link rather than sending the refused one again
      if (err.linkRefused) { job.slot = null; job.blocksDone = null; }
      setStage(job, 'failed', String(err.message || err));
      log(`❌ ${job.file.name}: ${err.message || err}`);
    }
  });
}

async function runUpload(jobs) {
  const catchNumber = getCatchNumberFromUrl();
  el.uploadBtn.disabled = true;
  el.retryBtn.classList.add('hidden');
  el.loadingIndicator.classList.add('visible');
  setStatus("Reeling files into the cloud...");

  uploadsRunning = true;
  keepScreenOn();
  try {
    await processJobs(catchNumber, jobs);
  } catch (err) {
    // The upload-slot request itself failed, before any file in this batch was sent or
    // recorded. Mark them all failed so Retry picks them up; a file already in storage
    // keeps `uploaded`, so its retry only records it.
    console.error(err);
    jobs.filter(j => j.stage === 'waiting').forEach(j =>
      setStage(j, 'failed', j.uploaded ? "Couldn't record it yet" : "Couldn't get an upload slot"));
    log(String(err));
  }

  uploadsRunning = false;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  el.loadingIndicator.classList.remove('visible');
  // Files that were recorded are watched even if others in the batch didn't make it
  watchConversions(catchNumber);
  if (showProblems()) return;

  setStatus("");
  el.uploadState.classList.add('hidden');
  el.backToCatch.classList.add('hidden');
  el.successState.classList.remove('hidden');
  el.successFiles.appendChild(el.fileList);
  startSuccessCountdown(catchNumber);
}

// Stays on the page if any file didn't make it, offering Retry for the ones a retry can fix.
// Returns true if it did.
function showProblems() {
  const failed = fileJobs.filter(j => j.stage === 'failed');
  const notSaved = failed.length + fileJobs.filter(j => j.stage === 'rejected').length;
  if (!notSaved) return false;
  const saved = fileJobs.length - notSaved;
  setStatus(`${notSaved} of ${fileJobs.length} file${fileJobs.length === 1 ? '' : 's'} didn't make it ❌${saved ? ' — the rest are saved.' : '.'}`);
  if (failed.length) {
    el.retryBtn.textContent = `🔁 Retry ${failed.length} Failed File${failed.length === 1 ? '' : 's'}`;
    el.retryBtn.classList.remove('hidden');
  }
  return true;
}

// --- Buttons ------------------------------------------------------------------

el.uploadBtn.addEventListener('click', () => {
  el.log.textContent = "";
  const files = Array.from(el.files.files || []);
  if (!files.length) return setStatus("Pick at least one photo or video.");

  log(`Catch: ${getCatchNumberFromUrl()}`);
  log(`Files: ${files.length}`);
  fileJobs = files.map(file => ({ file, stage: 'waiting', uploaded: false, slot: null, error: null, mediaId: null }));
  el.files.disabled = true;
  fileJobs.forEach(job => {
    const reason = rejectReason(job.file);
    if (reason) {
      job.stage = 'rejected';
      job.error = reason;
      log(`🚫 ${job.file.name}: ${reason}`);
    }
  });
  renderFileList();
  const toUpload = fileJobs.filter(j => j.stage === 'waiting');
  if (toUpload.length) runUpload(toUpload);
  else {
    showProblems();
    el.files.disabled = false; // nothing was sent, so let them pick different files
  }
});

el.retryBtn.addEventListener('click', () => {
  const failed = fileJobs.filter(j => j.stage === 'failed');
  failed.forEach(j => setStage(j, 'waiting'));
  log(`\nRetrying ${failed.length} file${failed.length === 1 ? '' : 's'}...`);
  runUpload(failed);
});

// --- Init --------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  const catchNumber = getCatchNumberFromUrl();

  if (!catchNumber) {
    el.uploadState.classList.add('hidden');
    el.backToCatch.classList.add('hidden');
    el.noCatchState.classList.remove('hidden');
    return;
  }

  el.backToCatch.href = catchDetailsUrl(catchNumber);

  loadCatchDetails(catchNumber);

  setStatus("Ready to upload.");
});
