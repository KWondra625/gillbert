# Media Management (admin page)

Status: **agreed with Kurt 2026-11-14**, building on `feature/media-thumbnails` after #38.

The admin **Media Activity** page becomes **Media Management**: one place to watch uploads
and to look after the stored files.

## Tabs, in this order

| Tab | What it's for |
|---|---|
| 📋 **Uploads** | Today's list: every upload with its status, filtered All / ⚠️ Needs attention / ⏳ Converting, with Retry and Delete. Unchanged. |
| 🖼️ **Media Thumbnails** | Photos and videos without their thumbnails (#38): tick up to 10, Generate, one at a time, Stop. Built in #38. |
| 🍎 **Apple Formats** | New: files still in an Apple format, to convert to the formats every browser plays. |
| 🧹 **Storage Check** | Records without a file, and files without a record. Unchanged. |

Day-to-day monitoring first, occasional clean-up last. The summary tiles above the tabs each
jump to their tab, with one added for Apple formats.

## 🍎 Apple Formats

**What's listed:** complete catch media still stored as HEIC/HEIF photos or MOV videos. Every
upload has been converted since conversion was added, so this is the files from before that:
today **17 MOV videos from January-February 2026**. Short-lived by design: once they're
converted the tab says there's nothing to convert. (MP4s with Apple's HEVC video inside are
left out: finding them means reading every video file.)

**Converting:** like the Thumbnails tab. Tick up to 10 ("Select 10" tops up), press
**Convert**, and they're done one at a time, each row showing ⏳ → ✅ or ⚠️ with the reason.
**Stop** finishes the current file and skips the rest.
- Each file goes through the same conversion as an upload (HEIC → JPEG, MOV → MP4, at most
  1080p H.264). The new file replaces the Apple one on the record, the Apple file is removed,
  and the new file then gets its thumbnail or poster automatically.
- A video can take minutes. The page starts the conversion and checks back every few seconds
  until the record is complete or failed, so no request has to stay open that long. After 15
  minutes it moves on and says the file is still converting (Uploads shows how it ends).
- A conversion that fails leaves the original in place, shows ⚠️ with the reason, and can be
  tried again (here, or with Retry on Uploads).
- **Staging:** these files live in Production's storage. Staging reads the original from its
  public link and writes the converted file to **Staging's own storage**; it never touches
  the Production original.

**Server changes (two, both small):**
- **POST Retry Catch Media:** also accepts a complete HEIC/HEIF/MOV (today: only failed or
  stuck). The page's Convert button calls it, so there's no new endpoint.
- **Convert Media:** reads the original from its public link when it isn't in this server's
  own storage (only these legacy files on Staging). On Production nothing changes.

## Page rename

- `media-activity.html` → `media-management.html` (with its script and stylesheet). No
  forwarding page: Kurt has no bookmarks to the old address.
- The admin menu entry, the page title and heading, and the Features page say Media
  Management.

## Applied on Staging

- 2026-11-14: Retry and Convert Media changes (`tools/n8n-migration/media_rework/deploy_apple_formats.py`,
  backups in its snapshots/); both read back OK and active. Tried on the smallest legacy MOV
  (id 72, Catch 26-081, 33.5 MB): converted in 29 s to an 8.9 MB MP4 in Staging's storage,
  poster frame made automatically, the original in Production's storage untouched. 16 left
  for Kurt to try the tab.
