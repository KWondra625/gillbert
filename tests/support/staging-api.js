// Direct calls to the Staging API, for tests that need to know what the data
// looks like (or set it up) without going through a page. It uses the site's own
// config.js as a local copy would, so it calls the same server with the same key.
const { site } = require('./site-config');

const config = { N8N_BASE_URL: site.N8N_BASE_URL, API_BASE: site.API_BASE, API_KEY: site.API_KEY };

async function apiGet(endpoint) {
  const res = await fetch(config.API_BASE + endpoint, { headers: { 'X-API-Key': config.API_KEY } });
  if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
  return res.json();
}

async function getCatches() {
  const data = await apiGet('get-catches');
  return (Array.isArray(data) ? data : (data.catches || [])).filter(c => c && c.catchNumber);
}

async function getLookups() {
  const raw = await apiGet('get-lookup-data');
  return Array.isArray(raw) ? raw[0] : raw;
}

// A catch's media. Like get-catches, the API answers "none" with one all-null
// placeholder row, so rows without an id are dropped.
async function getCatchMedia(catchNumber) {
  const data = await apiGet(`catch-media/get?catchNumber=${encodeURIComponent(catchNumber)}`);
  return (Array.isArray(data) ? data : data.media || []).filter(m => m && m.id);
}

module.exports = { config, apiGet, getCatches, getLookups, getCatchMedia };
