// Gear Stats (gear stage 4): fish by tip-up, bait and setup part, with the biggest fish on each.
// The counting is the database's (gear_stats_get): each fish counts for the setup version it was
// caught on, and only catches logged on a tip-up count. This page shows what comes back.

const el = {
  states: ['loadingState', 'errorState', 'statsState'],
  seasonFilter: document.getElementById('seasonFilter'),
  speciesChip: document.getElementById('filterSpeciesChip'),
  speciesValue: document.getElementById('filterSpeciesValue'),
  speciesDropdown: document.getElementById('filterSpeciesDropdown'),
  waterChip: document.getElementById('filterWaterChip'),
  waterValue: document.getElementById('filterWaterValue'),
  waterDropdown: document.getElementById('filterWaterDropdown'),
  summary: document.getElementById('statsSummary'),
  empty: document.getElementById('statsEmpty'),
  emptyText: document.getElementById('statsEmptyText'),
  sections: document.getElementById('statsSections'),
};

// The sections, in order (one with no rows isn't shown)
const SECTIONS = [
  { key: 'tipUp',  label: '🚩 Top Tip-ups' },
  { key: 'bait',   label: '🐟 Bait' },
  { key: 'hook',   label: '🪝 Hooks' },
  { key: 'line',   label: '🧵 Line' },
  { key: 'leader', label: '〰️ Leaders' },
  { key: 'bead',   label: '🫧 Beads', note: 'A fish on two beads counts for both.' },
  { key: 'flash',  label: '🪩 Flash', note: 'A fish on two flashes counts for both.' },
];
const TOP = 5;                     // rows shown before "Show all"
const MEDALS = ['🥇', '🥈', '🥉'];
const FILTERS_KEY = 'gillbert_gear_stats_filters';

// { speciesId, speciesName, waterId, waterName, season: 'all' | 'this' }
let filters = { speciesId: null, speciesName: '', waterId: null, waterName: '', season: 'all' };
try { Object.assign(filters, JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}')); } catch { /* keep defaults */ }
let listsBuilt = false;
const expanded = new Set();        // sections opened with "Show all"

function showState(id) {
  el.states.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

// This Season: the hard-water season (Nov to Mar) or the open-water one (Apr to Oct) we're in
function thisSeason(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  if (m >= 10) return { from: `${y}-11-01`, to: `${y + 1}-03-31`, label: `Hard water ${y}–${String(y + 1).slice(2)}` };
  if (m <= 2) return { from: `${y - 1}-11-01`, to: `${y}-03-31`, label: `Hard water ${y - 1}–${String(y).slice(2)}` };
  return { from: `${y}-04-01`, to: `${y}-10-31`, label: `Open water ${y}` };
}

async function loadStats() {
  const q = new URLSearchParams();
  if (filters.speciesId != null) q.set('speciesId', filters.speciesId);
  if (filters.waterId != null) q.set('waterId', filters.waterId);
  if (filters.season === 'this') {
    const s = thisSeason();
    q.set('from', s.from);
    q.set('to', s.to);
  }
  const url = q.toString() ? `${GEAR_STATS_URL}?${q}` : GEAR_STATS_URL;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return gearUnwrap(await res.json());
}

function biggestText(b) {
  if (!b) return '';
  const when = b.caughtWhen ? gearShortDate(b.caughtWhen) : null;
  return [`${b.length}" ${b.species}`, b.angler, when].filter(Boolean).join(' · ');
}

function rowHtml(sectionKey, r, i, max) {
  const medal = i < 3;
  const cls = `rank-row${medal ? ` rank-${i + 1}` : ''}${r.none ? ' stat-none' : ''}`;
  const body = `
    <div class="rank-badge">${medal ? MEDALS[i] : i + 1}</div>
    <div class="rank-content">
      <div class="rank-main">${gearEsc(r.name)}</div>
      ${r.owner ? `<div class="rank-meta">${gearEsc(r.owner)}</div>` : ''}
      <div class="stat-bar"><span style="width:${Math.max(4, Math.round(r.fish / max * 100))}%"></span></div>
      ${r.biggest ? `<div class="stat-best">📏 Biggest: ${gearEsc(biggestText(r.biggest))}</div>` : ''}
    </div>
    <div class="stat-count">${r.fish}<small>fish</small></div>`;
  // A tip-up opens its page; the other rows are just numbers
  return sectionKey === 'tipUp' && r.id != null
    ? `<a class="${cls}" href="./gear-tipup.html?id=${encodeURIComponent(r.id)}">${body}</a>`
    : `<div class="${cls}">${body}</div>`;
}

function render(data) {
  const fish = data.fish || 0;
  const scope = filters.season === 'this' ? thisSeason().label : 'All time';
  el.summary.textContent = `${scope} · ${fish} fish logged on ${data.tipUps || 0} tip-up${data.tipUps === 1 ? '' : 's'}`;
  el.empty.classList.toggle('hidden', fish > 0);
  el.emptyText.textContent = filters.speciesId != null || filters.waterId != null
    ? 'No fish caught on a tip-up match these filters.'
    : 'No fish logged on a tip-up yet. Pick the tip-up when you log a catch and it shows up here.';

  const sections = data.sections || {};
  el.sections.innerHTML = SECTIONS.map(s => {
    const rows = sections[s.key] || [];
    if (!rows.length) return '';
    const max = Math.max(...rows.map(r => r.fish));
    const open = expanded.has(s.key);
    const shown = open ? rows : rows.slice(0, TOP);
    // No beads / No flash ranks like the rest (in italics, as the baseline to compare with)
    const html = shown.map((r, i) => rowHtml(s.key, r, i, max)).join('');
    const more = rows.length > TOP
      ? `<button type="button" class="stats-more" data-section="${s.key}">${open ? 'Show top ' + TOP : `Show all ${rows.length} →`}</button>`
      : '';
    return `
      <section class="stats-section" data-section="${s.key}">
        <div class="section-divider"><span class="section-label">${s.label}</span></div>
        ${s.note ? `<p class="stats-note">${s.note}</p>` : ''}
        <div class="leaderboard-list">${html}${more}</div>
      </section>`;
  }).join('');
}

// ── Filters (the Catches page's chips) ────────────────────────────────────────────────────
function buildDropdown(dropdownEl, items, allLabel, onPick) {
  const options = [{ id: null, name: allLabel }, ...items];
  dropdownEl.innerHTML = options.map(o => `
    <div class="filter-option" data-id="${o.id ?? ''}">
      <span class="filter-option-check"></span>
      <span>${gearEsc(o.name)}</span>
    </div>`).join('');
  dropdownEl.querySelectorAll('.filter-option').forEach((optEl, i) => {
    optEl.addEventListener('click', () => {
      const o = options[i];
      onPick(o.id, o.id == null ? '' : o.name);
      closeDropdowns();
      refresh();
    });
  });
}

function buildFilterLists(data) {
  buildDropdown(el.speciesDropdown, data.species || [], 'All Species', (id, name) => {
    filters.speciesId = id; filters.speciesName = name;
  });
  buildDropdown(el.waterDropdown, data.waters || [], 'All Waters', (id, name) => {
    filters.waterId = id; filters.waterName = name;
  });
  listsBuilt = true;
}

function syncFilterUI() {
  [[el.speciesChip, el.speciesValue, el.speciesDropdown, filters.speciesId, filters.speciesName],
   [el.waterChip, el.waterValue, el.waterDropdown, filters.waterId, filters.waterName]]
    .forEach(([chip, value, dropdown, id, name]) => {
      chip.classList.toggle('active', id != null);
      value.textContent = id != null ? ': ' + name : '';
      dropdown.querySelectorAll('.filter-option').forEach(o => {
        const on = o.dataset.id === String(id ?? '');
        o.classList.toggle('selected', on);
        o.querySelector('.filter-option-check').textContent = on ? '✓' : '';
      });
    });
  el.seasonFilter.querySelectorAll('[data-season]').forEach(b =>
    b.classList.toggle('active', b.dataset.season === filters.season));
}

function closeDropdowns() {
  document.querySelectorAll('.filter-chip-wrapper, .filter-chip-dropdown, .filter-chip')
    .forEach(x => x.classList.remove('open'));
}

[[el.speciesChip, el.speciesDropdown], [el.waterChip, el.waterDropdown]].forEach(([chip, dropdown]) => {
  const wrapper = chip.closest('.filter-chip-wrapper');
  chip.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = wrapper.classList.contains('open');
    closeDropdowns();
    if (isOpen) return;
    wrapper.classList.add('open');
    chip.classList.add('open');
    dropdown.classList.add('open');
    // Fixed position under the chip, kept inside the screen
    const rect = chip.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 6) + 'px';
    dropdown.style.left = '0px';
    dropdown.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const left = Math.min(rect.left, window.innerWidth - dropdown.offsetWidth - 8);
      dropdown.style.left = Math.max(8, left) + 'px';
      dropdown.style.visibility = 'visible';
    });
  });
});
document.addEventListener('click', closeDropdowns);
window.addEventListener('scroll', closeDropdowns, { passive: true });

el.seasonFilter.addEventListener('click', e => {
  const b = e.target.closest('[data-season]');
  if (!b || b.dataset.season === filters.season) return;
  filters.season = b.dataset.season;
  refresh();
});

el.sections.addEventListener('click', e => {
  const b = e.target.closest('.stats-more');
  if (!b) return;
  const k = b.dataset.section;
  if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
  render(lastData);
});

// ── Load ──────────────────────────────────────────────────────────────────────────────────
let lastData = null;
let loadSeq = 0;

async function refresh() {
  try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* not needed */ }
  syncFilterUI();
  const seq = ++loadSeq;
  if (!lastData) showState('loadingState');
  else el.sections.classList.add('stats-loading');
  try {
    const data = await loadStats();
    if (seq !== loadSeq) return;          // a newer filter pick is on its way
    lastData = data;
    if (!listsBuilt) { buildFilterLists(data); syncFilterUI(); }
    render(data);
    showState('statsState');
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error('Gear stats failed to load:', err);
    showState('errorState');
  } finally {
    if (seq === loadSeq) el.sections.classList.remove('stats-loading');
  }
}

document.getElementById('retryBtn').addEventListener('click', refresh);
refresh();
