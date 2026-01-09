const hostname = window.location.hostname;
// Use test webhooks when on preview/dev URLs, production webhooks on main site
const ENV = (hostname === "gillbert.kwtechhub.net") ? "prod" : "dev";
const N8N_BASE_URL = "https://api.kwtechhub.net";
const WEBHOOK_PATH = ENV === "prod" ? "/webhook/" : "/webhook-test/";
const API_KEY = 'sj30z42c9e0nIzchc5u';

const SAS_WEBHOOK_URL = N8N_BASE_URL + WEBHOOK_PATH + "uploads/sas";
const COMMIT_WEBHOOK_URL = N8N_BASE_URL + WEBHOOK_PATH + "uploads/commit";
const CATCHES_GET_URL = N8N_BASE_URL + WEBHOOK_PATH + "catches";


const el = {
  catchId: document.getElementById('catchId'),
  files: document.getElementById('files'),
  uploadBtn: document.getElementById('uploadBtn'),
  status: document.getElementById('status'),
  log: document.getElementById('log'),
  catchSummary: document.getElementById('catchSummary'),
  loadingIndicator: document.getElementById('loadingIndicator'),
};

let catchesData = {}; // Store catch data for lookups

function setStatus(msg) {
  el.status.textContent = msg;
}

function log(msg) {
  el.log.textContent += msg + "\n";
}

async function getSasUrls(catchId, files) {
  const res = await fetch(SAS_WEBHOOK_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      catchId,
      files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
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
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!res.ok) throw new Error(`Azure PUT failed: ${res.status} ${await res.text()}`);
}

async function postUploadMetadata(catchId, uploads) {
  const res = await fetch(COMMIT_WEBHOOK_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ catchId, uploads }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Commit webhook failed: ${res.status} ${text}`);

  try {
    return JSON.parse(text);
  }
  catch {
    return { ok: true, raw: text };
  }
}

el.uploadBtn.addEventListener('click', async () => {
  el.log.textContent = "";
  const catchId = el.catchId.value;
  const files = Array.from(el.files.files || []);

  if (!catchId) return setStatus("Pick a catch.");
  if (!files.length) return setStatus("Pick at least one photo/video.");

  try {
    el.uploadBtn.disabled = true;
    el.loadingIndicator.classList.add('visible');
    setStatus("Requesting upload URLs...");
    log(`Catch: ${catchId}`);
    log(`Files: ${files.length}`);

    const { uploads } = await getSasUrls(catchId, files);

    setStatus("Uploading to Azure...");
    for (let i = 0; i < uploads.length; i++) {
      log(`Uploading ${i + 1}/${uploads.length}: ${uploads[i].originalName || files[i].name}...`);
      await uploadOne(uploads[i].uploadUrl, files[i]);
      log(`✅ Finished uploading ${i + 1}/${uploads.length}: ${uploads[i].originalName || files[i].name}`);
    }

    log(`\nSaving uploaded media details to AirTable...`);
    setStatus("Saving metadata to AirTable...");
    await postUploadMetadata(catchId, uploads);
    log(`✅ Saved to AirTable`);

    setStatus("Done ✅");
    el.files.value = ""; //Clear the files collection now that the upload has been successful.

  } catch (err) {
    console.error(err);
    setStatus("Upload failed ❌");
    log(String(err));
  } finally {
    el.uploadBtn.disabled = false;
    el.loadingIndicator.classList.remove('visible');
  }
});

async function loadCatchesIntoDropdown() {
  setStatus("Loading catches...");
  el.catchId.innerHTML = `<option value="">Loading…</option>`;

  const res = await fetch(CATCHES_GET_URL, {
    headers: { "X-API-Key": API_KEY },
  });

  if (!res.ok) throw new Error(`GET failed: ${res.status}`);

  const data = await res.json();

  // Accept either [{...}] OR { catches: [...] }
  const catches = Array.isArray(data) ? data : (data.catches || []);

  if (!catches.length) {
    el.catchId.innerHTML = `<option value="">No catches found</option>`;
    setStatus("No catches found.");
    return;
  }

  // Store catch data for lookup
  catchesData = {};
  catches.forEach(c => {
    catchesData[c.catchId] = c;
  });

  el.catchId.innerHTML = catches
    .map(c => `<option value="${escapeHtml(c.catchId)}">${escapeHtml(c.catchId)}</option>`)
    .join("");

  // Display summary for the first catch
  const firstCatchId = catches[0].catchId;
  displayCatchSummary(firstCatchId);

  setStatus("Ready.");
}

function displayCatchSummary(catchId) {
  if (!catchId) {
    el.catchSummary.classList.remove('visible');
    el.catchSummary.textContent = '';
    return;
  }

  const catchData = catchesData[catchId];
  if (catchData && catchData.fullSummary) {
    el.catchSummary.textContent = catchData.fullSummary;
    el.catchSummary.classList.add('visible');
  } else {
    el.catchSummary.classList.remove('visible');
  }
}

// tiny helper so weird characters don't break the HTML
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

// run on page load
window.addEventListener("DOMContentLoaded", () => {
  loadCatchesIntoDropdown().catch(err => {
    console.error(err);
    setStatus("Failed to load catches ❌");
    el.catchId.innerHTML = `<option value="">Failed to load</option>`;
    log(String(err));
  });

  // Show summary when user selects a catch
  el.catchId.addEventListener('change', (e) => {
    displayCatchSummary(e.target.value);
  });
});
