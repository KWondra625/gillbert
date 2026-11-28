"""Gear stage 3: setup photos (docs/plans/gear-tip-ups.md, "Stage 3"). Two parts, run separately:

--part gear (new workflows only; nothing existing changes)
  Gillbert - Media - Make Photo Copies           sub-workflow: thumbnail + viewing copy of one file,
                                                 for any container it knows (catch-media, gear-media)
  Gillbert - Gear - POST Photo Upload Slot        gillbert/gear/photo-sas      where to upload the original
  Gillbert - Gear - POST Save Setup Photo         gillbert/gear/photo-save     make the copies, record it
  Gillbert - Gear - POST Remove Setup Photo       gillbert/gear/photo-remove   take it off, delete its files

--part thumbnails (changes one existing workflow)
  Gillbert - Media - Make Thumbnails: its copy-making Code node is replaced by a call to Make Photo
  Copies (the same code, moved), so catch photos and setup photos make their copies one way.
  Its input and answer stay the same, so its callers don't change. Backed up first; --restore
  puts it back.

Each endpoint is the server's own access check (copied from POST Update Angler, the same nodes every
Gillbert webhook uses), then its steps. Upload slots come from the shared SAS sub-workflow; the
path is checked again before anything else (it goes into shell commands). Files that nothing uses
any more are deleted by the workflows; the database functions (scripts/gear/11) say which.
The photos go in the gear-media storage container, which must exist (public read, like catch-media).

  python -I -X utf8 gear/deploy_gear_photos.py --part gear                  Staging dry run
  python -I -X utf8 gear/deploy_gear_photos.py --part gear --apply          Staging: create + publish (Kurt's OK)
  python -I -X utf8 gear/deploy_gear_photos.py --part thumbnails [--apply]  Staging: Make Thumbnails (Kurt's OK)
  python -I -X utf8 gear/deploy_gear_photos.py --part thumbnails --restore <backup dir>
  --prod: production, ONLY at release with Kurt's separate OK.
Undo for --part gear: deactivate the new workflows (the API helper never deletes).
"""
import copy, json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import api  # noqa: E402

APPLY = "--apply" in sys.argv
HOST = "bridge01" if "--prod" in sys.argv else "pi"
PART = sys.argv[sys.argv.index("--part") + 1] if "--part" in sys.argv else None
RESTORE = sys.argv[sys.argv.index("--restore") + 1] if "--restore" in sys.argv else None
STAMP = time.strftime("%Y%m%d-%H%M%S")
IDS_FILE = os.path.join(HERE, f"deployed_ids_{HOST}.json")
DRAFTS = os.path.join(HERE, "drafts")
GILLBERT_TAG = "Gillbert"
TEMPLATE_POST = "Gillbert - POST Update Angler"
AUTH = ["Inbound Request", "Extract API Key", "Inspect API Key", "Is Authorized?",
        "Return 401 Unauthorized Response", "Sticky Note"]
KEEP_SETTINGS = ("executionOrder", "callerPolicy")
SHARED_SAS = "Gillbert - Shared - Generate SAS URL"
COPIES = "Gillbert - Media - Make Photo Copies"
THUMBS = "Gillbert - Media - Make Thumbnails"
COPIES_INPUTS = ["container", "blobPath", "readUrl", "mediaType", "contentType", "originalFilename", "skipReason"]
COPIES_JS = open(os.path.join(HERE, "make_photo_copies.js"), encoding="utf-8").read()


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


def nid():
    return str(uuid.uuid4())


def code(name, js, pos, **extra):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"jsCode": js}, **extra}


def call_wf(name, wf_id, inputs, pos, each=False):
    """An Execute Workflow node, inputs mapped by name ({input: expression}); each=True runs it once per item."""
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.3, "position": pos,
            "parameters": {"workflowId": {"__rl": True, "value": wf_id, "mode": "id"},
                           "workflowInputs": {"mappingMode": "defineBelow", "value": inputs, "matchingColumns": [],
                                              "schema": [{"id": k, "displayName": k, "required": False, "defaultMatch": False,
                                                          "display": True, "canBeUsedToMatch": True, "type": "string",
                                                          "removed": False} for k in inputs],
                                              "attemptToConvertTypes": False, "convertFieldsToString": True},
                           "options": {}, **({"mode": "each"} if each else {})}}


def if_true(name, expr, pos):
    """An If node: output 0 when expr is true."""
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": pos,
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                                          "conditions": [{"id": nid(), "leftValue": expr, "rightValue": "",
                                                          "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                                          "combinator": "and"}, "options": {}}}


def respond(name, body, pos, status=200):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.5, "position": pos,
            "parameters": {"respondWith": "json", "responseBody": body, "options": {"responseCode": status}}}


def note(text, pos, w=560, h=200):
    return {"id": nid(), "name": "About This Workflow", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1,
            "position": pos, "parameters": {"content": text, "height": h, "width": w}}


def link(conns, a, *outs):
    """outs: one list of target names per output."""
    conns[a] = {"main": [[{"node": t, "type": "main", "index": 0} for t in out] for out in outs]}


# ── Shared code for the endpoints ────────────────────────────────────────────────────────────
VALIDATE_SLOT = r"""// A bad request gets a reply (400 + message), not an error run
const body = $('Inbound Request').first().json.body ?? {};
const refuse = error => [{ json: { refused: true, error } }];
const gearId = body.gearId, file = body.file;
if (!Number.isInteger(gearId) || gearId <= 0) return refuse('Missing or invalid gearId');
if (!file || typeof file.name !== 'string') return refuse('File missing name');
if (typeof file.size !== 'number' || file.size <= 0) return refuse('File missing/invalid size');
if (file.size > 25 * 1024 * 1024) return refuse(`That photo is too large; the limit is 25 MB.`);
// Only photo types get an upload slot. The path is later used in shell commands, so nothing
// else may get through. Same types as profile photos, less GIF.
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic' };
const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
if (!TYPES[ext]) return refuse("That file type isn't supported. Choose a JPG, PNG, WebP or HEIC photo.");
const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
return [{ json: { refused: false, gearId, blobPath: `gear/${gearId}/${id}.${ext}`, contentType: TYPES[ext] } }];
"""

VALIDATE_SAVE = r"""// Only a path in the exact shape the upload slot issues, for this tip-up. The public link and
// type are set here from the path, not taken from the browser. Later steps put the path into
// shell commands, so nothing past this point may run for anything else.
const account = $env.GILLBERT_AZURE_STORAGE_ACCOUNT;
if (!account) throw new Error('Missing GILLBERT_AZURE_STORAGE_ACCOUNT on this server');
const body = $('Inbound Request').first().json.body ?? {};
const refuse = error => [{ json: { refused: true, error } }];
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic' };
const m = /^gear\/(\d+)\/[A-Z0-9]{8,24}\.([a-z]{3,4})$/.exec(body.blobPath || '');
if (!m || Number(m[1]) !== body.gearId || !TYPES[m[2]]) return refuse('Invalid upload path');
const by = Number.isInteger(body.byAnglerId) ? body.byAnglerId : null;
const name = String(body.originalName || '').replace(/[\r\n]/g, '').slice(0, 200);
return [{ json: { refused: false, gearId: body.gearId, blobPath: body.blobPath, byAnglerId: by,
  contentType: TYPES[m[2]], originalFilename: name,
  readUrl: `https://${account}.blob.core.windows.net/gear-media/${body.blobPath}` } }];
"""

# The database answers removePaths: the files nothing uses any more. One item per file to delete,
# or one { none: true } item.
FILES_TO_DELETE = """const r = $input.first().json.result || {};
const paths = (r.removePaths || []).filter(p => /^gear\\/\\d+\\/[A-Z0-9]{8,24}(-thumb|-view)?\\.[a-z]{3,4}$/.test(p));
return paths.length ? paths.map(blobName => ({ json: { blobName } })) : [{ json: { none: true } }];
"""

DELETE_FILES = r"""// Best effort: a file that's already gone, or a failed delete, doesn't fail the save. The
// URLs come from the shared SAS sub-workflow (delete permission, one file each).
const { spawn } = require('child_process');
const del = url => new Promise(resolve => {
  const p = spawn('curl', ['-sS', '-X', 'DELETE', '-o', '/dev/null', '-w', '%{http_code}', url], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.on('close', () => resolve(out.trim()));
  p.on('error', () => resolve('error'));
});
const done = [];
for (const item of $input.all()) done.push(await del(item.json.url));
return [{ json: { deleted: done.filter(c => c === '202').length, tried: done.length } }];
"""


def build_endpoint(name, path, steps, conns, template, note_text):
    nodes = []
    for n in template["nodes"]:
        if n["name"] not in AUTH:
            continue
        c = copy.deepcopy(n)
        c["id"] = nid()
        if c["name"] == "Inbound Request":
            c["parameters"]["path"] = path
            c["parameters"]["httpMethod"] = "POST"
            c["webhookId"] = nid()
        if c["name"] == "Sticky Note":
            c["parameters"]["content"] = "## Authorization Check\n"
        nodes.append(c)
    x0 = max(n["position"][0] for n in nodes) + 240
    y0 = next(n for n in nodes if n["name"] == "Is Authorized?")["position"][1]
    for i, s in enumerate(steps):
        if s["type"] != "n8n-nodes-base.stickyNote":
            s["position"] = [x0 + 240 * s["position"][0], y0 + 200 * s["position"][1]]
    nodes += steps + [note(note_text, [x0, y0 - 460])]
    first = steps[0]["name"]
    link(conns, "Inbound Request", ["Extract API Key"])
    link(conns, "Extract API Key", ["Inspect API Key"])
    link(conns, "Inspect API Key", ["Is Authorized?"])
    link(conns, "Is Authorized?", [first], ["Return 401 Unauthorized Response"])
    return {"name": name, "nodes": nodes, "connections": conns,
            "settings": {k: v for k, v in template["settings"].items() if k in KEEP_SETTINGS}}


def pg(name, sql, params, pos, cred):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": pos,
            "credentials": copy.deepcopy(cred), "onError": "continueErrorOutput",
            "parameters": {"operation": "executeQuery", "query": sql, "options": {"queryReplacement": params}}}


def delete_chain(sas_id, after):
    """Files To Delete → Any To Delete? → SAS (d) → Delete Files → after; nothing to delete → after."""
    nodes = [code("Files To Delete", FILES_TO_DELETE, [0, 0]),
             if_true("Any To Delete?", "={{ !$json.none }}", [1, 0]),
             call_wf("Delete Link", sas_id, {"container": "gear-media", "blobName": "={{ $json.blobName }}", "perms": "d"}, [2, -1],
                     each=True),
             code("Delete Files", DELETE_FILES, [3, -1])]
    conns = {}
    link(conns, "Files To Delete", ["Any To Delete?"])
    link(conns, "Any To Delete?", ["Delete Link"], [after])
    link(conns, "Delete Link", ["Delete Files"])
    link(conns, "Delete Files", [after])
    return nodes, conns


def shift(nodes, dx, dy=0):
    for n in nodes:
        n["position"] = [n["position"][0] + dx, n["position"][1] + dy]
    return nodes


def plan_gear(by_name, copies_id):
    template = get(f"/workflows/{by_name[TEMPLATE_POST]['id']}")
    sas_id = by_name[SHARED_SAS]["id"]
    gear_get = get(f"/workflows/{by_name['Gillbert - Gear - GET Gear']['id']}")
    cred = next(n["credentials"] for n in gear_get["nodes"] if n["type"] == "n8n-nodes-base.postgres")
    failed = '{"success": false, "message": "Unable to save the photo. Please try again."}'
    built = []

    # Upload slot
    steps = [code("Validate Request", VALIDATE_SLOT, [0, 0]),
             if_true("Refused?", "={{ $json.refused }}", [1, 0]),
             respond("Return 400 Refused", "={{ JSON.stringify({ success: false, message: $json.error }) }}", [2, -1], 400),
             call_wf("Upload Link", sas_id, {"container": "gear-media", "blobName": "={{ $json.blobPath }}", "perms": "cw"}, [2, 1]),
             respond("Respond to Webhook", "={{ JSON.stringify({ success: true, uploadUrl: $json.url, "
                     "blobPath: $('Validate Request').first().json.blobPath, contentType: $('Validate Request').first().json.contentType }) }}", [3, 1])]
    conns = {}
    link(conns, "Validate Request", ["Refused?"])
    link(conns, "Refused?", ["Return 400 Refused"], ["Upload Link"])
    link(conns, "Upload Link", ["Respond to Webhook"])
    built.append(build_endpoint("Gillbert - Gear - POST Photo Upload Slot", "gillbert/gear/photo-sas", steps, conns, template,
        "## Gear: setup photo upload slot\nChecks the file (type, 25 MB), picks its path `gear/<gearId>/<ID>.<ext>` and "
        "answers a short-lived upload link (shared SAS sub-workflow) to the gear-media container."))

    # Save
    v = "$('Validate Request').first().json"
    save_params = ("={{ [ JSON.stringify({ gearId: " + v + ".gearId, blobPath: " + v + ".blobPath, readUrl: " + v + ".readUrl, "
                   "byAnglerId: " + v + ".byAnglerId, thumbnailUrl: $json.ok ? $json.thumbnailUrl : '', "
                   "viewingUrl: $json.ok ? $json.viewingUrl : '' }) ] }}")
    dnodes, dconns = delete_chain(sas_id, "Build Response")
    steps = [code("Validate Request", VALIDATE_SAVE, [0, 0]),
             if_true("Refused?", "={{ $json.refused }}", [1, 0]),
             respond("Return 400 Refused", "={{ JSON.stringify({ success: false, message: $json.error }) }}", [2, -1], 400),
             call_wf("Make Photo Copies", copies_id, {
                 "container": "gear-media", "blobPath": "={{ $json.blobPath }}", "readUrl": "={{ $json.readUrl }}",
                 "mediaType": "Photo", "contentType": "={{ $json.contentType }}",
                 "originalFilename": "={{ $json.originalFilename }}", "skipReason": ""}, [2, 1]),
             pg("Save Photo", "SELECT gear_photo_save($1::jsonb) AS result;", save_params, [3, 1], cred),
             respond("Return 500 Failed", failed, [4, 2], 500),
             *shift(dnodes, 4, 1),
             code("Build Response", """// Copies that failed: the save was refused (no URLs) and the files cleaned up; say why
const r = $('Save Photo').first().json.result || {};
const copies = $('Make Photo Copies').first().json;
if (!copies.ok) return [{ json: { success: false, message: "Gillbert couldn't read that photo. Try another one, or a screenshot of it." } }];
return [{ json: r.success ? { success: true, photo: r.photo } : { success: false, message: r.message } }];""", [8, 1]),
             respond("Respond to Webhook", "={{ JSON.stringify($json) }}", [9, 1])]
    conns = {}
    link(conns, "Validate Request", ["Refused?"])
    link(conns, "Refused?", ["Return 400 Refused"], ["Make Photo Copies"])
    link(conns, "Make Photo Copies", ["Save Photo"])
    link(conns, "Save Photo", ["Files To Delete"], ["Return 500 Failed"])
    conns.update(dconns)
    link(conns, "Build Response", ["Respond to Webhook"])
    built.append(build_endpoint("Gillbert - Gear - POST Save Setup Photo", "gillbert/gear/photo-save", steps, conns, template,
        "## Gear: save a setup photo\nThe original is already uploaded (photo-sas). Make Photo Copies makes the 1200 px "
        "thumbnail and 2048 px viewing copy (shared with catch photos), `gear_photo_save()` puts it on the tip-up's current "
        "setup (no new version), and the files nothing uses any more are deleted (a replaced photo, or this one if refused)."))

    # Remove
    dnodes, dconns = delete_chain(sas_id, "Build Response")
    steps = [pg("Remove Photo", "SELECT gear_photo_remove($1::jsonb) AS result;",
                "={{ [ JSON.stringify($('Inbound Request').first().json.body ?? {}) ] }}", [0, 0], cred),
             respond("Return 500 Failed", failed.replace("save", "remove"), [1, 1], 500),
             *shift(dnodes, 1, 0),
             code("Build Response", """const r = $('Remove Photo').first().json.result || {};
return [{ json: r.success ? { success: true } : { success: false, message: r.message } }];""", [5, 0]),
             respond("Respond to Webhook", "={{ JSON.stringify($json) }}", [6, 0])]
    conns = {}
    link(conns, "Remove Photo", ["Files To Delete"], ["Return 500 Failed"])
    conns.update(dconns)
    link(conns, "Build Response", ["Respond to Webhook"])
    built.append(build_endpoint("Gillbert - Gear - POST Remove Setup Photo", "gillbert/gear/photo-remove", steps, conns, template,
        "## Gear: remove a setup photo\n`gear_photo_remove()` takes it off the tip-up's current setup; its files are deleted "
        "unless an older setup version still shows them."))
    return built


def build_copies():
    trig = {"id": nid(), "name": "When Executed by Another Workflow", "type": "n8n-nodes-base.executeWorkflowTrigger",
            "typeVersion": 1.1, "position": [0, 0],
            "parameters": {"workflowInputs": {"values": [{"name": k} for k in COPIES_INPUTS]}}}
    nodes = [trig, code("Make Photo Copies", COPIES_JS, [240, 0]),
             note("## Make Photo Copies\nOne file per run: a photo gets `<ID>-thumb.jpg` (1200 px) and `<ID>-view.jpg` "
                  "(2048 px) next to its original; a video its poster frame. Written to THIS server's storage only; the "
                  "original is only read. Never throws: returns { ok, skip, thumbnailUrl, viewingUrl, error }.\n"
                  "Used by Make Thumbnails (catch photos) and Save Setup Photo (gear). Code: "
                  "tools/n8n-migration/gear/make_photo_copies.js", [-40, -280], 600, 220)]
    conns = {}
    link(conns, "When Executed by Another Workflow", ["Make Photo Copies"])
    return {"name": COPIES, "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1", "callerPolicy": "workflowsFromSameOwner"}}


PREPARE = """// The catch_media row, as Make Photo Copies takes it. Anything that isn't ready gets a skip reason
// (nothing is recorded for it), as before this step moved to the shared sub-workflow.
const r = $json;
const skipReason = !r.id ? 'Media not found'
  : r.content_type === 'image/gif' ? 'GIFs keep their original (a thumbnail would freeze the animation)'
  : r.status !== 'complete' ? 'Only complete photos and videos get thumbnails' : '';
return [{ json: { container: 'catch-media', blobPath: r.blob_path || '', readUrl: r.read_url || '',
  mediaType: r.media_type || '', contentType: r.content_type || '', originalFilename: r.original_filename || '', skipReason } }];
"""


def plan_thumbnails(live, copies_id):
    nodes = copy.deepcopy(live["nodes"])
    by = {n["name"]: n for n in nodes}
    if "Make Photo Copies" in by:
        return nodes, live["connections"]          # already done
    old = by["Make Thumbnails"]
    pos = old["position"]
    nodes.remove(old)
    nodes.append(code("Prepare", PREPARE, [pos[0], pos[1]]))
    nodes.append(call_wf("Make Photo Copies", copies_id, {k: "={{ $json." + k + " }}" for k in COPIES_INPUTS},
                         [pos[0] + 220, pos[1]]))
    for n in nodes:
        if n["position"][0] > pos[0] and n["name"] not in ("Make Photo Copies", "Prepare"):
            n["position"] = [n["position"][0] + 220, n["position"][1]]
    save = by["Save Thumbnails"]["parameters"]["options"]
    trig = "$('When Executed by Another Workflow').first().json.mediaId"
    assert save["queryReplacement"].startswith("={{ [ $json.mediaId,"), save["queryReplacement"]
    save["queryReplacement"] = save["queryReplacement"].replace("$json.mediaId", trig, 1)
    res = by["Result"]["parameters"]
    a = "const t = $('Make Thumbnails').first().json;"
    assert a in res["jsCode"]
    res["jsCode"] = res["jsCode"].replace(a, "const t = { ...$('Make Photo Copies').first().json, mediaId: Number(" + trig + ") };")
    st = by.get("Sticky Note")
    if st:
        st["parameters"]["content"] += "\nThe copies are made by the shared sub-workflow Make Photo Copies (also used for gear setup photos)."
    conns = copy.deepcopy(live["connections"])
    conns.pop("Make Thumbnails", None)
    link(conns, "Load Media Row", ["Prepare"])
    link(conns, "Prepare", ["Make Photo Copies"])
    link(conns, "Make Photo Copies", ["Save Thumbnails"])
    return nodes, conns


def put_workflow(wf_id, live, nodes, connections):
    payload = {"name": live["name"], "nodes": nodes, "connections": connections,
               "settings": {k: v for k, v in (live.get("settings") or {}).items() if k in KEEP_SETTINGS}}
    if live["active"]:
        write("POST", f"/workflows/{wf_id}/deactivate")
    write("PUT", f"/workflows/{wf_id}", payload)
    if live["active"]:
        write("POST", f"/workflows/{wf_id}/activate")
    return get(f"/workflows/{wf_id}")


def create(wf, tag, ids):
    made = write("POST", "/workflows", wf)
    ids[wf["name"]] = made["id"]
    json.dump(ids, open(IDS_FILE, "w", encoding="utf-8"), indent=1)
    if tag:
        write("PUT", f"/workflows/{made['id']}/tags", [{"id": tag["id"]}])
    write("POST", f"/workflows/{made['id']}/activate")
    back = get(f"/workflows/{made['id']}")
    print(f"created + published {wf['name']}: {made['id']}, active={back.get('active')}")
    return made["id"]


def summary(wf):
    print(f"== {wf['name']}: {len(wf['nodes'])} nodes")
    for a, v in wf["connections"].items():
        print(f"   {a} -> {[[c['node'] for c in br] for br in v['main']]}")


if __name__ == "__main__":
    if PART not in ("gear", "thumbnails"):
        sys.exit("Say which part: --part gear or --part thumbnails")
    by_name = {w["name"]: w for w in get("/workflows?limit=250")["data"]}
    for need in (TEMPLATE_POST, SHARED_SAS, THUMBS):
        if need not in by_name:
            sys.exit(f"STOP: {need!r} not found on {HOST}")
    ids = json.load(open(IDS_FILE, encoding="utf-8")) if os.path.exists(IDS_FILE) else {}
    tag = next((t for t in get("/tags?limit=250")["data"] if t["name"] == GILLBERT_TAG), None)
    os.makedirs(DRAFTS, exist_ok=True)

    if PART == "gear":
        copies = build_copies()
        copies_id = by_name[COPIES]["id"] if COPIES in by_name else "<Make Photo Copies id>"
        built = plan_gear(by_name, copies_id)
        todo = [w for w in [copies] + built if w["name"] not in by_name]
        if have := [w["name"] for w in [copies] + built if w["name"] in by_name]:
            print(f"already on {HOST}, left as they are: {have}")
        for wf in todo:
            summary(wf)
            json.dump(wf, open(os.path.join(DRAFTS, f"photos_{wf['name'].split(' - ')[-1].lower().replace(' ', '-')}_{HOST}_{STAMP}.json"),
                               "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        if not APPLY:
            sys.exit(f"dry run: nothing written to {HOST}")
        if copies in todo:
            copies_id = create(copies, tag, ids)
            built = plan_gear(by_name, copies_id)      # rebuilt with the real id
        for wf in built:
            if wf["name"] not in by_name:
                create(wf, tag, ids)
        sys.exit("Done.")

    # --part thumbnails
    if RESTORE:
        for f in sorted(os.listdir(RESTORE)):
            old = json.load(open(os.path.join(RESTORE, f), encoding="utf-8"))
            cur = get(f"/workflows/{old['id']}")
            back = put_workflow(old["id"], cur, old["nodes"], old["connections"])
            print(f"restored {old['name']} ({old['id']}) active={back['active']}")
        sys.exit("Restore done.")
    if COPIES not in by_name:
        sys.exit(f"STOP: run --part gear first ({COPIES} isn't on {HOST})")
    live = get(f"/workflows/{by_name[THUMBS]['id']}")
    backup_dir = os.path.join(DRAFTS, f"thumbnails_backup_{HOST}_{STAMP}")
    os.makedirs(backup_dir)
    json.dump(live, open(os.path.join(backup_dir, f"{live['id']}.json"), "w", encoding="utf-8"), indent=1)
    nodes, conns = plan_thumbnails(live, by_name[COPIES]["id"])
    if nodes == live["nodes"]:
        sys.exit(f"{THUMBS} on {HOST}: already up to date")
    summary({"name": THUMBS, "nodes": nodes, "connections": conns})
    print(f"Backup: {backup_dir}")
    if not APPLY:
        sys.exit(f"dry run: nothing written to {HOST}")
    back = put_workflow(live["id"], live, nodes, conns)
    ok = {n["name"] for n in back["nodes"]} == {n["name"] for n in nodes} and back["active"] == live["active"]
    print(f"{THUMBS} ({live['id']}): read-back {'OK' if ok else 'MISMATCH'} (active={back['active']})")
    if not ok:
        sys.exit(f"STOP: restore with --part thumbnails --restore {backup_dir}")
    print(f"Done. Undo: --part thumbnails --restore {backup_dir}")
