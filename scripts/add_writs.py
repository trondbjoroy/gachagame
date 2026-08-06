"""Post additional writ bosses to the arena (owner op, one-shot).

2026-07-31: the boss grid renders three columns and ten writs left an
orphan row; two more make twelve, four clean rows. The pair continues
the ladder past The Hollow King (24/22/24).

Dry-run by default: set WRIT_APPLY=1 to post. Requires ARENA_NC.
Env: ARENA_NC (required), NODE_URL, WALLET_URL, WALLET_ID, WRIT_APPLY.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node1.testnet.hathor.network/v1a")
WALLET = os.environ.get("WALLET_URL", "http://localhost:8000")
WALLET_ID = os.environ.get("WALLET_ID", "operator")
NC = os.environ.get("ARENA_NC")
APPLY = os.environ.get("WRIT_APPLY") == "1"

NEW_WRITS = [
    ("The Ashen Regent", 28, 24, 26),
    ("The Midnight Court", 30, 30, 30),
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


def ensure_wallet():
    try:
        req = urllib.request.Request(WALLET + "/start",
            data=json.dumps({"wallet-id": WALLET_ID, "seedKey": WALLET_ID}).encode(),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=60).read()
    except Exception:
        pass  # already running
    for _ in range(40):
        try:
            req = urllib.request.Request(WALLET + "/wallet/status",
                headers={"x-wallet-id": WALLET_ID})
            with urllib.request.urlopen(req, timeout=15) as r:
                if json.loads(r.read()).get("statusMessage") == "Ready":
                    return
        except Exception:
            pass
        time.sleep(5)


def main():
    if not NC:
        sys.exit("ARENA_NC not set; refusing to guess a realm")
    count = call1("get_writ_count()")
    print(f"writs on chain: {count}")
    have = {call1(f"get_writ({i})").split("|")[0] for i in range(count or 0)}
    todo = [w for w in NEW_WRITS if w[0] not in have]
    if not todo:
        print("all new writs already posted; nothing to do")
        return
    for name, v, b, g in todo:
        print(f"to post: {name} {v}/{b}/{g}")
    if not APPLY:
        print("dry-run (set WRIT_APPLY=1 to post)")
        return
    ensure_wallet()
    req = urllib.request.Request(WALLET + "/wallet/address?index=0",
        headers={"x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=30) as r:
        addr = json.loads(r.read())["address"]
    for name, v, b, g in todo:
        body = {"nc_id": NC, "method": "add_writ", "address": addr,
                "data": {"args": [name, v, b, g]}}
        req = urllib.request.Request(WALLET + "/wallet/nano-contracts/execute",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-wallet-id": WALLET_ID})
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read())
        print("posted:", name, d.get("hash"), d.get("error", ""))
        if not d.get("hash"):
            sys.exit(1)
        time.sleep(2)
    for _ in range(30):
        if call1("get_writ_count()") == (count or 0) + len(todo):
            print("verified on chain:", call1("get_writ_count()"), "writs")
            return
        time.sleep(4)
    sys.exit("writ count never reflected the posts; check manually")


if __name__ == "__main__":
    main()
