// Shared by anglers-listing.js and edit-angler.js — computes per-angler
// catch stats (count, biggest catch, last catch) client-side from the full
// catch list. No dedicated stats endpoint/view needed: fish-of-fame.js
// already computes its leaderboard the same way from CATCHES_GET_URL, so
// this mirrors that rather than introducing a second source of truth.
async function fetchAnglerStats() {
  try {
    const res = await fetch(CATCHES_GET_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return {};
    const raw = await res.json();
    const catches = (Array.isArray(raw) ? raw : (raw.catches || [])).filter(c => c && c.catchNumber);

    const stats = {};
    catches.forEach(c => {
      const id = c.anglerId;
      if (id == null) return;
      if (!stats[id]) stats[id] = { count: 0, biggestCatch: null, lastCatch: null };
      const entry = stats[id];
      entry.count += 1;

      const length = (c.length != null && c.length !== '') ? Number(c.length) : null;
      if (length != null && (entry.biggestCatch == null || length > Number(entry.biggestCatch.length))) {
        entry.biggestCatch = c;
      }

      if (c.caughtWhen && (!entry.lastCatch || new Date(c.caughtWhen) > new Date(entry.lastCatch.caughtWhen))) {
        entry.lastCatch = c;
      }
    });
    return stats;
  } catch (err) {
    console.error('Failed to load angler stats:', err);
    return {};
  }
}

// Pre-selects anglerName in catches-listing.html's filter, matching the
// sessionStorage key/shape that page already restores on load. Name-only,
// same as species-catches.js — anglers.name has no unique constraint today
// (unlike fish_species), but Kurt confirmed duplicate angler names aren't a
// real scenario yet. If that changes, this needs the same id-based filter
// water-catches.js added once bodies_of_water hit the same gap for real.
// If returnTo ({href, label}) is given, also sets a one-shot return-to
// context so its back button comes back here instead of defaulting to Home.
function goToFilteredCatches(anglerName, returnTo) {
  sessionStorage.setItem('gillbert_filters', JSON.stringify({ angler: anglerName, species: '', water: '' }));
  sessionStorage.removeItem('gillbert_search');
  if (returnTo) sessionStorage.setItem('gillbert_return_to', JSON.stringify(returnTo));
  window.location.href = './catches-listing.html';
}
