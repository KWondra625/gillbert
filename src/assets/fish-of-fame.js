const MEDALS = ['🥇', '🥈', '🥉'];

const el = {
  status: document.getElementById('status'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  content: document.getElementById('content'),
  topCatchesList: document.getElementById('topCatchesList'),
  fishSpeciesRecordsList: document.getElementById('fishSpeciesRecordsList'),
  topAnglersList: document.getElementById('topAnglersList'),
};

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

function rankBadge(index) {
  return index < 3 ? MEDALS[index] : `#${index + 1}`;
}

function rankClass(index) {
  return index < 3 ? ` rank-${index + 1}` : '';
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function mediaBadge(count) {
  return count > 0
    ? `<span class="rank-media-badge" title="${count} attachment${count === 1 ? '' : 's'}">📷 ${count}</span>`
    : '';
}

function pendingBadge(verifiedAt) {
  return verifiedAt
    ? ''
    : `<span class="rank-pending-badge" title="Not yet reviewed">⏳ Pending Review</span>`;
}

function buildSpeciesBreakdown(speciesCounts, cap = 3) {
  const sorted = Array.from(speciesCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const top = sorted.slice(0, cap).map(([species, count]) => `${count} ${species}`);
  const remaining = sorted.length - cap;
  if (remaining > 0) top.push(`+${remaining} more species`);

  return top.join(', ');
}

// ── Ranking ──────────────────────────────────────────────────────────────────────────────
function computeTopCatches(catches) {
  return catches
    .filter(c => c.length != null && c.length !== '')
    .slice()
    .sort((a, b) => {
      const diff = Number(b.length) - Number(a.length);
      if (diff !== 0) return diff;
      // Tie-break: earliest catch to reach that length wins
      const aTime = a.caughtWhen ? new Date(a.caughtWhen).getTime() : Infinity;
      const bTime = b.caughtWhen ? new Date(b.caughtWhen).getTime() : Infinity;
      return aTime - bTime;
    })
    .slice(0, 10);
}

function computeFishSpeciesRecords(catches) {
  const byFishSpecies = new Map();

  catches.forEach(c => {
    if (c.length == null || c.length === '') return;
    const fishSpecies = c.fishSpeciesName || 'Unknown';
    const existing = byFishSpecies.get(fishSpecies);

    if (!existing) {
      byFishSpecies.set(fishSpecies, c);
      return;
    }

    const diff = Number(c.length) - Number(existing.length);
    if (diff > 0) {
      byFishSpecies.set(fishSpecies, c);
    } else if (diff === 0) {
      // Tie-break: earliest catch to reach that length wins
      const cTime = c.caughtWhen ? new Date(c.caughtWhen).getTime() : Infinity;
      const eTime = existing.caughtWhen ? new Date(existing.caughtWhen).getTime() : Infinity;
      if (cTime < eTime) byFishSpecies.set(fishSpecies, c);
    }
  });

  return Array.from(byFishSpecies.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fishSpecies, c]) => ({ fishSpecies, catch: c }));
}

function computeTopAnglers(catches) {
  const byAngler = new Map();

  catches.forEach(c => {
    const name = c.anglerName || 'Unknown';
    const key = c.anglerId ?? name;
    if (!byAngler.has(key)) {
      byAngler.set(key, { id: c.anglerId ?? null, name, count: 0, biggestCatch: null, speciesCounts: new Map() });
    }
    const entry = byAngler.get(key);
    entry.count += 1;

    const length = (c.length != null && c.length !== '') ? Number(c.length) : null;
    if (length != null && (entry.biggestCatch == null || length > Number(entry.biggestCatch.length))) {
      entry.biggestCatch = c;
    }

    const species = c.fishSpeciesName || 'Unknown';
    entry.speciesCounts.set(species, (entry.speciesCounts.get(species) || 0) + 1);
  });

  return Array.from(byAngler.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const aBest = a.biggestCatch?.length != null ? Number(a.biggestCatch.length) : -Infinity;
    const bBest = b.biggestCatch?.length != null ? Number(b.biggestCatch.length) : -Infinity;
    if (bBest !== aBest) return bBest - aBest;
    return a.name.localeCompare(b.name);
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────
function renderTopCatches(list) {
  if (!list.length) {
    el.topCatchesList.innerHTML = `<div class="rank-empty">No catches with recorded lengths yet.</div>`;
    return;
  }

  el.topCatchesList.innerHTML = list.map((c, i) => {
    const meta = [c.anglerName, c.bodyOfWaterName, formatDate(c.caughtWhen)].filter(Boolean).join(' · ');
    return `
      <a class="rank-row${rankClass(i)}" href="./catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=fish-of-fame">
        <div class="rank-badge">${rankBadge(i)}</div>
        <div class="rank-content">
          <div class="rank-main">${escapeHtml(String(c.length))}" ${escapeHtml(c.fishSpeciesName || 'Unknown')}${mediaBadge(c.catchMediaCount)}${pendingBadge(c.verifiedAt)}</div>
          <div class="rank-meta">${escapeHtml(meta)}</div>
        </div>
        <span class="rank-link">View →</span>
      </a>
    `;
  }).join('');
}

function renderFishSpeciesRecords(list) {
  if (!list.length) {
    el.fishSpeciesRecordsList.innerHTML = `<div class="rank-empty">No fish species records yet.</div>`;
    return;
  }

  el.fishSpeciesRecordsList.innerHTML = list.map(({ fishSpecies, catch: c }) => {
    const meta = [`${c.length}"`, c.anglerName, c.bodyOfWaterName, formatDate(c.caughtWhen)].filter(Boolean).join(' · ');
    return `
      <a class="rank-row" href="./catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=fish-of-fame">
        <div class="rank-badge">🐟</div>
        <div class="rank-content">
          <div class="rank-main">${escapeHtml(fishSpecies)}${mediaBadge(c.catchMediaCount)}${pendingBadge(c.verifiedAt)}</div>
          <div class="rank-meta">${escapeHtml(meta)}</div>
        </div>
        <span class="rank-link">View →</span>
      </a>
    `;
  }).join('');
}

function renderTopAnglers(list, photosById) {
  if (!list.length) {
    el.topAnglersList.innerHTML = `<div class="rank-empty">No anglers on the board yet.</div>`;
    return;
  }

  el.topAnglersList.innerHTML = list.map((a, i) => {
    const meta = [`${a.count} catch${a.count === 1 ? '' : 'es'}`, buildSpeciesBreakdown(a.speciesCounts)].filter(Boolean).join(' · ');
    const photoUrl = photosById && a.id != null ? photosById[a.id] : null;
    const avatarHtml = photoUrl
      ? `<img class="rank-avatar" src="${escapeHtml(photoUrl)}" alt="">`
      : `<div class="rank-avatar rank-avatar--placeholder">🎣</div>`;
    return `
      <a class="rank-row${rankClass(i)}" href="./catches-listing.html" data-angler="${escapeHtml(a.name)}">
        <div class="rank-badge">${rankBadge(i)}</div>
        ${avatarHtml}
        <div class="rank-content">
          <div class="rank-main">${escapeHtml(a.name)}${a.biggestCatch ? pendingBadge(a.biggestCatch.verifiedAt) : ''}</div>
          <div class="rank-meta">${escapeHtml(meta)}</div>
        </div>
        <span class="rank-link">View →</span>
      </a>
    `;
  }).join('');

  el.topAnglersList.querySelectorAll('.rank-row').forEach(row => {
    row.addEventListener('click', () => {
      sessionStorage.setItem('gillbert_filters', JSON.stringify({
        angler: row.dataset.angler, species: '', water: '',
      }));
      sessionStorage.removeItem('gillbert_search');
      sessionStorage.setItem('gillbert_return_to', JSON.stringify({ href: './fish-of-fame.html', label: 'Fish of Fame' }));
    });
  });
}

// ── Load ─────────────────────────────────────────────────────────────────────────────────
async function loadAnglerPhotos() {
  try {
    const res = await fetch(API_BASE + 'get-lookup-data', { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return {};
    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    const anglers = data.anglers || [];
    return Object.fromEntries(
      anglers.filter(a => a.profilePhotoReadUrl).map(a => [a.id, a.profilePhotoReadUrl])
    );
  } catch (err) {
    console.error('Failed to load angler photos:', err);
    return {};
  }
}

async function loadFishOfFame() {
  try {
    showLoading();
    setStatus('');

    const [res, photosById] = await Promise.all([
      fetch(CATCHES_GET_URL, { headers: { 'X-API-Key': API_KEY } }),
      loadAnglerPhotos(),
    ]);

    if (!res.ok) throw new Error(`GET failed: ${res.status}`);

    const data = await res.json();
    const allCatches = Array.isArray(data) ? data : (data.catches || []);

    hideLoading();

    if (!allCatches.length) {
      setStatus('No catches yet — log one to get on the board! 🎣');
      return;
    }

    renderTopCatches(computeTopCatches(allCatches));
    renderFishSpeciesRecords(computeFishSpeciesRecords(allCatches));
    renderTopAnglers(computeTopAnglers(allCatches), photosById);
    el.content.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    hideLoading();
    setStatus('Failed to load the leaderboards ❌');
  }
}

window.addEventListener('DOMContentLoaded', loadFishOfFame);
