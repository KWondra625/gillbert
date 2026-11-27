// One tip-up: its model, color and current setup, the ways to change it, and its history.
const STATE_IDS = ['loadingState', 'errorState', 'viewState'];
const tipId = new URLSearchParams(location.search).get('id');

const el = {
  tipName:     document.getElementById('tipName'),
  tipSub:      document.getElementById('tipSub'),
  retiredNote: document.getElementById('retiredNote'),
  tipParts:    document.getElementById('tipParts'),
  tipNotes:    document.getElementById('tipNotes'),
  setupLink:   document.getElementById('setupLink'),
  editLink:    document.getElementById('editLink'),
  historyList: document.getElementById('historyList'),
  viewCatches: document.getElementById('viewCatchesLink'),
  errorMsg:    document.getElementById('errorMsg'),
  retryBtn:    document.getElementById('retryBtn'),
};

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function part(label, value) {
  const shown = Array.isArray(value) ? value.join(', ') : value;
  return `<dt>${label}</dt><dd>${shown ? gearEsc(shown) : '<span class="gear-none">—</span>'}</dd>`;
}

let shown = null;  // the tip-up on the page, for the View Catches link

// "View 3 Catches" opens the catches list filtered to this tip-up; with none it's greyed out
function renderViewCatches(t) {
  const n = Number(t.catchCount) || 0;
  el.viewCatches.textContent = n > 0 ? `🎣 View ${n} Catch${n === 1 ? '' : 'es'}` : '🎣 No Catches Yet';
  el.viewCatches.classList.toggle('view-catches-link--empty', n === 0);
}

function render(t, history) {
  shown = t;
  renderViewCatches(t);
  document.title = `${t.name} · Gillbert`;
  el.tipName.textContent = t.name;
  el.tipSub.textContent = [`${t.ownerName}'s`, t.status].join(' · ');

  const retired = t.status === 'Retired';
  el.retiredNote.classList.toggle('hidden', !retired);
  el.retiredNote.textContent = retired ? `Retired${t.retiredNote ? `: ${t.retiredNote}` : ''}. Its history and catches are kept.` : '';

  const s = t.setup || {};
  el.tipParts.innerHTML = [
    part('Model', t.model), part('Color', t.color),
    part('Line', s.line), part('Leader', s.leader), part('Hook', s.hook),
    part('Beads', s.beads), part('Flash', s.flash),
  ].join('');

  el.tipNotes.textContent = t.notes || '';
  el.tipNotes.classList.toggle('hidden', !t.notes);

  el.setupLink.href = `./gear-setup.html?id=${encodeURIComponent(t.id)}`;
  el.setupLink.textContent = t.setup ? 'Change setup' : 'Set up its line, leader and hook';
  el.setupLink.classList.toggle('hidden', retired);
  el.editLink.href = `./gear-edit.html?id=${encodeURIComponent(t.id)}`;
  el.editLink.textContent = retired ? 'Rename, owner or bring back' : 'Rename, owner or retire';

  el.historyList.innerHTML = history.map(h => `
    <li>
      <span class="gear-history-when">${gearEsc(gearShortDate(h.at))} · ${gearEsc(h.byName || 'Someone')}</span>
      ${gearEsc(gearHistoryText(h))}
    </li>`).join('');
}

async function load() {
  showState('loadingState');
  if (!/^\d+$/.test(tipId || '')) {
    el.errorMsg.textContent = "This link doesn't say which tip-up to show.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }
  try {
    const { tipUps, history } = await gearLoad(tipId);
    const t = tipUps[0];
    if (!t) {
      el.errorMsg.textContent = "That tip-up isn't here any more. It may have been deleted.";
      el.retryBtn.classList.add('hidden');
      showState('errorState');
      return;
    }
    render(t, history);
    showState('viewState');
  } catch (err) {
    console.error('Failed to load tip-up:', err);
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
  }
}

el.viewCatches.addEventListener('click', e => {
  e.preventDefault();
  if (!shown || !(Number(shown.catchCount) > 0)) return;
  goToGearCatches(shown.id, shown.name, { href: `./gear-tipup.html?id=${encodeURIComponent(shown.id)}`, label: shown.name });
});
el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
