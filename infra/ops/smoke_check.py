"""Read-only smoke check of a Gillbert server: every GET endpoint the site uses, plus data and media sanity.

Sends GET requests only (n8n webhooks plus a 1-byte read of a media file or two in Azure). Writes nothing.
Never prints keys, media links or catch data; only counts, field names and PASS/FAIL lines.

  python infra/ops/smoke_check.py bridge01 --expect production
  python infra/ops/smoke_check.py lab01 --expect staging
  python infra/ops/smoke_check.py bridge01 --compare-with api     # the night: new production vs the frozen Pi

Servers: bridge01, lab01 (the Pi), api (the Pi's old hostname). Keys come from the gitignored
.claude/.env.gillbert-smoke (BRIDGE01_KEY=..., PI_KEY=...; use each server's direct_connect key from the
password manager), or GILLBERT_SMOKE_KEY for a single-server run. Exit code 1 if anything FAILs.
"""
import argparse, json, os, sys, time, urllib.error, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY_FILE = os.path.join(REPO, ".claude", ".env.gillbert-smoke")
SERVERS = {
    "bridge01": ("https://bridge01.builtbykw.net", "BRIDGE01_KEY"),
    "lab01":    ("https://lab01.builtbykw.net", "PI_KEY"),
    "api":      ("https://api.builtbykw.net", "PI_KEY"),
}
STORAGE = {"production": "gillbertmedia", "staging": "gillbertmediastaging"}
UA = "kw-smoke-check/1.0 (KW Solutions)"  # Cloudflare blocks Python's default User-Agent
# Fields each page relies on; a missing one means a workflow or view changed shape.
FIELDS = {
    "get-catches": {"catchNumber", "anglerId", "anglerName", "fishSpeciesId", "fishSpeciesName", "bodyOfWaterId",
                    "caughtWhen", "length", "catchMediaCount", "createdAt", "updatedAt"},
    "fish-species/get": {"id", "name", "displayNameOverride", "status"},
    "bodies-of-water/get": {"id", "name", "wbic", "status"},
    "anglers/get": {"id", "name", "status", "groups", "profilePhotoReadUrl"},
    "catch-media/get": {"catchNumber", "blobPath", "readUrl", "mediaType", "contentType"},
}
# Compared field by field between two servers (SAS links and the like differ by design, so they're left out)
COMPARE_CATCH = ["catchNumber", "anglerId", "fishSpeciesId", "bodyOfWaterId", "caughtWhen", "length", "waterDepth",
                 "notes", "catchMediaCount", "createdAt", "updatedAt", "verifiedAt", "recordSource"]


def keys():
    out = {}
    if os.path.exists(KEY_FILE):
        for line in open(KEY_FILE, encoding="utf-8"):
            line = line.strip().replace("\r", "")
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


class Server:
    def __init__(self, name, key):
        self.name, self.base, self.key = name, SERVERS[name][0], key
        self.fails = 0

    def get(self, path, key=True):
        req = urllib.request.Request(self.base + "/webhook/gillbert/" + path,
                                     headers={"User-Agent": UA, **({"X-API-Key": self.key} if key else {})})
        t = time.time()
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                status, body = r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read().decode("utf-8", "replace")
        except urllib.error.URLError as e:
            status, body = 0, str(e.reason)
        try:
            data = json.loads(body) if body else None
        except json.JSONDecodeError:
            data = None
        return status, data, time.time() - t

    def check(self, label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  (' + detail + ')' if detail else ''}")
        if not ok:
            self.fails += 1
        return ok


def unwrap(data):
    """n8n's Respond to Webhook sometimes wraps the list in another list."""
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], list):
        return data[0]
    return data if isinstance(data, list) else []


def blob_ok(url, account):
    """1-byte read of a media file: proves the stored link works and points at an allowed storage account.
    Staging's data is a copy of production, so copied rows keep production links (read-only; decided 2026-10-06)."""
    allowed = {account} | ({STORAGE["production"]} if account == STORAGE["staging"] else set())
    host = urllib.parse.urlparse(url or "").hostname or ""
    acct = host.split(".")[0]
    if host != f"{acct}.blob.core.windows.net" or acct not in allowed:
        return False, f"points at {acct or 'nothing'}, expected {' or '.join(sorted(allowed))}"
    req = urllib.request.Request(url, headers={"Range": "bytes=0-0", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            note = ", copied from production" if acct != account else ""
            return r.status in (200, 206), f"HTTP {r.status}, {acct}{note}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"


def run(s, expect):
    """All checks against one server. Returns what --compare-with needs."""
    print(f"\n=== {s.name}  ({s.base}) ===")
    got = {}
    for path in ("get-catches", "get-lookup-data", "fish-species/get", "bodies-of-water/get", "anglers/get"):
        status, data, secs = s.get(path)
        s.check(f"GET {path}", status == 200 and isinstance(data, list), f"HTTP {status}, {secs:.1f}s")
        got[path] = data if status == 200 else None
    catches = [c for c in unwrap(got["get-catches"]) if c and c.get("catchNumber")]
    species, waters, anglers = (unwrap(got[p]) for p in ("fish-species/get", "bodies-of-water/get", "anglers/get"))
    lookup = (got["get-lookup-data"] or [{}])[0] if got["get-lookup-data"] else {}

    # Fields the pages read
    for path, rows in (("get-catches", catches), ("fish-species/get", species),
                       ("bodies-of-water/get", waters), ("anglers/get", anglers)):
        missing = FIELDS[path] - set(rows[0]) if rows else FIELDS[path]
        s.check(f"{path}: {len(rows)} rows with the expected fields", rows and not missing,
                "missing " + ", ".join(sorted(missing)) if missing else "")

    # System Info (missing on the Pi until step 6 creates it)
    status, info, _ = s.get("system-info")
    server, db = {}, {}
    if status == 404:
        print("  SKIP  system-info (not on this server yet)")
    elif s.check("GET system-info", status == 200 and isinstance(info, list) and info, f"HTTP {status}"):
        server, db = info[0].get("server", {}), info[0].get("database", {})
        s.check("System Info host matches the URL", server.get("host") == urllib.parse.urlparse(s.base).hostname,
                server.get("host", "?"))
        if expect:
            s.check(f"environment is {expect}", server.get("environment") == expect, server.get("environment", "?"))
            s.check(f"storage is {STORAGE[expect]}", server.get("storageAccount") == STORAGE[expect],
                    server.get("storageAccount", "?"))
        print(f"        key used: {server.get('apiClient', '?')}, timezone: {server.get('timezone', '?')}")
        counts = db.get("counts", {})
        for label, n in (("catches", len(catches)), ("fishSpecies", len(species)),
                         ("bodiesOfWater", len(waters)), ("anglers", len(anglers))):
            s.check(f"{label}: listing matches the database count", counts.get(label) == n, f"{n} vs {counts.get(label)}")
        latest = (db.get("latestCatch") or {}).get("catchNumber")
        s.check("latest catch is in the listing", latest in {c["catchNumber"] for c in catches}, latest or "none")
    account = server.get("storageAccount") or (STORAGE[expect] if expect else None)

    # Data consistency: lookups cover every catch, numbers unique
    numbers = [c["catchNumber"] for c in catches]
    s.check("catch numbers are unique", len(numbers) == len(set(numbers)))
    for label, field, pool in (("angler", "anglerId", lookup.get("anglers", [])),
                               ("species", "fishSpeciesId", lookup.get("fishSpecies", [])),
                               ("water", "bodyOfWaterId", lookup.get("bodiesOfWater", []))):
        ids = {x.get("id") for x in pool}
        orphans = [c["catchNumber"] for c in catches if c.get(field) is not None and c[field] not in ids]
        s.check(f"every catch's {label} is in the lookup data ({len(pool)})", pool and not orphans,
                f"{len(orphans)} missing" if orphans else "")

    # Media: the newest catch with media, its count and one real file
    for c in catches:  # n8n returns this count as text
        c["catchMediaCount"] = int(c.get("catchMediaCount") or 0)
    with_media = sorted((c for c in catches if c["catchMediaCount"]), key=lambda c: c.get("createdAt") or "")
    if not with_media:
        print("  SKIP  catch media (no catch has media)")
    else:
        c = with_media[-1]
        status, media, _ = s.get("catch-media/get?catchNumber=" + urllib.parse.quote(c["catchNumber"]))
        media = [m for m in unwrap(media) if m and m.get("blobPath")] if status == 200 else []  # drop the no-results placeholder
        s.check(f"GET catch-media/get for the newest catch with media",
                status == 200 and len(media) == c["catchMediaCount"], f"{len(media)} of {c['catchMediaCount']} files")
        if media and account:
            s.check("a media file loads from storage", *blob_ok(media[0]["readUrl"], account))
    photo = next((a["profilePhotoReadUrl"] for a in anglers if a.get("profilePhotoReadUrl")), None)
    if photo and account:
        s.check("an angler profile photo loads from storage", *blob_ok(photo, account))

    # DNR search (calls the Wisconsin DNR, read-only)
    status, data, secs = s.get("bodies-of-water/dnr-search?q=winnebago")
    s.check("GET bodies-of-water/dnr-search", status == 200 and len(unwrap(data)) > 0, f"HTTP {status}, {secs:.1f}s")

    # The login check: no key must be turned away
    status, _, _ = s.get("get-catches", key=False)
    s.check("a request without a key is refused", status == 401, f"HTTP {status}")
    return {"catches": catches, "species": species, "waters": waters, "anglers": anglers}


def compare(a, b, ra, rb):
    print(f"\n=== {a.name} vs {b.name} (data must match) ===")
    for label in ("species", "waters", "anglers"):
        ida = {x["id"]: x.get("name") for x in ra[label]}
        idb = {x["id"]: x.get("name") for x in rb[label]}
        a.check(f"{label}: same ids and names", ida == idb, f"{len(ida)} vs {len(idb)}")
    ca = {c["catchNumber"]: c for c in ra["catches"]}
    cb = {c["catchNumber"]: c for c in rb["catches"]}
    only_a, only_b = sorted(set(ca) - set(cb)), sorted(set(cb) - set(ca))
    a.check("catches: same catch numbers", not only_a and not only_b,
            f"{len(ca)} vs {len(cb)}; only on {a.name}: {len(only_a)}, only on {b.name}: {len(only_b)}")
    diff = {f for n in set(ca) & set(cb) for f in COMPARE_CATCH if ca[n].get(f) != cb[n].get(f)}
    a.check("catches: same field values", not diff, "differ in " + ", ".join(sorted(diff)) if diff else "")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("server", choices=SERVERS)
    ap.add_argument("--expect", choices=STORAGE, help="the environment this server should report")
    ap.add_argument("--compare-with", choices=SERVERS, help="a second server whose data must match")
    a = ap.parse_args()
    k = keys()
    def key_for(name):
        v = os.environ.get("GILLBERT_SMOKE_KEY") if not a.compare_with else None
        v = v or k.get(SERVERS[name][1])
        if not v:
            sys.exit(f"No key for {name}: add {SERVERS[name][1]}=... to {KEY_FILE}")
        return v
    s1 = Server(a.server, key_for(a.server))
    r1 = run(s1, a.expect)
    fails = s1.fails
    if a.compare_with:
        s2 = Server(a.compare_with, key_for(a.compare_with))
        r2 = run(s2, a.expect)  # System Info's absence on the frozen Pi only skips those checks
        compare(s1, s2, r1, r2)
        fails = s1.fails + s2.fails
    print(f"\n{'ALL PASSED' if not fails else f'{fails} FAILED'}. Nothing was written anywhere.")
    sys.exit(1 if fails else 0)
