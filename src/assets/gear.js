// Gear: everyone's tip-ups, active first, then retired. Sorted by name, so a naming scheme
// like "KW 24-01" groups each person's together.
const STATE_IDS = ['loadingState', 'errorState', 'listState'];

const el = {
  errorMsg:      document.getElementById('errorMsg'),
  retryBtn:      document.getElementById('retryBtn'),
  activeCount:   document.getElementById('activeCount'),
  activeList:    document.getElementById('activeList'),
  activeEmpty:   document.getElementById('activeEmpty'),
  retiredSection: document.getElementById('retiredSection'),
  retiredCount:  document.getElementById('retiredCount'),
  retiredList:   document.getElementById('retiredList'),
};

function showState(id) {
  STATE_IDS.forEach(s => document.getElementById(s).classList.toggle('hidden', s !== id));
}

function row(t) {
  const retired = t.status === 'Retired';
  const meta = retired
    ? [t.ownerName, t.retiredNote].filter(Boolean).join(' · ')
    : [t.ownerName, gearSetupSummary(t.setup)].join(' · ');
  return `
    <li>
      <a class="gear-row${retired ? ' gear-row--retired' : ''}" href="./gear-tipup.html?id=${encodeURIComponent(t.id)}" data-id="${t.id}">
        <span class="gear-row-flag" aria-hidden="true"><img class="tipup-ico" src="./assets/tipup-icon.svg" alt="" /></span>
        <span class="gear-row-body">
          <span class="gear-row-name">${gearEsc(t.name)}</span>
          <span class="gear-row-meta">${gearEsc(meta)}</span>
        </span>
        <span class="gear-row-chevron" aria-hidden="true">›</span>
      </a>
    </li>`;
}

async function load() {
  showState('loadingState');
  try {
    const { tipUps } = await gearLoad();
    const active = tipUps.filter(t => t.status !== 'Retired');
    const retired = tipUps.filter(t => t.status === 'Retired');
    el.activeCount.textContent = active.length;
    el.activeList.innerHTML = active.map(row).join('');
    el.activeEmpty.classList.toggle('hidden', active.length > 0);
    el.retiredCount.textContent = retired.length;
    el.retiredList.innerHTML = retired.map(row).join('');
    el.retiredSection.classList.toggle('hidden', retired.length === 0);
    showState('listState');
  } catch (err) {
    console.error('Failed to load gear:', err);
    showState('errorState');
  }
}

el.retryBtn.addEventListener('click', load);
window.addEventListener('DOMContentLoaded', load);
