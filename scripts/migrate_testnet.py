"""Migrate the game to the official Hathor testnet (testnet-india), where
MetaMask Snap and WalletConnect wallets can actually sign transactions.

Prerequisites (manual, once):
  1. Fund the operator on testnet: visit https://faucet.testnet.hathor.network,
     paste Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG, solve the captcha.
  2. Edit wallet-headless/config.js AND wallet-headless/dist/config.js:
       server:      'https://node1.testnet.hathor.network/v1a/'
       txMiningUrl: 'https://txmining.testnet.hathor.network/'
     then restart wallet-headless and re-/start both wallets.
     (Same seeds -> same addresses. The local miner is NOT needed on testnet.)

Then run this script from the repo root:  python scripts/migrate_testnet.py
It waits for the faucet funds, deploys GachaArena + templates + CardMarket,
and rewrites frontend/public/config.js and frontend/server.js in place.
"""
import json
import re
import time
import urllib.error
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
NODE = "https://node1.testnet.hathor.network/v1a"


def post(path, wallet, payload):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": wallet})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read())


def wait(fn, label, tries=60):
    for _ in range(tries):
        try:
            if fn():
                print("OK:", label, flush=True)
                return
        except Exception:
            pass
        time.sleep(12)
    raise SystemExit("TIMEOUT: " + label)


# sanity: wallet-headless must be on testnet
status = get("http://localhost:8000/wallet/status") if False else None
req = urllib.request.Request("http://localhost:8000/wallet/status", headers={"x-wallet-id": "operator"})
with urllib.request.urlopen(req, timeout=20) as r:
    st = json.loads(r.read())
net = (st.get("serverInfo") or {}).get("network", "")
assert "india" in net or net == "testnet", f"wallet-headless is on '{net}' — repoint it to node1.testnet first"

print("waiting for faucet funds on", OP, flush=True)
def has_funds():
    req = urllib.request.Request("http://localhost:8000/wallet/balance", headers={"x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("available", 0) >= 30
wait(has_funds, "operator funded", tries=120)

# --- game blueprint + contract ---
code = open("blueprint/gacha_arena.py", encoding="utf-8").read()
r = post("/wallet/nano-contracts/create-on-chain-blueprint", "operator", {"code": code, "address": OP})
GAME_BP = r["hash"]; print("game blueprint:", GAME_BP, flush=True)
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={GAME_BP}").get("name") == "GachaArena",
     "game blueprint confirmed")

r = post("/wallet/nano-contracts/create", "operator", {
    "blueprint_id": GAME_BP, "address": OP,
    "data": {"args": [OP, 5, 6000, 3000, 900, 100],
             "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
GAME_NC = r["hash"]; print("game contract:", GAME_NC, flush=True)
wait(lambda: get(f"{NODE}/nano_contract/state?id={GAME_NC}&fields[]=gems_uid").get("success"),
     "game contract confirmed")
GEMS = get(f"{NODE}/nano_contract/state?id={GAME_NC}&fields[]=gems_uid")["fields"]["gems_uid"]["value"]
print("GEMS:", GEMS, flush=True)

for tier, name in [(0, "Moss Snail"), (0, "Pixel Slime"), (0, "Tin Knight"), (0, "Rusty Dagger"),
                   (1, "Storm Falcon"), (1, "Ember Fox"), (1, "Crystal Golem"),
                   (2, "Void Kraken"), (2, "Shadow Dragon"), (3, "Genesis Phoenix")]:
    r = post("/wallet/nano-contracts/execute", "operator", {
        "nc_id": GAME_NC, "method": "add_template", "address": OP,
        "data": {"args": [tier, name]}})
    print("template", name, r.get("success"), flush=True)
    time.sleep(1.5)

# --- market ---
code = open("blueprint/card_market.py", encoding="utf-8").read()
r = post("/wallet/nano-contracts/create-on-chain-blueprint", "operator", {"code": code, "address": OP})
MKT_BP = r["hash"]; print("market blueprint:", MKT_BP, flush=True)
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={MKT_BP}").get("name") == "CardMarket",
     "market blueprint confirmed")
r = post("/wallet/nano-contracts/create", "operator", {
    "blueprint_id": MKT_BP, "address": OP, "data": {"args": [OP, GAME_NC, 200]}})
MKT_NC = r["hash"]; print("market contract:", MKT_NC, flush=True)
wait(lambda: get(f"{NODE}/nano_contract/state?id={MKT_NC}&calls[]=get_listing_count()").get("success"),
     "market contract confirmed")

# --- rewrite frontend config + proxy ---
cfg = f"""// GachaArena deployment + wallet-connect configuration (official testnet)
window.GAME = {{
  network: 'testnet',
  blueprint: '{GAME_BP}',
  nc: '{GAME_NC}',
  gems: '{GEMS}',
  market: {{
    blueprint: '{MKT_BP}',
    nc: '{MKT_NC}',
  }},
  wcProjectId: 'bb36c8bcfd09cf5e6c4ca13c5db2b4e2',
}};
"""
open("frontend/public/config.js", "w", encoding="utf-8", newline="\n").write(cfg)

s = open("frontend/server.js", encoding="utf-8").read()
s = re.sub(r"const NODE = process\.env\.NODE_URL \|\| '[^']+';",
           f"const NODE = process.env.NODE_URL || '{NODE}';", s)
s = re.sub(r"const NC = '[0-9a-f]{64}';", f"const NC = '{GAME_NC}';", s)
s = re.sub(r"const MKT_NC = process\.env\.MARKET_NC \|\| '[0-9a-f]{64}';",
           f"const MKT_NC = process.env.MARKET_NC || '{MKT_NC}';", s)
s = re.sub(r"const GEMS = '[0-9a-f]{64}';", f"const GEMS = '{GEMS}';", s)
open("frontend/server.js", "w", encoding="utf-8", newline="\n").write(s)

print(json.dumps({"game_bp": GAME_BP, "game_nc": GAME_NC, "gems": GEMS,
                  "mkt_bp": MKT_BP, "mkt_nc": MKT_NC}, indent=1))
print("Done. Restart frontend/server.js. Snap + WalletConnect (network=testnet) can now sign for real.")
