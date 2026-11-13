#!/usr/bin/env bash
# Copy the TLS certificate for TELEMETRY_HOSTNAME into ./certs and restart fleet-telemetry when it changed.
# fleet-telemetry reads its certificate only at start-up, so run this daily (cron or systemd timer).
#
#   deploy/sync-certs.sh <cert-file> <key-file>
#
# Typical sources:
#   Host Caddy:    /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$HOST/$HOST.{crt,key}
#   Bundled Caddy: docker compose cp caddy:/data/caddy/certificates/... (see README)
#   certbot:       /etc/letsencrypt/live/$HOST/{fullchain,privkey}.pem
set -euo pipefail
cd "$(dirname "$0")/.."
src_cert=${1:?cert file}
src_key=${2:?key file}
mkdir -p certs
changed=0
if ! cmp -s "$src_cert" certs/fullchain.pem 2>/dev/null; then changed=1; fi
if ! cmp -s "$src_key" certs/privkey.pem 2>/dev/null; then changed=1; fi
if [[ $changed == 1 ]]; then
  install -m 644 "$src_cert" certs/fullchain.pem
  install -m 600 "$src_key" certs/privkey.pem
  chown "${TT_UID:-$(id -u)}:${TT_GID:-$(id -g)}" certs/privkey.pem certs/fullchain.pem 2>/dev/null || true
  if docker compose ps --status running fleet-telemetry --quiet | grep -q .; then
    docker compose restart fleet-telemetry
  fi
  echo "certificate updated"
fi
