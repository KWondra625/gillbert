// The top bar on every page: "Gillbert" on the left (tap = home) and the shack / tackle box
// menu on the right, plus an optional "‹ Parent" link under the bar.
//
// Each page has <header class="topbar" id="topbar"></header> with this script straight after
// it, so the bar is filled in before the page first draws. A page whose way back isn't Home
// says so on the header (data-back-href, data-back-label), or sets it later from its own
// script with GillbertTopbar.setBack(href, label).
//
// The home page has its own big header; it holds <div id="shackMount"></div> instead, and
// gets just the shack button and its menu. The menu is the same everywhere: this file is
// the only copy. The admin tray stays hidden until admin.js reveals #adminSection.
(function () {
  const HUB_ICON = '<svg class="hard-only" viewBox="0 0 24 24"><path d="M1.8 20.2h20.4"/><path d="M3.6 9.2Q12 3.6 20.4 9.2"/><path d="M3.6 9.2Q6.2 10.9 8.7 10.7H15.3Q17.8 10.9 20.4 9.2"/><path d="M3.6 9.2Q2.6 14.6 2.1 20.2M20.4 9.2Q21.4 14.6 21.9 20.2"/><path d="M8.7 10.7V20.2M15.3 10.7V20.2"/><path d="M10.4 20.2V14.6a1.6 1.6 0 0 1 3.2 0v5.6"/><path d="M4.9 12.8h2v2h-2z"/></svg>';
  const BOX_ICON = '<svg class="open-only" viewBox="0 0 24 24"><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18"/><rect x="10.5" y="10.5" width="3" height="3" rx=".6" class="latch"/></svg>';

  const SHACK_HTML = `
    <button type="button" class="shack-btn" id="shackOpen" aria-haspopup="dialog" aria-expanded="false" aria-controls="shack">
      <span class="shack-btn-ico" aria-hidden="true">${HUB_ICON}${BOX_ICON}</span>
      <span class="hard-only">The shack</span><span class="open-only">Tackle box</span>
    </button>
    <div class="shack-scrim" id="shackScrim"></div>
    <div class="shack" id="shack" role="dialog" aria-modal="true" aria-labelledby="shackTitle" inert>
      <div class="shack-head">
        <span class="shack-lid" aria-hidden="true">${HUB_ICON}${BOX_ICON}</span>
        <div>
          <h2 id="shackTitle"><span class="hard-only">The ice shack</span><span class="open-only">Tackle box</span></h2>
          <p><span class="hard-only">Come on in, the heater's going</span><span class="open-only">Everything else lives in here</span></p>
        </div>
        <button type="button" class="shack-close" id="shackClose" aria-label="Close">&times;</button>
      </div>
      <div class="tray">
        <div class="tray-label">Your setup</div>
        <a href="./notifications.html"><span class="tray-ico">🔔</span><span><b>Catch notifications</b><span>Get a buzz when someone logs a catch</span></span></a>
        <a href="./me.html"><span class="tray-ico">👤</span><span><b>My profile</b><span>Your photo and login</span></span></a>
      </div>
      <div class="tray">
        <div class="tray-label">About Gillbert</div>
        <a href="./whats-new.html"><span class="tray-ico">✨</span><span><b>What's new</b><span>The story so far</span></span></a>
        <a href="./features-functionality.html"><span class="tray-ico">🧰</span><span><b>Features &amp; how-to</b><span>Everything Gillbert can do</span></span></a>
      </div>
      <div class="tray tray-admin hidden" id="adminSection">
        <div class="tray-label">🔧 Admin · only you see this</div>
        <div class="hidden" id="adminSectionGrid">
          <a href="./anglers-listing.html"><span class="tray-ico">🎣</span><span><b>Anglers</b><span>Records, aliases and logins</span></span></a>
          <a href="./bodies-of-water-listing.html"><span class="tray-ico">💧</span><span><b>Bodies of water</b><span>Lakes and their DNR links</span></span></a>
          <a href="./fish-species-listing.html"><span class="tray-ico">🐟</span><span><b>Fish species</b><span>Names and DNR details</span></span></a>
          <a href="./media-activity.html"><span class="tray-ico">🗂️</span><span><b>Media activity</b><span>Uploads, retries and stray files</span></span></a>
          <a href="./under-the-hood.html"><span class="tray-ico">🏗️</span><span><b>Under the hood</b><span>Servers and versions</span></span></a>
          <a href="./settings.html"><span class="tray-ico">⚙️</span><span><b>Settings</b><span>Season, welcome line, Remember when</span></span></a>
        </div>
      </div>
    </div>`;

  const bar = document.getElementById('topbar');
  const mount = document.getElementById('shackMount');
  let back = null;

  if (bar) {
    // A small house before the name says "this goes home" without making it a button
    bar.innerHTML = '<a class="topbar-brand" href="./index.html" aria-label="Gillbert home">'
      + '<svg class="topbar-home" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/></svg>'
      + 'Gillbert</a>' + SHACK_HTML;
    back = document.createElement('a');
    back.className = 'topbar-back';
    back.id = 'topbarBack';
    back.hidden = true;
    bar.after(back);
  } else if (mount) {
    mount.outerHTML = SHACK_HTML;
  } else {
    return;
  }

  // Shows "‹ label" under the bar, going to href. No label (or Home) hides it: the
  // wordmark already goes home.
  function setBack(href, label) {
    if (!back) return;
    const isHome = !href || /(^|\/)index\.html$/.test(href);
    back.hidden = isHome || !label;
    if (back.hidden) return;
    back.href = href;
    back.textContent = `‹ ${label}`;
    back.setAttribute('aria-label', `Back to ${label}`);
  }

  if (bar && bar.dataset.backHref) setBack(bar.dataset.backHref, bar.dataset.backLabel);

  // ── Open and close: a sheet from the bottom on phones, a drop-down on wide screens ──
  const openBtn = document.getElementById('shackOpen');
  const shack = document.getElementById('shack');
  const scrim = document.getElementById('shackScrim');
  const closeBtn = document.getElementById('shackClose');

  const open = () => {
    document.body.classList.add('shack-open');
    shack.inert = false;
    openBtn.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  };
  const close = () => {
    if (!document.body.classList.contains('shack-open')) return;
    document.body.classList.remove('shack-open');
    shack.inert = true;
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.focus();
  };

  openBtn.addEventListener('click', () => (document.body.classList.contains('shack-open') ? close() : open()));
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  window.GillbertTopbar = { setBack };
})();
