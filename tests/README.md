# Gillbert automated tests

Playwright tests that run the site **locally against Staging data**. They never touch production.

## Setup (once)

```sh
cd tests
npm install
npx playwright install chromium webkit
```

## Running

| Command | What it does | Changes data? |
|---|---|---|
| `npm test` | Read-only tests on desktop Chrome, Android Chrome and iPhone Safari | No |
| `npm run test:write` | Layer 2: creates test records and uploads every media type | Yes, Staging only |
| `npm run test:delete` | Layer 3: deletes test media and a test profile photo | Yes, Staging only |
| `npm run test:all` | All three layers in order | Yes, Staging only |
| `npm run test:stress` | Read-only tests twice over with 8 parallel browsers and no retries: a load test for Staging | No |
| `npm run cleanup` | Shows what test data is on Staging (dry run) | No |
| `npm run cleanup -- --apply` | Removes all test data from Staging | Yes, Staging only |
| `npm run report` | Opens the HTML report from the last run | No |

Set `SKIP_AI=1` to skip the Ask Gillbert test, which calls Claude and spends API tokens. It runs by default.

A plain `npx playwright test` runs the write and delete tests as **skipped**. Only the `test:write`, `test:delete` and `test:all` scripts turn them on (they set `STAGING_WRITES=1`).

## Safety guards

- **Never production.** Every request to a production host (the production API server or the live site, both read from `src/assets/config.js`) is blocked and fails the test. Each page must also report that it talks to Staging, and the API helper refuses to start otherwise. Uploads and deletes to any storage account other than Staging's are blocked too. `read/guards.spec.js` checks that the guards themselves work.
- **Read-only means read-only.** Tests in `read/` block, and fail on, any call to a save, commit, delete or upload endpoint.
- **Everything is marked.** Test anglers, species and bodies of water are named `E2E Test …`, and test catches carry `[E2E Test]` in their notes. Cleanup removes only those, and only on the Staging server: it checks the SSH host's name before doing anything.
- **Browser errors fail tests.** Any uncaught error or console error fails the test, which catches breakage a screenshot wouldn't show.

## Layout

```
read/      Layer 1: pages load, listings, filters, detail pages, forms, API shapes
write/     Layer 2: create and edit records, upload every media type, profile photo
delete/    Layer 3: delete media and profile photos, and check the files are gone
cleanup/   Removes all test data from Staging
media/     Small test files for every upload type (generate.py recreates them);
           media/phone/ holds real phone files, git-ignored
support/   Guards, the local web server, and Staging API helpers
```

Layers 2 and 3 run one test at a time, in file order. The Staging server is a Raspberry Pi, so everyday runs use 2 parallel browsers. `test:stress` deliberately pushes harder; any Staging call that fails is reported with its status code and Cloudflare ray ID, so an edge rejection can be told apart from an n8n error.

## Cleanup needs SSH

`npm run cleanup` runs SQL on the Staging database over SSH, because the app has no way to delete catches, anglers, species or bodies of water. Copy `.env.example` to `.env` and fill in the SSH login, the server's hostname, the database container and the Staging storage account. Write tests need the storage account too.
