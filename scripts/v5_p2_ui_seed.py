"""Seed one OPEN squad duel on the phase-2 playground contract so the
v5-frontend Arena list can be smoke-checked in a browser. Reuses the three
player cards from the E2E (they are back in the player wallet afterwards).

Run: V5P2_NC=<hash> python scripts/v5_p2_ui_seed.py
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = os.environ["V5P2_NC"]


def post(path, payload, wallet="player"):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": wallet})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


req = urllib.request.Request("http://localhost:8000/wallet/address?index=0",
    headers={"x-wallet-id": "player"})
with urllib.request.urlopen(req, timeout=30) as r:
    PL = json.loads(r.read())["address"]

# the player's three cards = contract tokens whose balance sits in the wallet
uids = []
d = get(f"{NODE}/nano_contract/state?id={NC}&balances[]=__all__")
for uid in (d.get("balances") or {}):
    if uid == "00":
        continue
    w = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"http://localhost:8000/wallet/balance?token={uid}",
        headers={"x-wallet-id": "player"}), timeout=30).read())
    if (w.get("available") or 0) >= 1:
        uids.append(uid)
    if len(uids) == 3:
        break
assert len(uids) == 3, f"player holds {len(uids)} cards, need 3"

salt = "ui-smoke"
commit = hashlib.sha3_256(f"120:{salt}".encode()).hexdigest()
r = post("/wallet/nano-contracts/execute", {
    "nc_id": NC, "method": "create_squad_duel", "address": PL,
    "data": {"args": [0, commit],
             "actions": [{"type": "deposit", "token": u, "amount": 1} for u in uids]}})
print("create_squad_duel:", r.get("hash"), r.get("error", ""))
assert r.get("hash"), r
for _ in range(60):
    n = call1("get_duel_count()")
    if n and call1(f"get_duel_kind({n - 1})") == 1 and call1(f"get_duel({n - 1})").startswith("open"):
        print(f"open squad duel #{n - 1} live; cards {call1(f'get_squad_cards({n - 1}, 0)')}")
        break
    time.sleep(5)
else:
    raise SystemExit("duel never showed open")
