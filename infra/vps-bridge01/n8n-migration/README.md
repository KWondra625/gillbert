# n8n migration tooling (Pi → vps-bridge01)

Used for the overnight import on 2026-10-03 (see the vault note "n8n Migration Plan and Results" and runbook §21).
Never commit the Pi export or the logs: they contain secrets (see `.gitignore`).

- `api.py`: API helper. The Pi is GET-only except the explicitly approved calls in `PI_WRITE_ALLOW`, DELETE is refused, every call goes to `run_log.jsonl`. Reads keys from `.claude/.env.n8n-api*`.
- `transform.py`: Pi workflow → Bridge01 payload (credential, sub-workflow and Data Table ID remaps + planned edits). Run it directly for a dry-run report.
- `import_wf.py "<name>"`: import inactive, tag, read back, verify. Skips anything already in `wf_map.json`.
- `check1_structural.py`, `check2_references.py`, `check3_live.py`: the three parity checks. `check3` temporarily activates GET workflows, so run it only with Kurt's approval.
- `wf_map.json`, `tag_map.json`, `datatable_map.json`: Pi → Bridge01 ID maps (not secret).

- `reverse_sync.py`: dry run of cutover step 6 (copy Bridge01's Gillbert-tagged workflows onto the Pi as Staging). GET-only by construction (wraps `api.call` to refuse anything else). Reverses the credential, sub-workflow and Data Table IDs, checks for production storage / Bridge01 hostnames / keys, lists the `$env` settings the Pi needs, flags Pi edits since 2026-10-03, and prints the activation order. Full diffs and PUT payloads go to the gitignored `reverse_dryrun/` (they can contain Pi secrets). New Bridge01 workflows show up as CREATEs. Write modes, each needing `--until "YYYY-MM-DD HH:MM"` (max 12h; Pi writes are granted per workflow id and count via `api.grant_pi_writes`, never DELETE): `--test` (throwaway System Info copy on the Pi, delete it by hand after), `--write` (the night: needs a reviewed dry run under 60 minutes old, checks the Pi's n8n settings over SSH, snapshots to gitignored `reverse_backup/`, then deactivate -> copy+verify -> create -> activate -> re-check) and `--restore <snapshot dir>`.

Before re-use (e.g. a cutover re-sync), re-pull a fresh `pi_workflows.json` into this folder (it's gitignored because it contains secrets). For changed workflows, update them on Bridge01 rather than re-importing. That needs a small `PUT /workflows/{id}` path, which isn't written yet.
