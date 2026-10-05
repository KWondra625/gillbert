"""Tiny n8n API helper for the overnight Bridge01 migration.

Guardrails (enforced in code):
  - Pi: GET only.
  - Bridge01: DELETE is refused outright.
Every call is appended to run_log.jsonl (method, path, status, short response) - never secrets.
"""
import json, os, time, urllib.request, urllib.error

REPO = r"C:\Users\kurtw\source\repos\KWondra625\Gillbert\.claude"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "run_log.jsonl")


def _env(fname):
    out = {}
    for line in open(os.path.join(REPO, fname), encoding="utf-8"):
        line = line.strip().replace("\r", "")
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# Pi writes Kurt explicitly approved, one by one. Everything else against the Pi stays GET-only.
PI_WRITE_ALLOW = {
    ("POST", "/workflows/gwHPCm2WNF3iDbMN/deactivate"),  # 2026-10-04: freeze Junk Email Review for its move to Bridge01
    ("POST", "/tags"),                                    # 2026-10-04: create the "Runs on vps-bridge01" tag
    ("PUT", "/workflows/gwHPCm2WNF3iDbMN/tags"),          # 2026-10-04: tag Junk Email Review with it
}

ENVS = {"pi": _env(".env.n8n-api"), "bridge01": _env(".env.n8n-api-bridge01")}


def call(host, method, path, body=None, raw_url=None, extra_headers=None):
    e = ENVS[host]
    if host == "pi" and method != "GET" and (method, path) not in PI_WRITE_ALLOW:
        raise RuntimeError("GUARDRAIL: only GET is allowed against the Pi")
    if method == "DELETE":
        raise RuntimeError("GUARDRAIL: DELETE is not allowed tonight")
    url = raw_url or (e["N8N_API_BASE_URL"].rstrip("/") + path)
    headers = {"CF-Access-Client-Id": e["CLOUDFLARE_CLIENT_ID"],
               "CF-Access-Client-Secret": e["CLOUDFLARE_CLIENT_SECRET"],
               "Accept": "application/json",
               # Cloudflare's Browser Integrity Check blocks Python's default UA (error 1010)
               "User-Agent": "kw-bridge01-migration/1.0 (KW Solutions; Claude Code)"}
    if not raw_url:
        headers["X-N8N-API-KEY"] = e["N8N_API_KEY"]
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, text = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        status, text = err.code, err.read().decode("utf-8", "replace")
    entry = {"t": time.strftime("%H:%M:%S"), "host": host, "method": method,
             "path": path if not raw_url else "(webhook) " + raw_url.split("/webhook/")[-1],
             "status": status, "resp": text[:300] if status >= 400 else f"{len(text)} bytes"}
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = text
    return status, parsed
