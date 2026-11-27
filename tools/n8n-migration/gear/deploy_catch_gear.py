"""Gear stage 2: catches remember the tip-up they were caught on, and the bait (docs/plans/gear-tip-ups.md).

Two existing workflows change:

  Gillbert - POST - Save Catch
    - "Extract Input from Webhook Call" also reads gearId and bait, and notes whether the
      request carried them (gearSent). "Set Fields" passes the three on.
    - New "Gear Sent?" after "Upsert Catch": when the request carried the gear fields (the Log a
      Catch and Edit Catch forms), the new "Set Catch Gear" step calls catch_gear_set(); when it
      didn't (Catch Chat, until stage 5), nothing about gear changes.
    - "Is New Catch?" and "Notify New Catch" read the saved catch from "Upsert Catch" by name
      (they read "whatever came in" before), so the new step in between can't change them.
      "Set Catch Gear" never fails the save: its error output goes on the same way.
  Gillbert - GET Catch(es)
    - "Build Catch Response" adds caughtOn and bait (the view's new columns).

Needs scripts/gear/04_catch_gear.sql and scripts/views/vw_catch_details.sql on the server first.

  python -I -X utf8 gear/deploy_catch_gear.py                    Staging dry run: backups + diff, writes nothing
  python -I -X utf8 gear/deploy_catch_gear.py --apply            Staging write (Kurt's OK)
  python -I -X utf8 gear/deploy_catch_gear.py --prod [--apply]   production: ONLY at release, with Kurt's separate OK
  python -I -X utf8 gear/deploy_catch_gear.py [--prod] --restore <backup dir>   put the backups back

A re-run is safe: changes already in place are skipped. Backups go to gear/drafts/ (not committed).
"""
import copy, difflib, json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import api  # noqa: E402

APPLY = "--apply" in sys.argv
HOST = "bridge01" if "--prod" in sys.argv else "pi"
RESTORE = sys.argv[sys.argv.index("--restore") + 1] if "--restore" in sys.argv else None
STAMP = time.strftime("%Y%m%d-%H%M%S")
SAVE_WF, GET_WF = "Gillbert - POST - Save Catch", "Gillbert - GET Catch(es)"

SET_GEAR_SQL = ("SELECT * FROM catch_gear_set($1::int, NULLIF($2::text, '')::int, NULLIF($3::text, ''), "
                "NULLIF($4::text, '')::int);")
SET_GEAR_PARAMS = ("={{ [ $('Upsert Catch').first().json.id, $('Set Fields').first().json.gearId ?? '', "
                   "$('Set Fields').first().json.bait ?? '', $('Set Fields').first().json.updatedByAnglerId ?? '' ] }}")


def get(path):
    s, d = api.call(HOST, "GET", path)
    if s != 200:
        sys.exit(f"STOP: GET {path} -> {s}")
    return d


def write(method, path, body=None):
    s, d = api.call(HOST, method, path, body)
    if s >= 300:
        sys.exit(f"STOP: {method} {path} -> {s} {str(d)[:300]}")
    return d


def put_workflow(wf_id, live, nodes, connections):
    payload = {"name": live["name"], "nodes": nodes, "connections": connections,
               "settings": {k: v for k, v in (live.get("settings") or {}).items() if k in ("executionOrder", "callerPolicy")}}
    if HOST == "pi":
        api.grant_pi_writes({("POST", f"/workflows/{wf_id}/deactivate"): 1, ("PUT", f"/workflows/{wf_id}"): 1,
                             ("POST", f"/workflows/{wf_id}/activate"): 1}, time.time() + 600)
    if live["active"]:
        write("POST", f"/workflows/{wf_id}/deactivate")
    write("PUT", f"/workflows/{wf_id}", payload)
    if live["active"]:
        write("POST", f"/workflows/{wf_id}/activate")
    return get(f"/workflows/{wf_id}")


def node(nodes, name):
    n = next((x for x in nodes if x["name"] == name), None)
    if n is None:
        sys.exit(f"STOP: no node {name!r}")
    return n


def assignment(name, value, typ):
    return {"id": str(uuid.uuid4()), "name": name, "value": value, "type": typ}


def add_assignments(n, items):
    lst = n["parameters"]["assignments"]["assignments"]
    have = {a["name"] for a in lst}
    for a in items:
        if a["name"] not in have:
            lst.append(a)


def replace_once(n, old, new):
    text = json.dumps(n["parameters"], ensure_ascii=False)
    o, nw = json.dumps(old, ensure_ascii=False)[1:-1], json.dumps(new, ensure_ascii=False)[1:-1]
    if text.count(nw) and not text.count(o):
        return  # already applied
    if text.count(o) != 1:
        sys.exit(f"STOP: {n['name']}: expected 1 x {old!r}, found {text.count(o)}")
    n["parameters"] = json.loads(text.replace(o, nw))


def plan_save_catch(live):
    nodes, conns = copy.deepcopy(live["nodes"]), copy.deepcopy(live["connections"])
    body = "$('Inbound Request').item.json.body"
    add_assignments(node(nodes, "Extract Input from Webhook Call"), [
        assignment("gearSent", "={{ Object.keys(" + body + " || {}).includes('gearId') }}", "boolean"),
        assignment("gearId", "={{ " + body + ".gearId ?? null }}", "number"),
        assignment("bait", "={{ " + body + ".bait ?? null }}", "string"),
    ])
    add_assignments(node(nodes, "Set Fields"), [
        assignment("gearSent", "={{ $json.gearSent === true }}", "boolean"),
        assignment("gearId", "={{ $json.gearId ?? null }}", "number"),
        assignment("bait", "={{ $json.bait ?? null }}", "string"),
    ])
    replace_once(node(nodes, "Is New Catch?"),
                 "new Date($json.created_at).getTime() === new Date($json.updated_at).getTime()",
                 "new Date($('Upsert Catch').first().json.created_at).getTime() === "
                 "new Date($('Upsert Catch').first().json.updated_at).getTime()")
    notify = node(nodes, "Notify New Catch")["parameters"]["workflowInputs"]["value"]
    if notify.get("catchId") not in ("={{ $json.id }}", "={{ $('Upsert Catch').first().json.id }}"):
        sys.exit(f"STOP: Notify New Catch sends catchId {notify.get('catchId')!r}")
    notify["catchId"] = "={{ $('Upsert Catch').first().json.id }}"

    upsert = node(nodes, "Upsert Catch")
    x, y = upsert["position"]
    if not any(n["name"] == "Gear Sent?" for n in nodes):
        is_new = node(nodes, "Is New Catch?")
        gear_if = copy.deepcopy(is_new)
        gear_if.update(id=str(uuid.uuid4()), name="Gear Sent?", position=[x + 220, y - 160])
        gear_if["parameters"]["conditions"]["conditions"][0].update(
            id=str(uuid.uuid4()), leftValue="={{ $('Set Fields').first().json.gearSent }}")
        set_gear = {
            "id": str(uuid.uuid4()), "name": "Set Catch Gear", "type": "n8n-nodes-base.postgres",
            "typeVersion": upsert["typeVersion"], "position": [x + 440, y - 260],
            "credentials": copy.deepcopy(upsert["credentials"]), "onError": "continueErrorOutput",
            "parameters": {"operation": "executeQuery", "query": SET_GEAR_SQL,
                           "options": {"queryReplacement": SET_GEAR_PARAMS}},
        }
        nodes += [gear_if, set_gear]
        to_is_new = [{"node": "Is New Catch?", "type": "main", "index": 0}]
        main = conns["Upsert Catch"]["main"]
        if [c["node"] for c in main[0]] != ["Is New Catch?"]:
            sys.exit(f"STOP: Upsert Catch's success output goes to {main[0]}, expected Is New Catch?")
        main[0] = [{"node": "Gear Sent?", "type": "main", "index": 0}]
        conns["Gear Sent?"] = {"main": [[{"node": "Set Catch Gear", "type": "main", "index": 0}], to_is_new]}
        conns["Set Catch Gear"] = {"main": [to_is_new, copy.deepcopy(to_is_new)]}
    return nodes, conns


def plan_get_catches(live):
    nodes = copy.deepcopy(live["nodes"])
    replace_once(node(nodes, "Build Catch Response"),
                 "catchMediaProcessingCount: r.catch_media_processing_count ?? null\n",
                 "catchMediaProcessingCount: r.catch_media_processing_count ?? null,\n"
                 "  caughtOn: r.caught_on ?? null,\n  bait: r.bait_name ?? null\n")
    return nodes, live["connections"]


def show_diff(title, a, b):
    print(f"\n=== {title}")
    print("".join(l for l in difflib.unified_diff(json.dumps(a, indent=1, ensure_ascii=False, sort_keys=True).splitlines(True),
                                                   json.dumps(b, indent=1, ensure_ascii=False, sort_keys=True).splitlines(True), n=1)
                  if not l.startswith(("---", "+++"))))


by_name = {w["name"]: w for w in get("/workflows?limit=250")["data"]}

if RESTORE:
    for f in sorted(os.listdir(RESTORE)):
        old = json.load(open(os.path.join(RESTORE, f), encoding="utf-8"))
        cur = get(f"/workflows/{old['id']}")
        back = put_workflow(old["id"], cur, old["nodes"], old["connections"])
        print(f"restored {old['name']} ({old['id']}) active={back['active']}")
    sys.exit("Restore done.")

backup_dir = os.path.join(HERE, "drafts", f"catch_gear_backup_{HOST}_{STAMP}")
os.makedirs(backup_dir)
plans = []
for wf_name, planner in ((SAVE_WF, plan_save_catch), (GET_WF, plan_get_catches)):
    if wf_name not in by_name:
        sys.exit(f"STOP: no workflow {wf_name!r} on {HOST}")
    live = get(f"/workflows/{by_name[wf_name]['id']}")
    json.dump(live, open(os.path.join(backup_dir, f"{live['id']}.json"), "w", encoding="utf-8"), indent=1)
    nodes, conns = planner(live)
    old_nodes = {n["name"]: n for n in live["nodes"]}
    for n in nodes:
        if n["name"] not in old_nodes:
            show_diff(f"{wf_name} / NEW {n['name']}", {}, {k: n[k] for k in ("type", "parameters", "onError") if k in n})
        elif n["parameters"] != old_nodes[n["name"]]["parameters"]:
            show_diff(f"{wf_name} / {n['name']}", old_nodes[n["name"]]["parameters"], n["parameters"])
    if conns != live["connections"]:
        show_diff(f"{wf_name} / connections",
                  {k: [[c["node"] for c in br] for br in v["main"]] for k, v in live["connections"].items()},
                  {k: [[c["node"] for c in br] for br in v["main"]] for k, v in conns.items()})
    plans.append((live, nodes, conns))

print(f"\nBackups: {backup_dir}")
if not APPLY:
    sys.exit(f"Dry run on {HOST}: nothing changed.")

for live, nodes, conns in plans:
    if nodes == live["nodes"] and conns == live["connections"]:
        print(f"{HOST} {live['name']}: already up to date")
        continue
    back = put_workflow(live["id"], live, nodes, conns)
    want = {n["name"]: n["parameters"] for n in nodes}
    ok = all(want.get(x["name"]) == x["parameters"] for x in back["nodes"]) and len(back["nodes"]) == len(nodes) \
        and back["active"] == live["active"]
    print(f"{HOST} {live['name']} ({live['id']}): read-back {'OK' if ok else 'MISMATCH'} (active={back['active']})")
    if not ok:
        sys.exit(f"STOP: restore with --restore {backup_dir}")
print(f"Done. Undo: --restore {backup_dir}")
