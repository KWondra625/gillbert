# Media thumbnails (#38)

Status: **draft for Kurt's review**, 2026-11-14. Nothing here is on a server yet.
All three phases are built in the pages; phases 1 and 3 also in the workflow draft
(phase 2 needs no server change).

## Why

Catch pages download every photo at full size (3-10 MB each) just to draw the tiles. The
browser opens only 6 connections at a time to one storage server, so on a photo-heavy catch
everything else waits in line behind the photos, including a video you tap (Catch 26-147:
12 photos, ~95 MB, ~15 s before its video starts on fast Wi-Fi). With thumbnails that page
is ~2 MB.

## What gets made

For each **photo** (JPEG/PNG/WebP, and HEIC after it's converted to JPEG):

| File | Size | Used for | Stored as |
|---|---|---|---|
| Thumbnail | 1200 px long side, JPEG q82, ~150-300 KB | tiles, home card, Media Activity | `catches/Catch-26-147/<ID>-thumb.jpg` |
| Viewing copy | 2048 px long side, JPEG q85, ~400-900 KB | the lightbox | `catches/Catch-26-147/<ID>-view.jpg` |
| Original | unchanged | "Download original" | `catches/Catch-26-147/<ID>.jpg` (as today) |

- Why these sizes: see "Sizes" below.
- `magick <in> -auto-orient -resize 1200x1200> +profile "!icc,*" -quality 82 <out>`. **`-auto-orient`
  before removing the camera data**: phone photos are often stored sideways with a rotation flag, and
  stripping the flag without rotating the pixels would show them sideways.
- `>` means "only shrink": a photo already smaller than the target is copied at its own size.
- Thumbnails sit next to the original, named after the same ID, so they're easy to find,
  delete and check.

**One photo, one tile.** Pages never list storage: they list the `catch_media` records, and
the two copies are extra columns on the photo's *own* record, not records of their own. So
three files in storage are still one tile, and the page picks which file to load (tile →
thumbnail, full-screen → viewing copy, Download original → the original). The only way a
copy could become a second tile is being attached as a record of its own, so that's blocked
twice:
- **Media Activity → Storage Check:** a leftover `-thumb`/`-view` file gets **Delete** only,
  no **Attach** (like profile photo files today).
- **Log Catch Media Details (commit):** refuses a file name ending `-thumb.jpg`/`-view.jpg`.

For each **video** (phase 3): one file, its **poster frame**, stored as the video's
thumbnail (`<ID>-thumb.jpg`, 1200 px, q82, in `thumbnail_url`; no viewing copy). See
"Phase 3".

## Database

Migration `scripts/catch_media_data/add_thumbnail_columns.sql` (safe to re-run), on each
server before its workflows change:

- `thumbnail_url`, `viewing_url` (varchar 255, null = no thumbnails yet)
- `thumbnail_error` (text, null unless the last attempt failed)
- `thumbnails_updated_at` (timestamptz)

`vw_catch_media_details` gets the four columns appended at the end, plus
`thumbnail_status`: `done` (a photo with both URLs, a video with its poster), `failed` (has
an error), `missing` (a complete photo or video without them), or null (still converting).

## n8n

**New: `Gillbert - Media - Make Thumbnails`** (sub-workflow, input `mediaId`). One file per run:
1. Load the row; stop quietly unless it's a complete photo or video.
2. Download the original from its `read_url` (public read). On Staging most rows point at
   Production's storage: the original is only *read* from there. Thumbnails are always
   written to **this server's own storage**, so Staging never writes to Production storage.
3. Make both sizes with `magick` (in the same image that already converts HEIC). For a
   video, `ffmpeg` grabs one frame instead (see "Phase 3").
4. Upload both, then save the URLs (`thumbnail_error` cleared), or save the error.
5. Returns `{ ok, mediaId, thumbnailUrl, viewingUrl, error }`. Never throws.
6. Same temp-file pattern and sweep as Convert Media (`/tmp/gillbert_*`).

**New: `Gillbert - Media - POST Make Thumbnails`** (`gillbert/catch-media/thumbnails`): body
`{ mediaId }`, the same access check as the existing Media Admin endpoint, runs Make
Thumbnails and waits, responds with its result. **One photo per call**: the page sends the
selected photos one at a time, so each call is short (no webhook timeouts, light on the Pi)
and the page can show each photo's progress.

**Changed:**
- **Log Catch Media Details (commit):** photos recorded as complete straight away (JPEG/PNG/WebP)
  start Make Thumbnails without waiting, like it starts Convert Media today. Also refuses a
  `-thumb.jpg`/`-view.jpg` file (see "One photo, one tile").
- **Convert Media:** after Mark Complete, start Make Thumbnails without waiting. (A HEIC is
  thumbnailed from its converted JPEG; every video, MOV or MP4, goes through Convert Media.)
- **GIFs are left out:** a thumbnail would freeze an animated GIF. They keep loading the
  original, and the view gives them no thumbnail status (none on Staging today).
- **GET Catch Media:** the response mapping adds `thumbnailUrl`, `viewingUrl`,
  `thumbnailStatus`, `thumbnailError` (the mapping lists fields explicitly).
- **POST Delete Catch Media:** deletes the copies and the original, then the record (see
  "Deleting a photo" below).
- **Media Admin scan:** a `-thumb`/`-view` file whose ID has a record counts as known;
  one whose record is gone is listed as a file with no record, so leftovers from a failed
  delete still show up. `delete-orphan` accepts those names; the page offers only Delete.

Thumbnail failures never fail the upload: the photo is complete and viewable either way.

### Deleting a photo

All three files go with the record, in one delete (the 🗑️ on the catch page, or Delete on
Media Activity: both call POST Delete Catch Media, the only way media is deleted).
- **Order:** thumbnail, viewing copy, original, then the record (a video: poster, video,
  record). Today it's original then
  record; the record stays last, so the photo only disappears from the page once every file
  is gone.
- **A file that's already gone is fine** (an older photo with no copies yet, or a second try
  after a failure). The names come from the photo's ID, so the delete doesn't depend on the
  URL columns being filled in.
- **Any other failure stops the delete** before the record goes: the photo stays on its
  catch, the page shows the error, and pressing delete again finishes the job.
- **Deleted while its thumbnails are being made:** Make Thumbnails saves its URLs only if
  the record still exists. If it's gone, it deletes the file(s) it just wrote, so nothing
  is left behind.
- **Anything left behind anyway** (e.g. the server restarted mid-delete) shows up in Storage
  Check as a file with no record, offering Delete only.

## Pages

- **Catch details:** photo tiles (and their blurred backdrop) use `thumbnailUrl`; the
  lightbox uses `viewingUrl`. A photo without them uses the original, as today. Video tiles:
  see "Phase 3". The lightbox gets **Download original** (see below).
- **Home card:** `thumbnailUrl`, else the original.
- **Media Activity:** a third tab, **🖼️ Media Thumbnails**, and a summary tile counting
  photos and videos without thumbnails.
  - Lists complete photos and videos that are `missing` or `failed` (newest first, with the
    error for failed ones), each with a checkbox, a preview (🎬 for a video with no poster
    yet), its catch and size.
  - Check 1 to 10 (the rest disable at 10; "Select 10" tops the selection up to ten), then
    **Generate Thumbnails**. The page runs the selected photos one at a time, showing each
    row's progress (⏳ → ✅ or ⚠️ with the reason). **Stop** finishes the current photo and
    skips the rest.
  - Safe to stop or rerun: closing the tab mid-run leaves the remaining photos `missing`,
    and generating for a photo that already has thumbnails just remakes them.
  - Doubles as the repair tool: a photo whose automatic generation failed at upload shows
    up here as `failed`.
- Not changed: profile photos (`angler-media`, see "Phase 2"), the catches listing.

### Download original

A **⬇️ Download original** button in the lightbox, top left (across from ✕), on photos only:
the video player has its own download.
- A plain link to the original. **Make Thumbnails marks each photo's original "save as
  `<its uploaded name>`"** in storage (`Content-Disposition`), so the browser downloads it
  under that name (e.g. `IMG_1234.jpg`), on phones too. Pictures shown on the page aren't
  affected; the setting only applies when the file is opened as a page.
- Until a photo is marked (it hasn't been through Make Thumbnails yet), the link opens the
  original in a new tab instead. So Release 2's backfill also makes older photos
  downloadable.
- Marked only when the original is in **that server's own storage**, so Staging never
  writes to Production storage. On the develop site, photos kept in Production storage
  open in a tab.
- Considered and dropped: the page fetching the file itself. Storage refuses that for any
  site it doesn't belong to (Staging storage refuses even the local site), and every refusal
  shows as a browser error on every photo opened.

## Releases

**Applied on Staging so far** (copied into the release runbook when it's written):
- 2026-11-14: migration `add_thumbnail_columns.sql` and the new `vw_catch_media_details`
  (4 columns + `thumbnail_status`). Checked after: 180 rows unchanged, view has 22 columns,
  GET Catch Media and the catch page tests unaffected.
- 2026-11-14: created **Gillbert - Media - Make Thumbnails** and **Gillbert - Media - POST
  Make Thumbnails** (both active: n8n only lets an active workflow call a sub-workflow that
  is itself active). Tried on 5 files: JPEG in Staging storage (173, 5.6 s, "save as" set on
  its original), 7.7 MB sideways JPEG in Production storage (2, 4.9 s, copies upright,
  Production file untouched), PNG (208, 2.6 s), 85 MB MP4 (172, 1.6 s), 135 MB MOV in
  Production storage (14, 28.5 s: ffmpeg reads further into a MOV). Copies 60-850 KB,
  posters ~150 KB. Error answers checked: unknown id, bad id, no key.
- 2026-11-14: step 3 (`tools/n8n-migration/media_rework/deploy_thumbnails_step3.py`, backups
  in its snapshots/): GET Catch Media's 4 fields, Delete removes the copies, Media Admin
  knows the copies, commit and Convert Media start Make Thumbnails. All 5 read back OK and
  active. The upload step needed no change to refuse copy names: its path rule already
  allows only letters and digits before the extension. Checked after: the API returns the
  fields; Storage Check clean (30 files, 0 with no record, 0 missing).
- 2026-11-14: step 4, upload tests with thumbnail checks (`write/03-media-upload.spec.js`):
  29/29 passed on the second run: every type gets its copies, upright and within size,
  originals marked "save as", delete removes all three files, the catch page uses the
  copies. Test data cleaned up; Storage Check back to 30 files, 0 with no record.
  The first run hit an older bug, not a thumbnail one: a commit recorded twice (the
  browser re-sent it on a new connection after its answer was lost), so the second record
  found its HEIC already converted and removed. Fix prepared: record each file once
  (`deploy_commit_once.py`).
- 2026-11-14: record-once fix applied to the upload workflow (#47); upload tests re-run
  5/5 (JPEG, HEIC, MOV, mixed batch, delete) and cleaned up.
- 2026-11-14: partial backfill, as Kurt asked: 45 of the oldest files (38 photos, 7
  videos), 0 failures, ~6 s each. 130 left as `missing` for Kurt to try the Media
  Thumbnails tab. Storage Check clean (113 files, 0 with no record, 0 missing).

**Release 1 (new uploads):** migration, view, the two new workflows, the four changed ones,
pages. Photos and videos uploaded after it get thumbnails; older ones keep working from
originals. Verified on Staging first (upload JPEG + HEIC + MP4 + MOV; check the files, the
URLs, the tiles and lightbox; delete one of each and check their copies go; Storage Check
shows nothing new).

**Release 2 (existing photos, any time after):** no code. On Production, open Media
Activity → Media Thumbnails and generate in batches of up to 10 until none are missing
(Staging's data today: 148 photos and 32 videos).
Written as a runbook step; Staging first.

## Decisions (Kurt, 2026-11-14)

1. **Three phases, all on this branch before it merges:** phase 1 catch photos (this doc),
   phase 2 profile photos, phase 3 video poster images. Phases 2 and 3 have their own
   sections below.
2. **"Download original"** link in the lightbox (full-size file).
3. **Sizes: 1200 / 2048 px**, quality 82 / 85, color profile kept (see "Sizes" below).

## Sizes

- **Thumbnail 1200 px long side, q82.** A vertical photo in a full-width phone tile is shown
  ~390 CSS px wide on a 3x screen: at 800 px its short side is only 600 px, visibly soft.
  At 1200 it's 900 px, sharp enough for a tile. ~150-300 KB.
- **Viewing copy 2048 px long side, q85.** Fills a laptop/desktop screen and a phone held
  either way without upscaling; anything closer goes to Download original. ~400-900 KB.
- **Quality 82/85, not 75:** water and sky are smooth gradients, where low quality shows as
  banding and blocks first.
- **Keep the color profile:** `+profile "!icc,*"` instead of `-strip` removes camera and GPS
  data but keeps the ICC profile, so iPhone (Display P3) photos don't come out duller.
- Checked by eye on Staging: original vs both copies side by side, on a phone and the laptop.

## Phase 2: profile photos — sharper crops (decided, built)

**Kurt, 2026-11-14: option 2.** The crop screen now saves at **512 px square** (JPEG 0.92,
about 40-60 KB), instead of at the size of the box on screen. A crop from a smaller area of
the photo than that is saved at its own size, never stretched. Pages only (the crop happens
in the browser): no workflow, database or storage change. Existing profile photos stay as
they are until their angler crops a new one. Same on the angler edit page and My Profile.

Background, as found:

Checked before designing anything: **profile photos are already small.** The crop screen
saves the cropped square at the size of the crop box on screen, so every profile photo is
about 226 px square and 12-34 KB (all 8 on Staging measured). They're shown at 24-96 px.
A thumbnail would save almost nothing, and storing two copies of a 20 KB file adds a
workflow, columns and clean-up for no visible gain.

The one real gap goes the other way: **226 px is slightly soft at the largest size** (96 px
on the angler edit page is 288 screen pixels on a 3x phone).

Options considered:
1. **Drop phase 2** (recommended): profile photos are already the size a thumbnail would be.
2. **Make new crops sharper instead:** save the crop at a fixed 512 px square (about 40-60
   KB), a small change in the crop screen. Existing photos stay as they are until re-cropped.
3. Build thumbnails for them anyway, as for catch photos (not recommended, see above).

## Phase 3: video poster frames

**Why:** each video tile today loads the start of its video to show a first frame, holding
one of the browser's 6 connections per video. With a poster, a tile loads one small picture and **no video until it's tapped**.

**Made by** the same Make Thumbnails workflow (and endpoint, page tab and buttons):
- `ffmpeg -ss 1 -i <read_url> -frames:v 1 -q:v 2 frame.jpg`: one frame about a second in,
  past a black first frame (a clip shorter than that uses its first frame). ffmpeg reads
  only the parts of the video it needs, straight from the URL, and turns phone videos
  upright by itself.
- Then the same `magick` step as a photo thumbnail: 1200 px, q82, color profile kept.
- Stored as `<ID>-thumb.jpg` in `thumbnail_url`; `viewing_url` stays empty. Same name
  pattern as photos, so deleting, Storage Check and "one photo, one tile" need nothing new.
- All 180 media paths on Staging (148 photos; 32 videos: 15 MP4, 17 MOV) match the
  workflow's path rules.

**Pages (built):**
- **Video tile with a poster:** the poster with the same blurred fill as photo tiles, so
  vertical phone videos aren't cropped, plus the ▶ overlay. No `<video>` element until
  tapped.
- **No poster yet:** the video's start, as today. **A poster that fails to load** (e.g.
  missing from storage) falls back to the same.
- **Lightbox:** the poster shows while the video loads.
- **Media Thumbnails tab:** videos without a poster are listed with 🎬 in place of a
  preview, and generated like photos.
