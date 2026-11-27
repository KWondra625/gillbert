"""Gear stage 1: create the three gear webhooks (docs/plans/gear-tip-ups.md).

  Gillbert - Gear - GET Gear              GET  gillbert/gear/get           SELECT gear_get(...)
  Gillbert - Gear - POST Save Gear        POST gillbert/gear/save          SELECT gear_save($1::jsonb)
  Gillbert - Gear - POST Save Gear Setup  POST gillbert/gear/setup-save    SELECT gear_setup_save($1::jsonb)

Each one is: the server's own access check (copied from its GET Anglers / POST Update Angler,
the same nodes every Gillbert webhook uses), then one Postgres call, then the reply. The logic
lives in the database functions (scripts/gear/02_gear_functions.sql), which must exist first.
The request goes to Postgres as a bound parameter ($1), never as SQL text. Paths have no
leading "/", so the webhook's CORS setting applies (a leading slash makes n8n skip it).

  python -I -X utf8 gear/deploy_gear_endpoints.py                    Staging dry run: builds all 3, writes nothing
  python -I -X utf8 gear/deploy_gear_endpoints.py --apply            Staging: create + publish (Kurt's OK)
  python -I -X utf8 gear/deploy_gear_endpoints.py --prod [--apply]   production: ONLY at release, with Kurt's separate OK

Undo: deactivate the three workflows (the API helper never deletes). Nothing existing changes.
Created ids are saved to gear/deployed_ids_<host>.json.
"""
import copy, json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import api  # noqa: E402

APPLY = "--apply" in sys.argv
HOST = "bridge01" if "--prod" in sys.argv else "pi"
STAMP = time.strftime("%Y%m%d-%H%M%S")
IDS_FILE = os.path.join(HERE, f"deployed_ids_{HOST}.json")
DRAFTS = os.path.join(HERE, "drafts")
GILLBERT_TAG = "Gillbert"
TEMPLATE_GET, TEMPLATE_POST = "Gillbert - GET Anglers", "Gillbert - POST Update Angler"
AUTH = ["Inbound Request", "Extract API Key", "Inspect API Key", "Is Authorized?",
        "Return 401 Unauthorized Response", "Sticky Note"]
KEEP_SETTINGS = ("executionOrder", "callerPolicy")

SAVE_FAILED = '{"success": false, "message": "Unable to save changes. Please try again."}'
LOAD_FAILED = '{"success": false, "message": "Unable to load gear. Please try again."}'

ENDPOINTS = [
    {
        "name": "Gillbert - Gear - GET Gear",
        "method": "GET", "path": "gillbert/gear/get", "template": TEMPLATE_GET,
        "node": "Get Gear",
        # ?id=7 adds that tip-up's history; anything but digits counts as no id
        "sql": "SELECT gear_get(NULLIF($1, '')::int) AS result;",
        "params": "={{ [ /^\\d{1,9}$/.test(String($('Inbound Request').item.json.query.id ?? '')) ? String($('Inbound Request').item.json.query.id) : '' ] }}",
        "failed": LOAD_FAILED,
        "note": "## Gear: list\nAll tip-ups with their current setup, plus the type-ahead tags.\n"
                "`?id=` adds that tip-up's history. Logic: `gear_get()` in the database.",
    },
    {
        "name": "Gillbert - Gear - POST Save Gear",
        "method": "POST", "path": "gillbert/gear/save", "template": TEMPLATE_POST,
        "node": "Save Gear",
        "sql": "SELECT gear_save($1::jsonb) AS result;",
        "params": "={{ [ JSON.stringify($('Inbound Request').item.json.body ?? {}) ] }}",
        "failed": SAVE_FAILED,
        "note": "## Gear: add / rename / owner / retire / delete\nOne call, one transaction: `gear_save()` in the "
                "database checks the name, writes the tip-up and its history, and answers with a message "
                "the page shows as is.",
    },
    {
        "name": "Gillbert - Gear - POST Save Gear Setup",
        "method": "POST", "path": "gillbert/gear/setup-save", "template": TEMPLATE_POST,
        "node": "Save Gear Setup",
        "sql": "SELECT gear_setup_save($1::jsonb) AS result;",
        "params": "={{ [ JSON.stringify($('Inbound Request').item.json.body ?? {}) ] }}",
        "failed": SAVE_FAILED,
        "note": "## Gear: change a setup\nOne call, one transaction: `gear_setup_save()` adds new tags, "
                "updates the current version in place (no catches yet) or adds a new one, and writes the history.",
    },
]


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


def nid():
    return str(uuid.uuid4())


def build(ep, template, pg_cred):
    nodes = []
    for n in template["nodes"]:
        if n["name"] not in AUTH:
            continue
        c = copy.deepcopy(n)
        c["id"] = nid()
        if c["name"] == "Inbound Request":
            c["parameters"]["path"] = ep["path"]
            if ep["method"] == "POST":
                c["parameters"]["httpMethod"] = "POST"
            else:
                c["parameters"].pop("httpMethod", None)
            c["webhookId"] = nid()
        if c["name"] == "Sticky Note":
            c["parameters"]["content"] = "## Authorization Check\n"
        nodes.append(c)
    x0 = max(n["position"][0] for n in nodes) + 240
    y0 = next(n for n in nodes if n["name"] == "Is Authorized?")["position"][1]
    nodes += [
        {"id": nid(), "name": ep["node"], "type": "n8n-nodes-base.postgres", "typeVersion": 2.6,
         "position": [x0, y0 - 100], "credentials": copy.deepcopy(pg_cred),
         "onError": "continueErrorOutput",
         "parameters": {"operation": "executeQuery", "query": ep["sql"],
                        "options": {"queryReplacement": ep["params"]}}},
        {"id": nid(), "name": "Respond to Webhook", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.5,
         "position": [x0 + 260, y0 - 200],
         "parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify($json.result) }}",
                        "options": {"responseCode": 200}}},
        {"id": nid(), "name": "Return 500 Failed", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.5,
         "position": [x0 + 260, y0],
         "parameters": {"respondWith": "json", "responseBody": ep["failed"], "options": {"responseCode": 500}}},
        {"id": nid(), "name": "About This Workflow", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1,
         "position": [x0 - 20, y0 - 420], "parameters": {"content": ep["note"], "height": 180, "width": 520}},
    ]
    conns = {
        "Inbound Request": {"main": [[{"node": "Extract API Key", "type": "main", "index": 0}]]},
        "Extract API Key": {"main": [[{"node": "Inspect API Key", "type": "main", "index": 0}]]},
        "Inspect API Key": {"main": [[{"node": "Is Authorized?", "type": "main", "index": 0}]]},
        "Is Authorized?": {"main": [[{"node": ep["node"], "type": "main", "index": 0}],
                                    [{"node": "Return 401 Unauthorized Response", "type": "main", "index": 0}]]},
        ep["node"]: {"main": [[{"node": "Respond to Webhook", "type": "main", "index": 0}],
                              [{"node": "Return 500 Failed", "type": "main", "index": 0}]]},
    }
    return {"name": ep["name"], "nodes": nodes, "connections": conns,
            "settings": {k: v for k, v in template["settings"].items() if k in KEEP_SETTINGS}}


def check(wf):
    """The things that matter, checked on what we built (and what came back)."""
    names = {n["name"] for n in wf["nodes"]}
    missing = [a for a in AUTH if a not in names]
    hook = next(n for n in wf["nodes"] if n["name"] == "Inbound Request")
    problems = [f"missing {m}" for m in missing]
    if hook["parameters"]["path"].startswith("/"):
        problems.append("path starts with /")
    for n in wf["nodes"]:
        if n["type"] == "n8n-nodes-base.postgres" and "{{" in n["parameters"]["query"]:
            problems.append(f"{n['name']}: expression inside the SQL text")
    return problems


if __name__ == "__main__":
    if os.path.exists(IDS_FILE):
        sys.exit(f"STOP: {os.path.basename(IDS_FILE)} exists: already created on {HOST}? Check before re-running.")
    wf_list = get("/workflows?limit=250")["data"]
    by_name = {w["name"]: w for w in wf_list}
    if clash := [ep["name"] for ep in ENDPOINTS if ep["name"] in by_name]:
        sys.exit(f"STOP: already on {HOST}: {clash}")
    full = {}
    for t in (TEMPLATE_GET, TEMPLATE_POST):
        if t not in by_name:
            sys.exit(f"STOP: template {t!r} not found on {HOST}")
        full[t] = get(f"/workflows/{by_name[t]['id']}")
    pg_cred = next(n["credentials"] for n in full[TEMPLATE_GET]["nodes"] if n["type"] == "n8n-nodes-base.postgres")
    tag = next((t for t in get("/tags?limit=250")["data"] if t["name"] == GILLBERT_TAG), None)

    os.makedirs(DRAFTS, exist_ok=True)
    built = []
    for ep in ENDPOINTS:
        wf = build(ep, full[ep["template"]], pg_cred)
        if problems := check(wf):
            sys.exit(f"STOP: {ep['name']}: {problems}")
        out = os.path.join(DRAFTS, f"{ep['node'].lower().replace(' ', '-')}_{HOST}_{STAMP}.json")
        json.dump(wf, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(f"== {ep['name']}: {ep['method']} {ep['path']}, {len(wf['nodes'])} nodes, "
              f"credential {[v['name'] for v in pg_cred.values()]}; draft {os.path.relpath(out, HERE)}")
        built.append(wf)

    if not APPLY:
        print(f"dry run: nothing written to {HOST}")
        sys.exit(0)

    ids = {}
    for wf in built:
        made = write("POST", "/workflows", wf)
        ids[wf["name"]] = made["id"]
        json.dump(ids, open(IDS_FILE, "w", encoding="utf-8"), indent=1)   # saved as we go
        if tag:
            write("PUT", f"/workflows/{made['id']}/tags", [{"id": tag["id"]}])
        write("POST", f"/workflows/{made['id']}/activate")
        back = get(f"/workflows/{made['id']}")
        print(f"created + published {wf['name']}: {made['id']}, active={back.get('active')}, "
              f"checks {check(back) or 'ok'}")
