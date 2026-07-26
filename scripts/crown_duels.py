"""Keep a few open duels standing in the Arena (the Crown as counterparty).

A new player opening the Arena currently sees only settled fights, so the
tab reads as a realm nobody plays. This posts open challenges from the
Crown's own champions at small wagers and tops them up as players take
them, so there is always something to fight.

The Crown is a real counterparty: it stakes Ember and can lose. Wagers are
deliberately small and the number of standing duels is capped, so the
exposure is bounded and visible (WAGERS x KEEP is the most it can lose per
cycle).

Dry-run by default: set CROWN_APPLY=1 to actually post. Requires ARENA_NC.

Env: ARENA_NC (required), NODE_URL, WALLET_URL, WALLET_ID, CROWN_ADDR (dry runs),
     CROWN_KEEP (default 3), CROWN_WAGERS (default "5,15,40"), CROWN_APPLY.
Cron (every 20 min): */20 * * * * cd /opt/gacha &&
     ARENA_NC=<nc> CROWN_APPLY=1 python3 scripts/crown_duels.py >> /var/log/crown_duels.log 2>&1
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
KEEP = int(os.environ.get("CROWN_KEEP", "3"))
WAGERS = [int(w) for w in os.environ.get("CROWN_WAGERS", "5,15,40").split(",")]
APPLY = os.environ.get("CROWN_APPLY") == "1"


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def calls(cs):
    qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in cs)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return {k: v.get("value") for k, v in (d.get("calls") or {}).items()}


def wallet_get(path):
    req = urllib.request.Request(WALLET + path, headers={"x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def execute(addr, method, args, actions):
    body = {"nc_id": NC, "method": method, "address": addr,
            "data": {"args": args, "actions": actions}}
    req = urllib.request.Request(WALLET + "/wallet/nano-contracts/execute",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": WALLET_ID})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def main():
    if not NC:
        sys.exit("ARENA_NC not set; refusing to guess a realm")
    # CROWN_ADDR lets a dry run inspect a realm without a wallet attached
    addr = os.environ.get("CROWN_ADDR")
    if not addr:
        addr = wallet_get("/wallet/address?index=0")["address"]

    # how many of the Crown's own challenges are still waiting for a taker
    n = calls(["get_duel_count()"]).get("get_duel_count()") or 0
    window = list(range(max(0, n - 40), n))
    if window:
        got = calls([f"get_duel({i})" for i in window]
                    + [f"get_duel_challenger({i})" for i in window])
    else:
        got = {}
    open_mine = 0
    for i in window:
        status = (got.get(f"get_duel({i})") or "").split("|")[0]
        if status == "open" and got.get(f"get_duel_challenger({i})") == addr:
            open_mine += 1
    print(f"{open_mine} of {KEEP} Crown duels standing")
    if open_mine >= KEEP:
        return

    # champions the Crown holds free (not staked, not mid-duel, not parked)
    try:
        bal = wallet_get("/wallet/balance")
    except Exception:
        bal = {}
    held = []
    state = get(f"{NODE}/nano_contract/state?id={NC}&balances[]=__all__")
    for uid in (state.get("balances") or {}):
        if uid == "00":
            continue
        try:
            b = wallet_get(f"/wallet/balance?token={uid}")
        except Exception:
            break          # no wallet attached: a dry run stops at the read
        if (b.get("available") or 0) >= 1:
            held.append(uid)
    ember = calls([f'get_ember_balance("{addr}")']).get(f'get_ember_balance("{addr}")') or 0
    print(f"the Crown holds {len(held)} free champions and {ember} Ember "
          f"({bal.get('available', 0)} HTR cents)")

    need = KEEP - open_mine
    if not held:
        print("no free champions to post: skipping (claim or summon some first)")
        return

    for k in range(min(need, len(held))):
        wager = WAGERS[k % len(WAGERS)]
        if wager > ember:
            print(f"not enough Ember for a {wager} wager; stopping")
            break
        card = held[k]
        print(f"post: {wager} Ember on {card[:10]}…")
        if not APPLY:
            continue
        r = execute(addr, "create_duel", [wager, ""],
                    [{"type": "deposit", "token": card, "amount": 1}])
        print("  ", r.get("hash") or r.get("error"))
        if r.get("hash"):
            ember -= wager
            time.sleep(4)
    if not APPLY:
        print("dry-run (set CROWN_APPLY=1 to post)")


if __name__ == "__main__":
    main()
