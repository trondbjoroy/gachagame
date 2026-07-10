"""Instantiate EmberfallArena v2.2 + EmberfallCardMarket on testnet-india
from the Hathor-published blueprints, seed the 20 illustrated templates,
keep current prices (pull 5 cents; session fund stays frontend config)."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
ARENA_BP = "0078b201b50e228833ad6e526c6e0d5c89456502623b4f18807b3991ac3ce0bf"
MKT_BP = "007498c9c4c667c973c2800948aabb34b2cd8eed60c1d801bce2bda2e96fd33b"
NODE = "https://node1.testnet.hathor.network/v1a"
PULL_PRICE = 5  # 0.05 HTR, unchanged for now (owner can set_pull_price later)

TEMPLATES = [
    (0, "Moss Snail"), (0, "Pixel Slime"), (0, "Tin Knight"), (0, "Rusty Dagger"),
    (0, "Levy Spearman"), (0, "Bog Witch"), (0, "Plague Rat"), (0, "Gutter Piper"),
    (1, "Storm Falcon"), (1, "Ember Fox"), (1, "Crystal Golem"),
    (1, "Raven Keeper"), (1, "Heartwood Archer"), (1, "Cinder Priestess"),
    (2, "Void Kraken"), (2, "Shadow Dragon"), (2, "Dire Wolf"), (2, "Barrow Wight"),
    (3, "Genesis Phoenix"), (3, "The Winter Sovereign"),
]


def post(path, payload):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": "operator"})
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
        time.sleep(10)
    raise SystemExit("TIMEOUT: " + label)


# --- arena ---
r = post("/wallet/nano-contracts/create", {
    "blueprint_id": ARENA_BP, "address": OP,
    "data": {"args": [OP, PULL_PRICE, 60, 30, 9, 1],
             "actions": [{"type": "deposit", "token": "00", "amount": 3}]}})
ARENA = r.get("hash")
print("arena contract:", r.get("success"), ARENA or r.get("error"), flush=True)
assert ARENA
wait(lambda: get(f"{NODE}/nano_contract/state?id={ARENA}&fields[]=gems_uid").get("success"),
     "arena confirmed")
GEMS = get(f"{NODE}/nano_contract/state?id={ARENA}&fields[]=gems_uid")["fields"]["gems_uid"]["value"]
print("GEMS:", GEMS, flush=True)

for tier, name in TEMPLATES:
    r = post("/wallet/nano-contracts/execute", {
        "nc_id": ARENA, "method": "add_template", "address": OP,
        "data": {"args": [tier, name]}})
    print(f"T{tier} {name}:", r.get("success"), (r.get("error") or "")[:40], flush=True)
    time.sleep(1.5)

# --- market ---
r = post("/wallet/nano-contracts/create", {
    "blueprint_id": MKT_BP, "address": OP, "data": {"args": [OP, ARENA, 200]}})
MKT = r.get("hash")
print("market contract:", r.get("success"), MKT or r.get("error"), flush=True)
assert MKT
wait(lambda: get(f"{NODE}/nano_contract/state?id={MKT}&calls[]=get_listing_count()").get("success"),
     "market confirmed")

# sanity: template counts per tier
qs = "&".join(f"calls[]={urllib.parse.quote(f'get_template_count({t})')}" for t in range(4))
st = get(f"{NODE}/nano_contract/state?id={ARENA}&{qs}")
counts = [st["calls"][f"get_template_count({t})"]["value"] for t in range(4)]
print("template counts by tier:", counts, flush=True)
assert counts == [8, 6, 4, 2], counts

print("LAUNCH_IDS", json.dumps({"arena_bp": ARENA_BP, "arena": ARENA, "gems": GEMS,
                                "mkt_bp": MKT_BP, "mkt": MKT}))
