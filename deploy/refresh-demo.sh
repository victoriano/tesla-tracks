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
# swap in the new data atomically enough for a demo
rm -rf demo-data.old
[ -d demo-data ] && mv demo-data demo-data.old
mv "$tmp" demo-data
rm -rf demo-data.old
echo "demo data refreshed ($days days)"
