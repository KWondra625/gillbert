"""Check 2: every reference in Bridge01's imported workflows resolves on Bridge01; no Pi ids anywhere. Read-only."""
import json
import transform as T
from api import call

_, creds = call("bridge01", "GET", "/credentials")
cred_types = {c["id"]: c["type"] for c in creds["data"]}
_, wfs = call("bridge01", "GET", "/workflows?limit=100")
br_wfs = {w["id"]: w for w in wfs["data"]}
_, dts = call("bridge01", "GET", "/data-tables")
dt_ids = {d["id"] for d in dts["data"]}

pi_ids = set(T.CRED_MAP) | T.pi_wf_ids | {"WSZpOi0qQwSVWa78"}
imported = set(T.WF_MAP.values())
fails, counts = [], {"credential refs": 0, "sub-workflow refs": 0, "data table refs": 0}

for pid, bid in T.WF_MAP.items():
    wf = br_wfs.get(bid)
    if not wf:
        fails.append(f"{bid}: imported workflow missing from Bridge01 list")
        continue
    blob = json.dumps(wf)
    leftover = [i for i in pi_ids if i in blob]
    if leftover:
        fails.append(f"{wf['name']}: Pi ids present {leftover}")
    for n in wf["nodes"]:
        for ctype, c in (n.get("credentials") or {}).items():
            counts["credential refs"] += 1
            if cred_types.get(c["id"]) != ctype:
                fails.append(f"{wf['name']} / {n['name']}: credential {c['id']} ({ctype}) not found with that type")
        p = n.get("parameters", {})
        if n["type"].endswith("executeWorkflow"):
            counts["sub-workflow refs"] += 1
            ref = p.get("workflowId")
            tid = ref.get("value") if isinstance(ref, dict) else ref
            target = br_wfs.get(tid)
            if not target or tid not in imported:
                fails.append(f"{wf['name']} / {n['name']}: sub-workflow {tid} not found among imported workflows")
            elif not any(x["type"].endswith("executeWorkflowTrigger") for x in target["nodes"]):
                fails.append(f"{wf['name']} / {n['name']}: target {target['name']} has no Execute Workflow Trigger")
        if n["type"].endswith("dataTable"):
            counts["data table refs"] += 1
            if p.get("dataTableId", {}).get("value") not in dt_ids:
                fails.append(f"{wf['name']} / {n['name']}: data table {p.get('dataTableId', {}).get('value')} not found")

inactive = all(not br_wfs[b]["active"] for b in T.WF_MAP.values() if b in br_wfs)
print(f"workflows checked: {len(T.WF_MAP)} | all inactive: {inactive} | " + ", ".join(f"{k}: {v}" for k, v in counts.items()))
print("Check 2:", "PASS" if not fails and inactive else "FAIL")
for f in fails:
    print("   ", f)
json.dump({"counts": counts, "fails": fails, "all_inactive": inactive}, open("check2_results.json", "w"), indent=1)
