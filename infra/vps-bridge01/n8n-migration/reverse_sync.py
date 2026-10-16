"""Dry-run: what copying Bridge01's Gillbert workflows onto the Pi (cutover step 6) would change.

READ-ONLY. Sends GET requests only (enforced below, independent of api.py's allowlist) and writes
nothing to either n8n. Local output only:
  reverse_dryrun/<name>.payload.json  the PUT body the Pi would receive
  reverse_dryrun/<name>.diff          current Pi workflow vs that payload (may contain Pi secrets; gitignored)
  reverse_dryrun/report.json          machine-readable summary

The console never prints parameter values, only node names and parameter paths.

Usage: python reverse_sync.py
"""
import difflib, json, os, re, sys
from collections import defaultdict
import api

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "reverse_dryrun")

# Belt and braces: whatever happens below, nothing but GET can leave this process.
_real_call = api.call
def _get_only(host, method, *args, **kwargs):
    if method != "GET":
        raise RuntimeError(f"DRY RUN GUARD: refused {method} to {host}")
    return _real_call(host, method, *args, **kwargs)
api.call = _get_only


def get(host, path):
    """The only way this script talks to n8n. GET, nothing else."""
    status, body = api.call(host, "GET", path)
    if status != 200:
        sys.exit(f"STOP: GET {host}{path} -> {status}")
    return body


def all_workflows(host):
    out, cursor = [], None
    while True:
        body = get(host, "/workflows?limit=250" + (f"&cursor={cursor}" if cursor else ""))
        out += body["data"]
        cursor = body.get("nextCursor")
        if not cursor:
            return out


# ---- maps from the 2026-10-03 import, reversed (Bridge01 id -> Pi id) ----
load = lambda f: json.load(open(os.path.join(HERE, f), encoding="utf-8"))
WF_REV = {b: p for p, b in load("wf_map.json").items()}
DT_REV = {b: p for p, b in load("datatable_map.json").items()}
CRED_REV = {  # Bridge01 credential id -> (Pi id, Pi name); reverse of transform.CRED_MAP
    "vFNqhEImJEI64agi": ("5PEEDusUct5bPorw", None),
    "7hNRtoaEEwcK4AVO": ("CkbOckJTRdxisAsO", None),
}
GILLBERT_TAG = "Gillbert"
ALLOWED_SETTINGS = {"executionOrder"}  # n8n 2.15.1 public API rejects other keys (binaryMode etc.)
# Strings that must never follow a workflow onto Staging
FORBIDDEN = {
    "production storage account": re.compile(r"gillbertmedia(?!staging)"),
    "Bridge01 hostname": re.compile(r"bridge01\.builtbykw\.net"),
    "literal blob host": re.compile(r"https://[a-z0-9]{3,24}\.blob\.core\.windows\.net"),
    "Azure account key": re.compile(r"[A-Za-z0-9+/]{86}=="),
}
ENV_REF = re.compile(r"\$env\.([A-Z0-9_]+)|\$env\[['\"]([A-Z0-9_]+)['\"]\]")


def reverse(wf, problems, notes):
    nodes = json.loads(json.dumps(wf["nodes"]))
    for n in nodes:
        for ctype, c in (n.get("credentials") or {}).items():
            if c["id"] in CRED_REV:
                c["id"] = CRED_REV[c["id"]][0]
                c["name"] = PI_CRED_NAMES.get(c["id"]) or pi_cred_seen.get(c["id"], (None, c["name"]))[1]
            else:
                problems.append(f"UNMAPPED credential on '{n['name']}' ({ctype})")
        p = n.get("parameters", {})
        if n["type"].endswith("executeWorkflow"):
            ref = p.get("workflowId")
            old = ref.get("value") if isinstance(ref, dict) else ref
            new = WF_REV.get(old)
            if not new:
                problems.append(f"UNMAPPED sub-workflow on '{n['name']}'")
            elif isinstance(ref, dict):
                ref["value"] = new
                if "cachedResultUrl" in ref:
                    ref["cachedResultUrl"] = f"/workflow/{new}"
            else:
                p["workflowId"] = new
        if n["type"].endswith("dataTable"):
            ref = p.get("dataTableId", {})
            new = DT_REV.get(ref.get("value"))
            if not new:
                problems.append(f"UNMAPPED data table on '{n['name']}'")
            else:
                ref["value"] = new
                ref.pop("cachedResultUrl", None)  # holds a project id; n8n regenerates it
    settings = {k: v for k, v in (wf.get("settings") or {}).items() if k in ALLOWED_SETTINGS}
    dropped = sorted(set(wf.get("settings") or {}) - ALLOWED_SETTINGS)
    if dropped:
        notes.append("settings the API can't send (Pi keeps/defaults them): " + ", ".join(dropped))
    return {"name": wf["name"], "nodes": nodes, "connections": wf["connections"], "settings": settings}


def param_paths(a, b, prefix=""):
    """Paths where two JSON values differ. Paths only, never values."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += param_paths(a.get(k), b.get(k), f"{prefix}.{k}" if prefix else k)
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += param_paths(x, y, f"{prefix}[{i}]")
        return out
    return [] if a == b else [prefix or "(value)"]


def compare(pi_wf, payload):
    pn = {n["name"]: n for n in pi_wf["nodes"]}
    bn = {n["name"]: n for n in payload["nodes"]}
    d = {"added": sorted(set(bn) - set(pn)), "removed": sorted(set(pn) - set(bn)), "changed": {}, "moved_only": 0}
    for name in sorted(set(pn) & set(bn)):
        a, b = pn[name], bn[name]
        paths = []
        for key in ("type", "typeVersion", "disabled", "credentials", "webhookId", "alwaysOutputData",
                    "onError", "retryOnFail", "executeOnce", "notes"):
            if a.get(key) != b.get(key):
                paths.append(key)
        paths += ["parameters." + p for p in param_paths(a.get("parameters", {}), b.get("parameters", {}))]
        if paths:
            d["changed"][name] = paths
        elif a.get("position") != b.get("position"):
            d["moved_only"] += 1
    d["connections_differ"] = pi_wf["connections"] != payload["connections"]
    return d


def activation_order(payloads):
    """Sub-workflows before their callers (n8n 2.x publish rule)."""
    by_pi = {p["pi_id"]: p for p in payloads}
    deps = {p["pi_id"]: {n["parameters"]["workflowId"]["value"] if isinstance(n["parameters"].get("workflowId"), dict)
                          else n["parameters"].get("workflowId")
                          for n in p["payload"]["nodes"] if n["type"].endswith("executeWorkflow")} & set(by_pi)
            for p in payloads}
    order, done = [], set()
    while len(done) < len(deps):
        ready = sorted((i for i in deps if i not in done and deps[i] <= done), key=lambda i: by_pi[i]["name"])
        if not ready:
            return order + ["!! dependency cycle among: " + ", ".join(by_pi[i]["name"] for i in deps if i not in done)]
        for i in ready:
            order.append(by_pi[i]["name"])
            done.add(i)
    return order


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Reading both servers (GET only)...")
    br = all_workflows("bridge01")
    pi = all_workflows("pi")
    pi_by_id = {w["id"]: w for w in pi}
    try:
        PI_CRED_NAMES = {c["id"]: c["name"] for c in get("pi", "/credentials")["data"]}
    except SystemExit:
        PI_CRED_NAMES = {}
        print("  (Pi credential list not readable with this key; credential names checked via Pi workflows instead)")
    pi_cred_seen = {c["id"]: (ct, c["name"]) for w in pi for n in w["nodes"]
                    for ct, c in (n.get("credentials") or {}).items()}

    br_gill = [w for w in br if any(t["name"] == GILLBERT_TAG for t in w.get("tags", []))]
    print(f"Bridge01: {len(br)} workflows, {len(br_gill)} tagged {GILLBERT_TAG}. Pi: {len(pi)} workflows.\n")

    report, payloads, env_vars = [], [], defaultdict(set)
    global_problems = []
    for w in sorted(br_gill, key=lambda w: w["name"]):
        problems, notes = [], []
        pid = WF_REV.get(w["id"])
        if not pid:
            global_problems.append(f"'{w['name']}' ({w['id']}) has no Pi counterpart in wf_map.json: would need a CREATE, not an update")
            continue
        pi_wf = pi_by_id.get(pid)
        if not pi_wf:
            global_problems.append(f"'{w['name']}': mapped Pi id {pid} no longer exists on the Pi")
            continue
        if pi_wf["name"] != w["name"]:
            notes.append(f"name differs: Pi has '{pi_wf['name']}'")
        if not w.get("active"):
            notes.append("INACTIVE on Bridge01")
        payload = reverse(w, problems, notes)
        # Keep the Pi's own Data Table UI link (it embeds the Pi's project id) instead of dropping it
        pi_nodes = {n["name"]: n for n in pi_wf["nodes"]}
        for n in payload["nodes"]:
            if n["type"].endswith("dataTable") and n["name"] in pi_nodes:
                pi_ref = pi_nodes[n["name"]].get("parameters", {}).get("dataTableId", {})
                if pi_ref.get("cachedResultUrl") and pi_ref.get("value") == n["parameters"]["dataTableId"].get("value"):
                    n["parameters"]["dataTableId"]["cachedResultUrl"] = pi_ref["cachedResultUrl"]
        blob = json.dumps(payload)
        for label, rx in FORBIDDEN.items():
            if rx.search(blob):
                problems.append(f"contains {label}")
        leftovers = [i for i in list(CRED_REV) + list(WF_REV) + list(DT_REV) if i in blob]
        if leftovers:
            problems.append(f"{len(leftovers)} Bridge01 id(s) still present")
        for n in payload["nodes"]:
            for ct, c in (n.get("credentials") or {}).items():
                seen = pi_cred_seen.get(c["id"])
                if c["id"] not in PI_CRED_NAMES and not seen:
                    problems.append(f"credential for '{n['name']}' not found on the Pi")
                elif seen and seen[0] != ct:
                    problems.append(f"credential type mismatch on '{n['name']}'")
        for m in ENV_REF.finditer(blob):
            env_vars[m.group(1) or m.group(2)].add(w["name"])

        diff = compare(pi_wf, payload)
        identical = not (diff["added"] or diff["removed"] or diff["changed"] or diff["connections_differ"])
        safe = re.sub(r"[^A-Za-z0-9 _.-]", "_", w["name"])
        json.dump(payload, open(os.path.join(OUT, safe + ".payload.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        cur = json.dumps({k: pi_wf[k] for k in ("name", "nodes", "connections")}, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        new = json.dumps({k: payload[k] for k in ("name", "nodes", "connections")}, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        open(os.path.join(OUT, safe + ".diff"), "w", encoding="utf-8").write(
            "\n".join(difflib.unified_diff(cur, new, "pi (current)", "pi (after copy)", lineterm="")))

        payloads.append({"pi_id": pid, "name": w["name"], "payload": payload})
        report.append({"name": w["name"], "bridge01_id": w["id"], "pi_id": pid, "pi_active": pi_wf.get("active"),
                       "pi_updatedAt": pi_wf.get("updatedAt"), "identical": identical, "diff": diff,
                       "problems": problems, "notes": notes})

        mark = "!!" if problems else ("==" if identical else "~~")
        print(f"{mark} {w['name']}  (Pi {pid}, Pi active={pi_wf.get('active')})")
        for x in problems:
            print(f"     PROBLEM: {x}")
        for x in notes:
            print(f"     note: {x}")
        if not identical:
            if diff["added"]:
                print(f"     nodes added:   {', '.join(diff['added'])}")
            if diff["removed"]:
                print(f"     nodes removed: {', '.join(diff['removed'])}")
            for name, paths in diff["changed"].items():
                print(f"     changed '{name}': {', '.join(paths[:6])}{' …' if len(paths) > 6 else ''}")
            if diff["connections_differ"]:
                print("     connections differ")
        if diff["moved_only"]:
            print(f"     ({diff['moved_only']} node(s) only moved on the canvas)")

    # Pi-side context
    covered = {r["pi_id"] for r in report}
    pi_gill_other = sorted(w["name"] for w in pi if w["name"].startswith("Gillbert") and w["id"] not in covered)
    pi_recent = sorted((w["updatedAt"], w["name"]) for w in pi
                       if w["name"].startswith("Gillbert") and w.get("updatedAt", "") >= "2026-10-03")

    print("\n=== Summary ===")
    print(f"workflows to update on the Pi: {len(report)}  "
          f"(identical already: {sum(r['identical'] for r in report)}, with problems: {sum(bool(r['problems']) for r in report)})")
    for x in global_problems:
        print("PROBLEM:", x)
    print("\n$env settings the Pi's .env must provide:")
    for k in sorted(env_vars):
        print(f"  {k}  (used by {len(env_vars[k])} workflow(s))")
    print("\nPi 'Gillbert*' workflows NOT covered by the copy (left as they are):")
    for n in pi_gill_other:
        print("  ", n)
    print("\nPi Gillbert workflows edited on/after 2026-10-03 (would be overwritten; merge by hand first):")
    for t, n in pi_recent or [("", "(none)")]:
        print(f"   {t[:19]}  {n}")
    print("\nActivation order on the night (sub-workflows first):")
    for i, n in enumerate(activation_order(payloads), 1):
        print(f"  {i:2}. {n}")

    json.dump({"workflows": report, "problems": global_problems, "env_vars": {k: sorted(v) for k, v in env_vars.items()},
               "pi_gillbert_not_covered": pi_gill_other, "pi_recent_edits": pi_recent},
              open(os.path.join(OUT, "report.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"\nFull diffs and payloads: {OUT}  (gitignored; may contain Pi secrets)")
    print("Nothing was written to either n8n.")
