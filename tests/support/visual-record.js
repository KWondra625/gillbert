// Records the screenshot tests' Staging answers (desktop run, VISUAL_RECORD=1), then writes
// the phone baselines from those same recordings, so both projects compare like with like.
// Only `npm run test:visual:record` calls this. Extra arguments (e.g. -g index) are passed on.
const { spawnSync } = require('child_process');

const cli = require.resolve('@playwright/test/cli');
const extra = process.argv.slice(2);
const run = (args, env) => spawnSync(process.execPath, [cli, 'test', 'visual/', ...args, ...extra],
  { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

const recorded = run(['--project=desktop-chrome', '--update-snapshots', '--retries=0'], { VISUAL_RECORD: '1' });
if (recorded !== 0) process.exit(recorded);
process.exit(run(['--project=iphone-safari', '--update-snapshots', '--retries=0'], {}));
