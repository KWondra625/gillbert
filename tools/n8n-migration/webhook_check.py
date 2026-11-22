"""Webhook standard check (read-only): reports every Gillbert webhook workflow that is off-standard.

  python -I -X utf8 webhook_check.py            Staging
  python -I -X utf8 webhook_check.py --prod     Production
  add --all to list passing workflows too

Only GET requests. The standard is in the vault: Efforts/Gillbert/Webhook Standard - Assessment.
Exit code 1 when anything is off-standard, so it can gate a release checklist.
"""
import re, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import api  # noqa: E402

# Sites allowed to call each server (decided 2026-11-21). Production: the live site only.
# Staging: any site ("*"), because preview sites get a new name per branch and n8n can't wildcard.
# n8n matches exact names split on "," with no trimming, so the list is written without spaces.
ORIGINS = {"bridge01": ["https://gillbert.builtbykw.net"], "pi": ["*"]}

PATH_RE = re.compile(r"^gillbert/[a-z0-9-]+(/[a-z0-9-]+)?$")
ACCESS_NODES = ["Extract API Key", "Inspect API Key", "Is Authorized?"]
# The two chats also take messages from n8n's own chat window, so they read the key inside
# "Extract Input from Webhook Call" instead of a separate Extract API Key node.
ACCESS_EXCEPTIONS = {"Gillbert - Catch Chat": ["Extract API Key"],
                     "Gillbert - POST - Ask Gillbert": ["Extract API Key"]}
WEBHOOK, RESPOND = "n8n-nodes-base.webhook", "n8n-nodes-base.respondToWebhook"


def workflows(host):
    out, cursor = [], None
    while True:
        s, d = api.call(host, "GET", "/workflows?limit=100" + (f"&cursor={cursor}" if cursor else ""))
        if s != 200:
            sys.exit(f"STOP: GET /workflows -> {s}")
        out += d["data"]
        cursor = d.get("nextCursor")
        if not cursor:
            return out


def in_scope(w):
    return w["name"].startswith("Gillbert") and any(n["type"] == WEBHOOK for n in w["nodes"])


def check_webhook(n, host):
    p, issues = n["parameters"], []
    origins = (p.get("options") or {}).get("allowedOrigins", "")
    want = ",".join(ORIGINS[host])
    if origins != want:
        issues.append(("origins", f"'{origins or 'blank'}' should be '{want}'"))
    path = p.get("path", "")
    if not PATH_RE.match(path):
        issues.append(("path", f"'{path}' is not gillbert/<thing>/<action>"))
    if p.get("responseMode") != "responseNode":
        issues.append(("reply", "webhook doesn't answer through Respond to Webhook nodes"))
    return issues


def check_access(w):
    names = {n["name"] for n in w["nodes"]}
    missing = [a for a in ACCESS_NODES if a not in names and a not in ACCESS_EXCEPTIONS.get(w["name"], [])]
    return [("access", "missing/renamed: " + ", ".join(missing))] if missing else []


def check_reply(n):
    p, issues, name = n["parameters"], [], n["name"]
    opts = p.get("options") or {}
    code = opts.get("responseCode")
    if code in (None, ""):
        issues.append(("status", f"'{name}': status code not set"))
    headers = [h.get("name", "") for h in ((opts.get("responseHeaders") or {}).get("entries") or [])]
    extra = [h for h in headers if h.lower() != "content-type"]
    if extra:
        issues.append(("headers", f"'{name}': hand-added " + ", ".join(extra)))
    # Error replies: {success: false, message} (what the site reads). Bodies passed through from
    # an earlier node ($json...) are built there and can't be checked here.
    body = str(p.get("responseBody", ""))
    passthrough = re.fullmatch(r"=\{\{\s*\$json(\.\w+)?\s*\}\}", body.strip())
    is_error = (isinstance(code, int) and code >= 400) or "unauthorized" in body.lower()
    if is_error and not passthrough and not ("success" in body and "message" in body):
        issues.append(("body", f"'{name}': error body isn't {{success:false, message}}"))
    return issues


def check(w, host):
    issues = []
    for n in w["nodes"]:
        if n["type"] == WEBHOOK:
            issues += check_webhook(n, host)
        elif n["type"] == RESPOND:
            issues += check_reply(n)
    return issues + check_access(w)


def main():
    host = "bridge01" if "--prod" in sys.argv else "pi"
    found = sorted((w for w in workflows(host) if in_scope(w)), key=lambda w: w["name"])
    skipped = [w for w in found if not w["active"]]
    results = [(w, check(w, host)) for w in found if w["active"]]
    print(f"Webhook standard check: {'Production' if host == 'bridge01' else 'Staging'}, "
          f"{len(results)} active Gillbert webhook workflows"
          + (f" (skipped inactive: {', '.join(w['name'] for w in skipped)})" if skipped else "") + "\n")
    for w, issues in results:
        if issues or "--all" in sys.argv:
            print(f"{'OFF' if issues else 'ok '} {w['name']}  ({w['id']})")
            for kind, msg in issues:
                print(f"      {kind:8} {msg}")
    counts = {}
    for _, issues in results:
        for kind in {k for k, _ in issues}:
            counts[kind] = counts.get(kind, 0) + 1
    off = sum(1 for _, i in results if i)
    print(f"\n{len(results) - off} on standard, {off} off.  Workflows per issue: "
          + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none"))
    sys.exit(1 if off else 0)


if __name__ == "__main__":
    main()
