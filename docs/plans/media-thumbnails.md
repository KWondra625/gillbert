# Media thumbnails (#38)

Status: **draft for Kurt's review**, 2026-11-14. Nothing here is on a server yet.

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

**Videos: not in this round** (see open questions). Video tiles keep loading the start of
the video for their first frame.

## Database

Migration `scripts/catch_media_data/add_thumbnail_columns.sql` (safe to re-run), on each
server before its workflows change:

- `thumbnail_url`, `viewing_url` (varchar 255, null = no thumbnails yet)
- `thumbnail_error` (text, null unless the last attempt failed)
- `thumbnails_updated_at` (timestamptz)

`vw_catch_media_details` gets the four columns appended at the end, plus
`thumbnail_status`: `done` (has both URLs), `failed` (has an error), `missing` (a complete
photo with neither), or null (videos, and photos still converting).

## n8n

**New: `Gillbert - Media - Make Thumbnails`** (sub-workflow, input `mediaId`). One photo per run:
1. Load the row; stop quietly unless it's a complete photo.
2. Download the original from its `read_url` (public read). On Staging most rows point at
   Production's storage: the original is only *read* from there. Thumbnails are always
   written to **this server's own storage**, so Staging never writes to Production storage.
3. Make both sizes with `magick` (in the same image that already converts HEIC).
4. Upload both, then save the URLs (`thumbnail_error` cleared), or save the error.
5. Returns `{ ok, mediaId, thumbnailUrl, viewingUrl, error }`. Never throws.
6. Same temp-file pattern and sweep as Convert Media (`/tmp/gillbert_*`).

**New: `Gillbert - Media - POST Make Thumbnails`** (`gillbert/catch-media/thumbnails`): body
`{ mediaId }`, the same access check as the existing Media Admin endpoint, runs Make
Thumbnails and waits, responds with its result. **One photo per call**: the page sends the
selected photos one at a time, so each call is short (no webhook timeouts, light on the Pi)
and the page can show each photo's progress.

**Changed:**
- **Log Catch Media Details (commit):** photos recorded as complete straight away (JPEG/PNG)
  start Make Thumbnails without waiting, like it starts Convert Media today. Also refuses a
  `-thumb.jpg`/`-view.jpg` file (see "One photo, one tile").
- **Convert Media:** after Mark Complete for a photo, start Make Thumbnails without waiting.
  (A HEIC is thumbnailed from its converted JPEG.)
- **GET Catch Media:** the response mapping adds `thumbnailUrl`, `viewingUrl`,
  `thumbnailStatus`, `thumbnailError` (the mapping lists fields explicitly).
- **POST Delete Catch Media:** deletes all three files, then the record (see "Deleting a
  photo" below).
- **Media Admin scan:** a `-thumb`/`-view` file whose ID has a record counts as known;
  one whose record is gone is listed as a file with no record, so leftovers from a failed
  delete still show up. `delete-orphan` accepts those names; the page offers only Delete.

Thumbnail failures never fail the upload: the photo is complete and viewable either way.

### Deleting a photo

All three files go with the record, in one delete (the 🗑️ on the catch page, or Delete on
Media Activity: both call POST Delete Catch Media, the only way media is deleted).
- **Order:** thumbnail, viewing copy, original, then the record. Today it's original then
  record; the record stays last, so the photo only disappears from the page once every file
  is gone.
- **A file that's already gone is fine** (an older photo with no copies yet, or a second try
  after a failure). The names come from the photo's ID, so the delete doesn't depend on the
  URL columns being filled in.
- **Any other failure stops the delete** before the record goes: the photo stays on its
  catch, the page shows the error, and pressing delete again finishes the job.
- **Deleted while its thumbnails are being made:** Make Thumbnails saves its URLs only if
  the record still exists. If it's gone, it deletes the two files it just wrote, so nothing
  is left behind.
- **Anything left behind anyway** (e.g. the server restarted mid-delete) shows up in Storage
  Check as a file with no record, offering Delete only.

## Pages

- **Catch details:** photo tiles (and their blurred backdrop) use `thumbnailUrl`; the
  lightbox uses `viewingUrl`. A photo without them uses the original, as today.
- **Home card:** `thumbnailUrl`, else the original.
- **Media Activity:** a third tab, **🖼️ Media Thumbnails**, and a summary tile counting
  photos without thumbnails.
  - Lists complete photos that are `missing` or `failed` (newest first, with the error for
    failed ones), each with a checkbox, a preview, its catch and size.
  - Check 1 to 10 (the rest disable at 10; "Select 10" tops the selection up to ten), then
    **Generate Thumbnails**. The page runs the selected photos one at a time, showing each
    row's progress (⏳ → ✅ or ⚠️ with the reason). **Stop** finishes the current photo and
    skips the rest.
  - Safe to stop or rerun: closing the tab mid-run leaves the remaining photos `missing`,
    and generating for a photo that already has thumbnails just remakes them.
  - Doubles as the repair tool: a photo whose automatic generation failed at upload shows
    up here as `failed`.
- Not changed: video tiles, profile photos (`angler-media`), the catches listing.

## Releases

**Release 1 (new uploads):** migration, view, the two new workflows, the four changed ones,
pages. Photos uploaded after it get thumbnails; older ones keep working from originals.
Verified on Staging first (upload JPEG + HEIC; check both files, the URLs, the tiles and
lightbox; delete one and check its thumbnails go; Storage Check shows nothing new).

**Release 2 (existing photos, any time after):** no code. On Production, open Media
Activity → Media Thumbnails and generate in batches of up to 10 until none are missing.
Written as a runbook step; Staging first.

## Decisions (Kurt, 2026-11-14)

1. **Three phases, all on this branch before it merges:** phase 1 catch photos (this doc),
   phase 2 profile photos, phase 3 video poster images. Phases 2 and 3 get their own
   sections here before they're built.
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
