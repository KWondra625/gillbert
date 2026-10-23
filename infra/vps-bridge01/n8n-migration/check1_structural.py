"""Check 1: Bridge01 workflow == (Pi workflow + only the planned, approved edits). Read-only."""
import json
import transform as T
from api import call


def diff(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}.{k}: only on Bridge01 = {json.dumps(b[k])[:120]}")
            elif k not in b:
                out.append(f"{path}.{k}: missing on Bridge01 (expected {json.dumps(a[k])[:120]})")
            else:
                out += diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: list length {len(a)} vs {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]")
    elif a != b:
        out.append(f"{path}: expected {json.dumps(a)[:120]} got {json.dumps(b)[:120]}")
    return out


results = []
for wf in sorted(T.scope, key=lambda w: w["name"]):
    expected, changes, _ = T.transform(wf)
    s, actual = call("bridge01", "GET", f"/workflows/{T.WF_MAP[wf['id']]}")
    exp_nodes = {n["name"]: n for n in expected["nodes"]}
    act_nodes = {n["name"]: n for n in actual["nodes"]}
    problems = diff(exp_nodes, act_nodes, "nodes") + diff(expected["connections"], actual["connections"], "connections")
    if actual["name"] != wf["name"]:
        problems.append(f"name {actual['name']!r}")
    planned = [c for c in changes if not c.startswith("settings")]
    results.append({"name": wf["name"], "problems": problems, "planned": planned})
    print(("PASS" if not problems else "FAIL"), wf["name"], f"| planned edits: {len(planned)}")
    for p in problems[:15]:
        print("     ", p)
json.dump(results, open("check1_results.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"\nCheck 1: {sum(not r['problems'] for r in results)}/{len(results)} PASS")
