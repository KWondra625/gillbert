# n8n migration tooling (Pi → vps-bridge01)

Used for the overnight import on 2026-10-03 (see the vault note "n8n Migration Plan and Results" and runbook §21).
Never commit the Pi export or the logs: they contain secrets (see `.gitignore`).

- `api.py`: API helper. The Pi is GET-only except the explicitly approved calls in `PI_WRITE_ALLOW`, DELETE is refused, every call goes to `run_log.jsonl`. Reads keys from `.claude/.env.n8n-api*`.
- `transform.py`: Pi workflow → Bridge01 payload (credential, sub-workflow and Data Table ID remaps + planned edits). Run it directly for a dry-run report.
- `import_wf.py "<name>"`: import inactive, tag, read back, verify. Skips anything already in `wf_map.json`.
- `check1_structural.py`, `check2_references.py`, `check3_live.py`: the three parity checks. `check3` temporarily activates GET workflows, so run it only with Kurt's approval.
- `wf_map.json`, `tag_map.json`, `datatable_map.json`: Pi → Bridge01 ID maps (not secret).

Before re-use (e.g. a cutover re-sync), re-pull a fresh `pi_workflows.json` into this folder (it's gitignored because it contains secrets). For changed workflows, update them on Bridge01 rather than re-importing. That needs a small `PUT /workflows/{id}` path, which isn't written yet.
