"""Launch Emberfall v5: instantiate the arena and the market from published
blueprints, seed all 180 catalog champions WITH their keyword abilities
(per type; docs/v5-design.md), post the ten writs.

Dry-run on testnet-playground with a self-published blueprint, then run for
real once Hathor publishes v5:

  ARENA_BP=<hash> MARKET_BP=<hash> NODE_URL=<node/v1a> python scripts/launch_v5.py

Ids are written to scripts/v5_ids.json when everything verifies.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node1.playground.testnet.hathor.network/v1a")
ARENA_BP = os.environ.get("ARENA_BP")  # no default until v5 is published
MARKET_BP = os.environ.get("MARKET_BP", "00356e32686ea741b1a9d027bdf00e3c1e3563553f0d7ae1c2921c91af816d81")
PULL_PRICE = int(os.environ.get("PULL_PRICE", "100"))  # 1 HTR testnet economy
WEIGHTS = (6000, 3000, 900, 100)
DELVE_SECONDS = 28_800    # 8 hours
CARD_UNIT = 1
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

# keyword ability per champion TYPE (docs/v5-design.md)
TYPE_ABILITY = {
    "Levy": 1,        # Vanguard: +20% Attack round
    "Construct": 2,   # Warden: +20% Defense round
    "Mystic": 3,      # Trickster: +20% Cunning round
    "Beast": 4,       # Momentum: +10% after winning R1
    "Undead": 5,      # Closer: +25% in a 1-1 decider
    "Vermin": 6,      # Underdog: +15% all rounds when weaker
    "Relic": 7,       # Stancebreaker: foe's stance edge void
    "Drake": 8,       # Plunderer: winner takes the rake
    "Firstborn": 9,   # Scholar: double veterancy XP
    "Leviathan": 2,   # Warden (shared): immovable deeps
}


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
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == 4:
                raise
            time.sleep(4)


def wait(fn, label, tries=90, pause=5):
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
    """Parse frontend/public/catalog.js: (tier, name, ability from type)."""
    src = open("frontend/public/catalog.js", encoding="utf-8").read()
    pat = r"'((?:[^'\\]|\\.)*)':\s*\{\s*station:\s*'(\w+)',\s*type:\s*'([\w ]+)'"
    out = []
    for m in re.finditer(pat, src):
        name = m.group(1).replace("\\'", "'")
        out.append((TIER_OF[m.group(2)], name, TYPE_ABILITY[m.group(3)]))
    return out


def execute(nc, method, args):
    body = {"nc_id": nc, "method": method, "address": OP, "data": {"args": args}}
    for i in range(3):
        try:
            r = post("/wallet/nano-contracts/execute", body)
        except OSError as e:
            r = {"error": str(e)}
        if r.get("success"):
            return r
        print(f"RETRY {method}{args[:1]}: {r.get('error')}", flush=True)
        time.sleep(10)
    return r


def get_local_addr():
    req = urllib.request.Request("http://localhost:8000/wallet/address?index=0",
        headers={"x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["address"]


def main():
    global OP
    assert ARENA_BP, "set ARENA_BP (the v5 blueprint hash)"
    OP = get_local_addr()
    print("operator:", OP, "\nnode:", NODE, flush=True)
    entries = catalog_entries()
    counts = [sum(1 for t, _, _ in entries if t == i) for i in range(4)]
    print(f"catalog: {len(entries)} champions {counts}", flush=True)
    assert len(entries) == 180, "expected the full catalog"
    assert len(set(n for _, n, _ in entries)) == 180, "catalog contains duplicates"

    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": ARENA_BP, "address": OP,
        "data": {"args": [OP, PULL_PRICE, *WEIGHTS, DELVE_SECONDS, CARD_UNIT],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    nc = r.get("hash")
    print("v5 arena:", nc, r.get("error", ""), flush=True)
    assert nc, r

    def call1(target, c):
        import urllib.parse
        qs = "calls[]=" + urllib.parse.quote(c)
        d = get(f"{NODE}/nano_contract/state?id={target}&{qs}")
        return (d.get("calls") or {}).get(c, {}).get("value")

    wait(lambda: call1(nc, "get_card_unit()") == CARD_UNIT, "arena confirmed")

    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": MARKET_BP, "address": OP,
        "data": {"args": [OP, nc, FEE_BPS, CARD_UNIT]}})
    mkt = r.get("hash")
    print("v5 market:", mkt, r.get("error", ""), flush=True)
    assert mkt, r
    wait(lambda: call1(mkt, "get_listing_count()") == 0, "market confirmed")

    for i, (tier, name, ability) in enumerate(entries):
        execute(nc, "add_template", [tier, name, ability])
        if (i + 1) % 20 == 0:
            print(f"  templates submitted: {i + 1}/180", flush=True)
        time.sleep(1.2)

    for name, v, b, g in WRITS:
        r = execute(nc, "add_writ", [name, v, b, g])
        print("writ:", name, r.get("success"), flush=True)
        time.sleep(1.5)

    wait(lambda: [call1(nc, f"get_template_count({t})") for t in range(4)] == counts,
         f"all templates registered {counts}", tries=90)
    wait(lambda: call1(nc, "get_writ_count()") == len(WRITS), "all writs posted")

    print("\nLAUNCHED")
    print("arena: ", nc)
    print("market:", mkt)
    ids = {"nc": nc, "market": mkt,
           "blueprint": ARENA_BP, "market_blueprint": MARKET_BP,
           "card_unit": CARD_UNIT, "fee_bps": FEE_BPS, "node": NODE}
    with open("scripts/v5_ids.json", "w") as f:
        json.dump(ids, f, indent=1)
    print("ids written to scripts/v5_ids.json")


if __name__ == "__main__":
    main()
