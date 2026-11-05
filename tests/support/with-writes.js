// Runs Playwright with STAGING_WRITES=1 for the write/ or delete/ tests, one at a time
// on desktop Chrome, without retries (a retry would re-create records the first attempt
// already made). Only the npm scripts call this; a bare `npx playwright test`
// leaves those tests skipped.
//
// Playwright's CLI runs directly under Node, with no shell in between, so forwarded
// arguments keep their boundaries (e.g. --grep "a test angler") on Windows and Unix.
const { spawnSync } = require('child_process');

const cli = require.resolve('@playwright/test/cli');
const args = [cli, 'test', ...process.argv.slice(2), '--project=desktop-chrome', '--workers=1', '--retries=0'];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, STAGING_WRITES: '1' } });
process.exit(r.status ?? 1);
