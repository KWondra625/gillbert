// Admin: every gear tag (line, leader, hook, beads, flash, bait, model, color) with how much it's
// used, filtered by kind and search. A row opens gear-tag-edit.html to rename, hide, merge or delete.
// Sorted by kind, then name, so near-duplicates sit next to each other.
const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  errorMsg:    document.getElementById('errorMsg'),
  retryBtn:    document.getElementById('retryBtn'),
  searchInput: document.getElementById('searchInput'),
  kindFilter:  document.getElementById('kindFilter'),
  tbody:       document.getElementById('tagsTableBody'),
  emptyState:  document.getElementById('emptyState'),
};

let allTags = [];
let kind = '';  // '' = every kind

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

// A kind remembered from the edit page's Back (sessionStorage; fails soft in private windows)
function rememberKind(k) { try { sessionStorage.setItem('gillbert_gear_tag_kind', k); } catch {} }
function recallKind() { try { return sessionStorage.getItem('gillbert_gear_tag_kind') || ''; } catch { return ''; } }

function fillKindPills() {
  const counts = {};
  allTags.forEach(t => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
  if (kind && !counts[kind]) kind = '';
  el.kindFilter.innerHTML = [['', 'All'], ...GEAR_TAG_KINDS.filter(([k]) => counts[k])].map(([k, label]) =>
    `<button type="button" class="status-filter-btn${k === kind ? ' active' : ''}" data-kind="${k}">${label}</button>`
  ).join('');
}

function render() {
  const q = el.searchInput.value.trim().toLowerCase();
  const rows = allTags.filter(t => (!kind || t.kind === kind) && (!q || t.name.toLowerCase().includes(q)));
  el.emptyState.classList.toggle('hidden', rows.length > 0);
  el.tbody.innerHTML = rows.map(t => `
    <tr class="data-row" data-id="${t.id}">
      <td class="name-cell"><a class="row-edit-link" href="./gear-tag-edit.html?id=${encodeURIComponent(t.id)}">${gearEsc(t.name)}</a></td>
      <td>${gearEsc(GEAR_TAG_KIND_LABEL[t.kind] || t.kind)}</td>
      <td class="${t.tipUps || t.catches ? '' : 'tag-unused'}">${gearEsc(gearTagUses(t))}</td>
      <td><span class="pill ${t.status === 'Hidden' ? 'pill-amber' : 'pill-green'}">${t.status === 'Hidden' ? 'Hidden' : 'Shown'}</span></td>
    </tr>`).join('');
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
    allTags = await gearLoadTags();
    kind = recallKind();
    fillKindPills();
    render();
    showState('listState');
  } catch (err) {
    console.error('Failed to load gear tags:', err);
    el.errorMsg.textContent = 'Unable to load gear tags. Please check your connection and try again.';
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

el.searchInput.addEventListener('input', render);
el.kindFilter.addEventListener('click', e => {
  const b = e.target.closest('.status-filter-btn');
  if (!b) return;
  kind = b.dataset.kind;
  rememberKind(kind);
  el.kindFilter.querySelectorAll('.status-filter-btn').forEach(x => x.classList.toggle('active', x === b));
  render();
});
// The whole row opens the tag; the name link handles its own clicks (so ctrl-click opens a tab)
el.tbody.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('.data-row');
  if (row) window.location.href = `./gear-tag-edit.html?id=${encodeURIComponent(row.dataset.id)}`;
});
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
