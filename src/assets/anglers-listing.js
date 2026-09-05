const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  loadingState:    document.getElementById('loadingState'),
  errorState:      document.getElementById('errorState'),
  listState:       document.getElementById('listState'),
  errorMsg:        document.getElementById('errorMsg'),
  retryBtn:        document.getElementById('retryBtn'),
  searchInput:     document.getElementById('searchInput'),
  statusFilter:    document.getElementById('statusFilter'),
  tbody:           document.getElementById('anglersTableBody'),
  emptyState:      document.getElementById('emptyState'),
};

let allAnglers = [];
let activeStatusFilter = '';
let anglerStats = {};

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
    const [anglersRes, stats] = await Promise.all([
      fetch(ANGLERS_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchAnglerStats(),
    ]);
    if (!anglersRes.ok) throw new Error(`HTTP ${anglersRes.status}`);
    const raw = await anglersRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    allAnglers = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    anglerStats = stats;
    render();
    showState('listState');
  } catch (err) {
    console.error('Failed to load anglers:', err);
    el.errorMsg.textContent = 'Unable to load anglers. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

function render() {
  const term = el.searchInput.value.trim().toLowerCase();

  const rows = allAnglers
    .filter(a => {
      if (activeStatusFilter && a.status !== activeStatusFilter) return false;
      if (!term) return true;
      const haystack = [a.name, ...(a.aliases || [])].join(' ').toLowerCase();
      return haystack.includes(term);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  el.emptyState.classList.toggle('hidden', rows.length > 0);

  el.tbody.innerHTML = rows.map(a => {
    const count = (anglerStats[a.id] && anglerStats[a.id].count) || 0;
    const countCell = count > 0
      ? `<a href="#" class="catch-count-link" data-angler-name="${escapeHtml(a.name)}">${count}</a>`
      : `<span class="catch-count-zero">0</span>`;
    return `
    <tr class="data-row" data-id="${a.id}">
      <td class="name-cell">${escapeHtml(a.name)}</td>
      <td>${escapeHtml((a.aliases || []).join(', ') || '—')}</td>
      <td><span class="pill ${pillClass(a.status)}">${escapeHtml(a.status)}</span></td>
      <td>${countCell}</td>
    </tr>
  `;
  }).join('');

  el.tbody.querySelectorAll('.data-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.href = `./edit-angler.html?id=${encodeURIComponent(row.dataset.id)}`;
    });
  });

  el.tbody.querySelectorAll('.catch-count-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      goToFilteredCatches(link.dataset.anglerName, { href: './anglers-listing.html', label: 'Anglers' });
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
