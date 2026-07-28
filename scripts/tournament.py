"""Weekly tournament scheduler (VPS cron, e.g. Saturday morning: the
bracket opens for registration and starts Sunday 18:00 UTC, one round a
day after that).

The Crown seeds the pool from its own Ember ledger: a tenth of what the
tithe has gathered, floored at 100 and capped at 1000. Skips the week if
an open or running bracket already exists.

Dry-run by default: set TOUR_APPLY=1 to actually post. Requires ARENA_NC.

Env: ARENA_NC (required), NODE_URL, WALLET_URL, WALLET_ID,
     TOUR_FEE (default 25), TOUR_SIZE (default 16), TOUR_APPLY.
Cron: 10 9 * * 6  cd /opt/gacha && python3 scripts/tournament.py >> /var/log/tournament.log 2>&1
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node-partners.testnet.hathor.network/v1a")
WALLET = os.environ.get("WALLET_URL", "http://localhost:8000")
WALLET_ID = os.environ.get("WALLET_ID", "operator")
NC = os.environ.get("ARENA_NC")
FEE = int(os.environ.get("TOUR_FEE", "25"))
SIZE = int(os.environ.get("TOUR_SIZE", "16"))
APPLY = os.environ.get("TOUR_APPLY") == "1"
ROUND_SECS = 86_400

TOUR_NAMES = [
    "The Sundering Cup", "Trial of the Empty Throne", "The Weaver's Gauntlet",
    "Ledgerkeepers' Melee", "The Ember Crown", "Grand Melee of the Realm",
    "The Soulstone Open", "Banner and Blade",
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


def main():
    if not NC:
        sys.exit("ARENA_NC not set; refusing to guess a realm")
    count = call1("get_tournament_count()") or 0
    for t in range(max(0, count - 4), count):
        parts = (call1(f"get_tournament({t})") or "").split("|")
        if len(parts) > 1 and parts[1] in ("0", "1"):
            print(f"tournament #{t} ({parts[0]}) is still {['open', 'running'][int(parts[1])]}; skipping")
            return

    req = urllib.request.Request(WALLET + "/wallet/address?index=0",
        headers={"x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=30) as r:
        addr = json.loads(r.read())["address"]
    crown = call1(f'get_ember_balance("{addr}")') or 0
    seed = max(100, min(1000, crown // 10))
    if seed > crown:
        print(f"the Crown holds only {crown} Ember; posting without a seed")
        seed = 0

    now = int(time.time())
    # next Sunday 18:00 UTC (day 6 of the unix week epoch, Thu-based: Sun = 3)
    day = 86_400
    start = (now // day) * day + 18 * 3600
    while start <= now + 12 * 3600 or (start // day) % 7 != 3:
        start += day
    name = TOUR_NAMES[(now // 604_800) % len(TOUR_NAMES)]
    print(f"{name}: fee {FEE}, size {SIZE}, seed {seed}, "
          f"starts {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(start))}, daily rounds")
    if not APPLY:
        print("dry-run (set TOUR_APPLY=1 to post)")
        return
    body = {"nc_id": NC, "method": "create_tournament", "address": addr,
            "data": {"args": [name, FEE, SIZE, start, ROUND_SECS, seed]}}
    req = urllib.request.Request(WALLET + "/wallet/nano-contracts/execute",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read())
    print("posted:", d.get("hash"), d.get("error", ""))
    if not d.get("hash"):
        sys.exit(1)


if __name__ == "__main__":
    main()
