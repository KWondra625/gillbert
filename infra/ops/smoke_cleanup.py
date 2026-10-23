"""Clean-up, part 1 of 2: delete the smoke-test catches' media through the app, so the files leave storage the
same way a real delete does. Part 2 is smoke_cleanup.sql (DBeaver), which deletes the rows and resets the
counters so the next real catch gets the next number.

Everything newer than the baseline (the newest catch restored from the Pi) is smoke-test data: the anglers
aren't told until the clean-up is done.

  python infra/ops/smoke_cleanup.py bridge01 --after-catch 147               # DRY RUN: list what would go
  python infra/ops/smoke_cleanup.py bridge01 --after-catch 147 --delete      # delete the media

Refuses unless exactly --expect-catches catches (default 2) are newer than the baseline. Keys as smoke_check.py.
Never prints keys, media links or notes beyond the first 40 characters.
"""
import argparse, json, os, sys, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_check import SERVERS, UA, Server, keys, unwrap


def post(s, path, body):
    req = urllib.request.Request(s.base + "/webhook/gillbert/" + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"User-Agent": UA, "X-API-Key": s.key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def media_of(s, catch_number):
    status, data, _ = s.get("catch-media/get?catchNumber=" + urllib.parse.quote(catch_number))
    if status != 200:
        sys.exit(f"STOP: catch-media/get for {catch_number} -> HTTP {status}")
    return [m for m in unwrap(data) if m and m.get("blobPath")]


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("server", choices=SERVERS)
    ap.add_argument("--after-catch", type=int, required=True, metavar="ID", help="baseline: the newest real catch id")
    ap.add_argument("--expect-catches", type=int, default=2)
    ap.add_argument("--delete", action="store_true", help="actually delete the media (otherwise a dry run)")
    a = ap.parse_args()
    key = os.environ.get("GILLBERT_SMOKE_KEY") or keys().get(SERVERS[a.server][1])
    if not key:
        sys.exit(f"No key for {a.server}: add {SERVERS[a.server][1]}=... to .claude/.env.gillbert-smoke")
    s = Server(a.server, key)

    status, data, _ = s.get("get-catches")
    if status != 200:
        sys.exit(f"STOP: get-catches -> HTTP {status}")
    catches = [c for c in unwrap(data) if c and c.get("catchNumber")]
    if not any(int(c["id"]) == a.after_catch for c in catches):
        sys.exit(f"STOP: no catch with id {a.after_catch} on {a.server}; check the baseline")
    tests = sorted((c for c in catches if int(c["id"]) > a.after_catch), key=lambda c: int(c["id"]))
    print(f"{a.server}: {len(catches)} catches; newer than the baseline ({a.after_catch}): {len(tests)}")
    plan = []
    for c in tests:
        media = media_of(s, c["catchNumber"])
        plan += [(c["catchNumber"], m) for m in media]
        print(f"  {c['catchNumber']}  created {str(c.get('createdAt'))[:16]}  by {c.get('createdByAnglerName')}  "
              f"via {c.get('recordSource')}  notes: {(c.get('notes') or '')[:40]!r}  media: {len(media)}")
    if len(tests) != a.expect_catches:
        sys.exit(f"STOP: expected {a.expect_catches} test catch(es), found {len(tests)}; look before deleting anything")

    if not a.delete:
        print(f"\nDRY RUN: would delete {len(plan)} media file(s). Nothing was deleted. Add --delete to go.")
        sys.exit(0)

    print(f"\nDeleting {len(plan)} media file(s) through the app...")
    for number, m in plan:
        st = post(s, "catch-media/delete", {"mediaId": m["id"]})
        print(f"  {'ok  ' if st == 200 else 'FAIL'}  {number}  media {m['id']}  {m.get('mediaType')}  (HTTP {st})")
        if st != 200:
            sys.exit("STOP: a delete failed; nothing after it was attempted")
    left = sum(len(media_of(s, c["catchNumber"])) for c in tests)
    gone = []
    for _, m in plan:  # the stored link must stop working too, i.e. the file really left storage
        try:
            urllib.request.urlopen(urllib.request.Request(m["readUrl"], headers={"Range": "bytes=0-0", "User-Agent": UA}), timeout=60)
            gone.append(False)
        except urllib.error.HTTPError as e:
            gone.append(e.code == 404)
    print(f"\nMedia rows left on the test catches: {left}. Files gone from storage: {sum(gone)} of {len(gone)}.")
    if left or not all(gone):
        sys.exit("STOP: not fully clean; don't run the SQL yet")
    print("Clean. Next: smoke_cleanup.sql in DBeaver (part 2).")
