// Fallback height sync for browsers that don't support the
// `interactive-widget=resizes-content` viewport meta directive.
// Modern Chromium/Edge/Android honor that meta tag and resize 100dvh
// natively, so this only kicks in via the --app-height max-height guard.
(function () {
  const root = document.documentElement;
  let rafId = null;

  function updateAppHeight() {
    if (rafId !== null) cancelAnimationFrame(rafId);

    rafId = requestAnimationFrame(() => {
      const vv = window.visualViewport;
      // vv.offsetTop accounts for the browser scrolling the visual viewport
      // down to keep the focused input visible above the keyboard — without
      // it, --app-height is set too tall and leaves a gap under the keyboard.
      // Math.max guards against offsetTop ever making the result smaller.
      const viewportHeight = vv ? Math.round(Math.max(vv.height, vv.height + vv.offsetTop)) : window.innerHeight;

      root.style.setProperty('--app-height', viewportHeight + 'px');
      rafId = null;
    });
  }

  updateAppHeight();

  window.addEventListener('resize', updateAppHeight);
  window.addEventListener('orientationchange', updateAppHeight);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
    // offsetTop changes when the browser scrolls the visual viewport to keep
    // the focused input visible — that can happen without a resize event,
    // so this needs its own listener to stay in sync.
    window.visualViewport.addEventListener('scroll', updateAppHeight);
  }
})();
