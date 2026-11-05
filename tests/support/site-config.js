// The site's own config.js, evaluated the way a local copy of the site sees it. The
// tests take every server name from here rather than spelling any out themselves.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSiteConfig() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'assets', 'config.js'), 'utf8');
  const sandbox = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    document: { addEventListener() {} },
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;this.__cfg = { N8N_BASE_URL, API_BASE, API_KEY, API_SERVERS, PRODUCTION_HOSTNAME };`, sandbox);
  return sandbox.__cfg;
}

const site = loadSiteConfig();
const STAGING_HOST = new URL(site.API_SERVERS.staging).hostname;
// The production API server and the live site.
const PRODUCTION_HOSTS = [new URL(site.API_SERVERS.production).hostname, site.PRODUCTION_HOSTNAME];

if (new URL(site.N8N_BASE_URL).hostname !== STAGING_HOST) {
  throw new Error(`Refusing to run: config.js points a local copy at ${site.N8N_BASE_URL}, not Staging`);
}

// Optional local settings (tests/.env, git-ignored): KEY=value lines. Real environment
// variables win over the file.
function loadEnvFile() {
  const file = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

module.exports = { site, STAGING_HOST, PRODUCTION_HOSTS };
