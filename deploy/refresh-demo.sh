#!/usr/bin/env bash
# Regenerate the made-up data of the public demo so its dates stay recent (run daily).
#   deploy/refresh-demo.sh [days]
set -euo pipefail
cd "$(dirname "$0")/.."
days=${1:-60}
tmp=$(mktemp -d demo-data.new.XXXX)
chmod 755 "$tmp"
docker run --rm -u "$(id -u):$(id -g)" -e TT_DATA_DIR=/data -v "$PWD/$tmp:/data" tesla-tracks-ingester \
  tesla-tracks demo --days "$days" >/dev/null
# Replace the contents in place: the web-demo container bind-mounts this directory, so the
# directory itself must stay the same (a renamed/new directory would not be seen by the container).
mkdir -p demo-data
rsync -a --delete "$tmp"/ demo-data/
rm -rf "$tmp"
echo "demo data refreshed ($days days)"
