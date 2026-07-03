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
      const viewportHeight = vv ? Math.round(vv.height) : window.innerHeight;

      root.style.setProperty('--app-height', viewportHeight + 'px');
      rafId = null;
    });
  }

  updateAppHeight();

  window.addEventListener('resize', updateAppHeight);
  window.addEventListener('orientationchange', updateAppHeight);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
  }
})();
