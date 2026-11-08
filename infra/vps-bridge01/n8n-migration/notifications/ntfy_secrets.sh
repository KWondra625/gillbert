#!/bin/bash
# Adds the ntfy publisher secrets to a server's docker-stack .env, without ever printing them.
#   NTFY_PUBLISHER_HASH   bcrypt hash for the n8n-publisher user (its password is thrown away; nobody logs in)
#   NTFY_PUBLISHER_TOKEN  the token n8n posts with (goes into n8n's "Gillbert ntfy Publisher" credential)
# Values are single-quoted so compose doesn't expand the $ signs in the hash. Safe to re-run: does nothing
# if both already have values. Empty lines (a .env copied from env.template) are replaced: removed, then appended with values.
#
#   bash ntfy_secrets.sh ~/docker-stack/.env
set -euo pipefail
ENV_FILE="${1:?usage: ntfy_secrets.sh <path to .env>}"
IMG=binwiederhier/ntfy:v2.37.2
DOCKER="docker"; [ -w /var/run/docker.sock ] || DOCKER="sudo docker"

has_value() { grep -qE "^$1=.+" "$ENV_FILE"; }
if has_value NTFY_PUBLISHER_HASH && has_value NTFY_PUBLISHER_TOKEN; then
  echo "already there: nothing changed"; exit 0
fi
if has_value NTFY_PUBLISHER_HASH || has_value NTFY_PUBLISHER_TOKEN; then
  echo "only one of NTFY_PUBLISHER_HASH / NTFY_PUBLISHER_TOKEN has a value: fix .env by hand, nothing changed"; exit 1
fi

P=$(openssl rand -hex 24)
H=$(printf '%s\n%s\n' "$P" "$P" | $DOCKER run --rm -i $IMG user hash 2>/dev/null | tr -d '\r' | grep -o '\$2[aby]\$.*' | tail -1 || true)
T=$($DOCKER run --rm $IMG token generate 2>/dev/null | tr -d '\r' | grep -o 'tk_[a-z0-9]*' | tail -1 || true)
unset P
[ ${#H} -eq 60 ] && [ ${#T} -eq 32 ] || { echo "secret generation failed (is docker running, can it pull $IMG?): nothing written"; exit 1; }

# Drop any empty template lines, then append both values
sed -i -E '/^NTFY_PUBLISHER_(HASH|TOKEN)=$/d' "$ENV_FILE"
printf "NTFY_PUBLISHER_HASH='%s'\nNTFY_PUBLISHER_TOKEN='%s'\n" "$H" "$T" >> "$ENV_FILE"
echo "added to $ENV_FILE (hash ${#H} chars, token ${#T} chars)."
echo "n8n credential 'Gillbert ntfy Publisher' (Header Auth): Name = Authorization, Value = Bearer <space> + the token,"
echo "i.e. the text BETWEEN the quotes on the NTFY_PUBLISHER_TOKEN line. No quote marks."
