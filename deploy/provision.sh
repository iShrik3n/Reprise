#!/usr/bin/env bash
# Prepare a Debian/Ubuntu host to serve Reprise. Idempotent: safe to run on every deploy.
# Run as root after the repo's server/ and deploy/ folders are synced to /opt/reprise.
#
# Installs: nginx, ffmpeg, the standalone yt-dlp binary (bundles yt-dlp-ejs) and Deno
# (the JavaScript runtime yt-dlp needs for YouTube since 2025.11). Both binaries are checked
# against their published SHA-256 sums. Then sets up the API service and the daily updater.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SRC=/opt/reprise

need_pkgs=()
for p in nginx ffmpeg curl unzip python3 rsync; do
  dpkg -s "$p" >/dev/null 2>&1 || need_pkgs+=("$p")
done
if ((${#need_pkgs[@]})); then
  echo "  installing ${need_pkgs[*]}"
  apt-get update -qq
  apt-get install -y -qq "${need_pkgs[@]}" >/dev/null
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [[ ! -x /usr/local/bin/yt-dlp ]]; then
  echo "  installing yt-dlp"
  base=https://github.com/yt-dlp/yt-dlp/releases/latest/download
  curl -fsSL -o "$tmp/yt-dlp_linux" "$base/yt-dlp_linux"
  curl -fsSL -o "$tmp/SHA2-256SUMS" "$base/SHA2-256SUMS"
  (cd "$tmp" && grep ' yt-dlp_linux$' SHA2-256SUMS | sha256sum -c --quiet -)
  install -m 755 "$tmp/yt-dlp_linux" /usr/local/bin/yt-dlp
fi

if [[ ! -x /usr/local/bin/deno ]]; then
  echo "  installing deno"
  base=https://github.com/denoland/deno/releases/latest/download
  zip=deno-x86_64-unknown-linux-gnu.zip
  curl -fsSL -o "$tmp/$zip" "$base/$zip"
  curl -fsSL -o "$tmp/$zip.sha256sum" "$base/$zip.sha256sum"
  (cd "$tmp" && echo "$(awk '{print $1}' "$zip.sha256sum")  $zip" | sha256sum -c --quiet -)
  unzip -q -o "$tmp/$zip" -d "$tmp"
  install -m 755 "$tmp/deno" /usr/local/bin/deno
fi

id reprise >/dev/null 2>&1 || useradd --system --home-dir /var/cache/reprise --shell /usr/sbin/nologin reprise
install -d -m 755 -o reprise -g reprise /var/cache/reprise /var/cache/reprise/audio
install -d -m 750 -o reprise -g reprise /var/cache/reprise/work /var/cache/reprise/deno /var/cache/reprise/xdg

install -m 644 "$SRC/deploy/reprise-api.service" /etc/systemd/system/reprise-api.service
install -m 644 "$SRC/deploy/reprise-tools-update.service" /etc/systemd/system/reprise-tools-update.service
install -m 644 "$SRC/deploy/reprise-tools-update.timer" /etc/systemd/system/reprise-tools-update.timer
systemctl daemon-reload
systemctl enable --quiet reprise-api.service reprise-tools-update.timer
systemctl restart reprise-api.service
systemctl start reprise-tools-update.timer

install -m 644 "$SRC/deploy/nginx-reprise.conf" /etc/nginx/sites-available/reprise
ln -sf /etc/nginx/sites-available/reprise /etc/nginx/sites-enabled/reprise
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload nginx

echo "  yt-dlp $(/usr/local/bin/yt-dlp --version), $(/usr/local/bin/deno --version | head -1), $(ffmpeg -version | head -1 | cut -d' ' -f1-3)"
