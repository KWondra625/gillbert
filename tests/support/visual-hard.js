// Runs the screenshot tests in the hard-water look (VISUAL_WATER=hard), against the
// *-hard-water.png baselines. Only `npm run test:visual:hard` calls this; extra arguments
// (e.g. --update-snapshots, -g index) are passed on.
const { spawnSync } = require('child_process');

const cli = require.resolve('@playwright/test/cli');
const args = [cli, 'test', 'visual/', '--project=desktop-chrome', '--project=iphone-safari', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, VISUAL_WATER: 'hard' } });
process.exit(r.status ?? 1);
