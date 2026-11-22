// Gillbert's adjustable settings, in one place.
//
// Every page reads a setting through GillbertSettings.get(name). Today the value comes from
// this device's browser storage when the admin has changed it there, otherwise from the
// default below. Later, when the settings move to n8n so everyone sees the admin's choices,
// only this file changes: pages keep calling get().
//
// The Gillbert board tracks that move (one Inbox item per setting that needs the server).
(function () {
  const PREFIX = 'gillbert_setting_';

  const DEFAULTS = {
    // Home page welcome line under the Gillbert wordmark
    welcomeLine: "Our crew's fishing record book.",
    // Remember when? tease lines; one is shown per day, in order
    teaseLines: [
      "C'mon, take the bait. Tap in for the full story",
      'Reel it in for the whole story',
      'Bite on this one: photos, details and the story behind it',
      'Go on, set the hook. The full story is a tap away',
    ],
    // Remember when? "pick another": each bump moves to the next candidate for today
    rememberWhenSkip: 0,
    // 'auto' follows the calendar (hard water November to March); 'hard' / 'open' force a look
    waterOverride: 'auto',
  };

  function read(name) {
    try {
      const raw = localStorage.getItem(PREFIX + name);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  window.GillbertSettings = {
    DEFAULTS,
    get(name) {
      const saved = read(name);
      return saved === undefined ? DEFAULTS[name] : saved;
    },
    // true when this device has its own value instead of the default
    isChanged(name) {
      return read(name) !== undefined;
    },
    set(name, value) {
      try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); } catch { /* storage blocked */ }
    },
    reset(name) {
      try { localStorage.removeItem(PREFIX + name); } catch { /* storage blocked */ }
    },
  };
})();
