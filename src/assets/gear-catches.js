// A tip-up page's "View Catches" link: opens the catches list filtered to that tip-up, the same
// way the Angler, Water and Species pages do (water-catches.js): catches-listing.html restores
// gillbert_filters on load. The list matches on caughtOn.gearId and shows the name on its chip.
// returnTo ({href, label}) sets the one-shot back link to come back to the tip-up.
function goToGearCatches(gearId, gearName, returnTo) {
  sessionStorage.setItem('gillbert_filters', JSON.stringify({
    angler: '', species: '', water: '', waterId: null, group: '', gearId: Number(gearId), gearName, pendingOnly: false,
  }));
  sessionStorage.removeItem('gillbert_search');
  if (returnTo) sessionStorage.setItem('gillbert_return_to', JSON.stringify(returnTo));
  window.location.href = './catches-listing.html';
}
