const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  loadingState:    document.getElementById('loadingState'),
  errorState:      document.getElementById('errorState'),
  listState:       document.getElementById('listState'),
  errorMsg:        document.getElementById('errorMsg'),
  retryBtn:        document.getElementById('retryBtn'),
  searchInput:     document.getElementById('searchInput'),
  statusFilter:    document.getElementById('statusFilter'),
  tbody:           document.getElementById('speciesTableBody'),
  emptyState:      document.getElementById('emptyState'),
};

let allSpecies = [];
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
    const [speciesRes, counts] = await Promise.all([
      fetch(FISH_SPECIES_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      fetchCatchCounts(),
    ]);
    if (!speciesRes.ok) throw new Error(`HTTP ${speciesRes.status}`);
    const raw = await speciesRes.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    allSpecies = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (Array.isArray(raw) ? raw : []);
    catchCounts = counts;
    render();
    showState('listState');
  } catch (err) {
    console.error('Failed to load fish species:', err);
    el.errorMsg.textContent = 'Unable to load fish species. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

function render() {
  const term = el.searchInput.value.trim().toLowerCase();

  const rows = allSpecies
    .filter(s => {
      if (activeStatusFilter && s.status !== activeStatusFilter) return false;
      if (!term) return true;
      const haystack = [s.name, s.displayNameOverride, ...(s.aliases || [])].join(' ').toLowerCase();
      return haystack.includes(term);
    })
    .sort((a, b) => (a.displayNameOverride || a.name).localeCompare(b.displayNameOverride || b.name));

  el.emptyState.classList.toggle('hidden', rows.length > 0);

  el.tbody.innerHTML = rows.map(s => {
    const count = catchCounts[s.id] || 0;
    const displayName = s.displayNameOverride || s.name;
    const countCell = count > 0
      ? `<a href="#" class="catch-count-link" data-species-name="${escapeHtml(displayName)}">${count}</a>`
      : `<span class="catch-count-zero">0</span>`;
    return `
    <tr class="data-row" data-id="${s.id}">
      <td class="name-cell">${escapeHtml(displayName)}${s.displayNameOverride ? `<span class="name-info-icon" title="DNR name: ${escapeHtml(s.name)}">ⓘ</span>` : ''}</td>
      <td>${escapeHtml((s.aliases || []).join(', ') || '—')}</td>
      <td><span class="pill ${pillClass(s.status)}">${escapeHtml(s.status)}</span></td>
      <td>${countCell}</td>
    </tr>
  `;
  }).join('');

  el.tbody.querySelectorAll('.data-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.href = `./edit-fish-species.html?id=${encodeURIComponent(row.dataset.id)}`;
    });
  });

  el.tbody.querySelectorAll('.catch-count-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      goToFilteredCatches(link.dataset.speciesName, { href: './fish-species-listing.html', label: 'Fish Species' });
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
