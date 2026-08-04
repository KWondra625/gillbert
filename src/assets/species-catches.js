// Shared by fish-species-listing.js and edit-fish-species.js — both need to
// tally catch counts per species and jump to a pre-filtered catches-listing
// view. Extracted here rather than duplicated, since both copies would need
// to change in lockstep if the catches API response shape ever changes.

// Fetches every catch and tallies counts per fish_species_id. Fails soft —
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
      counts[c.fishSpeciesId] = (counts[c.fishSpeciesId] || 0) + 1;
    });
    return counts;
  } catch (err) {
    console.error('Failed to load catch counts:', err);
    return {};
  }
}

// Pre-selects speciesName in catches-listing.html's filter, matching the
// sessionStorage key/shape that page already restores on load. If returnTo
// ({href, label}) is given, also sets a one-shot return-to context so its
// back button comes back here instead of defaulting to Home.
function goToFilteredCatches(speciesName, returnTo) {
  sessionStorage.setItem('gillbert_filters', JSON.stringify({ angler: '', species: speciesName, water: '' }));
  sessionStorage.removeItem('gillbert_search');
  if (returnTo) sessionStorage.setItem('gillbert_return_to', JSON.stringify(returnTo));
  window.location.href = './catches-listing.html';
}
