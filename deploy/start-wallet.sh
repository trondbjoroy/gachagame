#!/usr/bin/env bash
# Start the shared "player" wallet in wallet-headless, retrying until the
# service is up. Idempotent: "already started" counts as success.
set -u
for i in $(seq 1 60); do
  out=$(curl -s -m 5 -X POST http://localhost:8000/start \
        -H 'Content-Type: application/json' \
        -d '{"wallet-id":"player","seedKey":"player"}')
  if echo "$out" | grep -Eq '"success": *true|already'; then
    echo "player wallet started: $out"
    exit 0
  fi
  echo "waiting for wallet-headless ($i): $out"
  sleep 3
done
echo "gave up starting the player wallet" >&2
exit 1
