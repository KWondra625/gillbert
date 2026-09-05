const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  loadingState:    document.getElementById('loadingState'),
  errorState:      document.getElementById('errorState'),
  listState:       document.getElementById('listState'),
  errorMsg:        document.getElementById('errorMsg'),
  retryBtn:        document.getElementById('retryBtn'),
  searchInput:     document.getElementById('searchInput'),
  statusFilter:    document.getElementById('statusFilter'),
  tbody:           document.getElementById('waterTableBody'),
  emptyState:      document.getElementById('emptyState'),
};

let allWaters = [];
let activeStatusFilter = '';
let catchCounts = {};

function showState(stateId) {
  STATE_IDS.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
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

function pillClass(status) {
  if (status === 'Active') return 'pill-green';
  if (status === 'Inactive') return 'pill-red';
  return 'pill-amber'; // Submitted
}

async function load() {
  showState('loadingState');

  await window.adminIdentityCheck;
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  try {
    const [watersRes, counts] = await Promise.all([
      fetch(BODIES_OF_WATER_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchCatchCounts(),
    ]);
    if (!watersRes.ok) throw new Error(`HTTP ${watersRes.status}`);
    const raw = await watersRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    allWaters = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    catchCounts = counts;
    render();
    showState('listState');
  } catch (err) {
    console.error('Failed to load bodies of water:', err);
    el.errorMsg.textContent = 'Unable to load bodies of water. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

function render() {
  const term = el.searchInput.value.trim().toLowerCase();

  const rows = allWaters
    .filter(w => {
      if (activeStatusFilter && w.status !== activeStatusFilter) return false;
      if (!term) return true;
      return w.name.toLowerCase().includes(term);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  el.emptyState.classList.toggle('hidden', rows.length > 0);

  el.tbody.innerHTML = rows.map(w => {
    const count = catchCounts[w.id] || 0;
    const countCell = count > 0
      ? `<a href="#" class="catch-count-link" data-water-id="${w.id}" data-water-name="${escapeHtml(w.name)}">${count}</a>`
      : `<span class="catch-count-zero">0</span>`;
    const linkedIcon = w.wbic ? `<span class="wbic-linked-icon" title="Linked to WI DNR (WBIC ${escapeHtml(String(w.wbic))})">🔗</span>` : '';
    return `
    <tr class="data-row" data-id="${w.id}">
      <td class="name-cell">${escapeHtml(w.name)}${linkedIcon}</td>
      <td><span class="pill ${pillClass(w.status)}">${escapeHtml(w.status)}</span></td>
      <td>${countCell}</td>
    </tr>
  `;
  }).join('');

  el.tbody.querySelectorAll('.data-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.href = `./edit-body-of-water.html?id=${encodeURIComponent(row.dataset.id)}`;
    });
  });

  el.tbody.querySelectorAll('.catch-count-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      goToFilteredCatches(Number(link.dataset.waterId), link.dataset.waterName, { href: './bodies-of-water-listing.html', label: 'Bodies of Water' });
    });
  });
}

el.searchInput.addEventListener('input', render);

el.statusFilter.querySelectorAll('.status-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeStatusFilter = btn.dataset.status;
    el.statusFilter.querySelectorAll('.status-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

el.retryBtn.addEventListener('click', load);

window.addEventListener('DOMContentLoaded', load);
