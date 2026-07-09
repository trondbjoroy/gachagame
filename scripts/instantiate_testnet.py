"""Instantiate GachaArena + CardMarket on testnet-india from the published
blueprints, seed the full template catalog, and print the new IDs."""
import json
import time
import urllib.error
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
PL = "WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE"
GAME_BP = "00fd125434accb0f6eeb50936ea0a60b4f8f930e401d3095cb9fa77c2b88d7b5"
MKT_BP = "00ddf5d21557d3d6dd9d34e88c43abc1a399faeb1bd5088dc5af617ed5be8938"
NODE = "https://node1.testnet.hathor.network/v1a"

TEMPLATES = [
    (0, "Moss Snail"), (0, "Pixel Slime"), (0, "Tin Knight"), (0, "Rusty Dagger"),
    (0, "Levy Spearman"), (0, "Bog Witch"), (0, "Plague Rat"),
    (1, "Storm Falcon"), (1, "Ember Fox"), (1, "Crystal Golem"),
    (1, "Raven Keeper"), (1, "Heartwood Archer"),
    (2, "Void Kraken"), (2, "Shadow Dragon"), (2, "Dire Wolf"), (2, "Barrow Wight"),
    (3, "Genesis Phoenix"), (3, "The Winter Sovereign"),
]


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


def wait(fn, label, tries=40):
    for _ in range(tries):
        try:
            if fn():
                print("OK:", label, flush=True)
                return
        except Exception:
            pass
        time.sleep(12)
    raise SystemExit("TIMEOUT: " + label)


r = post("/wallet/nano-contracts/create", "operator", {
    "blueprint_id": GAME_BP, "address": OP,
    "data": {"args": [OP, 5, 6000, 3000, 900, 100],
             "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
GAME = r.get("hash")
print("game contract:", r.get("success"), GAME or r.get("error"), flush=True)
assert GAME
wait(lambda: get(f"{NODE}/nano_contract/state?id={GAME}&fields[]=gems_uid").get("success"),
     "game confirmed")
GEMS = get(f"{NODE}/nano_contract/state?id={GAME}&fields[]=gems_uid")["fields"]["gems_uid"]["value"]
print("GEMS:", GEMS, flush=True)

for tier, name in TEMPLATES:
    r = post("/wallet/nano-contracts/execute", "operator", {
        "nc_id": GAME, "method": "add_template", "address": OP,
        "data": {"args": [tier, name]}})
    print(f"T{tier} {name}:", r.get("success"), (r.get("error") or "")[:50], flush=True)
    time.sleep(1.5)

r = post("/wallet/nano-contracts/create", "operator", {
    "blueprint_id": MKT_BP, "address": OP, "data": {"args": [OP, GAME, 200]}})
MKT = r.get("hash")
print("market contract:", r.get("success"), MKT or r.get("error"), flush=True)
assert MKT
wait(lambda: get(f"{NODE}/nano_contract/state?id={MKT}&calls[]=get_listing_count()").get("success"),
     "market confirmed")

r = post("/wallet/simple-send-tx", "operator", {"address": PL, "value": 1000})
print("player funded with 10 HTR:", r.get("success"), flush=True)

print("TESTNET_IDS", json.dumps({"game_bp": GAME_BP, "game": GAME, "gems": GEMS,
                                 "mkt_bp": MKT_BP, "mkt": MKT}))
