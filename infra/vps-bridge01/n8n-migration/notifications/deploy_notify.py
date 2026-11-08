"""New-catch phone notifications: create "Gillbert - Notify New Catch" and call it from Save Catch.

Save Catch is the one place every new catch is written (the Log a Catch form calls its webhook;
Catch Chat calls it as a sub-workflow). After the upsert, "Is New Catch?" checks whether the row was
just inserted (created_at = updated_at; an edit moves updated_at); a new catch goes through
"Notify New Catch", which starts the notification workflow without waiting, so a slow or failed
notification never delays or breaks a save. Both paths then continue to the existing reply.

Save Catch is wired as one straight line (Upsert -> Is New Catch? -> [Notify] -> Generate Response
JSON -> Respond to Webhook), and Generate Response JSON reads the saved row from "Upsert Catch".
That matters: when Catch Chat calls Save Catch, it gets the output of the LAST node that ran, and
it needs catch_id from the reply. A side branch would run last and hand back the wrong data.

Notify New Catch reads the catch from vw_catch_details, builds the message, and posts it to the
server's own ntfy container (http://ntfy:80, topic gillbert-catches) with the "Gillbert ntfy
Publisher" header credential (create it in the n8n UI first). The tap-link opens the live site from
production and the develop site from Staging; Staging titles start with [Staging].

  python -I -X utf8 notifications/deploy_notify.py                       Staging dry run (backup + plan)
  python -I -X utf8 notifications/deploy_notify.py --apply               Staging write (Kurt approved Staging work)
  python -I -X utf8 notifications/deploy_notify.py --prod [--apply]      production: ONLY with Kurt's separate OK
  python -I -X utf8 notifications/deploy_notify.py [--prod] --restore <Save Catch backup> --apply
"""
import json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import api  # noqa: E402

APPLY = "--apply" in sys.argv
HOST = "bridge01" if "--prod" in sys.argv else "pi"
RESTORE = None
if "--restore" in sys.argv:
    i = sys.argv.index("--restore")
    if i + 1 >= len(sys.argv) or sys.argv[i + 1].startswith("--"):
        sys.exit("usage: --restore <Save Catch backup file> --apply")
    RESTORE = sys.argv[i + 1]
STAMP = time.strftime("%Y%m%d-%H%M%S")
SNAP = os.path.join(HERE, "snapshots")

NOTIFY_NAME = "Gillbert - Notify New Catch"
SAVE_CATCH_NAME = "Gillbert - POST - Save Catch"
GILLBERT_TAG = "Gillbert"
DB_CRED_NAME = "Gillbert Database | data-postgres Credential [Docker]"   # fallback only (Staging's name)
NTFY_CRED_NAME = "Gillbert ntfy Publisher"
IF_NODE, CALL_NODE = "Is New Catch?", "Notify New Catch"
UPSERT, RESPONSE = "Upsert Catch", "Generate Response JSON"
# Only what the message shows: no lake (the topic is readable by anyone who knows its name)
GET_CATCH_SQL = "SELECT catch_number, angler_name, fish_species_name, length_in_inches\nFROM vw_catch_details\nWHERE id = $1;"

BUILD_JS = r"""// One notification per new catch. The live site is linked from production, the develop site from Staging.
const c = $json;
const isProd = String($env.N8N_HOST || '').startsWith('bridge01');
const site = isProd ? 'https://gillbert.builtbykw.net' : 'https://develop.gillbert.builtbykw.net';

const angler  = c.angler_name || 'Someone';
const species = c.fish_species_name || 'fish';
const length  = c.length_in_inches ? `${Number(c.length_in_inches)}" ` : '';

return [{
  json: {
    topic: 'gillbert-catches',
    title: `🎣 ${isProd ? '' : '[Staging] '}New catch: ${angler} · ${length}${species} 🐟`,
    // No lake on purpose: the topic is readable by anyone who knows its name, and fishing spots stay private.
    message: `${c.catch_number} · Tap for the details`,
    click: `${site}/catch-details.html?catchNumber=${encodeURIComponent(c.catch_number)}`,
  },
}];"""

# Save Catch's reply. The original read $json (the upsert row); it now reads "Upsert Catch" directly, so
# whatever runs between the two (the notification step) can't change what the caller gets back.
RESPONSE_JS_ORIGINAL = """return [{
  json: {
    success: true,
    message: "Catch saved successfully",
    catch_id:  $json.id,
    catch_number: $json.catch_number
  }
}];"""
RESPONSE_JS = """// Reads the saved row from Upsert Catch (not $json), so the notification step before it can't change the reply.
const saved = $('Upsert Catch').first().json;
return [{
  json: {
    success: true,
    message: "Catch saved successfully",
    catch_id:  saved.id,
    catch_number: saved.catch_number
  }
}];"""

STICKY = ("## Notify New Catch\nCalled by **Save Catch** (without waiting) when a catch is first created, "
          "never on edits. Posts to this server's own ntfy container; buddies subscribe to topic "
          "`gillbert-catches` in the ntfy app. A failure here never affects the save.")


def squash(s):
    return "".join((s or "").split())


def call(method, path, body=None):
    if HOST == "pi" and method != "GET":
        api.grant_pi_writes({(method, path): 1}, time.time() + 600)
    return api.call(HOST, method, path, body)


def get(path):
    s, d = call("GET", path)
    if s != 200:
        sys.exit(f"STOP: GET {path} -> {s}")
    return d


def write(method, path, body=None):
    s, d = call(method, path, body)
    if s >= 300:
        sys.exit(f"STOP: {method} {path} -> {s} {str(d)[:400]}")
    return d


def find_wf(name):
    hits = [w for w in get("/workflows?limit=250")["data"] if w["name"] == name]
    if len(hits) > 1:
        sys.exit(f"STOP: {len(hits)} workflows named {name!r}")
    return hits[0] if hits else None


def cred_ref(name, wf_list):
    """Credential id by name: from the credentials list where the API key allows it, else from nodes using it."""
    s, d = call("GET", "/credentials?limit=250")
    if s == 200:
        hits = [c for c in (d.get("data") or []) if c.get("name") == name]
        if len(hits) > 1:
            sys.exit(f"STOP: {len(hits)} credentials named {name!r}")
        if hits:
            return {"id": hits[0]["id"], "name": name}
    for w in wf_list:
        for n in w.get("nodes", []):
            for ref in (n.get("credentials") or {}).values():
                if ref.get("name") == name:
                    return {"id": ref["id"], "name": name}
    return None


def nid():
    return str(uuid.uuid4())


def snapshot(wf, label):
    path = os.path.join(SNAP, f"{label}_{HOST}_{wf['id']}_{STAMP}.json")
    json.dump(wf, open(path, "w", encoding="utf-8"), indent=1)
    return path


def put_workflow(live, nodes, conns, activate=None):
    """deactivate -> PUT -> activate. If the PUT or the activate fails, put the live version back and
    re-activate it, so a failed deploy never leaves the workflow switched off."""
    wid = live["id"]
    activate = live["active"] if activate is None else activate
    keep = lambda w: {k: v for k, v in (w.get("settings") or {}).items() if k in ("executionOrder", "callerPolicy")}
    body = lambda n, c: {"name": live["name"], "nodes": n, "connections": c, "settings": keep(live)}
    if live["active"]:
        write("POST", f"/workflows/{wid}/deactivate")
    s, d = call("PUT", f"/workflows/{wid}", body(nodes, conns))
    if s < 300 and activate:
        s, d = call("POST", f"/workflows/{wid}/activate")
    if s >= 300:
        print(f"FAILED ({s}: {str(d)[:300]}); putting {live['name']} back as it was")
        s1, _ = call("PUT", f"/workflows/{wid}", body(live["nodes"], live["connections"]))
        print(f"  put back as it was: {s1 < 300}")
        if live["active"]:
            s2, _ = call("POST", f"/workflows/{wid}/activate")
            print(f"  re-activated: {s2 < 300}")
        sys.exit("STOP: check the lines above all say True; if not, fix it by hand in the n8n UI (or --restore)")
    return get(f"/workflows/{wid}")


def notify_workflow(db_cred, ntfy_cred):
    http = {
        "parameters": {
            "method": "POST", "url": "http://ntfy:80/",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
            "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}",
            "options": {"timeout": 10000},
        },
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.3, "position": [672, 0],
        "id": nid(), "name": "Send to ntfy", "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
        "credentials": {"httpHeaderAuth": ntfy_cred},
    }
    nodes = [
        {"parameters": {"workflowInputs": {"values": [{"name": "catchId", "type": "number"}]}},
         "type": "n8n-nodes-base.executeWorkflowTrigger", "typeVersion": 1.1, "position": [0, 0],
         "id": nid(), "name": "When Executed by Another Workflow"},
        {"parameters": {"operation": "executeQuery",
                        "query": GET_CATCH_SQL,
                        "options": {"queryReplacement": "={{ $json.catchId }}"}},
         "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [224, 0],
         "id": nid(), "name": "Get Catch Details", "credentials": {"postgres": db_cred}},
        {"parameters": {"jsCode": BUILD_JS}, "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [448, 0], "id": nid(), "name": "Build Notification"},
        http,
        {"parameters": {"content": STICKY, "height": 200, "width": 420}, "type": "n8n-nodes-base.stickyNote",
         "typeVersion": 1, "position": [0, -260], "id": nid(), "name": "Sticky Note"},
    ]
    chain = ["When Executed by Another Workflow", "Get Catch Details", "Build Notification", "Send to ntfy"]
    connections = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(chain, chain[1:])}
    return {"name": NOTIFY_NAME, "nodes": nodes, "connections": connections,
            "settings": {"executionOrder": "v1", "callerPolicy": "workflowsFromSameOwner"}}


def to_ref(n):
    return {"node": n, "type": "main", "index": 0}


def patched_save_catch(live, notify_id):
    """Target shape: Upsert(success) -> Is New Catch? -> true: Notify New Catch -> Generate Response JSON
                                                         false: Generate Response JSON
    Works from the original workflow or from the earlier side-branch version. None = already in shape."""
    nodes = json.loads(json.dumps(live["nodes"]))
    conns = json.loads(json.dumps(live["connections"]))
    resp = next((n for n in nodes if n["name"] == RESPONSE), None)
    upsert = next((n for n in nodes if n["name"] == UPSERT), None)
    if not resp or not upsert:
        sys.exit(f"STOP: Save Catch has no {UPSERT!r} / {RESPONSE!r} node")
    code = resp["parameters"].get("jsCode", "")
    if squash(code) not in (squash(RESPONSE_JS_ORIGINAL), squash(RESPONSE_JS)):
        sys.exit(f"STOP: {RESPONSE} code isn't the expected original; compare by hand before patching")
    up_out = (conns.get(UPSERT, {}).get("main") or [[]])[0] or []
    # Upsert's success output may only lead to the reply and/or our IF (original or earlier version);
    # anything else is unexpected wiring we'd silently drop, so stop and look by hand.
    unexpected = [t["node"] for t in up_out if t["node"] not in (RESPONSE, IF_NODE)]
    if unexpected:
        sys.exit(f"STOP: {UPSERT}'s success output also feeds {unexpected}; compare by hand before patching")
    call_node = next((n for n in nodes if n["name"] == CALL_NODE), None)
    call_ok = bool(call_node) and (
        call_node["parameters"].get("workflowId", {}).get("value") == notify_id
        and call_node["parameters"].get("options", {}).get("waitForSubWorkflow") is False
        and call_node.get("onError") == "continueRegularOutput")
    in_shape = (up_out == [to_ref(IF_NODE)]
                and conns.get(IF_NODE, {}).get("main") == [[to_ref(CALL_NODE)], [to_ref(RESPONSE)]]
                and conns.get(CALL_NODE, {}).get("main") == [[to_ref(RESPONSE)]]
                and call_ok
                and squash(code) == squash(RESPONSE_JS))
    if in_shape:
        return None

    # Clear out any earlier version of the two nodes, then wire the straight line
    nodes = [n for n in nodes if n["name"] not in (IF_NODE, CALL_NODE)]
    conns.pop(IF_NODE, None)
    conns.pop(CALL_NODE, None)
    x, y = upsert["position"]
    nodes.append({
        "parameters": {"conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
            "conditions": [{"id": nid(),
                            "leftValue": "={{ new Date($json.created_at).getTime() === new Date($json.updated_at).getTime() }}",
                            "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"}, "options": {}},
        "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": [x + 224, y + 288],
        "id": nid(), "name": IF_NODE})
    nodes.append({
        "parameters": {
            "workflowId": {"__rl": True, "value": notify_id, "mode": "list",
                           "cachedResultUrl": f"/workflow/{notify_id}", "cachedResultName": NOTIFY_NAME},
            "workflowInputs": {"mappingMode": "defineBelow", "value": {"catchId": "={{ $json.id }}"},
                               "matchingColumns": [], "schema": [{"id": "catchId", "displayName": "catchId",
                               "required": False, "defaultMatch": False, "display": True, "canBeUsedToMatch": True,
                               "type": "number", "removed": False}],
                               "attemptToConvertTypes": False, "convertFieldsToString": True},
            "options": {"waitForSubWorkflow": False}},
        "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.3, "position": [x + 448, y + 288],
        "id": nid(), "name": CALL_NODE, "onError": "continueRegularOutput"})
    resp["parameters"]["jsCode"] = RESPONSE_JS
    up_main = conns.setdefault(UPSERT, {"main": [[]]}).setdefault("main", [[]])
    if not up_main:
        up_main.append([])
    up_main[0] = [to_ref(IF_NODE)]          # success output; the error output (index 1) is left as is
    conns[IF_NODE] = {"main": [[to_ref(CALL_NODE)], [to_ref(RESPONSE)]]}
    conns[CALL_NODE] = {"main": [[to_ref(RESPONSE)]]}
    return nodes, conns


# ---------------------------------------------------------------- main
os.makedirs(SNAP, exist_ok=True)
save_catch = find_wf(SAVE_CATCH_NAME)
if not save_catch:
    sys.exit(f"STOP: {SAVE_CATCH_NAME} not found on {HOST}")
save_catch = get(f"/workflows/{save_catch['id']}")

if RESTORE:
    back = json.load(open(RESTORE, encoding="utf-8"))
    if back["id"] != save_catch["id"]:
        sys.exit("STOP: backup is not this server's Save Catch")
    print(f"{HOST}: restore {SAVE_CATCH_NAME} from {RESTORE} (backup was active={back.get('active')}); "
          f"current state saved to {snapshot(save_catch, 'save-catch-before-restore')}")
    if not APPLY:
        sys.exit("dry run: add --apply to restore")
    done = put_workflow(save_catch, back["nodes"], back["connections"],
                        activate=bool(back.get("active") or save_catch["active"]))
    sys.exit(f"restored {done['name']} active={done['active']}")

print(f"{HOST}: {SAVE_CATCH_NAME} ({save_catch['id']}) active={save_catch['active']}; "
      f"backup {snapshot(save_catch, 'save-catch')}")

all_wfs = get("/workflows?limit=250")["data"]
# The database credential Save Catch itself uses: right on every server (named differently on each)
db_cred = ((next((n for n in save_catch["nodes"] if n["name"] == UPSERT), {}).get("credentials") or {}).get("postgres")
           or cred_ref(DB_CRED_NAME, all_wfs))
if db_cred:
    db_cred = {"id": db_cred["id"], "name": db_cred["name"]}
ntfy_cred = cred_ref(NTFY_CRED_NAME, all_wfs)
if not db_cred:
    sys.exit("STOP: Gillbert database credential not found")
print(f"database credential {db_cred['id']}; ntfy credential: {ntfy_cred['id'] if ntfy_cred else 'NOT FOUND'}")
if not ntfy_cred:
    sys.exit(f"STOP: create the Header Auth credential {NTFY_CRED_NAME!r} in the n8n UI first "
             f"(Name: Authorization, Value: Bearer + the token from .env), then re-run")
gillbert_tag = next((t for w in all_wfs for t in w.get("tags", []) if t["name"] == GILLBERT_TAG), None)

notify = find_wf(NOTIFY_NAME)
if notify:
    notify = get(f"/workflows/{notify['id']}")
    print(f"{NOTIFY_NAME} exists ({notify['id']}) active={notify['active']}")
    nodes = json.loads(json.dumps(notify["nodes"]))
    build = next(n for n in nodes if n["name"] == "Build Notification")
    send = next(n for n in nodes if n["name"] == "Send to ntfy")
    changes = []
    if build["parameters"]["jsCode"] != BUILD_JS:
        build["parameters"]["jsCode"] = BUILD_JS
        changes.append("Build Notification code")
    getc = next(n for n in nodes if n["name"] == "Get Catch Details")
    if getc["parameters"].get("query") != GET_CATCH_SQL:
        getc["parameters"]["query"] = GET_CATCH_SQL
        changes.append("Get Catch Details query")
    if (send.get("credentials") or {}).get("httpHeaderAuth", {}).get("id") != ntfy_cred["id"]:
        send["credentials"] = {"httpHeaderAuth": ntfy_cred}
        changes.append("ntfy credential on Send to ntfy")
    if changes:
        print(f"plan: update {', '.join(changes)} (and publish)")
        if APPLY:
            notify = put_workflow(notify, nodes, notify["connections"], activate=True)
            print(f"updated, active={notify['active']}")
    if gillbert_tag and GILLBERT_TAG not in [t["name"] for t in notify.get("tags", [])]:
        print(f"plan: tag {NOTIFY_NAME} {GILLBERT_TAG}")
        if APPLY:
            write("PUT", f"/workflows/{notify['id']}/tags", [{"id": gillbert_tag["id"]}])
else:
    body = notify_workflow(db_cred, ntfy_cred)
    print(f"plan: POST /workflows  {NOTIFY_NAME} ({len(body['nodes'])} nodes), tag {GILLBERT_TAG}, publish")
    if APPLY:
        notify = write("POST", "/workflows", body)
        print(f"created {notify['id']}")
        if gillbert_tag:
            write("PUT", f"/workflows/{notify['id']}/tags", [{"id": gillbert_tag["id"]}])

if notify and not notify.get("active") and APPLY:
    s, d = call("POST", f"/workflows/{notify['id']}/activate")
    if s >= 300:
        sys.exit(f"STOP before touching Save Catch: {NOTIFY_NAME} won't publish ({s}): {str(d)[:300]}")
    print(f"published {NOTIFY_NAME}")

patch = patched_save_catch(save_catch, notify["id"] if notify else "<new Notify id>")
if not patch:
    print("Save Catch is already wired as Upsert -> Is New Catch? -> [Notify] -> reply; nothing to change.")
    sys.exit(0)
print(f"plan: Save Catch in one line: {UPSERT} -> {IF_NODE} -> (new) {CALL_NODE} -> {RESPONSE}; "
      f"(edit) -> {RESPONSE}. {RESPONSE} reads {UPSERT} directly.")
if APPLY:
    done = put_workflow(save_catch, *patch)
    print(f"Save Catch updated: active={done['active']}, nodes {len(save_catch['nodes'])} -> {len(done['nodes'])}")
else:
    print("dry run: nothing written")
