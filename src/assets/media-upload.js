const SAS_WEBHOOK_URL    = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/catch-media/get-sas";
const COMMIT_WEBHOOK_URL = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/catch-media/commit";
const LOOKUP_URL         = API_BASE + 'get-lookup-data';

const REDIRECT_DELAY = 15; // seconds, starting once every file is uploaded and recorded
const PARALLEL_UPLOADS = 3; // files sent to storage at once

// Fired immediately so it's resolved (or in flight) by the time the user hits Upload.
// Multiple files in one upload are always attributed to the same person.
const uploadedByAnglerIdPromise = (async () => {
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return null;
    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    return await resolveMyAnglerId(data.anglers || []);
  } catch {
    return null;
  }
})();

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

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// --- Catch Context Card -------------------------------------------------------

async function loadCatchDetails(catchNumber) {
  try {
    const url = `${CATCHES_GET_URL}?catchNumber=${encodeURIComponent(catchNumber)}`;
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`GET failed: ${res.status}`);
    const data = await res.json();
    const catchData = Array.isArray(data) ? data[0] : data;
    renderCatchCard(catchNumber, catchData);
    document.title = `Upload to ${catchNumber} · Gillbert`;
  } catch (err) {
    console.error(err);
    el.catchCard.innerHTML = `<div class="catch-card-id">${escapeHtml(catchNumber)}</div><p class="catch-card-error">Could not load catch details.</p>`;
  }
}

function renderCatchCard(catchNumber, data) {
  if (!data) {
    el.catchCard.innerHTML = `<div class="catch-card-id">${escapeHtml(catchNumber)}</div>`;
    return;
  }

  const rows = [
    data.anglerName      && ['Angler',       data.anglerName],
    data.fishSpeciesName && ['Species',       data.fishSpeciesName],
    data.bodyOfWaterName && ['Body of Water', data.bodyOfWaterName],
    data.caughtWhen      && ['Caught When',   formatDate(data.caughtWhen)],
  ].filter(Boolean);

  el.catchCard.innerHTML = `
    <div class="catch-card-id">${escapeHtml(catchNumber)}</div>
    ${rows.map(([label, value]) => `
      <div class="catch-card-row">
        <span class="catch-card-label">${label}</span>
        <span class="catch-card-value">${escapeHtml(String(value))}</span>
      </div>`).join('')}`;
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

async function uploadOne(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": getContentType(file),
    },
    body: file,
  });
  if (!res.ok) throw new Error(`Azure PUT failed: ${res.status} ${await res.text()}`);
}

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
// 'converting' | 'failed'. `uploaded` remembers a file already in storage, so a retry only
// re-records it instead of uploading it again under a new name.
let fileJobs = [];

const STAGE_LABELS = {
  waiting:    '⏸️ Waiting',
  uploading:  '⬆️ Uploading…',
  recording:  '📝 Recording…',
  complete:   '✅ Done',
  converting: '⏳ Converting',
  failed:     '❌ Failed',
};

function renderFileList() {
  el.fileList.innerHTML = fileJobs.map(job => `
    <li class="file-row file-row--${job.stage}">
      <span class="file-row-name">${escapeHtml(job.file.name)}</span>
      <span class="file-row-status">${STAGE_LABELS[job.stage]}</span>
      ${job.stage === 'failed' && job.error ? `<span class="file-row-error">${escapeHtml(job.error)}</span>` : ''}
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

function startSuccessCountdown(catchNumber, convertingCount) {
  const detailsUrl = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
  el.successBackBtn.href = detailsUrl;
  el.successMsg.textContent = convertingCount
    ? `Your media is in Gillbert's digital live well. ${convertingCount} file${convertingCount === 1 ? ' is' : 's are'} still converting and will show up on your catch shortly.`
    : "Your media has been dropped in Gillbert's digital live well and linked to the catch.";

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

el.stayHereBtn.addEventListener('click', () => {
  clearInterval(countdownTimer);
  el.successRedirect.classList.add('hidden');
  el.stayHereBtn.classList.add('hidden');
});

// --- Upload -------------------------------------------------------------------

// Uploads and records each job that isn't done yet, 3 at a time. Files that need converting
// (HEIC, MOV, some MP4s) come back as 'converting'; the catch page shows them finishing.
async function processJobs(catchNumber, jobs) {
  const uploadedByAnglerId = await uploadedByAnglerIdPromise;

  // Upload slots only for files not already in storage from an earlier attempt
  const needSlots = jobs.filter(j => !j.uploaded);
  if (needSlots.length) {
    const { uploads } = await getSasUrls(catchNumber, needSlots.map(j => j.file));
    needSlots.forEach((job, i) => { job.slot = uploads[i]; });
  }

  await runPool(jobs, PARALLEL_UPLOADS, async job => {
    try {
      if (!job.uploaded) {
        setStage(job, 'uploading');
        await uploadOne(job.slot.uploadUrl, job.file);
        job.uploaded = true;
        log(`🐟 ${job.file.name} is in the boat!`);
      }
      setStage(job, 'recording');
      const { uploadUrl, ...upload } = job.slot;
      const recorded = await commitUpload(catchNumber, upload, uploadedByAnglerId);
      setStage(job, recorded.status === 'complete' ? 'complete' : 'converting');
      if (recorded.status !== 'complete') log(`⏳ ${job.file.name} is converting so everyone can see it.`);
    } catch (err) {
      console.error(err);
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

  try {
    await processJobs(catchNumber, jobs);
  } catch (err) {
    // The upload-slot request itself failed: nothing was uploaded
    console.error(err);
    jobs.filter(j => !j.uploaded).forEach(j => setStage(j, 'failed', "Couldn't get an upload slot"));
    log(String(err));
  }

  el.loadingIndicator.classList.remove('visible');
  const failed = fileJobs.filter(j => j.stage === 'failed');

  if (failed.length) {
    setStatus(`${failed.length} of ${fileJobs.length} file${fileJobs.length === 1 ? '' : 's'} didn't make it ❌ — the rest are saved.`);
    el.retryBtn.textContent = `🔁 Retry ${failed.length} Failed File${failed.length === 1 ? '' : 's'}`;
    el.retryBtn.classList.remove('hidden');
    return;
  }

  setStatus("");
  el.uploadState.classList.add('hidden');
  el.backToCatch.classList.add('hidden');
  el.successState.classList.remove('hidden');
  el.successFiles.appendChild(el.fileList);
  startSuccessCountdown(catchNumber, fileJobs.filter(j => j.stage === 'converting').length);
}

// --- Buttons ------------------------------------------------------------------

el.uploadBtn.addEventListener('click', () => {
  el.log.textContent = "";
  const files = Array.from(el.files.files || []);
  if (!files.length) return setStatus("Pick at least one photo or video.");

  log(`Catch: ${getCatchNumberFromUrl()}`);
  log(`Files: ${files.length}`);
  fileJobs = files.map(file => ({ file, stage: 'waiting', uploaded: false, slot: null, error: null }));
  el.files.disabled = true;
  renderFileList();
  runUpload(fileJobs);
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

  const detailsUrl = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
  el.backToCatch.href = detailsUrl;

  loadCatchDetails(catchNumber);

  setStatus("Ready to upload.");
});
