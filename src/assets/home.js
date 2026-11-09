// Home page: the "On the line" ticker (the latest catches) and "Remember when?".
// The ticker and Remember when read the same catch list Browse Catches uses, plus the
// anglers (for photos) and, for the day's pick, that catch's media. No other server calls.
const HOME_CATCHES_URL = API_BASE + 'get-catches';
const HOME_LOOKUP_URL = API_BASE + 'get-lookup-data';
const HOME_MEDIA_URL = API_BASE + 'catch-media/get';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKER_COUNT = 5;
const REMEMBER_MIN_AGE_MS = 30 * DAY_MS;   // too recent to be a "remember when"
const SAME_WEEK_DAYS = 3;                  // "this week in an earlier year" = within 3 days of today's date
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function apiGet(url) {
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function catchUrl(c) {
  return `./catch-details.html?catchNumber=${encodeURIComponent(c.catchNumber)}&from=home`;
}

function catchLabel(c) {
  const species = c.fishSpeciesName || 'fish';
  return c.length ? `${Number(c.length)}" ${species}` : species;
}

function agoShort(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

function agoLong(ms) {
  const days = Math.floor(ms / DAY_MS);
  if (days < 1) return agoShort(ms) + ' ago';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

// Angler photo, or their initials on their color (avatar.js, shared with Browse Catches)
function avatarHtml(angler, name) {
  return GillbertAvatar.html(angler, name);
}

// ── Hero: tap the flag (or bobber) to see it again ──────────────────────────
function setupHeroReplay() {
  const art = document.getElementById('heroArt');
  art.addEventListener('click', () => {
    art.querySelectorAll('svg').forEach(svg => {
      svg.classList.add('replay');
      void svg.getBoundingClientRect(); // restart the CSS animation
      svg.classList.remove('replay');
    });
  });
}

// ── On the line ─────────────────────────────────────────────────────────────
function renderTicker(catches, anglersById, now) {
  const logged = catches
    .filter(c => c.createdAt && c.catchNumber)
    .map(c => ({ c, at: new Date(c.createdAt).getTime() }))
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => b.at - a.at);
  if (!logged.length) return;

  // The latest catches, whenever they were logged: "2h" for today's, "3 days ago" for older ones
  const shown = logged.slice(0, TICKER_COUNT);
  const age = ms => (ms < DAY_MS ? agoShort(ms) : agoLong(ms));

  const item = ({ c, at }, copy) => `<a class="tk" href="${catchUrl(c)}"${copy ? ' tabindex="-1" aria-hidden="true"' : ''}>`
    + `${avatarHtml(anglersById[c.anglerId], c.anglerName)}<b>${escapeHtml(c.anglerName || 'Someone')}</b> `
    + `${escapeHtml(catchLabel(c))} <small>· ${escapeHtml(age(now - at))}</small></a>`;
  // Each set ends with a small orange bar, so you can see where the latest catches start over
  const set = copy => shown.map(x => item(x, copy)).join('') + '<span class="tk-sep" aria-hidden="true"></span>';

  // Two copies side by side, so the crawl loops without a gap; the second is for the eye only
  document.getElementById('tickerRun').innerHTML =
    `<span class="tk-set" style="display:contents">${set(false)}</span>`
    + `<span class="tk-set" style="display:contents" aria-hidden="true">${set(true)}</span>`;
  document.getElementById('ticker').hidden = false;
  document.body.classList.add('has-ticker');
}

// ── Remember when? ──────────────────────────────────────────────────────────
function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY_MS);
}

// Small, stable string hash: the same day gives everyone the same pick
function hash(text) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pickRememberWhen(catches, today) {
  const todayDoy = dayOfYear(today);
  const water = GillbertWater.current();
  const old = catches
    .filter(c => c.caughtWhen && c.catchNumber)
    .map(c => ({ c, when: new Date(c.caughtWhen) }))
    .filter(x => Number.isFinite(x.when.getTime()) && today - x.when >= REMEMBER_MIN_AGE_MS)
    .sort((a, b) => a.c.id - b.c.id);

  const sameWeek = x => {
    if (x.when.getFullYear() >= today.getFullYear()) return false;
    const diff = Math.abs(dayOfYear(x.when) - todayDoy);
    return Math.min(diff, 365 - diff) <= SAME_WEEK_DAYS;
  };
  const sameSeason = x => GillbertWater.forDate(x.when) === water;
  const hasMedia = x => Number(x.c.catchMediaCount) > 0;

  // Best first: this week in an earlier year, then the same season, then anything;
  // within each, catches with photos or videos first.
  const tiers = [
    { list: old.filter(x => sameWeek(x) && hasMedia(x)), week: true },
    { list: old.filter(sameWeek), week: true },
    { list: old.filter(x => sameSeason(x) && hasMedia(x)) },
    { list: old.filter(sameSeason) },
    { list: old.filter(hasMedia) },
    { list: old },
  ];
  const tier = tiers.find(t => t.list.length);
  if (!tier) return null;

  const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const skip = Number(GillbertSettings.get('rememberWhenSkip')) || 0;
  const pick = tier.list[(hash(dayKey) + skip) % tier.list.length];
  return { ...pick, week: !!tier.week };
}

function renderRememberWhen(pick, anglersById, today) {
  const { c, when, week } = pick;
  // Whole years between the two dates (calendar years overstate it across New Year)
  const years = Math.max(1, Math.round((today - when) / (365.25 * DAY_MS)));
  const whenText = week
    ? `This week, ${years} year${years === 1 ? '' : 's'} ago`
    : `Back in ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
  const date = `${MONTHS[when.getMonth()].slice(0, 3)} ${when.getDate()}, ${when.getFullYear()}`;
  const what = [c.fishSpeciesName, c.bodyOfWaterName && `on ${c.bodyOfWaterName}`].filter(Boolean).join(' ');
  const lines = GillbertSettings.get('teaseLines');
  const tease = Array.isArray(lines) && lines.length ? lines[dayOfYear(today) % lines.length] : 'Tap in for the full story';

  const card = document.getElementById('rememberWhen');
  card.href = catchUrl(c);
  card.classList.add('no-photo');
  card.innerHTML = `
    <div class="rw-body">
      <div class="rw-eyebrow">Remember when? <span class="rw-when">${escapeHtml(whenText)}</span></div>
      <div class="rw-who">${avatarHtml(anglersById[c.anglerId], c.anglerName)}${escapeHtml(c.anglerName || 'Someone')}</div>
      <div class="rw-what">${escapeHtml(what ? `${what} · ${date}` : date)}</div>
      <div class="rw-tease"><span>${escapeHtml(tease)}</span><em aria-hidden="true">›</em></div>
    </div>`;
  card.setAttribute('aria-label', `Remember when? ${c.anglerName || 'Someone'}, ${what || 'a catch'}, ${date}. ${tease}`);
  card.hidden = false;
  return card;
}

async function addRememberPhoto(card, c) {
  if (!(Number(c.catchMediaCount) > 0)) return;
  try {
    const items = await apiGet(`${HOME_MEDIA_URL}?catchNumber=${encodeURIComponent(c.catchNumber)}`);
    // Not HEIC: most browsers can't show it (Catch Details offers those as a download)
    const photo = (Array.isArray(items) ? items : []).find(m => m.mediaType === 'Photo' && m.readUrl
      && m.contentType !== 'image/heic'
      && (m.displayStatus || m.status || 'complete') === 'complete');
    if (!photo) return;
    const img = document.createElement('img');
    img.className = 'rw-photo';
    img.alt = '';
    // A photo that won't load leaves the card as it was, not a broken image
    img.onerror = () => { img.remove(); card.classList.add('no-photo'); };
    img.src = encodeURI(photo.readUrl);
    card.classList.remove('no-photo');
    card.prepend(img);
  } catch (err) {
    console.warn('Remember when: no photo', err);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
async function loadHomeData() {
  const [catchesRaw, lookupRaw] = await Promise.all([
    apiGet(HOME_CATCHES_URL),
    apiGet(HOME_LOOKUP_URL).catch(() => null),
  ]);
  const catches = Array.isArray(catchesRaw) ? catchesRaw : (catchesRaw?.catches || []);
  const lookup = Array.isArray(lookupRaw) ? lookupRaw[0] : lookupRaw;
  const anglersById = Object.fromEntries((lookup?.anglers || []).map(a => [a.id, a]));

  const now = new Date();
  renderTicker(catches, anglersById, now.getTime());
  const pick = pickRememberWhen(catches, now);
  if (pick) addRememberPhoto(renderRememberWhen(pick, anglersById, now), pick.c);
}

window.addEventListener('DOMContentLoaded', () => {
  const welcome = GillbertSettings.get('welcomeLine');
  if (welcome) document.getElementById('welcomeLine').textContent = welcome;
  setupHeroReplay();
  loadHomeData().catch(err => console.warn('Home: catches unavailable', err));
});
