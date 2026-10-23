"""Copy Bridge01's Gillbert workflows onto the Pi (cutover step 6). Dry run unless told otherwise.

Modes:
  python reverse_sync.py                          DRY RUN (default). GET only; writes nothing to either n8n.
  python reverse_sync.py --test --until T         Rehearsal before the night: creates a throwaway copy of
                                                  System Info on the Pi, exercises every write type, leaves it
                                                  inactive for Kurt to delete by hand.
  python reverse_sync.py --write --until T        The night. Needs a dry run from the last 60 minutes with
                                                  0 problems and nothing changed since. Snapshot -> deactivate
                                                  -> PUT + verify -> create -> activate -> re-check.
  python reverse_sync.py --restore DIR --until T  Put a --write snapshot back onto the Pi.

T is local time "YYYY-MM-DD HH:MM", at most 12 hours away. Pi writes are allowed only until then, only
for the planned workflow ids, and only as many times as planned (api.grant_pi_writes). Nothing is ever
written to Bridge01, and DELETE is never sent.

Local output (gitignored; payloads, diffs and snapshots can contain Pi secrets):
  reverse_dryrun/<name>.payload.json, <name>.diff, report.json   from the dry run
  reverse_backup/<timestamp>/                                    Pi workflows as they were before --write

The console never prints parameter values or secrets, only node names and parameter paths.
"""
import argparse, copy, difflib, hashlib, json, os, re, subprocess, sys, time, uuid
from collections import defaultdict
import api

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "reverse_dryrun")
BACKUP = os.path.join(HERE, "reverse_backup")
REPORT = os.path.join(OUT, "report.json")

# Belt and braces: everything except write() below can only send GET.
_real_call = api.call
def _get_only(host, method, *args, **kwargs):
    if method != "GET":
        raise RuntimeError(f"DRY RUN GUARD: refused {method} to {host}")
    return _real_call(host, method, *args, **kwargs)
api.call = _get_only


def get(host, path):
    """The only way the dry run talks to n8n. GET, nothing else."""
    status, body = api.call(host, "GET", path)
    if status != 200:
        sys.exit(f"STOP: GET {host}{path} -> {status}")
    return body


def write(method, path, body=None):
    """The only way a non-GET request leaves this script: Pi only, and api.py still checks the grant."""
    if method == "DELETE":
        raise RuntimeError("refused: this script never deletes")
    status, resp = _real_call("pi", method, path, body)
    if status not in (200, 201):
        sys.exit(f"STOP: {method} pi{path} -> {status}: {str(resp)[:300]}")
    return resp


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
WF_REV, DT_REV = {}, {}
def load_maps():
    WF_REV.clear(); WF_REV.update({b: p for p, b in load("wf_map.json").items()})
    DT_REV.clear(); DT_REV.update({b: p for p, b in load("datatable_map.json").items()})
CRED_REV = {  # Bridge01 credential id -> (Pi id, Pi name); reverse of transform.CRED_MAP
    "vFNqhEImJEI64agi": ("5PEEDusUct5bPorw", None),
    "7hNRtoaEEwcK4AVO": ("CkbOckJTRdxisAsO", None),
}
PI_CRED_NAMES, pi_cred_seen = {}, {}
GILLBERT_TAG = "Gillbert"
ALLOWED_SETTINGS = {"executionOrder"}  # n8n 2.15.1 public API rejects other keys (binaryMode etc.)
# Strings that must never follow a workflow onto Staging
FORBIDDEN = {
    # (a "=== 'gillbertmedia'" comparison is fine: System Info uses it to tell production from staging)
    "production storage account": re.compile(r"(?<!=== ')gillbertmedia(?!staging)"),
    "Bridge01 hostname": re.compile(r"bridge01\.builtbykw\.net"),
    "literal blob host": re.compile(r"https://[a-z0-9]{3,24}\.blob\.core\.windows\.net"),
    "Azure account key": re.compile(r"[A-Za-z0-9+/]{86}=="),
}
ENV_REF = re.compile(r"\$env\.([A-Z0-9_]+)|\$env\[['\"]([A-Z0-9_]+)['\"]\]")

# ---- the Pi as Staging (checked inside its running n8n container before --write) ----
PI_HOST = "lab01.builtbykw.net"
PI_SSH = "kwondra@pi-greenville01"
SSH = r"C:\Windows\System32\OpenSSH\ssh.exe"
PI_CONTAINER = "n8n"

# ---- the --test rehearsal ----
SYSTEM_INFO_B01 = "NemuHvdhra9QqY8V"
TEST_NAME = "ZZ Test - Reverse Sync (delete me)"
TEST_PATH = "gillbert/reverse-sync-test"

QUIET = False
def say(*a):
    if not QUIET:
        print(*a)


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


def identical(d):
    return not (d["added"] or d["removed"] or d["changed"] or d["connections_differ"])


def activation_order(payloads):
    """Pi ids, sub-workflows before their callers (n8n 2.x publish rule)."""
    by_pi = {p["pi_id"]: p for p in payloads}
    deps = {p["pi_id"]: {n["parameters"]["workflowId"]["value"] if isinstance(n["parameters"].get("workflowId"), dict)
                          else n["parameters"].get("workflowId")
                          for n in p["payload"]["nodes"] if n["type"].endswith("executeWorkflow")} & set(by_pi)
            for p in payloads}
    order, done = [], set()
    while len(done) < len(deps):
        ready = sorted((i for i in deps if i not in done and deps[i] <= done), key=lambda i: by_pi[i]["name"])
        if not ready:
            sys.exit("STOP: dependency cycle among: " + ", ".join(by_pi[i]["name"] for i in deps if i not in done))
        order += ready
        done.update(ready)
    return order


def sha(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def check_payload(name, payload, problems):
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
    return blob


def dry_run(save=True):
    """Read both servers and work out the copy. GET only. Returns the plan; save=True also writes report.json."""
    load_maps()
    os.makedirs(OUT, exist_ok=True)
    say("Reading both servers (GET only)...")
    br = all_workflows("bridge01")
    pi = all_workflows("pi")
    pi_by_id = {w["id"]: w for w in pi}
    PI_CRED_NAMES.clear()
    try:
        PI_CRED_NAMES.update({c["id"]: c["name"] for c in get("pi", "/credentials")["data"]})
    except SystemExit:
        say("  (Pi credential list not readable with this key; credential names checked via Pi workflows instead)")
    pi_cred_seen.clear()
    pi_cred_seen.update({c["id"]: (ct, c["name"]) for w in pi for n in w["nodes"]
                         for ct, c in (n.get("credentials") or {}).items()})
    pi_tag = next((t["id"] for w in pi for t in w.get("tags", []) if t["name"] == GILLBERT_TAG), None)

    br_gill = [w for w in br if any(t["name"] == GILLBERT_TAG for t in w.get("tags", []))]
    say(f"Bridge01: {len(br)} workflows, {len(br_gill)} tagged {GILLBERT_TAG}. Pi: {len(pi)} workflows.\n")

    report, creates, payloads, env_vars = [], [], [], defaultdict(set)
    global_problems = [] if pi_tag else [f"no '{GILLBERT_TAG}' tag found on the Pi"]
    for w in sorted(br_gill, key=lambda w: w["name"]):
        problems, notes = [], []
        pid = WF_REV.get(w["id"])
        pi_wf = pi_by_id.get(pid) if pid else None
        if pid and not pi_wf:
            global_problems.append(f"'{w['name']}': mapped Pi id {pid} no longer exists on the Pi")
            continue
        if not w.get("active"):
            notes.append("INACTIVE on Bridge01")
        payload = reverse(w, problems, notes)
        safe = re.sub(r"[^A-Za-z0-9 _.-]", "_", w["name"])

        if not pid:  # new on Bridge01 since the import: a CREATE on the Pi
            if any(p["name"] == w["name"] for p in pi):
                problems.append("a Pi workflow with this name already exists but isn't in wf_map.json")
            blob = check_payload(w["name"], payload, problems)
            for m in ENV_REF.finditer(blob):
                env_vars[m.group(1) or m.group(2)].add(w["name"])
            json.dump(payload, open(os.path.join(OUT, safe + ".payload.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
            creates.append({"name": w["name"], "bridge01_id": w["id"], "bridge01_active": w.get("active"),
                            "bridge01_updatedAt": w.get("updatedAt"), "payload_sha": sha(payload),
                            "problems": problems, "notes": notes})
            payloads.append({"pi_id": "new:" + w["id"], "name": w["name"], "payload": payload})
            say(f"{'!!' if problems else '++'} {w['name']}  (CREATE on the Pi)")
            for x in problems:
                say(f"     PROBLEM: {x}")
            for x in notes:
                say(f"     note: {x}")
            continue

        if pi_wf["name"] != w["name"]:
            notes.append(f"name differs: Pi has '{pi_wf['name']}'")
        # Keep the Pi's own Data Table UI link (it embeds the Pi's project id) instead of dropping it
        pi_nodes = {n["name"]: n for n in pi_wf["nodes"]}
        for n in payload["nodes"]:
            if n["type"].endswith("dataTable") and n["name"] in pi_nodes:
                pi_ref = pi_nodes[n["name"]].get("parameters", {}).get("dataTableId", {})
                if pi_ref.get("cachedResultUrl") and pi_ref.get("value") == n["parameters"]["dataTableId"].get("value"):
                    n["parameters"]["dataTableId"]["cachedResultUrl"] = pi_ref["cachedResultUrl"]
        blob = check_payload(w["name"], payload, problems)
        for m in ENV_REF.finditer(blob):
            env_vars[m.group(1) or m.group(2)].add(w["name"])

        diff = compare(pi_wf, payload)
        same = identical(diff)
        json.dump(payload, open(os.path.join(OUT, safe + ".payload.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        cur = json.dumps({k: pi_wf[k] for k in ("name", "nodes", "connections")}, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        new = json.dumps({k: payload[k] for k in ("name", "nodes", "connections")}, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        open(os.path.join(OUT, safe + ".diff"), "w", encoding="utf-8").write(
            "\n".join(difflib.unified_diff(cur, new, "pi (current)", "pi (after copy)", lineterm="")))

        payloads.append({"pi_id": pid, "name": w["name"], "payload": payload})
        report.append({"name": w["name"], "bridge01_id": w["id"], "pi_id": pid, "pi_active": pi_wf.get("active"),
                       "pi_updatedAt": pi_wf.get("updatedAt"), "bridge01_active": w.get("active"),
                       "bridge01_updatedAt": w.get("updatedAt"), "payload_sha": sha(payload),
                       "identical": same, "diff": diff, "problems": problems, "notes": notes})

        say(f"{'!!' if problems else ('==' if same else '~~')} {w['name']}  (Pi {pid}, Pi active={pi_wf.get('active')})")
        for x in problems:
            say(f"     PROBLEM: {x}")
        for x in notes:
            say(f"     note: {x}")
        if not same:
            if diff["added"]:
                say(f"     nodes added:   {', '.join(diff['added'])}")
            if diff["removed"]:
                say(f"     nodes removed: {', '.join(diff['removed'])}")
            for name, paths in diff["changed"].items():
                say(f"     changed '{name}': {', '.join(paths[:6])}{' …' if len(paths) > 6 else ''}")
            if diff["connections_differ"]:
                say("     connections differ")
        if diff["moved_only"]:
            say(f"     ({diff['moved_only']} node(s) only moved on the canvas)")

    # Pi-side context
    covered = {r["pi_id"] for r in report}
    pi_gill_other = sorted(w["name"] for w in pi if w["name"].startswith("Gillbert") and w["id"] not in covered
                           and w["name"] not in {c["name"] for c in creates})
    pi_recent = sorted((w["updatedAt"], w["name"]) for w in pi
                       if w["name"].startswith("Gillbert") and w.get("updatedAt", "") >= "2026-10-03")
    order = activation_order(payloads)
    names = {p["pi_id"]: p["name"] for p in payloads}
    n_problems = sum(bool(r["problems"]) for r in report + creates) + len(global_problems)

    say("\n=== Summary ===")
    say(f"workflows to update on the Pi: {len(report)}  (identical already: {sum(r['identical'] for r in report)}), "
        f"to create: {len(creates)}, with problems: {n_problems}")
    for x in global_problems:
        say("PROBLEM:", x)
    say("\n$env settings the Pi's n8n must provide:")
    for k in sorted(env_vars):
        say(f"  {k}  (used by {len(env_vars[k])} workflow(s))")
    say("\nPi 'Gillbert*' workflows NOT covered by the copy (left as they are):")
    for n in pi_gill_other:
        say("  ", n)
    say("\nPi Gillbert workflows edited on/after 2026-10-03 (would be overwritten; merge by hand first):")
    for t, n in pi_recent or [("", "(none)")]:
        say(f"   {t[:19]}  {n}")
    say("\nActivation order on the night (sub-workflows first):")
    for i, pid in enumerate(order, 1):
        say(f"  {i:2}. {names[pid]}{'  (new)' if pid.startswith('new:') else ''}")

    plan = {"generated_at": time.time(), "workflows": report, "creates": creates, "problems": global_problems,
            "n_problems": n_problems, "env_vars": {k: sorted(v) for k, v in env_vars.items()},
            "pi_gillbert_not_covered": pi_gill_other, "pi_recent_edits": pi_recent, "pi_tag": pi_tag}
    if save:
        json.dump(plan, open(REPORT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        say(f"\nFull diffs and payloads: {OUT}  (gitignored; may contain Pi secrets)")
    say("Nothing was written to either n8n.")
    plan["payloads"] = payloads
    return plan


# ======================================== writes ========================================

def parse_until(s):
    t = time.mktime(time.strptime(s, "%Y-%m-%d %H:%M"))
    if not time.time() < t <= time.time() + 12 * 3600:
        sys.exit("STOP: --until must be in the future and at most 12 hours away")
    return t


def fingerprint(plan):
    return (sorted((r["name"], r["pi_id"], r["pi_updatedAt"], r["bridge01_updatedAt"], r["payload_sha"]) for r in plan["workflows"]),
            sorted((c["name"], c["bridge01_id"], c["bridge01_updatedAt"], c["payload_sha"]) for c in plan["creates"]))


def check_pi_container(env_names):
    """Names only, never values: the settings the copied workflows need must be live in the Pi's n8n."""
    tests = [f'[ -n "$(printenv {n})" ] && echo "{n} ok" || echo "{n} MISSING"' for n in sorted(env_names)]
    tests += ['[ "$(printenv N8N_BLOCK_ENV_ACCESS_IN_NODE)" = "false" ] && echo "N8N_BLOCK_ENV_ACCESS_IN_NODE ok" '
              '|| echo "N8N_BLOCK_ENV_ACCESS_IN_NODE NOT false"',
              f'[ "$(printenv N8N_HOST)" = "{PI_HOST}" ] && echo "N8N_HOST ok" || echo "N8N_HOST is not {PI_HOST}"']
    cmd = f"docker exec {PI_CONTAINER} sh -c '{'; '.join(tests)}'"
    out = subprocess.run([SSH, "-o", "BatchMode=yes", PI_SSH, cmd], capture_output=True, text=True, timeout=60)
    lines = out.stdout.strip().splitlines()
    print("Pi n8n settings:", ", ".join(lines) or out.stderr.strip()[:200])
    if out.returncode != 0 or not lines or any(not l.endswith(" ok") for l in lines):
        sys.exit("STOP: the Pi's n8n isn't ready (prep #7: .env + compose, then restart n8n)")


def run_write(until):
    global QUIET
    reviewed = json.load(open(REPORT, encoding="utf-8"))
    if time.time() - reviewed.get("generated_at", 0) > 3600:
        sys.exit("STOP: the reviewed dry run is over 60 minutes old; run it again and review it")
    print("Re-reading both servers to make sure nothing changed since the dry run you reviewed...")
    QUIET = True
    plan = dry_run(save=False)
    QUIET = False
    if plan["n_problems"] or reviewed.get("n_problems"):
        sys.exit("STOP: the dry run has problems")
    if fingerprint(plan) != fingerprint(reviewed):
        sys.exit("STOP: something changed on a server since the reviewed dry run; run the dry run again")
    check_pi_container(plan["env_vars"])

    updates = plan["workflows"]
    payload_of = {p["pi_id"]: p["payload"] for p in plan["payloads"]}
    stamp = time.strftime("%Y-%m-%d_%H%M%S")
    snap = os.path.join(BACKUP, stamp)
    os.makedirs(snap)
    manifest = {"taken": stamp, "workflows": [], "created": []}
    for r in updates:
        json.dump(get("pi", f"/workflows/{r['pi_id']}"), open(os.path.join(snap, r["pi_id"] + ".json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        manifest["workflows"].append({"pi_id": r["pi_id"], "name": r["name"], "active": r["pi_active"]})
    save_manifest = lambda: json.dump(manifest, open(os.path.join(snap, "manifest.json"), "w", encoding="utf-8"), indent=1)
    save_manifest()
    print(f"Snapshot of {len(updates)} Pi workflows: {snap}")
    print(f"If anything below stops: python reverse_sync.py --restore \"{snap}\" --until <time>\n")

    ops = {}
    for r in updates:
        for op in (("POST", f"/workflows/{r['pi_id']}/deactivate"), ("PUT", f"/workflows/{r['pi_id']}"),
                   ("POST", f"/workflows/{r['pi_id']}/activate")):
            ops[op] = 1
    if plan["creates"]:
        ops[("POST", "/workflows")] = len(plan["creates"])
    api.grant_pi_writes(ops, until)

    order = activation_order(plan["payloads"])
    print("1. Deactivate (callers first)")
    for pid in reversed(order):
        r = next((r for r in updates if r["pi_id"] == pid), None)
        if r and r["pi_active"]:
            write("POST", f"/workflows/{pid}/deactivate")
            print(f"   off  {r['name']}")

    print("2. Copy + verify")
    for r in updates:
        write("PUT", f"/workflows/{r['pi_id']}", payload_of[r["pi_id"]])
        after = get("pi", f"/workflows/{r['pi_id']}")
        if not identical(compare(after, payload_of[r["pi_id"]])) or after.get("active"):
            sys.exit(f"STOP: '{r['name']}' doesn't match Bridge01 after the copy (or is active)")
        print(f"   ok   {r['name']}")

    print("3. Create")
    new_ids = {}
    for c in plan["creates"]:
        payload = payload_of["new:" + c["bridge01_id"]]
        nid = write("POST", "/workflows", payload)["id"]
        manifest["created"].append({"pi_id": nid, "name": c["name"]})
        save_manifest()
        wf_map = load("wf_map.json")
        wf_map[nid] = c["bridge01_id"]
        json.dump(wf_map, open(os.path.join(HERE, "wf_map.json"), "w", encoding="utf-8"), indent=1)
        api.grant_pi_writes({("PUT", f"/workflows/{nid}/tags"): 1, ("POST", f"/workflows/{nid}/activate"): 1}, until)
        write("PUT", f"/workflows/{nid}/tags", [{"id": plan["pi_tag"]}])
        if not identical(compare(get("pi", f"/workflows/{nid}"), payload)):
            sys.exit(f"STOP: new '{c['name']}' ({nid}) doesn't match Bridge01")
        new_ids["new:" + c["bridge01_id"]] = nid
        print(f"   new  {c['name']}  ({nid}, added to wf_map.json, tagged {GILLBERT_TAG})")

    print("4. Activate (sub-workflows first)")
    active_on_b01 = {r["pi_id"]: r["bridge01_active"] for r in updates}
    active_on_b01.update({"new:" + c["bridge01_id"]: c["bridge01_active"] for c in plan["creates"]})
    names = {p["pi_id"]: p["name"] for p in plan["payloads"]}
    for pid in order:
        if not active_on_b01[pid]:
            print(f"   skip {names[pid]} (inactive on Bridge01)")
            continue
        real = new_ids.get(pid, pid)
        if not write("POST", f"/workflows/{real}/activate").get("active"):
            sys.exit(f"STOP: '{names[pid]}' didn't activate")
        print(f"   on   {names[pid]}")

    print("5. Re-check with a fresh dry run")
    QUIET = True
    after = dry_run(save=True)
    QUIET = False
    bad = [r["name"] for r in after["workflows"] if not r["identical"] or r["pi_active"] != r["bridge01_active"]]
    if after["n_problems"] or after["creates"] or bad:
        sys.exit(f"STOP: not clean after the copy: problems={after['n_problems']}, creates={len(after['creates'])}, "
                 f"different={bad}")
    print(f"   clean: {len(after['workflows'])} workflows identical to Bridge01 with matching active state.")
    print("Done.")


def run_restore(snap, until):
    manifest = json.load(open(os.path.join(snap, "manifest.json"), encoding="utf-8"))
    load_maps()
    payloads = []
    for w in manifest["workflows"]:
        s = json.load(open(os.path.join(snap, w["pi_id"] + ".json"), encoding="utf-8"))
        payloads.append({"pi_id": w["pi_id"], "name": s["name"], "active": w["active"], "payload":
                         {"name": s["name"], "nodes": s["nodes"], "connections": s["connections"],
                          "settings": {k: v for k, v in (s.get("settings") or {}).items() if k in ALLOWED_SETTINGS}}})
    order = activation_order(payloads)
    by_id = {p["pi_id"]: p for p in payloads}
    ops = {}
    for p in payloads + manifest["created"]:
        ops[("POST", f"/workflows/{p['pi_id']}/deactivate")] = 1
    for p in payloads:
        ops[("PUT", f"/workflows/{p['pi_id']}")] = 1
        if p["active"]:
            ops[("POST", f"/workflows/{p['pi_id']}/activate")] = 1
    api.grant_pi_writes(ops, until)

    print(f"Restoring {len(payloads)} Pi workflows from {snap}")
    print("1. Deactivate (created ones, then callers first)")
    for c in manifest["created"]:
        if get("pi", f"/workflows/{c['pi_id']}").get("active"):
            write("POST", f"/workflows/{c['pi_id']}/deactivate")
        print(f"   off  {c['name']} (created by --write)")
    for pid in reversed(order):
        if get("pi", f"/workflows/{pid}").get("active"):
            write("POST", f"/workflows/{pid}/deactivate")
            print(f"   off  {by_id[pid]['name']}")
    print("2. Put back + verify")
    for p in payloads:
        write("PUT", f"/workflows/{p['pi_id']}", p["payload"])
        if not identical(compare(get("pi", f"/workflows/{p['pi_id']}"), p["payload"])):
            sys.exit(f"STOP: '{p['name']}' doesn't match its snapshot after the restore")
        print(f"   ok   {p['name']}")
    print("3. Activate what was active (sub-workflows first)")
    for pid in order:
        if by_id[pid]["active"]:
            write("POST", f"/workflows/{pid}/activate")
            print(f"   on   {by_id[pid]['name']}")
    for c in manifest["created"]:
        print(f"Left inactive, delete by hand in the Pi's n8n: '{c['name']}' ({c['pi_id']}); "
              f"also remove it from wf_map.json")
    print("Done.")


def run_test(until):
    """Exercise create, tag, activate, a live webhook call, deactivate and PUT on a throwaway copy."""
    global QUIET
    QUIET = True
    plan = dry_run(save=False)
    QUIET = False
    src = next((c for c in plan["creates"] if c["bridge01_id"] == SYSTEM_INFO_B01), None)
    if not src or src["problems"] or not plan["pi_tag"]:
        sys.exit("STOP: System Info isn't a clean CREATE in the dry run (or the Pi has no Gillbert tag)")
    if any(w["name"] == TEST_NAME for w in all_workflows("pi")):
        sys.exit(f"STOP: '{TEST_NAME}' already exists on the Pi; delete it first")
    payload = copy.deepcopy(next(p["payload"] for p in plan["payloads"] if p["pi_id"] == "new:" + SYSTEM_INFO_B01))
    payload["name"] = TEST_NAME
    for n in payload["nodes"]:
        if n["type"].endswith(".webhook"):
            n["parameters"]["path"] = TEST_PATH
            n["webhookId"] = str(uuid.uuid4())
    hook = api.ENVS["pi"]["N8N_API_BASE_URL"].rsplit("/api/", 1)[0] + "/webhook/" + TEST_PATH
    results = []
    def check(label, ok):
        results.append((label, ok))
        print(f"   {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            sys.exit(f"STOP at: {label}  (the test workflow '{TEST_NAME}' may exist; delete it by hand)")

    print(f"Test write on the Pi with a throwaway copy of System Info: '{TEST_NAME}'")
    api.grant_pi_writes({("POST", "/workflows"): 1}, until)
    nid = write("POST", "/workflows", payload)["id"]
    check(f"create (POST /workflows) -> {nid}", identical(compare(get("pi", f"/workflows/{nid}"), payload)))
    api.grant_pi_writes({("PUT", f"/workflows/{nid}/tags"): 1, ("POST", f"/workflows/{nid}/activate"): 1,
                         ("POST", f"/workflows/{nid}/deactivate"): 1, ("PUT", f"/workflows/{nid}"): 1}, until)
    write("PUT", f"/workflows/{nid}/tags", [{"id": plan["pi_tag"]}])
    check(f"tag {GILLBERT_TAG}", any(t["name"] == GILLBERT_TAG for t in get("pi", f"/workflows/{nid}").get("tags", [])))
    check("activate", bool(write("POST", f"/workflows/{nid}/activate").get("active")))
    status, _ = api.call("pi", "GET", "", raw_url=hook)
    check(f"live webhook answers 401 without a key (got {status})", status == 401)
    check("deactivate", not write("POST", f"/workflows/{nid}/deactivate").get("active"))
    status, _ = api.call("pi", "GET", "", raw_url=hook)
    check(f"webhook gone after deactivate (got {status})", status == 404)
    for n in payload["nodes"]:
        if n["type"].endswith("stickyNote"):
            n["parameters"]["content"] = n["parameters"].get("content", "") + "\n\n(reverse_sync --test edit)"
    write("PUT", f"/workflows/{nid}", payload)
    after = get("pi", f"/workflows/{nid}")
    check("copy over (PUT) + verify", identical(compare(after, payload)) and not after.get("active"))
    for label, attempt in (("a second unplanned PUT is refused", lambda: write("PUT", f"/workflows/{nid}", payload)),
                           ("DELETE is refused", lambda: write("DELETE", f"/workflows/{nid}"))):
        try:
            attempt()
            check(label, False)
        except RuntimeError:
            check(label, True)
    print(f"\nAll {len(results)} checks passed. Delete by hand in the Pi's n8n: '{TEST_NAME}' ({nid}), left inactive.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--test", action="store_true")
    mode.add_argument("--restore", metavar="SNAPSHOT_DIR")
    ap.add_argument("--until", metavar='"YYYY-MM-DD HH:MM"')
    a = ap.parse_args()
    if a.write or a.test or a.restore:
        if not a.until:
            sys.exit("STOP: writes need --until")
        until = parse_until(a.until)
        run_write(until) if a.write else run_test(until) if a.test else run_restore(a.restore, until)
    else:
        dry_run()
