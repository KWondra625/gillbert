// Hard water or open water? Sets <html data-water="hard|open"> before the page draws, so
// theme.css picks the right look with no flash. Loaded in <head>, right after settings.js.
//
//   Hard water: November to March (the ice season). Open water: April to October.
// The admin can force either look on this device (Settings → Season) to preview it.
(function () {
  function waterFor(date) {
    const month = date.getMonth(); // 0 = January
    return month >= 10 || month <= 2 ? 'hard' : 'open';
  }

  function currentWater() {
    const override = window.GillbertSettings ? GillbertSettings.get('waterOverride') : 'auto';
    return override === 'hard' || override === 'open' ? override : waterFor(new Date());
  }

  window.GillbertWater = {
    current: currentWater,
    isHard: () => currentWater() === 'hard',
    // Which season a given date falls in (used to match past catches to today's season)
    forDate: waterFor,
    // Re-apply after the admin changes the override
    apply() { document.documentElement.dataset.water = currentWater(); },
  };
  window.GillbertWater.apply();
})();
