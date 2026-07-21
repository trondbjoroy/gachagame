#!/bin/bash
# Bring up a self-hosted Hathor full node (testnet) in Docker.
# Run on the VPS after it has >= 4GB RAM. Idempotent.
#
# After first start, check the logs for the peer id and for whitelist
# rejections; if peers refuse us, send the peer id to the Hathor team.
set -euo pipefail

DATA=/opt/hathor-node/data
mkdir -p "$DATA"

# docker, if missing
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker.io
  systemctl enable --now docker
fi

docker pull hathornetwork/hathor-core:latest

# systemd wrapper so the node survives reboots like the other services
cat > /etc/systemd/system/hathor-node.service <<'EOF'
[Unit]
Description=Hathor full node (testnet)
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker rm -f hathor-node
ExecStart=/usr/bin/docker run --name hathor-node --rm \
  -v /opt/hathor-node/data:/data \
  -p 127.0.0.1:8081:8080 \
  -p 40403:40403 \
  hathornetwork/hathor-core:latest \
  run_node --testnet --data /data \
  --status 8080 --listen tcp:40403 \
  --wallet-index --x-enable-event-queue
ExecStop=/usr/bin/docker stop hathor-node

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hathor-node

echo "node starting; watch sync with:"
echo "  docker logs -f hathor-node"
echo "  curl -s http://127.0.0.1:8081/v1a/status | head -c 400"
