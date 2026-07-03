(function () {
  const root = document.documentElement;

  function updateAppHeight() {
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    root.style.setProperty('--app-height', Math.round(viewportHeight) + 'px');
  }

  updateAppHeight();

  window.addEventListener('resize', updateAppHeight);
  window.addEventListener('orientationchange', updateAppHeight);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
    window.visualViewport.addEventListener('scroll', updateAppHeight);
  }
})();
