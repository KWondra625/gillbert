"""New-catch phone notifications: create "Gillbert - Notify New Catch" and call it from Save Catch.

Save Catch is the one place every new catch is written (the Log a Catch form calls its webhook;
Catch Chat calls it as a sub-workflow). After the upsert, a new branch checks whether the row was
just inserted (created_at = updated_at; an edit moves updated_at) and, if so, starts Notify New Catch
without waiting, so a slow or failed notification never delays or breaks a save.

Notify New Catch reads the catch from vw_catch_details, builds the message, and posts it to the
server's own ntfy container (http://ntfy:80, topic gillbert-catches) with the "Gillbert ntfy
Publisher" header credential. The tap-link opens the live site from production and the develop site
from Staging; Staging titles start with [Staging].

  python -I -X utf8 notifications/deploy_notify.py                     Staging dry run (backups + plan)
  python -I -X utf8 notifications/deploy_notify.py --apply             Staging write (Kurt approved Staging work 2026-11-06)
  python -I -X utf8 notifications/deploy_notify.py --prod [--apply]    production: ONLY with Kurt's separate OK
  python -I -X utf8 notifications/deploy_notify.py [--prod] --restore <Save Catch backup file>
"""
import json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import api  # noqa: E402

APPLY = "--apply" in sys.argv
HOST = "bridge01" if "--prod" in sys.argv else "pi"
RESTORE = sys.argv[sys.argv.index("--restore") + 1] if "--restore" in sys.argv else None
STAMP = time.strftime("%Y%m%d-%H%M%S")
SNAP = os.path.join(HERE, "snapshots")

NOTIFY_NAME = "Gillbert - Notify New Catch"
SAVE_CATCH_NAME = "Gillbert - POST - Save Catch"
GILLBERT_TAG = "Gillbert"
DB_CRED_NAME = "Gillbert Database | data-postgres Credential [Docker]"
NTFY_CRED_NAME = "Gillbert ntfy Publisher"
IF_NODE, CALL_NODE = "Is New Catch?", "Notify New Catch"

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
    message: [c.body_of_water_name ? `On ${c.body_of_water_name}` : null, c.catch_number].filter(Boolean).join(' · '),
    click: `${site}/catch-details.html?catchNumber=${encodeURIComponent(c.catch_number)}`,
  },
}];"""

STICKY = ("## Notify New Catch\nCalled by **Save Catch** (without waiting) when a catch is first created, "
          "never on edits. Posts to this server's own ntfy container; buddies subscribe to topic "
          "`gillbert-catches` in the ntfy app. A failure here never affects the save.")


def get(path):
    s, d = api.call(HOST, "GET", path)
    if s != 200:
        sys.exit(f"STOP: GET {path} -> {s}")
    return d


def write(method, path, body=None):
    if HOST == "pi":
        api.grant_pi_writes({(method, path): 1}, time.time() + 600)
    s, d = api.call(HOST, method, path, body)
    if s >= 300:
        sys.exit(f"STOP: {method} {path} -> {s} {str(d)[:400]}")
    return d


def find_wf(name):
    hits = [w for w in get("/workflows?limit=250")["data"] if w["name"] == name]
    if len(hits) > 1:
        sys.exit(f"STOP: {len(hits)} workflows named {name!r}")
    return hits[0] if hits else None


def cred_ref(name, wf_list):
    """Find a credential id by name from nodes already using it (the API key can't list credentials)."""
    for w in wf_list:
        for n in w.get("nodes", []):
            for ref in (n.get("credentials") or {}).values():
                if ref.get("name") == name:
                    return {"id": ref["id"], "name": name}
    return None


def nid():
    return str(uuid.uuid4())


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
    }
    if ntfy_cred:
        http["credentials"] = {"httpHeaderAuth": ntfy_cred}
    nodes = [
        {"parameters": {"workflowInputs": {"values": [{"name": "catchId", "type": "number"}]}},
         "type": "n8n-nodes-base.executeWorkflowTrigger", "typeVersion": 1.1, "position": [0, 0],
         "id": nid(), "name": "When Executed by Another Workflow"},
        {"parameters": {"operation": "executeQuery",
                        "query": "SELECT catch_number, angler_name, fish_species_name, body_of_water_name, length_in_inches\n"
                                 "FROM vw_catch_details\nWHERE id = $1;",
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


def patched_save_catch(live, notify_id):
    nodes = json.loads(json.dumps(live["nodes"]))
    conns = json.loads(json.dumps(live["connections"]))
    if any(n["name"] in (IF_NODE, CALL_NODE) for n in nodes):
        return None
    upsert = next(n for n in nodes if n["name"] == "Upsert Catch")
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
    # Upsert Catch's success output already feeds Generate Response JSON (listed first, so the response
    # goes out first); the new branch is added alongside it. The error output is unchanged.
    conns["Upsert Catch"]["main"][0].append({"node": IF_NODE, "type": "main", "index": 0})
    conns[IF_NODE] = {"main": [[{"node": CALL_NODE, "type": "main", "index": 0}], []]}
    return nodes, conns


def put_workflow(live, nodes, conns):
    wid = live["id"]
    payload = {"name": live["name"], "nodes": nodes, "connections": conns,
               "settings": {k: v for k, v in (live.get("settings") or {}).items() if k in ("executionOrder", "callerPolicy")}}
    if live["active"]:
        write("POST", f"/workflows/{wid}/deactivate")
    write("PUT", f"/workflows/{wid}", payload)
    if live["active"]:
        write("POST", f"/workflows/{wid}/activate")
    return get(f"/workflows/{wid}")


os.makedirs(SNAP, exist_ok=True)
save_catch = find_wf(SAVE_CATCH_NAME)
if not save_catch:
    sys.exit(f"STOP: {SAVE_CATCH_NAME} not found on {HOST}")
save_catch = get(f"/workflows/{save_catch['id']}")

if RESTORE:
    back = json.load(open(RESTORE, encoding="utf-8"))
    if back["id"] != save_catch["id"]:
        sys.exit("STOP: backup is not this server's Save Catch")
    done = put_workflow(save_catch, back["nodes"], back["connections"])
    sys.exit(f"restored {done['name']} active={done['active']}")

backup = os.path.join(SNAP, f"save-catch_{HOST}_{save_catch['id']}_{STAMP}.json")
json.dump(save_catch, open(backup, "w", encoding="utf-8"), indent=1)
print(f"{HOST}: {SAVE_CATCH_NAME} ({save_catch['id']}) active={save_catch['active']}; backup {backup}")

all_wfs = get("/workflows?limit=250")["data"]
db_cred = cred_ref(DB_CRED_NAME, all_wfs)
ntfy_cred = cred_ref(NTFY_CRED_NAME, all_wfs)
if not db_cred:
    sys.exit("STOP: Gillbert database credential not found")
print(f"database credential {db_cred['id']}; ntfy credential: {ntfy_cred['id'] if ntfy_cred else 'NOT IN USE YET (set it in the UI)'}")

notify = find_wf(NOTIFY_NAME)
if notify:
    notify = get(f"/workflows/{notify['id']}")
    print(f"{NOTIFY_NAME} exists ({notify['id']}) active={notify['active']}")
    build = next(n for n in notify["nodes"] if n["name"] == "Build Notification")
    if build["parameters"]["jsCode"] != BUILD_JS:
        print("plan: update Build Notification code")
        if APPLY:
            nodes = json.loads(json.dumps(notify["nodes"]))
            next(n for n in nodes if n["name"] == "Build Notification")["parameters"]["jsCode"] = BUILD_JS
            notify = put_workflow(notify, nodes, notify["connections"])
            print(f"updated Build Notification, active={notify['active']}")
else:
    body = notify_workflow(db_cred, ntfy_cred)
    print(f"plan: POST /workflows  {NOTIFY_NAME} ({len(body['nodes'])} nodes), tag {GILLBERT_TAG}, publish")
    if APPLY:
        notify = write("POST", "/workflows", body)
        tag = next(t for w in all_wfs for t in w.get("tags", []) if t["name"] == GILLBERT_TAG)
        write("PUT", f"/workflows/{notify['id']}/tags", [{"id": tag["id"]}])
        print(f"created {notify['id']}")

if notify and not notify.get("active") and APPLY:
    if HOST == "pi":
        api.grant_pi_writes({("POST", f"/workflows/{notify['id']}/activate"): 1}, time.time() + 600)
    s, d = api.call(HOST, "POST", f"/workflows/{notify['id']}/activate")
    if s >= 300:
        sys.exit(f"STOP before touching Save Catch: {NOTIFY_NAME} won't publish ({s}): {str(d)[:300]}")
    print(f"published {NOTIFY_NAME}")

patch = patched_save_catch(save_catch, notify["id"] if notify else "<new Notify id>")
if not patch:
    print(f"Save Catch already has {IF_NODE} / {CALL_NODE}; nothing to change.")
    sys.exit(0)
print(f"plan: Save Catch + '{IF_NODE}' (created_at = updated_at) -> '{CALL_NODE}' (no wait, errors ignored),"
      f" wired from Upsert Catch's success output next to Generate Response JSON")
if APPLY:
    done = put_workflow(save_catch, *patch)
    print(f"Save Catch updated: active={done['active']}, nodes {len(save_catch['nodes'])} -> {len(done['nodes'])}")
else:
    print("dry run: nothing written")
