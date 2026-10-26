// Runs Playwright with STAGING_WRITES=1 for the write/ or delete/ tests, one at a time
// on desktop Chrome, without retries (a retry would re-create records the first attempt
// already made). Only the npm scripts call this; a bare `npx playwright test`
// leaves those tests skipped.
const { spawnSync } = require('child_process');

const args = ['playwright', 'test', ...process.argv.slice(2), '--project=desktop-chrome', '--workers=1', '--retries=0'];
const r = spawnSync('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, STAGING_WRITES: '1' } });
process.exit(r.status ?? 1);
