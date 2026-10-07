// Gillbert API Configuration
// Shared across all pages — load this script before any page-specific scripts.

// Which n8n server this browser talks to. A per-device test switch, set from
// the admin-only "Server" card on me.html. Anything other than "bridge01"
// (including nothing saved) means the Pi, which is production.
const API_TARGET_STORAGE_KEY = 'gillbert_api_target';
const API_TARGETS = {
  pi:       "https://api.builtbykw.net",
  bridge01: "https://bridge01.builtbykw.net",
};

function readApiTarget() {
  try {
    return localStorage.getItem(API_TARGET_STORAGE_KEY) === 'bridge01' ? 'bridge01' : 'pi';
  } catch {
    return 'pi'; // storage blocked (private mode etc.) — always production
  }
}

const API_TARGET  = readApiTarget();
const IS_BRIDGE01 = API_TARGET === 'bridge01';

const N8N_BASE_URL = API_TARGETS[API_TARGET];
const WEBHOOK_PATH = "/webhook/";
// Each server has its own API keys. Bridge01 tells callers apart by key: the live
// site vs. everything else (Pages previews, local dev). Its third key, direct_connect,
// is for scripts and never ships here.
const API_KEYS = {
  pi:       'ac89c77eaa95002649c596434b2e63eac8cc6694f97cefed6d91f7e0354eabe4',
  bridge01: location.hostname === 'gillbert.builtbykw.net'
    ? '9c1e708d989f0ca31c6a0dbd7da0d7243b61a21ce8fc428b'   // deployed_app
    : '0407ff4ae29ae63255ef397f861d6bc367774262803d968f',  // preview_app
};
const API_KEY = API_KEYS[API_TARGET];

const API_BASE        = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/";
const CATCHES_GET_URL = API_BASE + "get-catches";

const FISH_SPECIES_GET_URL    = API_BASE + "fish-species/get";
const FISH_SPECIES_SAVE_URL = API_BASE + "fish-species/save";

const BODIES_OF_WATER_GET_URL        = API_BASE + "bodies-of-water/get";
const BODIES_OF_WATER_SAVE_URL       = API_BASE + "bodies-of-water/save";
const BODIES_OF_WATER_DNR_SEARCH_URL = API_BASE + "bodies-of-water/dnr-search";

const ANGLERS_GET_URL  = API_BASE + "anglers/get";
const ANGLERS_SAVE_URL = API_BASE + "anglers/save";

// Banner on every page while this device is pointed at vps-bridge01, so it's
// never mistaken for production. Tapping it opens the Server card on me.html.
// It's a fixed strip with space reserved above the page, so it works the same
// whatever layout the page's <body> uses (many centre their content with flex).
function showBridge01Banner() {
  if (!IS_BRIDGE01 || document.getElementById('bridge01Banner')) return;

  const style = document.createElement('style');
  style.textContent = `
    .bridge01-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      display: block;
      padding: 9px 14px;
      padding-top: max(9px, env(safe-area-inset-top));
      background: #ffb020;
      border-bottom: 2px solid #c77700;
      color: #3d2500;
      font: 700 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center;
      text-decoration: none;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    }

    /* Chat pages are a fixed-height column, so the banner sits in the flow
       there instead, and the chat shrinks to fit below it. */
    body:has(> .chat-page):has(> .bridge01-banner) {
      display: flex;
      flex-direction: column;
    }
    body:has(> .chat-page) > .bridge01-banner {
      position: static;
      flex-shrink: 0;
    }
    body:has(> .bridge01-banner) > .chat-page {
      flex: 1 1 auto;
      height: auto;
      min-height: 0;
    }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('a');
  banner.id = 'bridge01Banner';
  banner.className = 'bridge01-banner';
  banner.href = './me.html#serverCard';
  banner.textContent = "⚠️ Connected to vps-bridge01. Production data doesn't live here, yet.";
  document.body.prepend(banner);

  if (document.querySelector('body > .chat-page')) return;

  // Push the page down by the banner's height (it wraps to two lines on narrow
  // phones), on top of whatever top padding the page already has.
  const basePadding = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  const reserveSpace = () => {
    document.body.style.paddingTop = `${basePadding + banner.offsetHeight}px`;
  };
  reserveSpace();
  window.addEventListener('resize', reserveSpace);
}

document.addEventListener('DOMContentLoaded', showBridge01Banner);
