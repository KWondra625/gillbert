// Shared by bodies-of-water-listing.js and edit-body-of-water.js — mirrors
// species-catches.js exactly, tallying by bodyOfWaterId instead of
// fishSpeciesId. Kept as a separate file rather than generalizing
// species-catches.js, since the two mirror by coincidence of shape, not by
// a shared abstraction either page depends on.

// Fetches every catch and tallies counts per body_of_water_id. Fails soft —
// a fetch error just means catch counts show as 0 rather than blocking
// the whole page.
async function fetchCatchCounts() {
  try {
    const res = await fetch(CATCHES_GET_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) return {};
    const raw = await res.json();
    const catches = (Array.isArray(raw) ? raw : (raw.catches || [])).filter(c => c && c.catchNumber);
    const counts = {};
    catches.forEach(c => {
      counts[c.bodyOfWaterId] = (counts[c.bodyOfWaterId] || 0) + 1;
    });
    return counts;
  } catch (err) {
    console.error('Failed to load catch counts:', err);
    return {};
  }
}

// Pre-selects waterName in catches-listing.html's filter, matching the
// sessionStorage key/shape that page already restores on load. Also carries
// waterId through: unlike fish_species.name (UNIQUE), bodies_of_water.name
// has no unique constraint (Catch Chat can create same-named duplicates),
// so a name-only filter could show a different set than the count this
// link was clicked from — catches-listing.js filters by waterId when
// present, falling back to name-only for the general water dropdown filter
// (which has no id to offer). If returnTo ({href, label}) is given, also
// sets a one-shot return-to context so its back button comes back here
// instead of defaulting to Home.
function goToFilteredCatches(waterId, waterName, returnTo) {
  sessionStorage.setItem('gillbert_filters', JSON.stringify({ angler: '', species: '', water: waterName, waterId }));
  sessionStorage.removeItem('gillbert_search');
  if (returnTo) sessionStorage.setItem('gillbert_return_to', JSON.stringify(returnTo));
  window.location.href = './catches-listing.html';
}
