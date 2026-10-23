// Under the Hood: admin-only diagnostics. Shows what this browser thinks it's talking to
// (from config.js and version.js) next to what the server says about itself, and checks
// that the two agree.

const SYSTEM_INFO_URL = API_BASE + "system-info";
const PRODUCTION_HOSTNAME = 'gillbert.builtbykw.net';
const REPO_COMMIT_URL = 'https://github.com/KWondra625/Gillbert/commit/';

const STATE_IDS = ['loadingState', 'errorState', 'detailsState'];

const el = {
  errorMsg:     document.getElementById('errorMsg'),
  retryBtn:     document.getElementById('retryBtn'),
  refreshBtn:   document.getElementById('refreshBtn'),
  verdict:      document.getElementById('verdict'),
  checksList:   document.getElementById('checksList'),
  siteList:     document.getElementById('siteList'),
  serverList:   document.getElementById('serverList'),
  databaseList: document.getElementById('databaseList'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function showState(stateId) {
  STATE_IDS.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}

function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Rows are [label, html]. Values are escaped by the caller (some are links).
function renderList(dl, rows) {
  dl.innerHTML = rows.map(([label, html]) => `
    <div class="info-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${html ?? '<span class="muted">unknown</span>'}</dd>
    </div>`).join('');
}

const text = value => (value === null || value === undefined || value === '') ? null : escapeHtml(value);
const code = value => text(value) && `<code>${text(value)}</code>`;

// ── What this site expects ─────────────────────────────────────────────

function expectedEnvironment() {
  return location.hostname === PRODUCTION_HOSTNAME ? 'production' : 'staging';
}

function versionLabel(b) {
  if (!b) return null;
  return `v${b.major ?? '?'}.${b.build ?? '?'}`;
}

function renderSite() {
  const b = window.GILLBERT_BUILD;
  const commit = b && b.commit
    ? `<a href="${REPO_COMMIT_URL}${encodeURIComponent(b.commit)}" target="_blank" rel="noopener"><code>${escapeHtml(b.commit.slice(0, 7))}</code></a>`
    : null;

  // A local copy has no deploy info, so it gets one row instead of four "unknown"s.
  const versionRows = b
    ? [
        ['Code version', text(versionLabel(b))],
        ['Branch', code(b.branch)],
        ['Commit', commit],
        ['Deployed', text(formatDateTime(b.deployedAt))],
      ]
    : [['Code version', '<span class="muted">local copy, no deploy info</span>']];

  renderList(el.siteList, [
    ['Site', code(location.hostname)],
    ['Expects', text(expectedEnvironment())],
    ...versionRows,
    ['API server', code(new URL(N8N_BASE_URL).hostname)],
    ['API key', API_KEY_NAME ? code(API_KEY_NAME) : '<span class="muted">unnamed (Pi)</span>'],
  ]);
}

// ── What the server says ───────────────────────────────────────────────

function renderServer(s) {
  renderList(el.serverList, [
    ['Hostname', code(s.host)],
    ['Environment', text(s.environment)],
    ['Time zone', text(s.timezone)],
    ['Media storage', code(s.storageAccount)],
    ['Key seen as', code(s.apiClient)],
    ['Answered at', text(formatDateTime(s.checkedAt))],
  ]);
}

function renderDatabase(d) {
  const c = d.counts || {};
  const latest = d.latestCatch && d.latestCatch.catchNumber
    ? `<a href="./catch-details.html?catchNumber=${encodeURIComponent(d.latestCatch.catchNumber)}">${escapeHtml(d.latestCatch.catchNumber)}</a>, logged ${escapeHtml(formatDateTime(d.latestCatch.createdAt) || '')}`
    : null;

  renderList(el.databaseList, [
    ['Database', code(d.name)],
    ['Signed in as', code(d.user)],
    ['Latest catch', latest],
    ['Catches', text(c.catches)],
    ['Media files', text(c.media)],
    ['Anglers', text(c.anglers)],
    ['Fish species', text(c.fishSpecies)],
    ['Bodies of water', text(c.bodiesOfWater)],
  ]);
}

// ── Checks ─────────────────────────────────────────────────────────────

function runChecks(server) {
  const expected = expectedEnvironment();
  const apiHost = new URL(N8N_BASE_URL).hostname;
  const checks = [
    {
      label: 'Environment',
      pass: server.environment === expected,
      detail: `site expects ${expected}, server is ${server.environment || 'unknown'}`,
    },
    {
      label: 'Server',
      pass: server.host === apiHost,
      detail: `site calls ${apiHost}, server is ${server.host || 'unknown'}`,
    },
  ];
  // The Pi's keys have no names, so there's nothing to compare there.
  if (API_KEY_NAME) {
    checks.push({
      label: 'API key',
      pass: server.apiClient === API_KEY_NAME,
      detail: `site sends ${API_KEY_NAME}, server saw ${server.apiClient || 'unknown'}`,
    });
  }
  return checks;
}

function renderChecks(checks, server) {
  renderList(el.checksList, checks.map(c => [
    c.label,
    `${c.pass ? '✅' : '❌'} ${escapeHtml(c.detail)}`,
  ]));

  const allPass = checks.every(c => c.pass);
  el.verdict.className = `verdict ${allPass ? 'verdict--pass' : 'verdict--fail'}`;
  el.verdict.innerHTML = allPass
    ? `✅ All good: <strong>${escapeHtml(server.environment)}</strong> on <code>${escapeHtml(server.host)}</code>`
    : `❌ Mismatch: check the details below before logging anything`;
}

// ── Server switch ──────────────────────────────────────────────────────
// Per-device switch between production (the Pi) and vps-bridge01 (test data).
// Admins only, but always shown while on vps-bridge01, so a device can get back
// to production even after admin mode expires.

function renderServerSwitch() {
  const servers = [
    { key: 'pi',       name: '🏠 Home Pi5',     note: 'Production. Where everyone else is.' },
    { key: 'bridge01', name: '🧪 vps-bridge01', note: "Test data and staging media." },
  ];
  document.getElementById('serverSwitchContent').innerHTML = `
    <div class="server-options">
      ${servers.map(s => {
        const current = s.key === API_TARGET;
        return `<button type="button" class="server-option${current ? ' server-option--current' : ''}${s.key === 'bridge01' ? ' server-option--test' : ''}" data-server="${s.key}"${current ? ' aria-current="true"' : ''}>
          <strong>${s.name}${current ? ' ✓' : ''}</strong>
          <span>${s.note}</span>
        </button>`;
      }).join('')}
    </div>
    <p class="field-hint" id="serverHint">Applies to this device only.</p>
  `;
  document.querySelectorAll('.server-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.server;
      if (target === API_TARGET) return;
      try {
        if (target === 'bridge01') localStorage.setItem(API_TARGET_STORAGE_KEY, 'bridge01');
        else localStorage.removeItem(API_TARGET_STORAGE_KEY);
      } catch {
        document.getElementById('serverHint').textContent = '⚠️ Unable to save the server choice on this device.';
        return;
      }
      location.reload();
    });
  });
  const card = document.getElementById('serverSwitchCard');
  card.classList.remove('hidden');
  if (location.hash === '#serverSwitchCard') card.scrollIntoView({ block: 'center' });
}

// ── Load ───────────────────────────────────────────────────────────────

async function load() {
  showState('loadingState');
  el.verdict.classList.add('hidden');

  await window.adminIdentityCheck;
  if (isAdminUnlocked() || IS_BRIDGE01) renderServerSwitch();
  if (!isAdminUnlocked()) {
    el.errorMsg.textContent = "You don't have permission to access this page.";
    el.retryBtn.classList.add('hidden');
    showState('errorState');
    return;
  }

  renderSite();
  // Cloudflare Access's own answer (fetched by admin.js), so it shows even if n8n is down
  document.getElementById('rawIdentity').textContent = window.cloudflareIdentity
    ? JSON.stringify(window.cloudflareIdentity, null, 2)
    : 'No response (local dev, or not logged in via Cloudflare Access)';

  try {
    const res = await fetch(SYSTEM_INFO_URL, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // n8n Respond to Webhook may wrap the payload in an array — unwrap if needed
    const info = Array.isArray(raw) ? raw[0] : raw;
    if (!info || !info.server || !info.database) throw new Error('Unexpected response');

    renderServer(info.server);
    renderDatabase(info.database);
    renderChecks(runChecks(info.server), info.server);
    showState('detailsState');
  } catch (err) {
    console.error('Failed to load system info:', err);
    // A server without the System Info workflow answers 404 with no CORS headers,
    // which the browser reports only as a failed fetch.
    el.errorMsg.textContent = `No answer from ${new URL(N8N_BASE_URL).hostname} (${err.message}). It may be down, or not have the System Info workflow yet. This site's details are below.`;
    el.retryBtn.classList.remove('hidden');
    showState('errorState');
    // Still show what the browser knows: that alone answers "which server am I calling?"
    document.getElementById('detailsState').classList.remove('hidden');
    document.getElementById('serverInfoCard').classList.add('hidden');
    document.getElementById('databaseCard').classList.add('hidden');
    renderList(el.checksList, [['Server', `❌ ${escapeHtml(err.message)}`]]);
    el.refreshBtn.classList.add('hidden');
  }
}

function reload() {
  document.getElementById('serverInfoCard').classList.remove('hidden');
  document.getElementById('databaseCard').classList.remove('hidden');
  el.refreshBtn.classList.remove('hidden');
  load();
}

el.retryBtn.addEventListener('click', reload);
el.refreshBtn.addEventListener('click', reload);

load();
