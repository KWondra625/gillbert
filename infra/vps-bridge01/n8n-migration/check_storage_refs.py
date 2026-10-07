"""Guard: no workflow may hardcode an Azure storage account or key.

Each server reads its own storage settings from .env ($env.GILLBERT_AZURE_STORAGE_*).
A hardcoded value would follow a workflow copied between servers, letting Staging
write to production media (or the reverse). Run before promoting workflows:

    python check_storage_refs.py bridge01      (or: pi)

Read-only (GET). Exits 1 if anything is found. Never prints the matched value.
"""
import json, re, sys
import api

PATTERNS = {
    "storage account name": re.compile(r"gillbertmedia"),
    "literal blob host": re.compile(r"https://[a-z0-9]{3,24}\.blob\.core\.windows\.net"),
    "Azure account key": re.compile(r"[A-Za-z0-9+/]{86}=="),
}

host = sys.argv[1] if len(sys.argv) > 1 else "bridge01"
status, resp = api.call(host, "GET", "/workflows?limit=250")
if status != 200:
    sys.exit(f"GET /workflows failed: {status}")

hits = []
for wf in resp["data"]:
    for node in wf["nodes"]:
        text = json.dumps(node.get("parameters", {}))
        for label, pat in PATTERNS.items():
            if pat.search(text):
                hits.append(f"{wf['name']} ({wf['id']}) :: {node['name']} :: {label}")

print(f"{host}: scanned {len(resp['data'])} workflows")
for h in hits:
    print("  FOUND", h)
print("OK, nothing hardcoded" if not hits else f"{len(hits)} problem(s)")
sys.exit(1 if hits else 0)
