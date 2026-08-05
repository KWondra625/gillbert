# Fish Species Roster: DNR Sourcing & Refresh Process

Context for how the `fish_species` table went from 10 ad-hoc rows to a
curated ~30-species roster sourced from the Wisconsin DNR, and how to
refresh it later without re-learning the pitfalls the hard way.

## Sources used, and what each is actually good for

**1. WI DNR "Meet your Wisconsin Fishes" page**
`https://dnr.wisconsin.gov/topic/Fishing/species`

Has a table of the ~15 most common species, most linking to a per-species
page. Metadata on those pages is inconsistent — Largemouth Bass's page has
decent detail (scientific name, distribution, spawning behavior), but the
Catfish page covers *two* species jointly ("Channel and Flathead catfish")
with almost nothing inline. Don't expect more than: common name, sometimes
a scientific name, and a URL.

**2. The "full species list" PDF linked at the bottom of that page**
(`Species_wifish.pdf`)

**Do not seed directly from this.** It looks like it should be "the 160
species" but it's actually the complete official Wisconsin ichthyological
checklist — ~300 taxa including lampreys, darters, sculpins, gobies,
shiners, dace, chubs, hybrids, and extirpated/endangered species. It's
built for biologists, not anglers, and most of it will never be logged as
a catch. This was the single biggest wrong turn in the original research —
if a future refresh goes back to DNR sourcing, start from the regulations
pamphlet or the common-species page instead.

The PDF *is* still useful for one thing: it's organized under real
taxonomic family headers (e.g. `CENTRARCHIDAE - SUNFISHES`,
`ESOCIDAE - PIKES`), which is where `family_scientific_name` values came
from.

**3. WI DNR Hook and Line Fishing Regulations pamphlet** (statewide
bag-limit table, roughly page 16 as of the 2026-2027 edition)
`https://widnr.widen.net/s/glhqr9znsp/fishingregselectronic2627`

The best signal for "what anglers actually target" — it groups species by
shared bag limit (e.g. "Largemouth and smallmouth bass," "Panfish
(bluegill, pumpkinseed, yellow perch, white and black crappie)"). This repo's
roster splits those regulatory bundles into individual species rather than
keeping DNR's groupings, to match the granularity the app already wanted
(e.g. Largemouth vs. Smallmouth Bass as distinct catches).

## Curation criteria

The current ~30-species roster (plus a permanent `Other` catch-all) combined:
- Every species already appearing in real catch history at the time
- The DNR's 15-most-common list, split into individual species
- The regulations pamphlet's bag-limit groupings, similarly split
- A couple of frequent incidental catches not on DNR's "common" list but
  caught often in practice (Freshwater Drum, Common Carp)

Explicitly excluded: true rarities and academic-only taxa (gar, paddlefish,
general "rough fish," invasive-only species like round goby/ruffe). The
goal was a roster sized for "our group's actual fishing," not statewide
completeness.

## Schema decisions and why

| Column | Purpose |
|---|---|
| `name` | DNR-sourced canonical name. **Not exposed as editable in the admin UI** — it's the join key `upsert_fish_species_roster.sql` matches on via `ON CONFLICT (name)`. Renaming it there would break future refreshes matching this row back up. |
| `display_name_override` | Nullable. Lets the app show something different from the DNR name (e.g. "Musky" instead of "Muskellunge," "Perch" instead of "Yellow Perch") without touching `name`. This is what admins should edit instead. |
| `aliases` | Nicknames/alternate spellings used for exact-match and fuzzy-match (`pg_trgm`) lookup when Catch Chat resolves free-text species mentions. |
| `family_display_name` | Informal grouping for organizing the admin UI (e.g. "Panfish," "Pike") — not real taxonomy, just what reads naturally to anglers. |
| `family_scientific_name` | Real taxonomic family (e.g. "Centrarchidae," "Esocidae"), sourced from the checklist PDF's section headers. |
| `dnr_url` | Link to the species' own DNR page, when one exists — not all species have one (e.g. White Bass, Rock Bass don't). |
| `status` | DB constraint still allows `Submitted`/`Active`/`Inactive`, but the admin UI only exposes Active/Inactive. Nothing in the app produces `Submitted` rows anymore, and Catch Chat's fuzzy-match fallback only checks `Inactive` — a `Submitted` row is effectively invisible everywhere. Not worth a schema change to remove it, just not surfaced. |

A species-level `scientific_name` column was considered and deliberately
dropped — nothing in the app displays it, and it's trivial to add back if
a real use for it ever comes up.

## How to run a refresh

1. Re-check the sources above for anything that's changed (new common
   species, updated bag-limit groupings, dead DNR links).
2. Hand-edit the `VALUES` list in `scripts/upsert_fish_species_roster.sql`
   — there's no automated diffing against the DNR site, this is manual.
3. Re-run only Step 2 of the script — Step 1 is **not** safe to re-run:
   - **Step 1** (the handful of identity-fixing `UPDATE`s for the
     originally-messy legacy rows) is a one-time historical correction,
     not part of the ongoing refresh. It writes directly to `aliases` and
     `display_name_override` with no guard, so re-running it will stomp
     any admin-UI edits made to those fields on the rows it touches.
     **Skip it on every refresh after the first run.**
   - **Step 2** (the main upsert) only refreshes `family_display_name`,
     `family_scientific_name`, and `dnr_url` on conflict — it **never**
     touches `status`, `aliases`, `notes`, or `display_name_override` on
     an existing row. Anything hand-curated through the admin UI survives
     a refresh untouched.

Day-to-day status changes (turning a species on/off) don't need this
script at all — that's what the admin UI (`fish-species-listing.html` /
`edit-fish-species.html`) is for.

`scripts/snapshot_fish_species_pre_metadata_expansion.sql` and
`scripts/add_fish_species_metadata_columns.sql` were one-time migration
artifacts from the original 10→33 expansion — not part of the ongoing
refresh cycle, kept for historical reference.
