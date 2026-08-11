// Shared WI DNR search widget for the bodies-of-water create/edit forms.
// Both pages wire an identical search box (#dnrSearchInput/#dnrSearchBtn/
// #dnrSearchStatus/#dnrSearchResults) to the same endpoint and hand a
// picked result to their own page-specific selectDnrResult(r). Kept in one
// place because the n8n "Always Output Data" placeholder-filter workaround
// below needs to change in lockstep on both pages if that API contract
// ever shifts — this bit drifting out of sync between the two pages is
// exactly the failure mode worth avoiding.

function escapeHtmlForDnrSearch(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

async function runDnrSearch() {
  const input = document.getElementById('dnrSearchInput');
  const statusEl = document.getElementById('dnrSearchStatus');
  const resultsEl = document.getElementById('dnrSearchResults');

  const q = input.value.trim();
  resultsEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  if (!q) return;

  statusEl.textContent = 'Searching WI DNR…';
  statusEl.classList.remove('hidden');

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
      statusEl.textContent = 'No matches found on WI DNR.';
      return;
    }

    statusEl.classList.add('hidden');
    renderDnrResults(results);
  } catch (err) {
    console.error('DNR search failed:', err);
    statusEl.textContent = 'Unable to search WI DNR right now. Please try again.';
  }
}

function renderDnrResults(results) {
  const resultsEl = document.getElementById('dnrSearchResults');
  resultsEl.innerHTML = results.map((r, i) => {
    const mapLink = (r.latitude != null && r.longitude != null)
      ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(r.latitude)},${encodeURIComponent(r.longitude)}" target="_blank" rel="noopener" class="dnr-result-map">📍 View on Map</a>`
      : '';
    return `
    <div class="dnr-result" data-index="${i}">
      <div class="dnr-result-main">
        <span class="dnr-result-name">${escapeHtmlForDnrSearch(r.waterbodyName || '(unnamed)')}</span>
        <span class="dnr-result-wbic">WBIC ${escapeHtmlForDnrSearch(String(r.waterbodyWbic))}</span>
      </div>
      <div class="dnr-result-actions">
        ${mapLink}
        <button type="button" class="dnr-result-select" data-index="${i}">Use this</button>
      </div>
    </div>`;
  }).join('');

  resultsEl.classList.remove('hidden');

  resultsEl.querySelectorAll('.dnr-result-select').forEach(btn => {
    btn.addEventListener('click', () => selectDnrResult(results[Number(btn.dataset.index)]));
  });
}

document.getElementById('dnrSearchBtn').addEventListener('click', runDnrSearch);
document.getElementById('dnrSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runDnrSearch(); }
});
