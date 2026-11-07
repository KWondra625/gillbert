#!/bin/bash
# Adds the ntfy publisher secrets to a server's docker-stack .env, without ever printing them.
#   NTFY_PUBLISHER_HASH   bcrypt hash for the n8n-publisher user (its password is thrown away; nobody logs in)
#   NTFY_PUBLISHER_TOKEN  the token n8n posts with (goes into n8n's "Gillbert ntfy Publisher" credential)
# Values are single-quoted so compose doesn't expand the $ signs in the hash. Safe to re-run: does nothing
# if the token is already there. Used on Staging 2026-11-06; production at release (sudo on Bridge01).
#
#   bash ntfy_secrets.sh ~/docker-stack/.env
set -euo pipefail
ENV_FILE="${1:?usage: ntfy_secrets.sh <path to .env>}"
IMG=binwiederhier/ntfy:v2.37.2
DOCKER="docker"; [ -w /var/run/docker.sock ] || DOCKER="sudo docker"

if grep -q '^NTFY_PUBLISHER_TOKEN=' "$ENV_FILE"; then
  echo "already there: nothing changed"; exit 0
fi
P=$(openssl rand -hex 24)
H=$(printf '%s\n%s\n' "$P" "$P" | $DOCKER run --rm -i $IMG user hash 2>/dev/null | tr -d '\r' | grep -o '\$2[aby]\$.*' | tail -1)
T=$($DOCKER run --rm $IMG token generate 2>/dev/null | tr -d '\r' | grep -o 'tk_[a-z0-9]*' | tail -1)
unset P
[ ${#H} -eq 60 ] && [ ${#T} -eq 32 ] || { echo "secret generation failed: nothing written"; exit 1; }
printf "\n# ntfy (Gillbert new-catch notifications)\nNTFY_PUBLISHER_HASH='%s'\nNTFY_PUBLISHER_TOKEN='%s'\n" "$H" "$T" >> "$ENV_FILE"
echo "added to $ENV_FILE (hash ${#H} chars, token ${#T} chars). For n8n: the token is the text BETWEEN the quotes."
