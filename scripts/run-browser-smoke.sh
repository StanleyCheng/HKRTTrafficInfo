#!/usr/bin/env bash
set -euo pipefail

base_url="http://127.0.0.1:5173"
evidence_dir="outputs/browser-smoke"
mkdir -p "$evidence_dir"
node scripts/run-framework.mjs dev --host 127.0.0.1 > "$evidence_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

ready=0
for _ in {1..60}; do
  if curl --silent --fail --max-time 2 "$base_url/api/health" > /dev/null; then ready=1; break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  cat "$evidence_dir/server.log"
  echo 'Local app did not become ready for browser checks.' >&2
  exit 1
fi

export PLAYWRIGHT_CHANNEL=chromium
node tests/startup-defaults.browser.mjs "$base_url" "$evidence_dir/startup"
TRANSPORT_TEST_FILTER='^(1440-960-en-2d|390-844-zh-2d|390-844-zh-3d)$' node tests/transport-layers.browser.mjs "$base_url" "$evidence_dir/layers"
node tests/refresh-recovery.browser.mjs "$base_url"
