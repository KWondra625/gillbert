"""Gear setup photos, follow-ups (docs/plans/gear-tip-ups.md, "Still to do"). Changes two existing
workflows; each is backed up first and --restore puts it back.

  Gillbert - Gear - POST Save Gear       deleting a tip-up (no catches) also deletes its setup
                                         photos' files: gear_save answers removePaths (scripts/gear/02),
                                         then the same delete steps as Remove Setup Photo.
  Gillbert - Media - POST Media Admin    the Media page's Storage Check covers gear-media too:
                                         files no setup points at (delete only), setups pointing at
                                         a missing file.

  python -I -X utf8 gear/deploy_gear_photo_cleanup.py              Staging dry run
  python -I -X utf8 gear/deploy_gear_photo_cleanup.py --apply      Staging (Kurt's OK)
  python -I -X utf8 gear/deploy_gear_photo_cleanup.py --restore <backup dir>
  --prod: production, ONLY at release with Kurt's separate OK.
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deploy_gear_photos as P  # noqa: E402  (its helpers; same --apply / --prod flags)

SAVE_GEAR = "Gillbert - Gear - POST Save Gear"
MEDIA_ADMIN = "Gillbert - Media - POST Media Admin"
RESTORE = sys.argv[sys.argv.index("--restore") + 1] if "--restore" in sys.argv else None


def plan_save_gear(live, sas_id):
    nodes = copy.deepcopy(live["nodes"])
    by = {n["name"]: n for n in nodes}
    if "Files To Delete" in by:
        return nodes, live["connections"]                       # already done
    resp = by["Respond to Webhook"]
    assert resp["parameters"]["responseBody"] == "={{ JSON.stringify($json.result) }}", resp["parameters"]["responseBody"]
    resp["parameters"]["responseBody"] = "={{ JSON.stringify($('Save Gear').first().json.result) }}"
    save_pos = by["Save Gear"]["position"]
    dnodes, dconns = P.delete_chain(sas_id, "Respond to Webhook")
    for n in dnodes:                                            # delete_chain positions are grid units
        n["position"] = [save_pos[0] + 240 * (n["position"][0] + 1), save_pos[1] + 200 * n["position"][1]]
    for n in nodes:
        if n["position"][0] > save_pos[0]:
            n["position"] = [n["position"][0] + 240 * 4, n["position"][1]]
    nodes += dnodes
    conns = copy.deepcopy(live["connections"])
    outs = conns["Save Gear"]["main"]
    assert [c["node"] for c in outs[0]] == ["Respond to Webhook"], outs
    outs[0] = [{"node": "Files To Delete", "type": "main", "index": 0}]
    conns.update(dconns)
    st = next((n for n in nodes if n["type"] == "n8n-nodes-base.stickyNote" and n["name"] != "Sticky Note"), None)
    if st:
        st["parameters"]["content"] += ("\nDeleting a tip-up also deletes its setup photos' files (removePaths from "
                                        "gear_save; the same delete steps as Remove Setup Photo).")
    return nodes, conns


# Text swaps in the live Media Admin nodes (each must match exactly once)
LOAD_OLD = """-- Every stored file a record points at: catch media, and anglers' profile photos.
SELECT id, blob_path, read_url, 'catch-media' AS container FROM catch_media
UNION ALL
SELECT id, profile_photo_blob_path, profile_photo_read_url, 'angler-media' FROM anglers
WHERE profile_photo_blob_path IS NOT NULL;"""
LOAD_NEW = """-- Every stored file a record points at: catch media, anglers' profile photos, and tip-up setup
-- photos (one row per photo; id = the tip-up, since several versions can share one).
SELECT id, blob_path, read_url, 'catch-media' AS container FROM catch_media
UNION ALL
SELECT id, profile_photo_blob_path, profile_photo_read_url, 'angler-media' FROM anglers
WHERE profile_photo_blob_path IS NOT NULL
UNION ALL
SELECT DISTINCT ON (photo_blob_path) gear_id, photo_blob_path, photo_read_url, 'gear-media' FROM gear_setups
WHERE photo_blob_path IS NOT NULL;"""

CODE_SWAPS = [
    ("""  'angler-media': /^anglers\\/\\d+\\/[A-Z0-9]{8,24}\\.([a-z0-9]{3,4})$/,
};""",
     """  'angler-media': /^anglers\\/\\d+\\/[A-Z0-9]{8,24}\\.([a-z0-9]{3,4})$/,
  // tip-up setup photos (gear stage 3), with their thumbnail and viewing copy
  'gear-media':   /^gear\\/\\d+\\/[A-Z0-9]{8,24}(?:-(?:thumb|view))?\\.([a-z0-9]{3,4})$/,
};"""),
    ("""// action 'scan': compare the files in storage with the records, both ways: catch media
// (catches/ in catch-media) and profile photos (anglers/ in angler-media).""",
     """// action 'scan': compare the files in storage with the records, both ways: catch media
// (catches/ in catch-media), profile photos (anglers/ in angler-media) and tip-up setup photos
// (gear/ in gear-media)."""),
    ("const CONTAINERS = { 'catch-media': 'catches/', 'angler-media': 'anglers/' };",
     "const CONTAINERS = { 'catch-media': 'catches/', 'angler-media': 'anglers/', 'gear-media': 'gear/' };"),
    ("""// A catch photo's or video's thumbnail and viewing copy (#38) belong to its record. One whose
// record is gone isn't known, so it's listed as a file with no record.
for (const r of rows) {
  if (r.container !== 'catch-media') continue;""",
     """// A catch photo's or video's thumbnail and viewing copy (#38), and a setup photo's, belong to its
// record. One whose record is gone isn't known, so it's listed as a file with no record.
for (const r of rows) {
  if (r.container === 'angler-media') continue;"""),
    ("  const blobs = [...await listBlobs('catch-media'), ...await listBlobs('angler-media')];",
     "  const blobs = [...await listBlobs('catch-media'), ...await listBlobs('angler-media'), ...await listBlobs('gear-media')];"),
    ("""    ? { ...b, anglerId: Number((b.blobPath.match(/^anglers\\/(\\d+)\\//) || [])[1]) || null }
    : { ...b, catchNumber""",
     """    ? { ...b, anglerId: Number((b.blobPath.match(/^anglers\\/(\\d+)\\//) || [])[1]) || null }
    : b.container === 'gear-media' ? { ...b, gearId: Number((b.blobPath.match(/^gear\\/(\\d+)\\//) || [])[1]) || null }
    : { ...b, catchNumber"""),
    ("""      ? { container: r.container, anglerId: r.id, blobPath: r.blob_path }
      : { container: r.container, id: r.id, blobPath: r.blob_path });""",
     """      ? { container: r.container, anglerId: r.id, blobPath: r.blob_path }
      : r.container === 'gear-media' ? { container: r.container, gearId: r.id, blobPath: r.blob_path }
      : { container: r.container, id: r.id, blobPath: r.blob_path });"""),
    ("""      ? "This is an angler's current profile photo; remove it from the angler instead."
      : 'A media record""",
     """      ? "This is an angler's current profile photo; remove it from the angler instead."
      : container === 'gear-media' ? "A tip-up's setup uses this photo; remove it from the tip-up instead."
      : 'A media record"""),
]


def plan_media_admin(live):
    nodes = copy.deepcopy(live["nodes"])
    by = {n["name"]: n for n in nodes}
    load = by["Load Media Paths"]["parameters"]
    code = by["Run Admin Action"]["parameters"]
    if "'gear-media'" in code["jsCode"]:
        return nodes                                            # already done
    assert load["query"].count(LOAD_OLD) == 1, "Load Media Paths query isn't what this script expects"
    load["query"] = load["query"].replace(LOAD_OLD, LOAD_NEW)
    for a, b in CODE_SWAPS:
        assert code["jsCode"].count(a) == 1, f"Run Admin Action: expected once: {a[:70]!r}"
        code["jsCode"] = code["jsCode"].replace(a, b)
    return nodes


if __name__ == "__main__":
    by_name = {w["name"]: w for w in P.get("/workflows?limit=250")["data"]}
    for need in (SAVE_GEAR, MEDIA_ADMIN, P.SHARED_SAS):
        if need not in by_name:
            sys.exit(f"STOP: {need!r} not found on {P.HOST}")
    if RESTORE:
        for f in sorted(os.listdir(RESTORE)):
            old = json.load(open(os.path.join(RESTORE, f), encoding="utf-8"))
            back = P.put_workflow(old["id"], P.get(f"/workflows/{old['id']}"), old["nodes"], old["connections"])
            print(f"restored {old['name']} ({old['id']}) active={back['active']}")
        sys.exit("Restore done.")

    backup_dir = os.path.join(P.DRAFTS, f"photo_cleanup_backup_{P.HOST}_{P.STAMP}")
    os.makedirs(backup_dir)
    plans = []
    live = P.get(f"/workflows/{by_name[SAVE_GEAR]['id']}")
    nodes, conns = plan_save_gear(live, by_name[P.SHARED_SAS]["id"])
    plans.append((live, nodes, conns))
    live = P.get(f"/workflows/{by_name[MEDIA_ADMIN]['id']}")
    plans.append((live, plan_media_admin(live), live["connections"]))

    todo = []
    for live, nodes, conns in plans:
        if nodes == live["nodes"] and conns == live["connections"]:
            print(f"{live['name']}: already up to date")
            continue
        json.dump(live, open(os.path.join(backup_dir, f"{live['id']}.json"), "w", encoding="utf-8"), indent=1)
        P.summary({"name": live["name"], "nodes": nodes, "connections": conns})
        todo.append((live, nodes, conns))
    print(f"Backup: {backup_dir}")
    if not P.APPLY:
        sys.exit(f"dry run: nothing written to {P.HOST}")
    for live, nodes, conns in todo:
        back = P.put_workflow(live["id"], live, nodes, conns)
        ok = ({n["name"]: n["parameters"] for n in back["nodes"]} == {n["name"]: n["parameters"] for n in nodes}
              and back["active"] == live["active"])
        print(f"{live['name']} ({live['id']}): read-back {'OK' if ok else 'MISMATCH'} (active={back['active']})")
        if not ok:
            sys.exit(f"STOP: restore with --restore {backup_dir}")
    print(f"Done. Undo: --restore {backup_dir}")
