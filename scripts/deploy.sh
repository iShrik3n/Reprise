#!/usr/bin/env bash
# Test, build and publish Reprise (a static site) to an nginx host over rsync.
#
#   npm run deploy                                         # default host: ssh alias "ct-reprise"
#   DEPLOY_HOST=user@host DEPLOY_PATH=/var/www/reprise npm run deploy
#
# The host only needs nginx (or any static file server) serving DEPLOY_PATH, writable by the
# SSH user. Nothing else runs server-side: all audio analysis happens in the visitor's browser.
set -euo pipefail

HOST="${DEPLOY_HOST:-ct-reprise}"
DEST="${DEPLOY_PATH:-/var/www/reprise}"
cd "$(dirname "$0")/.."

echo "→ testing"
npm test --silent >/dev/null
echo "→ building"
npm run build --silent >/dev/null

RSYNC=(rsync -rlz --chmod=D755,F644)
echo "→ uploading to ${HOST}:${DEST}"
# 1. New hashed assets first, 2. then index.html that points at them, 3. then remove stale
#    files. A visitor mid-deploy never gets an index.html referencing assets that aren't there yet.
"${RSYNC[@]}" --exclude index.html dist/ "${HOST}:${DEST}/"
"${RSYNC[@]}" dist/index.html "${HOST}:${DEST}/"
"${RSYNC[@]}" --delete dist/ "${HOST}:${DEST}/"

status="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://localhost/")"
if [[ "$status" != 200 ]]; then
  echo "✗ deployed, but the site answered HTTP ${status}" >&2
  exit 1
fi
echo "✓ deployed ($(git rev-parse --short HEAD 2>/dev/null || echo 'uncommitted'))"
