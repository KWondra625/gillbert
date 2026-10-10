#!/bin/bash
# Nightly backup of a server's Docker stack (n8n + app Postgres).
#
#   Database dumps + config files + the n8n encryption key
#   -> one archive, encrypted with a passphrase (gpg, AES256)
#   -> uploaded to Azure, plus a short-lived local copy.
#   -> result reported to the "Ops - Log Job Run" n8n workflow (ops.job_runs + Discord,
#      ntfy on failure); if n8n can't be reached, the script pages ntfy itself.
#
# Shared by every server; per-server settings and secrets live in backup.env
# (see backup.env.template, never committed). Runs as root from cron:
#   21 3 * * * /home/kurt/docker-stack/backup/backup.sh 2>&1 | systemd-cat -t kw-backup
#
# Azure retention is NOT handled here: the server's SAS can't delete, and a lifecycle
# rule on the container removes old backups. A compromised server can't wipe its history.
#
# Restore: gpg --decrypt <file>.tar.gz.gpg | tar -xz   (passphrase from the password manager)

set -euo pipefail   # pipefail: a failed pg_dump must fail the run, not leave an empty .gz
umask 077

SCRIPT_VERSION="3.1"
CONF="${1:-$(dirname "$(readlink -f "$0")")/backup.env}"
# shellcheck source=/dev/null
source "$CONF"
: "${SERVER_NAME:?}" "${STACK_DIR:?}" "${N8N_PG_USER:?}" "${DATA_PG_USER:?}" "${PASSPHRASE_FILE:?}"
: "${LOCAL_DIR:?}" "${LOCAL_RETENTION_DAYS:?}" "${AZURE_STORAGE_ACCOUNT:?}" "${AZURE_CONTAINER:?}" "${AZURE_SAS_TOKEN:?}"
# Reporting is optional: leave OPS_WEBHOOK_URL / NTFY_URL unset and the backup runs silently.

STARTED_AT=$(date -Iseconds)
START_S=$(date +%s)
STEP="starting"
FAILED_LINE=""
DETAILS=()   # "key":value pairs for the report; values must already be JSON

# --- Reporting (must never fail the backup itself) ----------------------------
add_detail() { DETAILS+=("\"$1\":$2"); }

page() {   # page <title> <message>: straight to ntfy, for when n8n can't be reached
  [ -n "${NTFY_URL:-}" ] || return 0
  curl -fsS -m 20 --retry 2 -H "Title: $1" -H "Priority: high" -H "Tags: rotating_light" \
       -d "$2" "$NTFY_URL" > /dev/null || echo "⚠️ ntfy page failed too"
}

report() {   # report <success|failed> [error]
  [ -n "${OPS_WEBHOOK_URL:-}" ] || return 0
  local status=$1 err=${2:-} err_json=null body
  [ -n "$err" ] && err_json="\"${err//[\"\\]/}\""
  body=$(printf '{"job":"backup","server":"%s","status":"%s","started_at":"%s","finished_at":"%s","duration_s":%d,"size_bytes":%s,"error":%s,"details":{%s}}' \
    "$SERVER_NAME" "$status" "$STARTED_AT" "$(date -Iseconds)" "$(( $(date +%s) - START_S ))" \
    "${ARCHIVE_BYTES:-null}" "$err_json" "$(IFS=,; echo "${DETAILS[*]}")")
  # Custom User-Agent: Cloudflare's Browser Integrity Check blocks some default ones
  if curl -fsS -m 20 --retry 2 -A "kw-backup/$SCRIPT_VERSION" -H "X-API-Key: ${OPS_WEBHOOK_KEY:-}" \
          -H "Content-Type: application/json" -d "$body" "$OPS_WEBHOOK_URL" > /dev/null; then
    echo "📨 Reported to n8n ($status)"
  else
    echo "⚠️ Couldn't report to n8n, paging ntfy directly"
    page "backup on $SERVER_NAME: n8n unreachable" "Backup status: $status. ${err:-The backup itself succeeded.} Logging to n8n failed."
  fi
}

# Any failure (set -e, a failed check, a missing setting) ends up here with a non-zero code
finish() {
  local rc=$?
  rm -rf "$WORK"
  if [ "$rc" -ne 0 ]; then
    echo "❌ Backup failed while $STEP (exit $rc)"
    report failed "Failed while $STEP (exit $rc${FAILED_LINE:+, line $FAILED_LINE})" || true
  fi
}

NAME="${SERVER_NAME}-backup-$(date +%Y-%m-%d-%H%M%S)"
WORK=$(mktemp -d)
trap finish EXIT
trap 'FAILED_LINE=$LINENO' ERR
D="$WORK/$NAME"
mkdir "$D"
add_detail archive "\"$NAME.tar.gz.gpg\""
add_detail script_version "\"$SCRIPT_VERSION\""

echo "Starting backup: $NAME"

# --- Databases (critical) ---------------------------------------------------
STEP="dumping the n8n database"
echo "Dumping n8n database..."
docker exec n8n-postgres pg_dump -U "$N8N_PG_USER" n8n | gzip > "$D/n8n_backup.sql.gz"

STEP="dumping the app databases"
echo "Dumping app databases + roles (pg_dumpall)..."
docker exec data-postgres pg_dumpall -U "$DATA_PG_USER" | gzip > "$D/data_backup.sql.gz"

# A dump that stopped early has no completion line; refuse to ship it.
# (tail to a file first: grep -q exiting early would trip pipefail)
STEP="checking the dumps"
check_dump() {
  zcat "$1" | tail -n 5 > "$WORK/dump_tail"
  grep -q "$2" "$WORK/dump_tail" || { echo "❌ $(basename "$1") is incomplete"; STEP="checking $(basename "$1") (incomplete)"; exit 1; }
}
check_dump "$D/n8n_backup.sql.gz"  "PostgreSQL database dump complete"
check_dump "$D/data_backup.sql.gz" "PostgreSQL database cluster dump complete"
add_detail n8n_dump_bytes  "$(stat -c%s "$D/n8n_backup.sql.gz")"
add_detail data_dump_bytes "$(stat -c%s "$D/data_backup.sql.gz")"

# --- Config (important) ------------------------------------------------------
STEP="copying config files"
echo "Copying config files..."
cp "$STACK_DIR/.env"               "$D/env_backup"
cp "$STACK_DIR/docker-compose.yml" "$D/docker-compose_backup.yml"
cp "$STACK_DIR/Dockerfile"         "$D/Dockerfile_backup"
cp /etc/docker/daemon.json         "$D/daemon_backup.json"
cp "$0"                            "$D/backup_script_backup.sh"
cp "$CONF"                         "$D/backup_env_backup"   # holds the SAS; safe inside the encrypted archive

# n8n encryption key: without it, every n8n credential has to be re-entered
STEP="copying the n8n encryption key"
echo "Copying n8n encryption key..."
docker cp n8n:/home/node/.n8n/config "$D/n8n_config_backup"

# --- Metadata ----------------------------------------------------------------
STEP="writing metadata"
N8N_VERSION=$(docker exec n8n n8n --version 2>/dev/null || echo unknown)
add_detail n8n_version "\"$N8N_VERSION\""
cat > "$D/metadata.json" << METADATA
{
  "backup_name": "$NAME",
  "server": "$SERVER_NAME",
  "n8n_image": "$(docker inspect n8n --format='{{.Config.Image}}' 2>/dev/null || echo unknown)",
  "n8n_version": "$N8N_VERSION",
  "postgres_image": "$(docker inspect data-postgres --format='{{.Config.Image}}' 2>/dev/null || echo unknown)",
  "os": "$(uname -a)",
  "backup_script_version": "$SCRIPT_VERSION"
}
METADATA

# --- Compress + encrypt ------------------------------------------------------
STEP="compressing and encrypting"
echo "Compressing + encrypting..."
ARCHIVE="$WORK/$NAME.tar.gz.gpg"
tar -czf - -C "$WORK" "$NAME" \
  | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" -o "$ARCHIVE"
ARCHIVE_BYTES=$(stat -c%s "$ARCHIVE")
echo "Archive: $(du -h "$ARCHIVE" | cut -f1)"

# --- Upload to Azure ----------------------------------------------------------
STEP="uploading to Azure"
echo "Uploading to Azure..."
/usr/local/bin/azcopy copy "$ARCHIVE" \
  "https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${AZURE_CONTAINER}/${NAME}.tar.gz.gpg?${AZURE_SAS_TOKEN}" \
  --overwrite=true --log-level=WARNING --output-level=essential
# overwrite=true on purpose: =false first checks whether the blob exists, which needs Read,
# and the SAS deliberately has none. Names are timestamped, so nothing gets overwritten.
echo "✅ Uploaded to Azure"

# --- Local copy (short retention) ---------------------------------------------
STEP="keeping the local copy"
mkdir -p "$LOCAL_DIR"
cp "$ARCHIVE" "$LOCAL_DIR/"
find "$LOCAL_DIR" -maxdepth 1 -name "${SERVER_NAME}-backup-*.tar.gz.gpg" -mtime +"$LOCAL_RETENTION_DAYS" -delete
LOCAL_COPIES=$(find "$LOCAL_DIR" -maxdepth 1 -name "${SERVER_NAME}-backup-*.tar.gz.gpg" | wc -l)
add_detail local_copies "$LOCAL_COPIES"
echo "✅ Local copy kept in $LOCAL_DIR ($LOCAL_COPIES on disk)"

echo "✅ Backup complete: $NAME"
STEP="reporting"
report success
