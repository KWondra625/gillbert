// Removes everything the write/ and delete/ tests created on Staging. Never production.
//
//   npm run cleanup             dry run: shows what would be removed, changes nothing
//   npm run cleanup -- --apply  removes it
//
// Two steps, because the app can delete files but not rows:
//   1. Files: media on test catches and test anglers' profile photos are deleted through
//      the app's own endpoints (catch-media/delete, anglers/delete-photo), which remove
//      the stored file as well as the row.
//   2. Rows: test catches, anglers, species and bodies of water are deleted with SQL on
//      the Staging database over SSH, in one transaction, and the id sequences are reset
//      so the next real catch number follows on with no gap (scripts/reset_table_ids.sql).
//
// "Test" means: catches whose notes contain [E2E Test]; anglers, species and bodies of
// water named "E2E Test …" (see support/test-data.js). Nothing else is touched.
//
// Settings come from tests/.env (git-ignored; see .env.example): STAGING_SSH, STAGING_SSH_HOSTNAME,
// PG_CONTAINER, PG_USER, PG_DB. It refuses to run without them.
const { spawnSync } = require('child_process');
const { config, apiGet, getCatches, getCatchMedia } = require('../support/staging-api');
const { NAME_PREFIX, NOTES_MARKER, apiPost } = require('../support/test-data');

const APPLY = process.argv.includes('--apply');
const SETTINGS = ['STAGING_SSH', 'STAGING_SSH_HOSTNAME', 'PG_CONTAINER', 'PG_USER', 'PG_DB'];
const missing = SETTINGS.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} in tests/.env first (see .env.example).`);
  process.exit(1);
}
const { STAGING_SSH: SSH, STAGING_SSH_HOSTNAME: STAGING_HOSTNAME, PG_CONTAINER, PG_USER, PG_DB } = process.env;
// Git Bash's ssh has no access to the key agent; Windows OpenSSH does.
const SSH_EXE = process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh';

function ssh(command, input) {
  const r = spawnSync(SSH_EXE, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH, command],
    { input, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`ssh ${SSH} failed (${r.status}): ${r.stderr || r.error}`);
  return r.stdout.trim();
}

function psql(sql) {
  return ssh(`docker exec -i ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -v ON_ERROR_STOP=1 -q -At -F " | "`, sql);
}

const isTestCatch = c => (c.notes || '').includes(NOTES_MARKER);
const isTestName = name => (name || '').startsWith(`${NAME_PREFIX} `);
const sqlString = s => `'${s.replace(/'/g, "''")}'`;

// Every table the row step touches, and how it recognizes a test row.
const ROWS = {
  catches: `position(${sqlString(NOTES_MARKER)} in coalesce(notes, '')) > 0`,
  anglers: `name LIKE ${sqlString(`${NAME_PREFIX} %`)}`,
  fish_species: `name LIKE ${sqlString(`${NAME_PREFIX} %`)}`,
  bodies_of_water: `name LIKE ${sqlString(`${NAME_PREFIX} %`)}`,
};

async function main() {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (add --apply to remove)'} · API ${config.N8N_BASE_URL} · DB ${SSH} ${PG_CONTAINER}/${PG_DB}\n`);

  // Guard: the SSH target must report itself as the Staging server, whatever STAGING_SSH says.
  const host = ssh('hostname');
  if (host !== STAGING_HOSTNAME) throw new Error(`Refusing: ${SSH} is "${host}", not the Staging server ${STAGING_HOSTNAME}`);

  // ── 1. Files, through the app ─────────────────────────────────────────
  const testCatches = (await getCatches()).filter(isTestCatch);
  const media = [];
  for (const c of testCatches) media.push(...await getCatchMedia(c.catchNumber));
  const anglerData = await apiGet('anglers/get');
  const anglers = (Array.isArray(anglerData) ? anglerData : Object.values(anglerData).find(Array.isArray) || []);
  const photos = anglers.filter(a => isTestName(a.name) && a.profilePhotoReadUrl);

  console.log(`Files: ${media.length} media on ${testCatches.length} test catch(es), ${photos.length} test angler photo(s)`);
  for (const m of media) console.log(`  media ${m.id}  ${m.catchNumber}  ${m.contentType}  ${m.blobPath}`);
  for (const a of photos) console.log(`  photo  angler ${a.id} "${a.name}"`);
  if (APPLY) {
    for (const m of media) await apiPost('catch-media/delete', { mediaId: m.id });
    for (const a of photos) await apiPost('anglers/delete-photo', { anglerId: a.id });
    console.log('  removed');
  }

  // ── 2. Rows, with SQL ─────────────────────────────────────────────────
  // Leftover media rows go first (their files are handled above), then catches, then
  // the lookups the catches pointed at. Any real catch still pointing at a test record
  // makes the delete fail, and the whole transaction rolls back.
  const report = Object.entries(ROWS)
    .map(([table, where]) => `SELECT '${table}', count(*), coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM ${table} WHERE ${where};`)
    .join('\n');
  const deletes = `
    DELETE FROM catch_media WHERE catch_id IN (SELECT id FROM catches WHERE ${ROWS.catches});
    DELETE FROM catches WHERE ${ROWS.catches};
    DELETE FROM anglers WHERE ${ROWS.anglers};
    DELETE FROM fish_species WHERE ${ROWS.fish_species};
    DELETE FROM bodies_of_water WHERE ${ROWS.bodies_of_water};
    ${['anglers', 'bodies_of_water', 'catches', 'catch_media', 'fish_species'].map(t =>
      `SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 1), (SELECT MAX(id) FROM ${t}) IS NOT NULL);`).join('\n    ')}`;

  console.log('\nRows (table | count | ids):');
  console.log(psql(`BEGIN;\n${report}\n${APPLY ? `${deletes}\nCOMMIT;` : 'ROLLBACK;'}`)
    .split('\n').filter(l => /^\w+ \| /.test(l)).map(l => `  ${l}`).join('\n'));
  console.log(APPLY ? '\nDone: test rows removed and id sequences reset.' : '\nNothing changed (dry run).');
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
