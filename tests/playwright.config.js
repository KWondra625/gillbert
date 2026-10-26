// Gillbert tests run the site locally against Staging data. Never production:
// support/fixtures.js blocks every request to the production server and fails the test.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT || 4173);

// One ID per run, shared by every worker, so test records made in one test can be
// found by the next (test-data.js names them with it).
process.env.E2E_RUN_ID ||= String(Date.now()).slice(-6);

module.exports = defineConfig({
  testDir: '.',
  testMatch: ['read/**/*.spec.js', 'write/**/*.spec.js', 'delete/**/*.spec.js'],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Staging is a Raspberry Pi; more parallel browsers than this starts failing requests.
  workers: 2,
  retries: 1, // a retried pass still shows as "flaky" in the report
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    actionTimeout: 15_000, // a missing element fails fast instead of hanging the test
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'] }, testMatch: 'read/**/*.spec.js' },
    { name: 'iphone-safari', use: { ...devices['iPhone 14'] }, testMatch: 'read/**/*.spec.js' },
  ],
  webServer: {
    command: 'node support/static-server.js',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    env: { PORT: String(PORT) },
  },
});
