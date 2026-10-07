#!/bin/bash
# Nightly backup of a server's Docker stack (n8n + app Postgres).
#
#   Database dumps + config files + the n8n encryption key
#   -> one archive, encrypted with a passphrase (gpg, AES256)
#   -> uploaded to Azure, plus a short-lived local copy.
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

SCRIPT_VERSION="3.0"
CONF="${1:-$(dirname "$(readlink -f "$0")")/backup.env}"
# shellcheck source=/dev/null
source "$CONF"
: "${SERVER_NAME:?}" "${STACK_DIR:?}" "${N8N_PG_USER:?}" "${DATA_PG_USER:?}" "${PASSPHRASE_FILE:?}"
: "${LOCAL_DIR:?}" "${LOCAL_RETENTION_DAYS:?}" "${AZURE_STORAGE_ACCOUNT:?}" "${AZURE_CONTAINER:?}" "${AZURE_SAS_TOKEN:?}"

NAME="${SERVER_NAME}-backup-$(date +%Y-%m-%d-%H%M%S)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
D="$WORK/$NAME"
mkdir "$D"

echo "Starting backup: $NAME"

# --- Databases (critical) ---------------------------------------------------
echo "Dumping n8n database..."
docker exec n8n-postgres pg_dump -U "$N8N_PG_USER" n8n | gzip > "$D/n8n_backup.sql.gz"

echo "Dumping app databases + roles (pg_dumpall)..."
docker exec data-postgres pg_dumpall -U "$DATA_PG_USER" | gzip > "$D/data_backup.sql.gz"

# A dump that stopped early has no completion line; refuse to ship it.
# (tail to a file first: grep -q exiting early would trip pipefail)
check_dump() {
  zcat "$1" | tail -n 5 > "$WORK/dump_tail"
  grep -q "$2" "$WORK/dump_tail" || { echo "❌ $(basename "$1") is incomplete"; exit 1; }
}
check_dump "$D/n8n_backup.sql.gz"  "PostgreSQL database dump complete"
check_dump "$D/data_backup.sql.gz" "PostgreSQL database cluster dump complete"

# --- Config (important) ------------------------------------------------------
echo "Copying config files..."
cp "$STACK_DIR/.env"               "$D/env_backup"
cp "$STACK_DIR/docker-compose.yml" "$D/docker-compose_backup.yml"
cp "$STACK_DIR/Dockerfile"         "$D/Dockerfile_backup"
cp /etc/docker/daemon.json         "$D/daemon_backup.json"
cp "$0"                            "$D/backup_script_backup.sh"
cp "$CONF"                         "$D/backup_env_backup"   # holds the SAS; safe inside the encrypted archive

# n8n encryption key: without it, every n8n credential has to be re-entered
echo "Copying n8n encryption key..."
docker cp n8n:/home/node/.n8n/config "$D/n8n_config_backup"

# --- Metadata ----------------------------------------------------------------
cat > "$D/metadata.json" << METADATA
{
  "backup_name": "$NAME",
  "server": "$SERVER_NAME",
  "n8n_image": "$(docker inspect n8n --format='{{.Config.Image}}' 2>/dev/null || echo unknown)",
  "n8n_version": "$(docker exec n8n n8n --version 2>/dev/null || echo unknown)",
  "postgres_image": "$(docker inspect data-postgres --format='{{.Config.Image}}' 2>/dev/null || echo unknown)",
  "os": "$(uname -a)",
  "backup_script_version": "$SCRIPT_VERSION"
}
METADATA

# --- Compress + encrypt ------------------------------------------------------
echo "Compressing + encrypting..."
ARCHIVE="$WORK/$NAME.tar.gz.gpg"
tar -czf - -C "$WORK" "$NAME" \
  | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" -o "$ARCHIVE"
echo "Archive: $(du -h "$ARCHIVE" | cut -f1)"

# --- Upload to Azure ----------------------------------------------------------
echo "Uploading to Azure..."
/usr/local/bin/azcopy copy "$ARCHIVE" \
  "https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${AZURE_CONTAINER}/${NAME}.tar.gz.gpg?${AZURE_SAS_TOKEN}" \
  --overwrite=true --log-level=WARNING --output-level=essential
# overwrite=true on purpose: =false first checks whether the blob exists, which needs Read,
# and the SAS deliberately has none. Names are timestamped, so nothing gets overwritten.
echo "✅ Uploaded to Azure"

# --- Local copy (short retention) ---------------------------------------------
mkdir -p "$LOCAL_DIR"
cp "$ARCHIVE" "$LOCAL_DIR/"
find "$LOCAL_DIR" -maxdepth 1 -name "${SERVER_NAME}-backup-*.tar.gz.gpg" -mtime +"$LOCAL_RETENTION_DAYS" -delete
echo "✅ Local copy kept in $LOCAL_DIR ($(ls "$LOCAL_DIR" | wc -l) on disk)"

echo "✅ Backup complete: $NAME"
