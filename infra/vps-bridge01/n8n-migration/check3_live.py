"""Check 3: live read-only comparison of GET endpoints, Pi vs Bridge01.

Temporarily activates ONLY the 6 read-only GET workflows on Bridge01, compares responses, and always deactivates
them again (finally block). Never prints the app's API key.
"""
import json, re, urllib.parse
import transform as T
from api import call

CFG = open(r"C:\Users\kurtw\source\repos\KWondra625\Gillbert\src\assets\config.js", encoding="utf-8").read()
APP_KEY = re.search(r"API_KEY\s*=\s*['\"]([^'\"]+)['\"]", CFG).group(1)
PI_BASE = "https://api.builtbykw.net/webhook/gillbert/"
BR_BASE = "https://bridge01.builtbykw.net/webhook/gillbert/"

GET_WORKFLOWS = ["Gillbert - Inspect API Key",  # pure validator sub-workflow; n8n requires it published before callers
                 "Gillbert - GET Anglers", "Gillbert - Get Bodies of Water", "Gillbert - GET Fish Species",
                 "Gillbert - Media \u2013 GET Lookup Data", "Gillbert - GET Catch(es)", "Gillbert - Media \u2013 GET Catch Media"]
by_name = {w["name"]: w for w in T.scope}
ids = [T.WF_MAP[by_name[n]["id"]] for n in GET_WORKFLOWS]


def get(host, path, key=APP_KEY):
    base = PI_BASE if host == "pi" else BR_BASE
    return call(host, "GET", "", raw_url=base + path, extra_headers={"X-API-Key": key})


SAS = re.compile(r"(https://[^\s\"?]+)\?[^\s\"]*sig=[^\s\"]*")


def normalize(obj):
    """SAS URLs carry fresh signatures/timestamps on every call; compare everything up to the '?'."""
    return json.loads(SAS.sub(lambda m: m.group(1) + "?<sas>", json.dumps(obj, sort_keys=True)))


def compare(label, path):
    sp, rp = get("pi", path)
    sb, rb = get("bridge01", path)
    same = sp == sb and normalize(rp) == normalize(rb)
    size = len(rp) if isinstance(rp, list) else (len(rp.get("data", [])) if isinstance(rp, dict) and isinstance(rp.get("data"), list) else "-")
    detail = ""
    if not same:
        a, b = json.dumps(normalize(rp), sort_keys=True), json.dumps(normalize(rb), sort_keys=True)
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
        detail = f" | first diff @{i}: pi={a[max(0,i-60):i+80]!r} || br={b[max(0,i-60):i+80]!r}"
    print(f"{'PASS' if same else 'FAIL'} {label}: Pi {sp} / Bridge01 {sb} | items: {size}{detail}")
    return {"label": label, "path": path.split("?")[0] + ("?" + urllib.parse.urlparse(path).query if "?" in path else ""),
            "pi_status": sp, "br_status": sb, "pass": same, "items": size, "detail": detail[:600]}, rp


results, activated = [], []
try:
    for wid, name in zip(ids, GET_WORKFLOWS):
        s, r = call("bridge01", "POST", f"/workflows/{wid}/activate")
        if s != 200 or not r.get("active"):
            raise RuntimeError(f"activate {name} failed: {s} {json.dumps(r)[:300]}")
        activated.append(wid)
        print(f"activated: {name} ({wid})")

    for label, path in [("anglers", "anglers/get"), ("bodies of water", "bodies-of-water/get"),
                        ("fish species", "fish-species/get"), ("lookup data", "get-lookup-data")]:
        results.append(compare(label, path)[0])
    res, all_catches = compare("all catches", "get-catches")
    results.append(res)

    rows = all_catches if isinstance(all_catches, list) else (all_catches or {}).get("data", [])
    nums = [c.get("catchNumber") or c.get("catch_number") for c in rows if isinstance(c, dict)]
    nums = [n for n in nums if n]
    picks = sorted(set(nums))[:1] + sorted(set(nums))[-1:] if nums else []
    for n in picks:
        results.append(compare(f"catch {n}", f"get-catches?catchNumber={urllib.parse.quote(str(n))}")[0])
        results.append(compare(f"media for catch {n}", f"catch-media/get?catchNumber={urllib.parse.quote(str(n))}")[0])
    results.append(compare("search 'walleye'", "get-catches?search=walleye")[0])

    # auth parity: a wrong key must be rejected the same way on both
    sp, _ = get("pi", "fish-species/get", key="definitely-not-the-key")
    sb, _ = get("bridge01", "fish-species/get", key="definitely-not-the-key")
    ok = sp == sb and sp >= 400
    print(f"{'PASS' if ok else 'FAIL'} wrong API key rejected: Pi {sp} / Bridge01 {sb}")
    results.append({"label": "wrong API key rejected", "pi_status": sp, "br_status": sb, "pass": ok})
finally:
    for wid in reversed(activated):  # callers first, Inspect API Key last
        s, r = call("bridge01", "POST", f"/workflows/{wid}/deactivate")
        print(f"deactivated {wid}: {s} active={r.get('active') if isinstance(r, dict) else '?'}")
    _, wfs = call("bridge01", "GET", "/workflows?limit=100")
    still = [w["name"] for w in wfs["data"] if w["active"]]
    print("active workflows on Bridge01 after cleanup:", still or "none")
    json.dump({"results": results, "active_after": still}, open("check3_results.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)

print(f"\nCheck 3: {sum(r['pass'] for r in results)}/{len(results)} PASS")
