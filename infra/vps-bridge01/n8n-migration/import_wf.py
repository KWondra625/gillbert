"""Import one or more Pi workflows into Bridge01 (inactive), tag, read back and verify.

Usage: python import_wf.py "<exact Pi workflow name>" ["<name>" ...]
Stops at the first failure (non-zero exit). Never re-imports a workflow already in wf_map.json.
"""
import json, os, sys
import transform as T
from api import call

UNTAGGED = {"Junk Email Review"}
TAG_ID = json.load(open(os.path.join(T.HERE, "tag_map.json")))["Gillbert"]
RESULTS = os.path.join(T.HERE, "import_results.jsonl")


def fail(msg):
    print("STOP:", msg)
    sys.exit(1)


def import_one(name):
    wf = next((w for w in T.scope if w["name"] == name), None)
    if not wf:
        fail(f"'{name}' is not in the approved scope")
    if wf["id"] in T.WF_MAP:
        print(f"skip (already imported): {name} -> {T.WF_MAP[wf['id']]}")
        return
    payload, changes, leftovers = T.transform(wf)
    if leftovers:
        fail(f"{name}: payload still contains Pi ids {leftovers}; not sending")
    if any("UNMAPPED" in c or "PENDING" in c for c in changes):
        fail(f"{name}: unresolved references: {[c for c in changes if 'UNMAPPED' in c or 'PENDING' in c]}")

    s, r = call("bridge01", "POST", "/workflows", payload)
    if s not in (200, 201):
        fail(f"{name}: POST /workflows -> {s} {json.dumps(r)[:400]}")
    new_id = r["id"]
    T.WF_MAP[wf["id"]] = new_id
    json.dump(T.WF_MAP, open(T.WF_MAP_FILE, "w"), indent=1)  # record immediately, before anything else can fail

    tagged = False
    if name not in UNTAGGED:
        s, r = call("bridge01", "PUT", f"/workflows/{new_id}/tags", [{"id": TAG_ID}])
        if s not in (200, 201):
            fail(f"{name}: created as {new_id} but tagging failed -> {s} {json.dumps(r)[:300]}")
        tagged = True

    # read back + verify
    s, b = call("bridge01", "GET", f"/workflows/{new_id}")
    if s != 200:
        fail(f"{name}: read-back failed {s}")
    blob = json.dumps(b)
    problems = []
    if b.get("active"):
        problems.append("is ACTIVE")
    if len(b["nodes"]) != len(wf["nodes"]):
        problems.append(f"node count {len(b['nodes'])} != Pi {len(wf['nodes'])}")
    pi_ids = list(T.CRED_MAP) + [i for i in T.pi_wf_ids if i != wf["id"]] + ["WSZpOi0qQwSVWa78"]
    left = [i for i in pi_ids if i in blob]
    if left:
        problems.append(f"Pi ids present: {left}")
    # n8n 2.15.1: a missing binaryMode behaves exactly like 'separate' (only 'combined' changes behavior;
    # helper defaults are BINARY_MODE_SEPARATE). The public API can't set it, so only flag a real 'combined' mismatch.
    eff = lambda v: v or "separate"
    if eff(b.get("settings", {}).get("binaryMode")) != eff(wf.get("settings", {}).get("binaryMode")):
        problems.append(f"effective binaryMode differs: {b.get('settings', {}).get('binaryMode')} vs Pi {wf.get('settings', {}).get('binaryMode')}")
    tag_names = [t["name"] for t in b.get("tags", [])]
    if tagged and tag_names != ["Gillbert"]:
        problems.append(f"tags {tag_names}")
    rec = {"name": name, "pi_id": wf["id"], "bridge01_id": new_id, "nodes": len(b["nodes"]),
           "active": b.get("active"), "tags": tag_names,
           "settings": b.get("settings"), "planned_changes": [c for c in changes if not c.startswith("settings")],
           "problems": problems}
    with open(RESULTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"OK  {name}: {wf['id']} -> {new_id} | nodes={len(b['nodes'])} active={b.get('active')} tags={tag_names}"
          + (f" | PROBLEMS: {problems}" if problems else ""))
    if problems:
        fail(f"{name}: verification problems {problems}")


if __name__ == "__main__":
    for n in sys.argv[1:]:
        import_one(n)
