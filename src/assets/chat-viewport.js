(function () {
  const root = document.documentElement;
  let rafId = null;

  function updateAppHeight() {
    if (rafId !== null) cancelAnimationFrame(rafId);

    rafId = requestAnimationFrame(() => {
      const vv = window.visualViewport;
      const viewportHeight = vv
        ? Math.round(Math.max(vv.height, vv.height + vv.offsetTop))
        : window.innerHeight;

      root.style.setProperty('--app-height', viewportHeight + 'px');
      rafId = null;
    });
  }

  updateAppHeight();

  window.addEventListener('resize', updateAppHeight);
  window.addEventListener('orientationchange', updateAppHeight);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
    window.visualViewport.addEventListener('scroll', updateAppHeight);
  }
})();
