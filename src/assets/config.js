// Gillbert API Configuration
// Shared across all pages — load this script before any page-specific scripts.

// Where this copy of the site runs decides which n8n server it talks to: the live
// site uses production (vps-bridge01); everything else uses Staging (the Pi, lab01).
const PRODUCTION_HOSTNAME = 'gillbert.builtbykw.net';
const DEVELOP_HOSTNAME    = 'develop.gillbert.builtbykw.net';

// 'production' | 'develop' | 'preview' (Cloudflare Pages branch builds) | 'local'
const SITE_KIND =
  location.hostname === PRODUCTION_HOSTNAME ? 'production'
  : location.hostname === DEVELOP_HOSTNAME ? 'develop'
  : (location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) ? 'local'
  : 'preview';
const IS_PRODUCTION = SITE_KIND === 'production';

const API_SERVERS = {
  production: "https://bridge01.builtbykw.net",
  staging:    "https://lab01.builtbykw.net",
};
const N8N_BASE_URL = IS_PRODUCTION ? API_SERVERS.production : API_SERVERS.staging;
const WEBHOOK_PATH = "/webhook/";

// Each server has its own API keys and tells callers apart by name: deployed_app for
// a stable site (the live one on production, develop.gillbert on Staging), preview_app
// for previews and local copies. direct_connect is for scripts and never ships here.
const API_KEYS = {
  production: {
    deployed_app: '9c1e708d989f0ca31c6a0dbd7da0d7243b61a21ce8fc428b',
  },
  staging: {
    deployed_app: '61f997a833437066630ddb6390f5fa7f798d379a401a9962',  
    preview_app:  '6e8e1ffa5ab6935ab875215806cf250815c7079103f8bee8',   
  },
};
// The name the server knows this key by; the admin Under the Hood page checks it.
const API_KEY_NAME = (SITE_KIND === 'production' || SITE_KIND === 'develop') ? 'deployed_app' : 'preview_app';
const API_KEY = API_KEYS[IS_PRODUCTION ? 'production' : 'staging'][API_KEY_NAME];

const API_BASE        = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/";
const CATCHES_GET_URL = API_BASE + "get-catches";

const FISH_SPECIES_GET_URL    = API_BASE + "fish-species/get";
const FISH_SPECIES_SAVE_URL = API_BASE + "fish-species/save";

const BODIES_OF_WATER_GET_URL        = API_BASE + "bodies-of-water/get";
const BODIES_OF_WATER_SAVE_URL       = API_BASE + "bodies-of-water/save";
const BODIES_OF_WATER_DNR_SEARCH_URL = API_BASE + "bodies-of-water/dnr-search";

const ANGLERS_GET_URL  = API_BASE + "anglers/get";
const ANGLERS_SAVE_URL = API_BASE + "anglers/save";

// Banner on every page of every non-production copy of the site, so it's never
// mistaken for the live one. It says which kind of copy this is; tapping it opens
// the admin Under the Hood page. It's a fixed strip with space reserved above the
// page, so it works the same whatever layout the page's <body> uses (many centre
// their content with flex).
// Names the site first, then whose data it uses. The server name comes from the
// address this page actually calls, so the two can't disagree.
const ENV_BANNER_SITE = {
  develop: "🧪 Develop site",
  preview: "🧪 Preview build",
  local:   "💻 Local copy",
};
const ENV_BANNER_TEXT = Object.fromEntries(Object.entries(ENV_BANNER_SITE).map(([kind, site]) =>
  [kind, `${site} · Staging data (${new URL(N8N_BASE_URL).hostname.split('.')[0]})`]));

function showEnvironmentBanner() {
  if (IS_PRODUCTION || document.getElementById('envBanner')) return;

  const style = document.createElement('style');
  style.textContent = `
    .env-banner {
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
    .env-banner--local {
      background: #7cc4ff;
      border-bottom-color: #2b7fc4;
      color: #08263f;
    }

    /* Chat pages are a fixed-height column, so the banner sits in the flow
       there instead, and the chat shrinks to fit below it. */
    body:has(> .chat-page):has(> .env-banner) {
      display: flex;
      flex-direction: column;
    }
    body:has(> .chat-page) > .env-banner {
      position: static;
      flex-shrink: 0;
    }
    body:has(> .env-banner) > .chat-page {
      flex: 1 1 auto;
      height: auto;
      min-height: 0;
    }
  `;
  document.head.appendChild(style);

  // An <a> with no href is plain text; it only becomes a link for admins (admin.js),
  // since Under the Hood is admin-only. The Cloudflare login check can finish after load.
  const banner = document.createElement('a');
  banner.id = 'envBanner';
  banner.className = `env-banner env-banner--${SITE_KIND}`;
  banner.textContent = ENV_BANNER_TEXT[SITE_KIND];
  document.body.prepend(banner);
  if (typeof isAdminUnlocked === 'function') {
    Promise.resolve(window.adminIdentityCheck).then(() => {
      if (isAdminUnlocked()) banner.href = './under-the-hood.html';
    });
  }

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

document.addEventListener('DOMContentLoaded', showEnvironmentBanner);
