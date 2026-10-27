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
// "Test" means (see support/test-data.js): anglers, species and bodies of water named
// "E2E Test …"; chat sessions whose id contains "e2e-test-" (Ask Gillbert and Catch Chat
// tests set it), with their conversations and chat memory; and catches whose notes carry
// [E2E Test], that belong to a test angler, or that a test chat logged. Nothing else.
//
// Settings come from tests/.env (git-ignored; see .env.example): STAGING_SSH, STAGING_SSH_HOSTNAME,
// PG_CONTAINER, PG_USER, PG_DB. It refuses to run without them.
const { spawnSync } = require('child_process');
const { config, apiGet, getCatches, getCatchMedia } = require('../support/staging-api');
const { NAME_PREFIX, NOTES_MARKER, SESSION_MARKER, apiPost } = require('../support/test-data');

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

const isTestName = name => (name || '').startsWith(`${NAME_PREFIX} `);
const isTestCatch = c => (c.notes || '').includes(NOTES_MARKER) || isTestName(c.anglerName);
const sqlString = s => `'${s.replace(/'/g, "''")}'`;

// Every table the row step touches, and how it recognizes a test row.
const TEST_NAME = `name LIKE ${sqlString(`${NAME_PREFIX} %`)}`;
const TEST_SESSION = `session_id LIKE ${sqlString(`%${SESSION_MARKER}%`)}`;
const ROWS = {
  catches: `position(${sqlString(NOTES_MARKER)} in coalesce(notes, '')) > 0
    OR angler_id IN (SELECT id FROM anglers WHERE ${TEST_NAME})
    OR conversation_id IN (SELECT id FROM conversations WHERE ${TEST_SESSION})`,
  conversations: TEST_SESSION,
  chat_messages: TEST_SESSION,
  anglers: TEST_NAME,
  fish_species: TEST_NAME,
  bodies_of_water: TEST_NAME,
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
    // A delete can fail. If its file is already gone, the row step below can still remove
    // the row. If the file is still in storage, removing the row would orphan it, so stop
    // before the row step: the rows stay, and the next cleanup run retries.
    const stillStored = [];
    const attempt = async (what, endpoint, body, fileUrl) => {
      try { await apiPost(endpoint, body); return; } catch (err) { console.log(`  ${what} failed: ${err.message.slice(0, 160)}`); }
      const status = await fetch(fileUrl, { method: 'HEAD' }).then(r => r.status, () => 'unreachable');
      if (status === 404) console.log(`    its file is already gone, so the row can go`);
      else stillStored.push(`${what} (file check: ${status})`);
    };
    for (const m of media) await attempt(`media ${m.id}`, 'catch-media/delete', { mediaId: m.id }, m.readUrl);
    for (const a of photos) await attempt(`photo of angler ${a.id}`, 'anglers/delete-photo', { anglerId: a.id }, a.profilePhotoReadUrl);
    if (stillStored.length) {
      console.error(`\nStopped before removing any rows: these files are still in storage, and removing`
        + ` their rows would leave them orphaned. Run cleanup again later.\n  ${stillStored.join('\n  ')}`);
      process.exit(1);
    }
    console.log('  done');
  }

  // ── 2. Rows, with SQL ─────────────────────────────────────────────────
  // Leftover media rows go first (their files are handled above), then catches, then
  // test chats (catches point at conversations), then the lookups the catches pointed at. Any real catch still pointing at a test record
  // makes the delete fail, and the whole transaction rolls back.
  const report = Object.entries(ROWS)
    .map(([table, where]) => `SELECT '${table}', count(*), coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM ${table} WHERE ${where};`)
    .join('\n');
  const deletes = `
    DELETE FROM catch_media WHERE catch_id IN (SELECT id FROM catches WHERE ${ROWS.catches});
    DELETE FROM catches WHERE ${ROWS.catches};
    DELETE FROM conversations WHERE ${ROWS.conversations};
    DELETE FROM chat_messages WHERE ${ROWS.chat_messages};
    DELETE FROM anglers WHERE ${ROWS.anglers};
    DELETE FROM fish_species WHERE ${ROWS.fish_species};
    DELETE FROM bodies_of_water WHERE ${ROWS.bodies_of_water};
    ${['anglers', 'bodies_of_water', 'catches', 'catch_media', 'fish_species', 'conversations', 'chat_messages'].map(t =>
      `SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 1), (SELECT MAX(id) FROM ${t}) IS NOT NULL);`).join('\n    ')}`;

  console.log('\nRows (table | count | ids):');
  console.log(psql(`BEGIN;\n${report}\n${APPLY ? `${deletes}\nCOMMIT;` : 'ROLLBACK;'}`)
    .split('\n').filter(l => /^\w+ \| /.test(l)).map(l => `  ${l}`).join('\n'));
  console.log(APPLY ? '\nDone: test rows removed and id sequences reset.' : '\nNothing changed (dry run).');
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
