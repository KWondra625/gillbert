const SAS_WEBHOOK_URL    = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/upload-media/get-sas";
const COMMIT_WEBHOOK_URL = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/upload-media/commit";

const REDIRECT_DELAY = 20; // seconds

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
      files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
    }),
  });
  if (!res.ok) throw new Error(`SAS request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function uploadOne(uploadUrl, file) {
  console.log('Azure PUT URL:', uploadUrl);
  console.log('File type:', file.type, 'File size:', file.size);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) throw new Error(`Azure PUT failed: ${res.status} ${await res.text()}`);
}

async function postUploadMetadata(catchNumber, uploads) {
  const res = await fetch(COMMIT_WEBHOOK_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ catchNumber, uploads }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Commit webhook failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}

// --- Success & Redirect -------------------------------------------------------

function startSuccessCountdown(catchNumber) {
  const detailsUrl = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
  el.successBackBtn.href = detailsUrl;

  let remaining = REDIRECT_DELAY;
  el.countdown.textContent = remaining;

  const timer = setInterval(() => {
    remaining--;
    el.countdown.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timer);
      window.location.href = detailsUrl;
    }
  }, 1000);
}

// --- Upload Button ------------------------------------------------------------

el.uploadBtn.addEventListener('click', async () => {
  el.log.textContent = "";
  const catchNumber = getCatchNumberFromUrl();
  const files = Array.from(el.files.files || []);

  if (!files.length) return setStatus("Pick at least one photo or video.");

  try {
    el.uploadBtn.disabled = true;
    el.loadingIndicator.classList.add('visible');
    setStatus("Requesting upload slots...");
    log(`Catch: ${catchNumber}`);
    log(`Files: ${files.length}`);

    const { uploads } = await getSasUrls(catchNumber, files);

    setStatus("Reeling files into the cloud...");
    for (let i = 0; i < uploads.length; i++) {
      const name = uploads[i].originalName || files[i].name;
      log(`Uploading ${i + 1}/${uploads.length}: ${name}...`);
      await uploadOne(uploads[i].uploadUrl, files[i]);
      log(`✅ ${name} is in the boat!`);
    }

    log(`\nDropping your catch in Gillbert's digital live well...`);
    setStatus("Stocking the live well...");
    await postUploadMetadata(catchNumber, uploads);
    log(`✅ Locked in — your catch is fully documented!`);

    el.loadingIndicator.classList.remove('visible');
    setStatus("");

    el.uploadState.classList.add('hidden');
    el.successState.classList.remove('hidden');
    startSuccessCountdown(catchNumber);

  } catch (err) {
    console.error(err);
    setStatus("Upload failed ❌");
    log(String(err));
    el.uploadBtn.disabled = false;
    el.loadingIndicator.classList.remove('visible');
  }
});

// --- Init --------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  const catchNumber = getCatchNumberFromUrl();

  if (!catchNumber) {
    el.uploadState.classList.add('hidden');
    el.noCatchState.classList.remove('hidden');
    return;
  }

  const detailsUrl = `./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}`;
  el.backToCatch.href = detailsUrl;

  loadCatchDetails(catchNumber);
  setStatus("Ready to upload.");
});
