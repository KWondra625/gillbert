# Gear: tip-ups and their setups

Status: **stage 1 built on `feature/gear-tip-ups`, not yet on Staging** (2026-11-24). Design agreed
2026-11-18; data model reviewed 2026-11-23 (Model + Color added from the crew's feedback, the change
log renamed `gear_history`, three rules added below). Mockup v2 (6 phone screens) was reviewed alongside this.

## Why

Today a catch says who, what, where and when, but not **what it was caught on**. Over a few
seasons, knowing which tip-up setups (hook, beads, flash...) and which baits catch what, on
which lakes, is the interesting data. Hard water comes first: **tip-ups only**. Rods and open
water come later, shaped by how this winter goes.

## Decisions so far (Kurt, 2026-11-18)

- Every piece of gear has **one owner** (an angler). No groups table.
- Each tip-up has a **display name** the crew chooses (e.g. `KW 24-01`: initials, year bought,
  number). **Unique across all gear**, ignoring capitals and extra spaces. The owner is stored
  separately and never worked out from the name.
- Each tip-up also has a **Model** (e.g. Frabill Pro-Thermal, Beaver Dam) and a **Color**, both
  optional type-ahead tags. They describe the tip-up itself, so they aren't versioned (crew feedback,
  2026-11-23).
- A tip-up's **setup** = line, leader, hook (one each), beads (zero or more), flash (zero or
  more), and an optional photo. No depth (the crew always sets ~3' off bottom).
- Values are **type-ahead tags**: matches show as you type, and anything new becomes a choice
  for everyone. Pick lists for analysis, with no fixed list to maintain.
- **Anyone** can change any tip-up's setup. Every change is kept: who, when, and what changed.
- A catch gets two optional fields: **Caught on** (a tip-up) and **Bait** (per catch, since bait
  changes during the day; includes "Not sure").
- A **Retired** status (lost down the hole, broken): off the "Caught on" list, but its name stays
  reserved and its history and catches stay.
- Menu: **Gear** in the shack (for everyone, not admin). The page lists tip-ups now; rods appear
  when built, with no "coming soon" placeholder.
- Outings and flag counts are a **separate, later project** that builds on gear (flags per
  tip-up).

## The key idea: a change log, and versions for catches

Two separate things, so the screen stays simple:
- **The history** (`gear_history`) records every change: who, when, which part, old → new.
  That's what the tip-up's history shows ("Nov 22 · Dave T: hook #8 octopus → #10 treble,
  + Glow beads"). Renames, owner changes and retiring go in the same log.
- **Setup versions** (`gear_setups`) are what catches point at. Saving a change **updates the
  current version in place while no catch points at it yet** (so fixing a typo or fiddling
  before the first fish doesn't pile up versions). Once a catch points at the current
  version, the next save **adds a new version** and leaves the old one as it was.

Nobody picks between "correct" and "new version": there's one Save button, and the app
decides. The history reads the same either way. So:
- Catch Details always shows the setup *as it was that day*, even after the tip-up changes,
  is renamed or retired.
- Stats count fish against the setup that actually caught them.

## Database (all new, plus two optional columns on catches)

| Table | What it holds |
|---|---|
| `gear` | One row per tip-up: `gear_type` (`tip_up` now, `rod` later), `display_name`, `name_key` (generated: lower-cased, spaces squeezed, **unique**), `owner_angler_id`, `model_option_id`, `color_option_id`, `notes` (free text, up to 1,000 characters), `status` (Active / Retired), `retired_note`, created/updated by and at |
| `gear_options` | The shared tags: `kind` (`line`, `leader`, `hook`, `bead`, `flash`, `bait`, `model`, `color`), `name`, `name_key` (generated, **unique per kind**), `status` (Active / Hidden), created by and at |
| `gear_setups` | One row per **version**: `gear_id`, `version_no`, `line_option_id`, `leader_option_id`, `hook_option_id`, photo URLs, created by and at. Unique (`gear_id`, `version_no`) |
| `gear_setup_options` | Beads and flash for a version (zero or more): `setup_id`, `option_id` |
| `gear_history` | The tip-up's history: setup changes, renames, owner / model / color / notes changes, retire / un-retire: `gear_id`, `event_type`, `field`, `old_value` → `new_value` (as text), by, at |

`catches` gets **`gear_setup_id`** and **`bait_option_id`**, both nullable. Existing catches
keep null and look exactly as today. `vw_catch_details` gets the new fields **appended at the
end** (the same approach as the thumbnail columns), so nothing reading it today shifts.

The weekly table snapshot picks up new tables on its own (it copies every table).

Scripts: `scripts/gear/01_gear_tables.sql` (tables, the two catches columns, bait starter list),
`02_gear_functions.sql` (`gear_get`, `gear_save`, `gear_setup_save` and helpers: all the rules live
here, one transaction per save), `03_check_gear_functions.sql` (checks on Staging, ends in ROLLBACK).
The two `catches` columns are added in stage 1 but stay unused until stage 2.

**Rules (from the 2026-11-23 review):**
1. A catch's version comes from **`caught_when`**, not from when it was saved: the newest version
   whose `created_at` is at or before the catch time (a fish logged that night still gets the
   morning's hook). Applies in stage 2.
2. A tag must be the **right kind** (bait is a bait tag, etc.): the save functions look tags up by
   kind, since a plain foreign key can't check it.
3. **Deleting** a tip-up with no catches removes its versions, beads/flash and history with it
   (`ON DELETE CASCADE`); a catch's foreign key blocks deleting one that has caught fish.

## Server endpoints (n8n)

| Endpoint | Does |
|---|---|
| `gear/get` | The tip-up list with each one's current setup (fish counts arrive with stage 2); `?id=` adds that tip-up's history; the `gear_options` per kind for the type-ahead |
| `gear/save` | Add, rename, change owner / model / color, retire, delete (no catches only). Refuses a duplicate name with a friendly message |
| `gear/setup-save` | In one transaction: creates any brand-new tags, updates the current version in place (no catches yet) or adds a new one, and writes the change log |
| Save Catch / Edit Catch | Accept the two new optional fields |
| (all three) | Built by `tools/n8n-migration/gear/deploy_gear_endpoints.py`: the server's own API-key check, then one Postgres call with the request as a bound parameter |
| Setup photo | Reuses the single-photo upload pattern from profile photos, plus the existing thumbnail step |

**Save Catch is the riskiest touch:** it's the one funnel for both the form and Catch Chat.
The change is additive (two optional values, null when missing), Catch Chat keeps sending
nothing until stage 5, and it gets the full write-test run.

## Stage 2 as built (2026-11-26)

- **Forms:** Log a Catch and Edit Catch get "Caught on" (a type-ahead on tip-up name or owner, the
  catch's angler's first; only existing tip-ups can be picked; retired left out unless the catch
  already uses one; the setup shows underneath) and
  "Bait" (type-ahead; anything new becomes a choice). Both optional. If `gear/get` fails, both stay
  hidden and the save sends nothing about gear, so an edited catch keeps what it had.
- **Catch page:** "Caught on" links to the tip-up and lists the setup *as caught*; "Bait" under it.
- **Database:** `scripts/gear/04_catch_gear.sql` adds `catch_gear_set(catch, gear, bait, by)`: picks
  the version by `caught_when` (the first version if the catch is older than all of them; an empty v1
  if the tip-up has none yet), finds or adds the bait, and never refuses (the catch is already saved).
  `vw_catch_details` appends `gear_setup_id`, `caught_on` (JSON) and `bait_name`, as inline subqueries
  so the view's readers need no rights on the gear tables. `05_check_catch_gear.sql` checks it all.
- **n8n:** `tools/n8n-migration/gear/deploy_catch_gear.py` patches Save Catch (a "Gear Sent?" branch
  after the upsert calls `catch_gear_set` only when the request carried `gearId`, so Catch Chat is
  untouched until stage 5) and GET Catch(es) (adds `caughtOn` and `bait`).
- **Gear list:** cards like the Anglers page, with a search box (name, owner, model, color, setup
  parts) and owner pills (only anglers who own a tip-up).
- **Release order:** 01, 02, 04, then the view, then the n8n patch.

## Stage 5 design: Catch Chat (agreed 2026-11-27)

Catch Chat picks up the tip-up and bait: "got him on KW 24-02 with a sucker". Ask Gillbert
(questions about gear) is left for later.

**How Gillbert behaves**
- Each turn it's given the active tip-ups (with owners) and the bait choices.
- It catches both whenever they're mentioned, in any order.
- During ice season (November to March, by catch date, like the site's season look) it asks for
  them in the same breath as depth: "Which tip-up was it on, what bait, and any idea on the
  depth?" No extra turn. In open water it never asks, but still takes them if mentioned.
- Tip-up: only a name from the list. Loose versions are fine ("kw 2402", "Dave's 22-01") when
  exactly one fits; otherwise it asks once with up to 3 likely names, then leaves it blank. It
  never makes one up. Whose tip-up doesn't matter.
- Bait: the existing spelling when it's the same bait. Kind but no size ("sucker") → "Sucker".
  Anything new becomes a choice, like the form.
- The recap before saving mentions both.

**How it saves**
- The name is matched again in the database (active tip-ups, same name rule as the gear pages).
  No match = no tip-up; Catch Chat never creates gear.
- Save Catch gets gearId and bait from Catch Chat too, so the catch gets the setup version and
  bait through the same `catch_gear_set` as the forms.

**Changes** (tools/n8n-migration/gear/deploy_catch_chat_gear.py; dry run on Staging is clean)
1. `scripts/gear/06_catch_chat_gear.sql`: `conversations` gets `tip_up_raw`, `bait_raw`.
2. n8n data table `fish_catch_conversations`: the same two string columns, added by hand in
   the n8n screen (the API key can't change data tables). Must come before step 3.
3. The script: Save Catch takes gearId and bait from workflow calls; Catch Chat gets "Get Gear
   Names", the prompt and output fields, the two *_raw fields carried through, "Lookup Tip-Up",
   and sends both to Save Catch.
4. Test: `tests/write/09-catch-chat.spec.js` (opt-in, calls Claude) names a test tip-up and bait
   and checks both land on the catch.

**Answered (Kurt, 2026-11-27)**
- Bait with no size: store the kind alone ("Sucker"), no extra question. Guessing the size from
  a recent catch's bait was considered and dropped: more complexity than it's worth.
- Ask about the tip-up only in ice season (Nov–Mar).
- Jigging rods come later (low priority). Then "tip-up" in the prompt becomes "what it was
  caught on" (tip-up or rod), and open water may ask about rods; the save path stays the same
  (gearId).

## Stages

| # | Stage | Touches existing things? | Size |
|---|---|---|---|
| 1 | **Gear pages:** list, add, rename / retire, change setup (type-ahead + tags), history | No: new tables, pages and endpoints, plus one shack menu link | M |
| 2 | **Caught on + Bait** on Log a Catch and Edit Catch; a "Caught on" section on Catch Details | Yes: Save Catch, Edit Catch, `vw_catch_details`, two catch pages | M |
| 3 | **Setup photos** | A little: storage folder + thumbnail step | S |
| 4 | **Stats page:** fish by setup part, bait, lake and species | No | M |
| 5 | **Catch Chat / Ask Gillbert** know about gear ("got him on KW 24-02 with a sucker") | Yes: the AI workflows | M |
| 6 | **Admin merge** for near-duplicate tags ("30lb dacron" into "Dacron 30 lb") | No | S |

Stages 1 and 2 are the winter-useful core. Stage 1 alone lets the crew enter their tip-ups
before anything else in the app changes. Later: outings and flag counts, then rods.

**Timing:** after the November Follow-ups release. Each stage follows the usual path: a
feature branch, Staging, release runbook.

## Testing

- Read tests (mocked data) for every new page and for the new catch fields, in Chrome and Safari.
- Write tests on Staging: add a tip-up, save two setup versions, log a catch on it, check that
  Catch Details shows the version at the time. Test gear uses an `E2E` name prefix, and
  `npm run cleanup` learns the new tables (catches first, then setups, options and gear).
- Full read suite before each merge, since stage 2 touches the shared catch pages.

## Risks and how they're handled

- **Breaking catch logging:** stage 2 only adds optional values; null = today's behavior.
  Full suite + write tests before merging.
- **Messy tags** (near-duplicates): type-ahead shows matches first; admin merge in stage 6.
- **Thin data at first:** ~8 anglers means the stats get interesting over 2–3 seasons. Logging
  has to be quick or it won't happen: one pick for the tip-up, one for bait, both optional.
- **Name clashes:** unique, checked by the database itself, not just the page.
- **Deleting:** gear is retired, not deleted, once any catch points at it. A tip-up with no
  catches can be deleted outright.

## Answered (Kurt, 2026-11-18)

1. **Typo fixes:** correct in place, as long as the screen stays easy to follow. Done as above:
   in place while no catch uses the version, one Save button, history from the change log.
2. **Deleting or merging tags:** admins only (stage 6). Everyone else just adds.
3. **"Fish this season"** uses the app's hard / open water season dates (Settings).
4. **Bait starter list:** Shiner (small, medium, large), Sucker (small, medium, large),
   plus "Not sure". Anything else gets typed and becomes a choice.
