"""Gear stage 5: Catch Chat picks up the tip-up and bait ("got him on KW 24-02 with a sucker").
See docs/plans/gear-tip-ups.md, "Stage 5".

Two workflows change:

  Gillbert - Catch Chat
    - New "Get Gear Names" (before the AI Agent, every turn): the active tip-ups with their owners,
      and the bait choices, as two short lists for the prompt.
    - AI Agent: the prompt gets a GEAR section (STATE still comes from "Set Conversation Id");
      the system message learns tip_up_raw and bait_raw: when to ask (hard-water months only),
      how to match a tip-up (only names on the list), and to mention both in the recap.
      The output schema gets the two fields.
    - "Extract Fish Catch Details", "Update Local Conversation Record" and "Insert Conversation
      Record" carry tip_up_raw and bait_raw like the other *_raw fields.
    - New "Lookup Tip-Up" after "Merge All Lookups": the name said, matched again in the
      database against active tip-ups (never creates one; no match = no tip-up).
    - Both gear lookups carry on if they fail (onError continueRegularOutput): no gear, but the
      chat and the save still work.
    - "Save Catch Record" also sends gearId and bait.
  Gillbert - POST - Save Catch
    - "When Executed by Another Workflow" takes gearId and bait; "Extrract Input from Workflow
      Call" passes them on, with gearSent when either is there, so "Set Catch Gear" runs.

Needs first: scripts/gear/06_catch_chat_gear.sql on the server, and the n8n data table
fish_catch_conversations given two string columns, tip_up_raw and bait_raw (n8n screen).

  python -I -X utf8 gear/deploy_catch_chat_gear.py                    Staging dry run: backups + diff, writes nothing
  python -I -X utf8 gear/deploy_catch_chat_gear.py --apply            Staging write (Kurt's OK)
  python -I -X utf8 gear/deploy_catch_chat_gear.py --prod [--apply]   production: ONLY at release, with Kurt's separate OK
  python -I -X utf8 gear/deploy_catch_chat_gear.py [--prod] --restore <backup dir>   put the backups back

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
CHAT_WF, SAVE_WF = "Gillbert - Catch Chat", "Gillbert - POST - Save Catch"
GEAR_FIELDS = ("tip_up_raw", "bait_raw")

GEAR_NAMES_SQL = """SELECT
  COALESCE((SELECT string_agg(g.display_name || ' (' || COALESCE(a.display_name, '?') || ')', '; ' ORDER BY g.display_name)
            FROM gear g LEFT JOIN anglers a ON a.id = g.owner_angler_id
            WHERE g.gear_type = 'tip_up' AND g.status = 'Active'), '') AS tip_ups,
  COALESCE((SELECT string_agg(o.name, '; ' ORDER BY o.name)
            FROM gear_options o WHERE o.kind = 'bait' AND o.status = 'Active'), '') AS baits;"""

LOOKUP_TIP_UP_SQL = """SELECT id FROM gear
WHERE gear_type = 'tip_up' AND status = 'Active'
  AND name_key = lower(regexp_replace(btrim($1), '\\s+', ' ', 'g'))
LIMIT 1;"""

# The agent's per-turn text: STATE as before (now named, since "Get Gear Names" sits in between),
# plus the gear lists and whether to ask about them (hard water = November to March, by catch date,
# like the site's season.js)
OLD_TEXT_STATE = "{{ JSON.stringify($json, null, 2) }}"
NEW_TEXT_STATE = "{{ JSON.stringify($('Set Conversation Id').item.json, null, 2) }}"
OLD_TEXT_TAIL = "USER_MESSAGE:"
NEW_TEXT_TAIL = ("GEAR:\n"
                 "TIP_UPS: {{ $('Get Gear Names').first().json.tip_ups || '(none)' }}\n"
                 "BAITS: {{ $('Get Gear Names').first().json.baits || '(none)' }}\n"
                 "ASK_ABOUT_TIP_UP: {{ (() => { const d = $('Set Conversation Id').item.json.date_of_catch_raw || ''; "
                 "const m = /^\\d{4}-\\d{2}/.test(d) ? Number(d.slice(5, 7)) : $now.month; "
                 "return (m >= 11 || m <= 3) && !!$('Get Gear Names').first().json.tip_ups; })() }}\n\n"
                 "USER_MESSAGE:")

PROMPT_FIELDS_OLD = '- notes_raw (string) — 2–5 sentence catch story; "" if none\n'
PROMPT_FIELDS_NEW = PROMPT_FIELDS_OLD + """- tip_up_raw (string) — the tip-up it was caught on, exactly as named in TIP_UPS; "" if none or unknown
- bait_raw (string) — the bait; "" if none or unknown

---

TIP-UP AND BAIT

The crew names their tip-ups like "KW 24-02" (initials, year, number). The message gives you
TIP_UPS (active tip-ups, each with its owner in brackets) and BAITS (the bait choices so far).

- Capture them whenever they come up, in any gate ("got him on KW 24-02 with a sucker").
- tip_up_raw must be a name copied exactly from TIP_UPS, without the owner. Accept loose
  versions ("kw 2402", "24-02", "Dave's 22-01") when exactly one tip-up fits. If two or more
  fit, or none does, ask once and name up to 3 likely ones. If they still aren't sure, leave it
  "". Never make up a tip-up or use one that isn't on the list.
- Whose tip-up it is doesn't matter: anyone can fish anyone's tip-up.
- bait_raw: use the spelling from BAITS when it's the same bait ("sucker, medium one" →
  "Sucker (medium)"). If they give the kind but no size, use the kind alone ("Sucker"). Anything
  new: as they said it, in Title Case. "Not sure" is a fine answer: store "Not sure".
- Only ask about the tip-up and bait when ASK_ABOUT_TIP_UP is true (ice season). Otherwise
  don't bring them up, but still capture them if the angler mentions them.
"""

PROMPT_GATE2_OLD = 'Good: "Solid fish. Any idea on the depth, or want to add the story behind it?"\n'
PROMPT_GATE2_NEW = PROMPT_GATE2_OLD + (
    'When ASK_ABOUT_TIP_UP is true and the tip-up or bait is still unknown, fold them into this same question, '
    'not a separate one:\n'
    'Good: "Solid fish. Which tip-up was it on, what bait, and any idea on the depth?"\n')

PROMPT_GATE3_OLD = "- If optional fields are unknown, acknowledge it once casually — don't dwell.\n"
PROMPT_GATE3_NEW = PROMPT_GATE3_OLD + "- Mention the tip-up and bait when known (\"...on KW 24-02 with a medium sucker\").\n"


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
    lst.extend(a for a in items if a["name"] not in have)


def show_diff(title, a, b):
    print(f"\n=== {title}")
    print("".join(l for l in difflib.unified_diff(json.dumps(a, indent=1, ensure_ascii=False, sort_keys=True).splitlines(True),
                                                   json.dumps(b, indent=1, ensure_ascii=False, sort_keys=True).splitlines(True), n=1)
                  if not l.startswith(("---", "+++"))))


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


def replace_in(n, path, old, new):
    """One exact swap inside a long text parameter (path = keys down to the text)."""
    obj = n["parameters"]
    for k in path[:-1]:
        obj = obj[k]
    text = obj[path[-1]]
    if new in text:
        return  # already applied
    if text.count(old) != 1:
        sys.exit(f"STOP: {n['name']} {'/'.join(path)}: expected 1 x {old[:60]!r}, found {text.count(old)}")
    obj[path[-1]] = text.replace(old, new)


def add_columns(n, names, like="notes_raw"):
    cols = n["parameters"]["columns"]
    model = next(x for x in cols["schema"] if x["id"] == like)
    for f in names:
        cols["value"].setdefault(f, "={{ $json.%s }}" % f)
        if not any(x["id"] == f for x in cols["schema"]):
            cols["schema"].append({**copy.deepcopy(model), "id": f, "displayName": f})


def postgres_node(like, name, query, params, position):
    n = {"id": str(uuid.uuid4()), "name": name, "type": "n8n-nodes-base.postgres", "typeVersion": like["typeVersion"],
         "position": position, "credentials": copy.deepcopy(like["credentials"]), "alwaysOutputData": True,
         "parameters": {"operation": "executeQuery", "query": query, "options": {}}}
    if params:
        n["parameters"]["options"]["queryReplacement"] = params
    return n


def plan_chat(live):
    nodes, conns = copy.deepcopy(live["nodes"]), copy.deepcopy(live["connections"])
    agent = node(nodes, "AI Agent")
    replace_in(agent, ["text"], OLD_TEXT_STATE, NEW_TEXT_STATE)
    replace_in(agent, ["text"], OLD_TEXT_TAIL, NEW_TEXT_TAIL)
    replace_in(agent, ["options", "systemMessage"], PROMPT_FIELDS_OLD, PROMPT_FIELDS_NEW)
    replace_in(agent, ["options", "systemMessage"], PROMPT_GATE2_OLD, PROMPT_GATE2_NEW)
    replace_in(agent, ["options", "systemMessage"], PROMPT_GATE3_OLD, PROMPT_GATE3_NEW)

    parser = node(nodes, "Structured Output Parser")
    schema = json.loads(parser["parameters"]["inputSchema"])
    ex = schema["properties"]["extracted"]
    for f, desc in (("tip_up_raw", "Tip-up name exactly as in TIP_UPS; empty string if none or unknown."),
                    ("bait_raw", "Bait; empty string if none or unknown.")):
        ex["properties"].setdefault(f, {"type": "string", "description": desc})
        if f not in ex["required"]:
            ex["required"].append(f)
    parser["parameters"]["inputSchema"] = json.dumps(schema, indent=2, ensure_ascii=False)

    add_assignments(node(nodes, "Extract Fish Catch Details"), [
        assignment(f, "={{ $('AI Agent').item.json.output.extracted.%s ?? '' }}" % f, "string") for f in GEAR_FIELDS])
    add_columns(node(nodes, "Update Local Conversation Record"), GEAR_FIELDS)
    add_columns(node(nodes, "Insert Conversation Record"), GEAR_FIELDS)

    lookup_angler = node(nodes, "Lookup Angler")
    if not any(n["name"] == "Get Gear Names" for n in nodes):
        if [c["node"] for c in conns["Set Conversation Id"]["main"][0]] != ["AI Agent"]:
            sys.exit("STOP: Set Conversation Id doesn't go straight to AI Agent")
        x, y = node(nodes, "Set Conversation Id")["position"]
        gn = postgres_node(lookup_angler, "Get Gear Names", GEAR_NAMES_SQL, None, [x + 120, y + 180])
        gn["executeOnce"] = True
        nodes.append(gn)
        conns["Set Conversation Id"]["main"][0] = [{"node": "Get Gear Names", "type": "main", "index": 0}]
        conns["Get Gear Names"] = {"main": [[{"node": "AI Agent", "type": "main", "index": 0}]]}

    if not any(n["name"] == "Lookup Tip-Up" for n in nodes):
        if [c["node"] for c in conns["Merge All Lookups"]["main"][0]] != ["Save Catch Record"]:
            sys.exit("STOP: Merge All Lookups doesn't go straight to Save Catch Record")
        x, y = node(nodes, "Merge All Lookups")["position"]
        lt = postgres_node(lookup_angler, "Lookup Tip-Up", LOOKUP_TIP_UP_SQL,
                           "={{ [ $('Insert Conversation Record').first().json.tip_up_raw || '' ] }}", [x + 110, y + 200])
        lt["executeOnce"] = True
        nodes.append(lt)
        conns["Merge All Lookups"]["main"][0] = [{"node": "Lookup Tip-Up", "type": "main", "index": 0}]
        conns["Lookup Tip-Up"] = {"main": [[{"node": "Save Catch Record", "type": "main", "index": 0}]]}

    # A gear lookup that fails mustn't stop the chat: carry on with no tip-up list / no tip-up
    # (the expressions above fall back to '(none)' / null). Catch Chat didn't depend on gear before.
    for name in ("Get Gear Names", "Lookup Tip-Up"):
        node(nodes, name)["onError"] = "continueRegularOutput"

    save = node(nodes, "Save Catch Record")["parameters"]["workflowInputs"]
    save["value"].setdefault("gearId", "={{ $('Lookup Tip-Up').first().json.id ?? null }}")
    save["value"].setdefault("bait", "={{ $('Insert Conversation Record').first().json.bait_raw || null }}")
    model = next(x for x in save["schema"] if x["id"] == "conversationId")
    for f, typ in (("gearId", "number"), ("bait", "string")):
        if not any(x["id"] == f for x in save["schema"]):
            save["schema"].append({**copy.deepcopy(model), "id": f, "displayName": f, "type": typ})
    return nodes, conns


def plan_save(live):
    nodes = copy.deepcopy(live["nodes"])
    trig = node(nodes, "When Executed by Another Workflow")["parameters"]["workflowInputs"]["values"]
    for f, typ in (("gearId", "number"), ("bait", None)):
        if not any(v["name"] == f for v in trig):
            trig.append({"name": f, **({"type": typ} if typ else {})})
    add_assignments(node(nodes, "Extrract Input from Workflow Call"), [
        assignment("gearSent", "={{ $json.gearId != null || !!$json.bait }}", "boolean"),
        assignment("gearId", "={{ $json.gearId ?? null }}", "number"),
        assignment("bait", "={{ $json.bait || null }}", "string"),
    ])
    return nodes, live["connections"]


by_name = {w["name"]: w for w in get("/workflows?limit=250")["data"]}

if RESTORE:
    for f in sorted(os.listdir(RESTORE)):
        old = json.load(open(os.path.join(RESTORE, f), encoding="utf-8"))
        cur = get(f"/workflows/{old['id']}")
        back = put_workflow(old["id"], cur, old["nodes"], old["connections"])
        print(f"restored {old['name']} ({old['id']}) active={back['active']}")
    sys.exit("Restore done.")

backup_dir = os.path.join(HERE, "drafts", f"catch_chat_gear_backup_{HOST}_{STAMP}")
os.makedirs(backup_dir)
plans = []
for wf_name, planner in ((SAVE_WF, plan_save), (CHAT_WF, plan_chat)):
    if wf_name not in by_name:
        sys.exit(f"STOP: no workflow {wf_name!r} on {HOST}")
    live = get(f"/workflows/{by_name[wf_name]['id']}")
    json.dump(live, open(os.path.join(backup_dir, f"{live['id']}.json"), "w", encoding="utf-8"), indent=1)
    nodes, conns = planner(live)
    old_nodes = {n["name"]: n for n in live["nodes"]}
    for n in nodes:
        if n["name"] not in old_nodes:
            show_diff(f"{wf_name} / NEW {n['name']}", {}, {k: n[k] for k in ("type", "parameters", "executeOnce", "alwaysOutputData", "onError") if k in n})
        elif n["parameters"] != old_nodes[n["name"]]["parameters"]:
            show_diff(f"{wf_name} / {n['name']}", old_nodes[n["name"]]["parameters"], n["parameters"])
        if n["name"] in old_nodes and n.get("onError") != old_nodes[n["name"]].get("onError"):
            print(f"== {wf_name} / {n['name']}: onError {old_nodes[n['name']].get('onError')} -> {n.get('onError')}")
    if conns != live["connections"]:
        show_diff(f"{wf_name} / connections",
                  {k: [[c["node"] for c in br] for br in v.get("main", [])] for k, v in live["connections"].items()},
                  {k: [[c["node"] for c in br] for br in v.get("main", [])] for k, v in conns.items()})
    plans.append((live, nodes, conns))

print(f"\nBackups: {backup_dir}")
if not APPLY:
    sys.exit(f"Dry run on {HOST}: nothing changed.")

# Save Catch first: once it takes gearId and bait, Catch Chat can send them
for live, nodes, conns in plans:
    if nodes == live["nodes"] and conns == live["connections"]:
        print(f"{HOST} {live['name']}: already up to date")
        continue
    back = put_workflow(live["id"], live, nodes, conns)
    want = {n["name"]: n["parameters"] for n in nodes}
    ok = all(want.get(x["name"]) == x["parameters"] for x in back["nodes"]) and len(back["nodes"]) == len(nodes)         and all({n["name"]: n.get("onError") for n in nodes}.get(x["name"]) == x.get("onError") for x in back["nodes"]) \
        and back["active"] == live["active"]
    print(f"{HOST} {live['name']} ({live['id']}): read-back {'OK' if ok else 'MISMATCH'} (active={back['active']})")
    if not ok:
        sys.exit(f"STOP: restore with --restore {backup_dir}")
print(f"Done. Undo: --restore {backup_dir}")
