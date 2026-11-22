// An angler's face, the same on every page: their profile photo, or their initials on a
// color picked from their id, so each angler keeps one color everywhere (home page ticker
// and Remember when, Browse Catches, Catch Details).
(function () {
  const COLORS = ['#2f6b47', '#8a4fbf', '#c2552c', '#1f7fd1', '#9a7a12', '#b0386a', '#3d7f86'];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // angler: { id, profilePhotoReadUrl } or null; name: the name to take initials from;
  // className: the class for the <img> or <span> (each page sizes it)
  function html(angler, name, className = 'avatar') {
    if (angler && angler.profilePhotoReadUrl) {
      return `<img class="${className}" src="${encodeURI(angler.profilePhotoReadUrl)}" alt="">`;
    }
    const initials = String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const color = COLORS[Math.abs(Number(angler?.id) || initials.charCodeAt(0)) % COLORS.length];
    return `<span class="${className}" style="background:${color}" aria-hidden="true">${esc(initials)}</span>`;
  }

  window.GillbertAvatar = { html };
})();
