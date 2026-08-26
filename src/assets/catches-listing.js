const ITEMS_PER_PAGE = 24;
const LOOKUP_URL = API_BASE + 'get-lookup-data';

const el = {
  catchesContainer: document.getElementById('catchesContainer'),
  status: document.getElementById('status'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  pageInfo: document.getElementById('pageInfo'),
  paginationContainer: document.getElementById('paginationContainer'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  filterAnglerChip: document.getElementById('filterAnglerChip'),
  filterAnglerValue: document.getElementById('filterAnglerValue'),
  filterAnglerDropdown: document.getElementById('filterAnglerDropdown'),
  filterSpeciesChip: document.getElementById('filterSpeciesChip'),
  filterSpeciesValue: document.getElementById('filterSpeciesValue'),
  filterSpeciesDropdown: document.getElementById('filterSpeciesDropdown'),
  filterWaterChip: document.getElementById('filterWaterChip'),
  filterWaterValue: document.getElementById('filterWaterValue'),
  filterWaterDropdown: document.getElementById('filterWaterDropdown'),
  filterPendingWrapper: document.getElementById('filterPendingWrapper'),
  filterPendingChip: document.getElementById('filterPendingChip'),
  filterPendingValue: document.getElementById('filterPendingValue'),
  filterSummary: document.getElementById('filterSummary'),
  filterSummaryText: document.getElementById('filterSummaryText'),
  filterClearAll: document.getElementById('filterClearAll'),
};

let allCatches = [];
let filteredCatches = [];
let currentPage = 1;
let lookups = { anglers: [], species: [], bodiesOfWater: [] };
let activeFilters = { angler: '', species: '', water: '', pendingOnly: false };

// Guards against loadLookups() rendering an empty-state flash if it resolves
// before loadCatches() has populated allCatches for the first time.
let catchesLoaded = false;

function setStatus(msg) {
  el.status.textContent = msg;
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

async function loadCatches() {
  try {
    showLoading();
    setStatus("Loading catches...");

    const term = el.searchInput.value.trim();
    const url = term
      ? `${CATCHES_GET_URL}?search=${encodeURIComponent(term)}`
      : CATCHES_GET_URL;

    const res = await fetch(url, {
      headers: { "X-API-Key": API_KEY },
    });

    if (!res.ok) throw new Error(`GET failed: ${res.status}`);

    const data = await res.json();

    // Accept either [{...}] OR { catches: [...] }; filter out null-placeholder rows the API returns on no-results
    allCatches = (Array.isArray(data) ? data : (data.catches || []))
      .filter(c => c && c.catchNumber);
    catchesLoaded = true;

    if (!allCatches.length) {
      const hasTerm = !!el.searchInput.value.trim();
      el.catchesContainer.innerHTML = hasTerm
        ? `<div class="no-results-banner">
            <div class="no-results-icon">🔍</div>
            <p class="no-results-text">No catches match your search.</p>
            <p class="no-results-hint">Try a different search term or clear it to see all catches.</p>
          </div>`
        : `<div class="empty-state"><p>No catches found.</p></div>`;
      el.paginationContainer.style.display = 'none';
      setStatus("");
      hideLoading();
      return;
    }

    setStatus("");
    currentPage = 1;
    sessionStorage.setItem('gillbert_search', el.searchInput.value.trim());
    applyFilters();
    hideLoading();
  } catch (err) {
    console.error(err);
    catchesLoaded = true;
    setStatus("Failed to load catches ❌");
    el.catchesContainer.innerHTML = `<div class="empty-state"><p>Error loading catches.</p></div>`;
    el.paginationContainer.style.display = 'none';
    hideLoading();
  }
}

function renderPage() {
  const totalPages = Math.ceil(filteredCatches.length / ITEMS_PER_PAGE);

  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageCatches = filteredCatches.slice(startIndex, endIndex);

  // No results — show banner and bail out
  if (!filteredCatches.length) {
    el.catchesContainer.innerHTML = `
      <div class="no-results-banner">
        <div class="no-results-icon">🔍</div>
        <p class="no-results-text">No catches match your search.</p>
        <p class="no-results-hint">Try adjusting your filters or clearing them to see all catches.</p>
      </div>`;
    el.paginationContainer.style.display = 'none';
    return;
  }

  // Render cards
  el.catchesContainer.innerHTML = pageCatches
    .map(c => renderCatchCard(c))
    .join("");

  // Update pagination
  el.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  el.prevBtn.disabled = currentPage === 1;
  el.nextBtn.disabled = currentPage === totalPages;

  // Show pagination only if there's more than one page
  el.paginationContainer.style.display = totalPages > 1 ? 'flex' : 'none';

  // Scroll to top for better UX
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// formatDateLabel/hasExplicitTime come from date-format.js (shared with
// catch-details.js — see that file for why this is extracted rather than
// duplicated).

function getRelativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffHours < 48) {
    const time = new Date(dateStr).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `Yesterday at ${time}`;
  }
  const days = Math.floor(diffHours / 24);
  return `${days} days ago`;
}

function renderCatchCard(catchData) {
  const {
    catchNumber = "Unknown",
    anglerName = "Unknown",
    fishSpeciesName = "Unknown",
    length = null,
    caughtWhen = null,
    createdAt = null,
    bodyOfWaterName = null,
    catchMediaCount = 0,
    verifiedAt = null,
  } = catchData;

  const now = Date.now();
  const isRecentCatch = caughtWhen && (now - new Date(caughtWhen).getTime()) < 72 * 60 * 60 * 1000;
  const isRecentlyAdded = createdAt && (now - new Date(createdAt).getTime()) < 24 * 60 * 60 * 1000;

  // No explicit time (see date-format.js) means skip both the relative-time
  // and absolute-with-time treatments and just show the date.
  const caughtWhenHasTime = caughtWhen && hasExplicitTime(new Date(caughtWhen));

  const caughtWhenDisplay = caughtWhen
    ? !caughtWhenHasTime
      ? formatDateLabel(new Date(caughtWhen))
      : isRecentCatch
        ? getRelativeTime(caughtWhen)
        : new Date(caughtWhen).toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
    : 'Unknown';

  return `
    <div class="catch-card">
      <div class="catch-card-header">
        <div class="catch-header-row">
          <h2 class="catch-id">${escapeHtml(catchNumber)}</h2>
          <div class="catch-badges">
            ${isRecentlyAdded ? '<span class="badge-new" title="Added within the last 24 hours">🆕</span>' : ''}
            ${catchMediaCount > 0 ? `<span class="badge-media" title="${catchMediaCount} attachment${catchMediaCount === 1 ? '' : 's'}">📷 ${catchMediaCount}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="catch-card-body">
        <div class="catch-field">
          <span class="field-label">👤 Angler:</span>
          <span class="field-value">${escapeHtml(anglerName)}</span>
        </div>
        <div class="catch-field">
          <span class="field-label">🐟 Species:</span>
          <span class="field-value">${escapeHtml(fishSpeciesName)}</span>
        </div>
        ${bodyOfWaterName ? `
        <div class="catch-field">
          <span class="field-label">💧 Water:</span>
          <span class="field-value">${escapeHtml(bodyOfWaterName)}</span>
        </div>` : ''}
        ${length != null && length !== '' ? `
        <div class="catch-field">
          <span class="field-label">📏 Length:</span>
          <span class="field-value">${escapeHtml(String(length))}"</span>
        </div>` : ''}
        <div class="catch-field">
          <span class="field-label">📅 When:</span>
          <span class="field-value${isRecentCatch ? ' field-value--fresh' : ''}">${escapeHtml(caughtWhenDisplay)}</span>
        </div>
        ${!verifiedAt ? '<div class="catch-pending-row"><span class="badge-pending" title="Not yet reviewed">⏳ Pending Review</span></div>' : ''}
      </div>
      <div class="catch-card-footer">
        <a href="./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}&from=list" class="card-button">
          🔍 View Details
        </a>
      </div>
    </div>
  `;
}

el.prevBtn.addEventListener("click", () => {
  currentPage--;
  renderPage();
});

el.nextBtn.addEventListener("click", () => {
  currentPage++;
  renderPage();
});

el.searchBtn.addEventListener("click", () => {
  currentPage = 1;
  loadCatches();
});

el.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    currentPage = 1;
    loadCatches();
  }
});

el.searchInput.addEventListener("input", () => {
  if (el.searchInput.value.trim() === "") {
    currentPage = 1;
    loadCatches();
  }
});

// ── Lookups & Filters ──────────────────────────────────────────────────────────────────────────────
async function loadLookups() {
  try {
    const res = await fetch(LOOKUP_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return;
    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    lookups.anglers = data.anglers || [];
    lookups.species = data.fishSpecies || [];
    lookups.bodiesOfWater = data.bodiesOfWater || [];
    buildDropdowns();
    // Only re-filter here if catches have already loaded — otherwise this would
    // run against an empty allCatches and flash a false "no results" state.
    // loadCatches() will call applyFilters() itself once it finishes.
    if (catchesLoaded) applyFilters();
  } catch (e) {
    console.error('Lookup fetch failed', e);
  }
}

// Builds each dropdown's markup and click listeners once, when the lookup
// lists first arrive — the angler/species/water lists never change within a
// page session, so there's no need to redo this on every filter interaction
// (see syncDropdownSelections, called instead on each applyFilters()).
function buildDropdowns() {
  buildDropdown('angler', el.filterAnglerDropdown, lookups.anglers, 'All Anglers');
  buildDropdown('species', el.filterSpeciesDropdown, lookups.species, 'All Species');
  buildDropdown('water', el.filterWaterDropdown, lookups.bodiesOfWater, 'All Waters');
  syncDropdownSelections();
}

function buildDropdown(filterKey, dropdownEl, items, allLabel) {
  const options = [
    { label: allLabel, value: '' },
    ...items.map(i => ({ label: i.name || String(i), value: i.name || String(i) }))
  ];
  dropdownEl.innerHTML = options.map(opt => `
    <div class="filter-option" data-filter="${filterKey}" data-value="${escapeHtml(opt.value)}">
      <span class="filter-option-check"></span>
      <span>${escapeHtml(opt.label)}</span>
    </div>
  `).join('');
  dropdownEl.querySelectorAll('.filter-option').forEach(optEl => {
    optEl.addEventListener('click', () => {
      activeFilters[filterKey] = optEl.dataset.value;
      closeDropdowns();
      applyFilters();
    });
  });
}

// Cheap per-filter-change update: just toggles which existing option is
// marked selected, no markup rebuild or listener re-attachment.
function syncDropdownSelections() {
  syncDropdownSelection(el.filterAnglerDropdown, 'angler');
  syncDropdownSelection(el.filterSpeciesDropdown, 'species');
  syncDropdownSelection(el.filterWaterDropdown, 'water');
}

function syncDropdownSelection(dropdownEl, filterKey) {
  dropdownEl.querySelectorAll('.filter-option').forEach(optEl => {
    const isSelected = optEl.dataset.value === activeFilters[filterKey];
    optEl.classList.toggle('selected', isSelected);
    optEl.querySelector('.filter-option-check').textContent = isSelected ? '✓' : '';
  });
}

function applyFilters() {
  filteredCatches = allCatches.filter(c => {
    if (activeFilters.angler && c.anglerName !== activeFilters.angler) return false;
    if (activeFilters.species && c.fishSpeciesName !== activeFilters.species) return false;
    if (activeFilters.water && c.bodyOfWaterName !== activeFilters.water) return false;
    if (activeFilters.pendingOnly && c.verifiedAt) return false;
    return true;
  });
  currentPage = 1;
  sessionStorage.setItem('gillbert_filters', JSON.stringify(activeFilters));
  updateFilterUI();
  renderPage();
}

function updateFilterUI() {
  updateChip('angler', el.filterAnglerChip, el.filterAnglerValue);
  updateChip('species', el.filterSpeciesChip, el.filterSpeciesValue);
  updateChip('water', el.filterWaterChip, el.filterWaterValue);
  updatePendingChip();
  syncDropdownSelections();
  const hasFilter = activeFilters.angler || activeFilters.species || activeFilters.water || activeFilters.pendingOnly;
  if (hasFilter && allCatches.length) {
    el.filterSummary.classList.add('visible');
    el.filterSummaryText.textContent = `🎣 Showing ${filteredCatches.length} of ${allCatches.length} catches`;
  } else {
    el.filterSummary.classList.remove('visible');
  }
}

// Toggle chip (not a dropdown picker) — label always shows a live pending count.
function updatePendingChip() {
  const pendingCount = allCatches.filter(c => !c.verifiedAt).length;
  el.filterPendingValue.textContent = ` (${pendingCount})`;
  el.filterPendingChip.classList.toggle('active', activeFilters.pendingOnly);
}

function updateChip(filterKey, chipEl, valueEl) {
  const val = activeFilters[filterKey];
  if (val) {
    chipEl.classList.add('active');
    valueEl.textContent = ': ' + val;
  } else {
    chipEl.classList.remove('active');
    valueEl.textContent = '';
  }
}

function closeDropdowns() {
  document.querySelectorAll('.filter-chip-wrapper').forEach(w => w.classList.remove('open'));
  document.querySelectorAll('.filter-chip-dropdown').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('open'));
}

['filterAnglerChip', 'filterSpeciesChip', 'filterWaterChip'].forEach(chipId => {
  const chip = document.getElementById(chipId);
  const dropdownId = chipId.replace('Chip', 'Dropdown');
  const dropdown = document.getElementById(dropdownId);
  const wrapper = chip.closest('.filter-chip-wrapper');
  chip.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = wrapper.classList.contains('open');
    closeDropdowns();
    if (!isOpen) {
      wrapper.classList.add('open');
      chip.classList.add('open');
      dropdown.classList.add('open');
      // Position using fixed coords so it always floats above everything
      const rect = chip.getBoundingClientRect();
      dropdown.style.top = (rect.bottom + 6) + 'px';
      // Align left edge with chip, but clamp to viewport
      let left = rect.left;
      dropdown.style.left = '0px'; // render first to get width
      dropdown.style.visibility = 'hidden';
      requestAnimationFrame(() => {
        const dw = dropdown.offsetWidth;
        if (left + dw > window.innerWidth - 8) {
          left = window.innerWidth - dw - 8;
        }
        dropdown.style.left = Math.max(8, left) + 'px';
        dropdown.style.visibility = 'visible';
      });
    }
  });
});

document.addEventListener('click', closeDropdowns);

el.filterClearAll.addEventListener('click', () => {
  activeFilters = { angler: '', species: '', water: '', pendingOnly: false };
  sessionStorage.removeItem('gillbert_filters');
  applyFilters();
});

el.filterPendingChip.addEventListener('click', () => {
  activeFilters.pendingOnly = !activeFilters.pendingOnly;
  applyFilters();
});

// Admin-only: reveal the "Pending Review" toggle once identity/PIN unlock resolves.
// Runs independently of the page's data loads so it never delays them.
async function setupPendingFilterGate() {
  await (window.adminIdentityCheck || Promise.resolve());
  if (isAdminUnlocked()) el.filterPendingWrapper.hidden = false;
}

window.addEventListener("DOMContentLoaded", () => {
  const savedSearch = sessionStorage.getItem('gillbert_search');
  if (savedSearch) {
    el.searchInput.value = savedSearch;
  }
  const savedFilters = sessionStorage.getItem('gillbert_filters');
  if (savedFilters) {
    try { activeFilters = { ...activeFilters, ...JSON.parse(savedFilters) }; } catch (e) {}
  }
  setupPendingFilterGate();
  loadLookups();
  loadCatches();
});
