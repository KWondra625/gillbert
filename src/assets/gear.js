// Gear: everyone's tip-ups as cards, active first, then retired. Sorted by name, so a naming
// scheme like "KW 24-01" groups each person's together. The search box and owner pills work
// like the Anglers page's.
const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  errorMsg:       document.getElementById('errorMsg'),
  retryBtn:       document.getElementById('retryBtn'),
  searchInput:    document.getElementById('searchInput'),
  ownerFilter:    document.getElementById('ownerFilter'),
  activeCount:    document.getElementById('activeCount'),
  activeList:     document.getElementById('activeList'),
  activeEmpty:    document.getElementById('activeEmpty'),
  retiredSection: document.getElementById('retiredSection'),
  retiredCount:   document.getElementById('retiredCount'),
  retiredList:    document.getElementById('retiredList'),
};

let allTipUps = [];
let ownerId = '';  // '' = everyone

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function card(t) {
  const retired = t.status === 'Retired';
  const meta = retired ? (t.retiredNote || 'Retired') : gearSetupSummary(t.setup);
  return `
    <a class="gear-card${retired ? ' gear-card--retired' : ''}" href="./gear-tipup.html?id=${encodeURIComponent(t.id)}" data-id="${t.id}">
      <span class="gear-card-photo" aria-hidden="true"><img class="tipup-ico" src="./assets/tipup-icon.svg" alt="" /></span>
      <span class="gear-card-body">
        <span class="gear-card-name">${gearEsc(t.name)}</span>
        <span class="gear-card-owner">${gearEsc(t.ownerName || '')}</span>
        <span class="gear-card-meta">${gearEsc(meta)}</span>
      </span>
    </a>`;
}

// Everything a search can match: name, owner, model, color and the setup's parts
function searchText(t) {
  const s = t.setup || {};
  return [t.name, t.ownerName, t.model, t.color, s.line, s.leader, s.hook, ...(s.beads || []), ...(s.flash || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

function fillOwnerPills() {
  const owners = new Map();
  allTipUps.forEach(t => owners.set(String(t.ownerAnglerId), t.ownerName || 'Unknown'));
  const sorted = [...owners.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (!owners.has(ownerId)) ownerId = '';
  el.ownerFilter.innerHTML = [['', 'All'], ...sorted].map(([id, name]) =>
    `<button type="button" class="status-filter-btn${id === ownerId ? ' active' : ''}" data-owner="${gearEsc(id)}">${gearEsc(name)}</button>`
  ).join('');
  el.ownerFilter.classList.toggle('hidden', sorted.length < 2);
}

function render() {
  const q = el.searchInput.value.trim().toLowerCase();
  const shown = allTipUps.filter(t =>
    (!ownerId || String(t.ownerAnglerId) === ownerId) && (!q || searchText(t).includes(q)));
  const active = shown.filter(t => t.status !== 'Retired');
  const retired = shown.filter(t => t.status === 'Retired');
  const filtered = Boolean(q || ownerId);

  el.activeCount.textContent = active.length;
  el.activeList.innerHTML = active.map(card).join('');
  el.activeEmpty.textContent = filtered
    ? 'No tip-ups match.'
    : 'No tip-ups yet. Add the first one, and its setup after.';
  el.activeEmpty.classList.toggle('hidden', active.length > 0);
  el.retiredCount.textContent = retired.length;
  el.retiredList.innerHTML = retired.map(card).join('');
  el.retiredSection.classList.toggle('hidden', retired.length === 0);
}

async function load() {
  showState('loadingState');
  try {
    ({ tipUps: allTipUps } = await gearLoad());
    fillOwnerPills();
    render();
    showState('listState');
  } catch (err) {
    console.error('Failed to load gear:', err);
    showState('errorState');
  }
}

el.searchInput.addEventListener('input', render);
el.ownerFilter.addEventListener('click', e => {
  const b = e.target.closest('.status-filter-btn');
  if (!b) return;
  ownerId = b.dataset.owner;
  el.ownerFilter.querySelectorAll('.status-filter-btn').forEach(x => x.classList.toggle('active', x === b));
  render();
});
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
