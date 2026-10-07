#!/bin/bash
# Proves a backup can actually be restored. Run as root, e.g. quarterly:
#   sudo ~/docker-stack/backup/restore-test.sh [backup-file.tar.gz.gpg]
#
# Decrypts the newest local backup (or the one given), loads both dumps into a
# throwaway Postgres container (no ports, no link to the real databases), then
# compares every table's row count with the live databases and checks the n8n
# encryption key. Prints counts and PASS/FAIL only; cleans up after itself.
# Live data written since the backup ran can show up as small, explainable differences.

set -euo pipefail
umask 077
CONF="$(dirname "$(readlink -f "$0")")/backup.env"
# shellcheck source=/dev/null
source "$CONF"

FILE="${1:-$(ls -t "$LOCAL_DIR/${SERVER_NAME}"-backup-*.tar.gz.gpg | head -1)}"
WORK=$(mktemp -d)
PG=restore-test-$$
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "Restore test of: $(basename "$FILE")"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" -d "$FILE" | tar -xz -C "$WORK"
D=$(ls -d "$WORK"/*/)
echo "✅ Decrypted + unpacked: $(ls "$D" | tr '\n' ' ')"

IMAGE=$(docker inspect data-postgres --format='{{.Config.Image}}')
docker run -d --name "$PG" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" "$IMAGE" >/dev/null
until docker exec "$PG" pg_isready -U postgres -q; do sleep 1; done

# pg_dumpall recreates roles + the gillbert/commons databases; n8n's dump needs its role and DB first.
zcat "$D/data_backup.sql.gz" | docker exec -i "$PG" psql -U postgres -q -v ON_ERROR_STOP=0 >"$WORK/data_restore.log" 2>&1
docker exec "$PG" psql -U postgres -q -c "CREATE ROLE $N8N_PG_USER LOGIN" -c "CREATE DATABASE n8n OWNER $N8N_PG_USER" >/dev/null
zcat "$D/n8n_backup.sql.gz" | docker exec -i "$PG" psql -U postgres -d n8n -q >"$WORK/n8n_restore.log" 2>&1
echo "✅ Loaded into throwaway container ($(grep -ci 'error' "$WORK/data_restore.log" "$WORK/n8n_restore.log" | awk -F: '{s+=$2} END {print s}') error lines; expected 0-1: 'role already exists' for postgres)"

COUNTS="select table_schema||'.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
        from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1"
fail=0
for spec in "data-postgres:$DATA_PG_USER:gillbert" "data-postgres:$DATA_PG_USER:commons" "n8n-postgres:$N8N_PG_USER:n8n"; do
  IFS=: read -r live user db <<< "$spec"
  docker exec "$live" psql -U "$user" -d "$db" -At -F' ' -c "$COUNTS" > "$WORK/live_$db"
  docker exec "$PG"   psql -U postgres -d "$db" -At -F' ' -c "$COUNTS" > "$WORK/restored_$db"
  tables=$(wc -l < "$WORK/live_$db"); rows=$(awk '{s+=$2} END {print s}' "$WORK/restored_$db")
  # n8n's execution/insights tables grow with every run after the backup, so they're left out of the compare
  for f in live restored; do grep -vE '\.(execution_|insights_)' "$WORK/${f}_$db" > "$WORK/${f}_$db.cmp" || true; done
  if diff -q "$WORK/live_$db.cmp" "$WORK/restored_$db.cmp" >/dev/null; then
    echo "✅ $db: $tables tables, $rows rows, all counts match live (n8n execution history excluded)"
  else
    echo "⚠️  $db: differences (live < > restored):"; diff "$WORK/live_$db.cmp" "$WORK/restored_$db.cmp" | grep '^[<>]' | head -20; fail=1
  fi
done

live_key=$(docker exec n8n cat /home/node/.n8n/config | sha256sum)
if [ "$live_key" = "$(sha256sum < "$D/n8n_config_backup")" ]; then echo "✅ n8n encryption key matches live"; else echo "❌ n8n encryption key differs"; fail=1; fi

[ "$fail" -eq 0 ] && echo "PASS: backup restores cleanly" || { echo "CHECK: see differences above"; exit 1; }
