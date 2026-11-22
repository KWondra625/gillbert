"""Dry-run transform of Pi workflows into Bridge01 import payloads. Local only; never calls any API.

Usage: python transform.py [newIdsJson]
  newIdsJson: optional JSON file mapping Pi workflow id -> Bridge01 workflow id (filled in as sub-workflows get imported).
Writes payloads/<pi_id>.json and prints a per-workflow change report.
"""
import json, sys, os, re, copy

HERE = os.path.dirname(os.path.abspath(__file__))
PI = json.load(open(os.path.join(HERE, "pi_workflows.json"), encoding="utf-8"))["data"]

CRED_MAP = {  # Pi credential id -> (Bridge01 id, Bridge01 name)
    "5PEEDusUct5bPorw": ("vFNqhEImJEI64agi", "Gillbert Database"),
    "CkbOckJTRdxisAsO": ("7hNRtoaEEwcK4AVO", "Claude Connection"),
    "nM7kAlLWIFzaDyKI": ("sBKKQXcOsgxd0nbM", "Commons Database | Junk Email App"),
    "YlKKPu6i8PI0IL6J": ("FxCZhWQX9Rc7QrKr", "Microsoft Outlook Account"),
}
DATATABLE_MAP = {}  # Pi data table id -> Bridge01 id, filled once Kurt creates it
if os.path.exists(os.path.join(HERE, "datatable_map.json")):
    DATATABLE_MAP = json.load(open(os.path.join(HERE, "datatable_map.json")))
WF_MAP = {}  # Pi workflow id -> Bridge01 workflow id, grows as imports happen
WF_MAP_FILE = os.path.join(HERE, "wf_map.json")
if os.path.exists(WF_MAP_FILE):
    WF_MAP = json.load(open(WF_MAP_FILE))

LEGACY_EXCLUDED = {"Gillbert - ChatBot - V7", "Gillbert - ChatBot - V8 WIP",
                   "Gillbert - Copy Airtable Database to Postgres", "Gillbert - Legacy Data Load"}
scope = [w for w in PI if w["active"] and (w["name"].startswith("Gillbert") or w["name"] == "Junk Email Review")
         and w["name"] not in LEGACY_EXCLUDED]
pi_wf_ids = {w["id"] for w in PI}

ALLOWED_SETTINGS = {"executionOrder"}  # public API rejects binaryMode (400 "additional properties"); availableInMCP untested


def transform(wf):
    changes = []
    out = {"name": wf["name"], "nodes": copy.deepcopy(wf["nodes"]),
           "connections": wf["connections"], "settings": {}}
    dropped = []
    for k, v in (wf.get("settings") or {}).items():
        if k in ALLOWED_SETTINGS:
            out["settings"][k] = v
        else:
            dropped.append(f"{k}={v}")
    if dropped:
        changes.append("settings dropped: " + ", ".join(dropped))
    for n in out["nodes"]:
        for ctype, c in (n.get("credentials") or {}).items():
            if c["id"] in CRED_MAP:
                new_id, new_name = CRED_MAP[c["id"]]
                changes.append(f"cred  {n['name']}: {c['name']} -> {new_name}")
                c["id"], c["name"] = new_id, new_name
            else:
                changes.append(f"!! UNMAPPED credential {c['id']} on {n['name']}")
        p = n.get("parameters", {})
        if n["type"].endswith("executeWorkflow"):
            ref = p.get("workflowId")
            old = ref.get("value") if isinstance(ref, dict) else ref
            new = WF_MAP.get(old)
            if new:
                if isinstance(ref, dict):
                    ref["value"] = new
                    ref["cachedResultUrl"] = f"/workflow/{new}"
                else:
                    p["workflowId"] = new
                changes.append(f"subwf {n['name']}: {old} -> {new}")
            else:
                changes.append(f"subwf {n['name']}: {old} -> (PENDING: import that workflow first)")
        if n["type"].endswith("dataTable"):
            ref = p.get("dataTableId", {})
            new = DATATABLE_MAP.get(ref.get("value"))
            if new:
                ref["value"] = new
                ref.pop("cachedResultUrl", None)  # contains the Pi's project id; n8n regenerates it
                changes.append(f"table {n['name']}: {ref.get('cachedResultName')} -> {new}")
            else:
                changes.append(f"table {n['name']}: {ref.get('value')} -> (PENDING: data table not created yet)")
        # planned edits
        if wf["name"] == "Gillbert - Weekly Postgres Snapshot" and n["type"].endswith("scheduleTrigger"):
            for r in p["rule"]["interval"]:
                r["triggerAtHour"] = 0
                r["triggerAtMinute"] = 22
            changes.append(f"edit  {n['name']}: Sunday 4:00 AM -> 12:22 AM (clear of both DST changes, before the 3:21 backup)")
        if wf["name"] == "Junk Email Review" and n["type"] == "n8n-nodes-base.postgres":
            sch = p.get("schema")
            if isinstance(sch, dict) and sch.get("value") == "public":
                sch["value"] = "junk_email"
                changes.append(f"edit  {n['name']}: schema public -> junk_email")
    # safety: no Pi credential/workflow/datatable ids may remain anywhere in the payload
    blob = json.dumps(out)
    leftovers = [i for i in list(CRED_MAP) + list(pi_wf_ids - {wf['id']}) + ["WSZpOi0qQwSVWa78"] if i in blob]
    return out, changes, leftovers


if __name__ != "__main__":
    pass
else:
  os.makedirs(os.path.join(HERE, "payloads"), exist_ok=True)
  for wf in sorted(scope, key=lambda w: w["name"]):
    out, changes, leftovers = transform(wf)
    json.dump(out, open(os.path.join(HERE, "payloads", wf["id"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    summary = {}
    for c in changes:
        summary[c.split()[0]] = summary.get(c.split()[0], 0) + 1
    print(f"=== {wf['name']} ({wf['id']}) nodes={len(out['nodes'])} " + " ".join(f"{k}:{v}" for k, v in summary.items())
          + (f"  LEFTOVER Pi ids: {leftovers}" if leftovers else ""))
    for c in changes:
        if not c.startswith(("cred", "settings")) or "UNMAPPED" in c:
            print("   ", c)
  print(f"\nin scope: {len(scope)}")
