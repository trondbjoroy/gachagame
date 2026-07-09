#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 VPS.
# Run as root from the repo root after cloning it to /opt/gacha:
#   git clone https://github.com/trondbjoroy/gachagame /opt/gacha
#   cd /opt/gacha && sudo bash deploy/setup.sh
# Then edit /etc/caddy/Caddyfile with your domain and: systemctl reload caddy
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== packages =="
apt-get update -qq
apt-get install -y -qq curl git python3-venv debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "== service user =="
id gacha &>/dev/null || useradd -r -m -d /opt/gacha -s /usr/sbin/nologin gacha

echo "== python venv (miner) =="
python3 -m venv venv
./venv/bin/pip install -q hathorlib

echo "== wallet-headless =="
if [ ! -d wallet-headless ]; then
  git clone --depth 1 https://github.com/HathorNetwork/hathor-wallet-headless wallet-headless
fi
cp wallet-headless.config.js wallet-headless/config.js
(cd wallet-headless && npm install --silent && npm run build --silent && cp config.js dist/config.js)

echo "== permissions =="
chown -R gacha:gacha /opt/gacha
chmod +x deploy/start-wallet.sh

echo "== systemd =="
cp deploy/gacha-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gacha-miner gacha-wallet gacha-wallet-start gacha-frontend

echo "== caddy =="
if ! grep -q 'reverse_proxy 127.0.0.1:8090' /etc/caddy/Caddyfile 2>/dev/null; then
  cp deploy/Caddyfile /etc/caddy/Caddyfile
fi
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo
cat > /etc/cron.daily/gacha-faucet <<'CRON'
#!/bin/sh
# top up the shared demo wallet from the operator treasury when it runs low
ADDR=$(curl -s -m 10 localhost:8090/api/wallet/address?index=0 | grep -o 'W[1-9A-HJ-NP-Za-km-z]*')
BAL=$(curl -s -m 10 localhost:8000/wallet/balance -H 'x-wallet-id: player' | grep -o '"available":[0-9]*' | cut -d: -f2)
[ -n "$ADDR" ] && [ "${BAL:-0}" -lt 500 ] && curl -s -m 60 -X POST localhost:8000/wallet/simple-send-tx \
  -H 'x-wallet-id: operator' -H 'Content-Type: application/json' \
  -d "{\"address\":\"$ADDR\",\"value\":500}" >/dev/null 2>&1
CRON
chmod +x /etc/cron.daily/gacha-faucet

echo "Done. Next steps:"
echo "  1. Point your domain's A record at this server."
echo "  2. Edit /etc/caddy/Caddyfile (replace gacha.example.com), then: systemctl reload caddy"
echo "  3. Fund the player wallet: POST https://faucet.hathor.dev/api/drip with its address"
echo "     (curl localhost:8090/api/wallet/address?index=0)"
echo "  4. Check: curl localhost:8090/api/wallet/balance"
