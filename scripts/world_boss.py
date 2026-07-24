"""Weekly world-boss poster (VPS cron, runs shortly after the unix-week
turns on Thursday 00:00 UTC).

HP scales with the realm: hp = 5000 + 500 * active identities last week
(distinct callers in the arena's history). Aspects scale gently with
activity so a mid host still lands rounds. Boss names rotate by week.

Dry-run by default: set WB_APPLY=1 to actually post. Requires ARENA_NC
(no default: posting to the wrong realm must be impossible by omission).

Env: ARENA_NC (required), NODE_URL, WALLET_URL, WALLET_ID, WB_APPLY.
Cron: 20 0 * * 4  cd /opt/gacha && python3 scripts/world_boss.py >> /var/log/world_boss.log 2>&1
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
APPLY = os.environ.get("WB_APPLY") == "1"

BOSS_NAMES = [
    "Hollow Colossus", "The Unmourned King", "Cinder Leviathan",
    "Warden of the Sundering", "The Pale Devourer", "Ashen Tyrant",
    "The Last Oathbreaker", "Gravemaw", "The Silent Sovereign",
    "Embercrowned Wraith",
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


def active_last_week():
    """Distinct identities that touched the arena in the last 7 days."""
    cutoff = time.time() - 7 * 86400
    seen = set()
    after = ""
    for _ in range(40):  # 40 pages x 50 txs bounds the walk
        url = f"{NODE}/nano_contract/history?id={NC}&count=50" + (f"&after={after}" if after else "")
        d = get(url)
        hist = d.get("history") or []
        if not hist:
            break
        for tx in hist:
            if tx.get("timestamp", 0) < cutoff:
                return len(seen)
            addr = tx.get("nc_address")
            if addr:
                seen.add(addr)
        after = hist[-1].get("hash", "")
        if not d.get("has_more"):
            break
    return len(seen)


def main():
    if not NC:
        sys.exit("ARENA_NC not set; refusing to guess a realm")
    week = int(time.time()) // 604_800
    existing = call1(f"get_world_boss({week})")
    if existing:
        print(f"week {week}: boss already stands ({existing.split('|')[0]}); nothing to do")
        return
    active = active_last_week()
    hp = 5000 + 500 * active
    aspect = max(25, min(120, 25 + active * 5))
    name = BOSS_NAMES[week % len(BOSS_NAMES)]
    print(f"week {week}: {name}, hp {hp} ({active} active), aspects {aspect}/{aspect}/{aspect}")
    if not APPLY:
        print("dry-run (set WB_APPLY=1 to post)")
        return
    req = urllib.request.Request(WALLET + "/wallet/address?index=0",
        headers={"x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=30) as r:
        addr = json.loads(r.read())["address"]
    body = {"nc_id": NC, "method": "post_world_boss", "address": addr,
            "data": {"args": [name, hp, aspect, aspect, aspect]}}
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
