"""Launch Emberfall v4: instantiate the arena and the market from published
blueprints, seed all 180 catalog champions, post the ten writs.

Works against any network the local wallet-headless is pointed at — dry-run
it on testnet-playground with the self-published blueprints, then run it for
real on testnet-india once Hathor publishes:

  ARENA_BP=<hash> MARKET_BP=<hash> NODE_URL=<node/v1a> python scripts/launch_v4.py

Defaults are the playground-validated blueprints (dry-run). Ids are written
to scripts/v4_ids.json when everything verifies.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node1.playground.testnet.hathor.network/v1a")
ARENA_BP = os.environ.get("ARENA_BP", "000f4ae9ea365e48bb925f847a12f5c279f29b869c5fe9a676a16e2fcbf9f383")
MARKET_BP = os.environ.get("MARKET_BP", "008eb85b7b08806a12702cff4efe4465e13bb11b13642bc1292a31bcda641d56")
PULL_PRICE = int(os.environ.get("PULL_PRICE", "100"))  # 1 HTR testnet economy
WEIGHTS = (6000, 3000, 900, 100)
DELVE_SECONDS = 28_800    # 8 hours
CARD_UNIT = 1             # v4 mints 1-unit NFTs
FEE_BPS = 500             # 5% market fee, lister-side

# The Gauntlet: ten writs of the Sundering, Grim spreads (Dire x2, Black x4)
WRITS = [
    ("The Oathless Levy", 6, 5, 5),
    ("The Shieldbreaker", 14, 3, 5),
    ("The Bog Warden", 4, 14, 6),
    ("The Gutter King", 5, 6, 15),
    ("The Ashen Knight", 12, 12, 6),
    ("The Hollow Priest", 8, 8, 20),
    ("The Broken Banner", 18, 12, 8),
    ("The Wight of Harrow", 14, 18, 12),
    ("The Pale Duchess", 16, 16, 20),
    ("The Hollow King", 24, 22, 24),
]

TIER_OF = {"Footman": 0, "Knight": 1, "Highlord": 2, "Sovereign": 3}


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
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def wait(fn, label, tries=40, pause=6):
    for _ in range(tries):
        try:
            if fn():
                print("OK:", label, flush=True)
                return
        except Exception:
            pass
        time.sleep(pause)
    raise SystemExit("TIMEOUT: " + label)


def catalog_entries():
    """Parse frontend/public/catalog.js: name -> station."""
    src = open("frontend/public/catalog.js", encoding="utf-8").read()
    out = []
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)':\s*\{\s*station:\s*'(\w+)'", src):
        name = m.group(1).replace("\\'", "'")
        out.append((TIER_OF[m.group(2)], name))
    return out


def execute(nc, method, args):
    body = {"nc_id": nc, "method": method, "address": OP, "data": {"args": args}}
    for attempt in range(3):
        try:
            r = post("/wallet/nano-contracts/execute", body)
        except OSError as e:
            r = {"error": f"transport: {e}"}
        if r.get("success"):
            return r
        print(f"RETRY {method}{args[:1]}: {r.get('error')}", flush=True)
        time.sleep(10)
    return r


def main():
    global OP
    OP = get_local_addr()
    print("operator:", OP, "\nnode:", NODE, flush=True)
    entries = catalog_entries()
    counts = [sum(1 for t, _ in entries if t == i) for i in range(4)]
    print(f"catalog: {len(entries)} champions {counts}", flush=True)
    assert len(entries) == 180, "expected the full catalog"
    assert len(set(n for _, n in entries)) == 180, "catalog contains duplicates"

    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": ARENA_BP, "address": OP,
        "data": {"args": [OP, PULL_PRICE, *WEIGHTS, DELVE_SECONDS, CARD_UNIT],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    nc = r.get("hash")
    print("v4 arena:", nc, r.get("error", ""), flush=True)
    assert nc, r

    def call1(target, c):
        qs = "calls[]=" + urllib.parse.quote(c)
        d = get(f"{NODE}/nano_contract/state?id={target}&{qs}")
        return (d.get("calls") or {}).get(c, {}).get("value")

    wait(lambda: call1(nc, "get_card_unit()") == CARD_UNIT, "arena confirmed")

    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": MARKET_BP, "address": OP,
        "data": {"args": [OP, nc, FEE_BPS, CARD_UNIT]}})
    mkt = r.get("hash")
    print("v4 market:", mkt, r.get("error", ""), flush=True)
    assert mkt, r
    wait(lambda: call1(mkt, "get_listing_count()") == 0, "market confirmed")

    for i, (tier, name) in enumerate(entries):
        execute(nc, "add_template", [tier, name])
        if (i + 1) % 20 == 0:
            print(f"  templates submitted: {i + 1}/180", flush=True)
        time.sleep(1.2)

    for name, v, b, g in WRITS:
        r = execute(nc, "add_writ", [name, v, b, g])
        print("writ:", name, r.get("success"), flush=True)
        time.sleep(1.5)

    wait(lambda: [call1(nc, f"get_template_count({t})") for t in range(4)] == counts,
         f"all templates registered {counts}", tries=60)
    wait(lambda: call1(nc, "get_writ_count()") == len(WRITS), "all writs posted")

    print("\nLAUNCHED")
    print("arena: ", nc)
    print("market:", mkt)
    ids = {"nc": nc, "market": mkt,
           "blueprint": ARENA_BP, "market_blueprint": MARKET_BP,
           "card_unit": CARD_UNIT, "fee_bps": FEE_BPS, "node": NODE}
    with open("scripts/v4_ids.json", "w") as f:
        json.dump(ids, f, indent=1)
    print("ids written to scripts/v4_ids.json — update frontend/public/config.js"
          " (blueprint/nc/market) and server.js NC/MARKET_NC next")


def get_local_addr():
    req = urllib.request.Request("http://localhost:8000/wallet/address?index=0",
        headers={"x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["address"]


if __name__ == "__main__":
    main()
