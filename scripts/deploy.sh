#!/usr/bin/env bash
# Test, build and publish Reprise to a Debian/Ubuntu host over SSH.
#
#   npm run deploy                                         # default host: ssh alias "ct-reprise"
#   DEPLOY_HOST=user@host DEPLOY_PATH=/var/www/reprise npm run deploy
#
# The SSH user needs passwordless sudo on the host. Two parts get deployed:
#   * the static site (dist/) → DEPLOY_PATH, served by nginx
#   * the YouTube audio API (server/, deploy/) → /opt/reprise, then deploy/provision.sh
#     (idempotent) installs or updates nginx config, yt-dlp, Deno, ffmpeg and the systemd units.
set -euo pipefail

HOST="${DEPLOY_HOST:-ct-reprise}"
DEST="${DEPLOY_PATH:-/var/www/reprise}"
cd "$(dirname "$0")/.."

echo "→ testing"
npm test --silent >/dev/null
python3 -m unittest discover -s server -q 2>/dev/null
echo "→ building"
npm run build --silent >/dev/null

RSYNC=(rsync -rlz --chmod=D755,F644)
echo "→ uploading site to ${HOST}:${DEST}"
# 1. New hashed assets first, 2. then index.html that points at them, 3. then remove stale
#    files. A visitor mid-deploy never gets an index.html referencing assets that aren't there yet.
"${RSYNC[@]}" --exclude index.html dist/ "${HOST}:${DEST}/"
"${RSYNC[@]}" dist/index.html "${HOST}:${DEST}/"
"${RSYNC[@]}" --delete dist/ "${HOST}:${DEST}/"

echo "→ uploading API and provisioning"
ssh "$HOST" 'sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/reprise'
"${RSYNC[@]}" --delete --exclude '__pycache__' server deploy "${HOST}:/opt/reprise/"
ssh "$HOST" 'sudo bash /opt/reprise/deploy/provision.sh'

for path in / /api/health; do
  status="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' --retry 5 --retry-connrefused --retry-delay 1 http://localhost${path}")"
  if [[ "$status" != 200 ]]; then
    echo "✗ deployed, but ${path} answered HTTP ${status}" >&2
    exit 1
  fi
done
echo "✓ deployed ($(git rev-parse --short HEAD 2>/dev/null || echo 'uncommitted'))"
