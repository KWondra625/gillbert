const ITEMS_PER_PAGE = 25;

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
};

let allCatches = [];
let currentPage = 1;

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

    // Accept either [{...}] OR { catches: [...] }
    allCatches = Array.isArray(data) ? data : (data.catches || []);

    if (!allCatches.length) {
      el.catchesContainer.innerHTML = `<div class="empty-state"><p>No catches found.</p></div>`;
      el.paginationContainer.style.display = 'none';
      setStatus("No catches available.");
      hideLoading();
      return;
    }

    setStatus("");
    currentPage = 1;
    sessionStorage.setItem('gillbert_search', el.searchInput.value.trim());
    renderPage();
    hideLoading();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load catches ❌");
    el.catchesContainer.innerHTML = `<div class="empty-state"><p>Error loading catches.</p></div>`;
    el.paginationContainer.style.display = 'none';
    hideLoading();
  }
}

function renderPage() {
  const totalPages = Math.ceil(allCatches.length / ITEMS_PER_PAGE);

  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageCatches = allCatches.slice(startIndex, endIndex);

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

function renderCatchCard(catchData) {
  const {
    catchNumber = "Unknown",
    anglerName = "Unknown",
    fishSpeciesName = "Unknown",
    length = "N/A",
    caughtWhen = null,
  } = catchData;

  const caughtWhenDisplay = caughtWhen
    ? new Date(caughtWhen).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : 'Unknown';

  return `
    <div class="catch-card">
      <div class="catch-card-header">
        <h2 class="catch-id">${escapeHtml(catchNumber)}</h2>
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
        <div class="catch-field">
          <span class="field-label">📏 Length:</span>
          <span class="field-value">${escapeHtml(String(length))}"</span>
        </div>
        <div class="catch-field">
          <span class="field-label">📅 When:</span>
          <span class="field-value">${escapeHtml(caughtWhenDisplay)}</span>
        </div>
      </div>
      <div class="catch-card-footer">
        <a href="./catch-details.html?catchNumber=${encodeURIComponent(catchNumber)}" class="card-button">
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

window.addEventListener("DOMContentLoaded", () => {
  const savedSearch = sessionStorage.getItem('gillbert_search');
  if (savedSearch) {
    el.searchInput.value = savedSearch;
  }
  loadCatches();
});
