"""Emberfall seasons: seasonal renown standings from public on-chain data.

Seasonal renown is the renown a player earned on the Ledger inside the
season window: current renown minus their baseline. Baselines are the
renown each player held when first seen by this script; the very first
run grandfathers all pre-season renown out of the standings, and players
who appear later start from zero (all their renown is in-season).

Runs from cron (daily):  python3 scripts/season.py
State:  /opt/gacha/season-state.json   (baselines per player)
Output: frontend/public/season.json    (served to players)

Like the weekly favor, this is a transparent interim implementation:
anyone can recompute the standings from public node data.
"""
import json
import os
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node-partners.testnet.hathor.network/v1a")
# v3 arena; renown was migrated 1:1 via adopt_player, so existing baselines
# stay valid. Player discovery still scans the retired v2.2 realm's history
# because migration transactions carry only the operator's address.
ARENA = os.environ.get("ARENA_NC", "0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587")
STATE = os.environ.get("SEASON_STATE", "/opt/gacha/season-state.json")
OUT = os.environ.get("SEASON_OUT", "/opt/gacha/frontend/public/season.json")

SEASON = 1
NAME = "The First Muster"
STARTS = 1783900800          # 2026-07-13T00:00:00Z
ENDS = 1788739200            # 2026-09-07T00:00:00Z (8 weeks)
TOP = 50


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def views(calls):
    out = {}
    for i in range(0, len(calls), 30):
        qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in calls[i:i + 30])
        st = get(f"{NODE}/nano_contract/state?id={ARENA}&{qs}")
        for k, v in (st.get("calls") or {}).items():
            out[k] = v.get("value")
    return out


def discover_players():
    addrs = set()
    for nc in (ARENA,):
        after = None
        for _ in range(200):
            url = f"{NODE}/nano_contract/history?id={nc}&count=50"
            if after:
                url += f"&after={after}"
            h = get(url)
            hist = h.get("history") or []
            if not hist:
                break
            for tx in hist:
                a = tx.get("nc_address")
                if a:
                    addrs.add(a)
            after = hist[-1].get("hash")
            if len(hist) < 50:
                break
    return sorted(addrs)


def main():
    import time
    state = {}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state = json.load(f)
    first_run = "baseline" not in state
    baseline = state.get("baseline", {})

    players = discover_players()
    v = views([f'get_renown("{a}")' for a in players])
    current = {a: int(v.get(f'get_renown("{a}")') or 0) for a in players}

    for a, r in current.items():
        if a not in baseline:
            # first run grandfathers pre-season renown; later arrivals
            # earned everything in-season
            baseline[a] = r if first_run else 0

    standings = sorted(
        ({"addr": a, "seasonal": current[a] - baseline.get(a, 0), "lifetime": current[a]}
         for a in players if current[a] - baseline.get(a, 0) > 0),
        key=lambda s: -s["seasonal"])[:TOP]

    state["baseline"] = baseline
    state["season"] = SEASON
    with open(STATE, "w") as f:
        json.dump(state, f)
    with open(OUT, "w") as f:
        json.dump({"season": SEASON, "name": NAME, "starts": STARTS, "ends": ENDS,
                   "updated": int(time.time()), "standings": standings}, f)
    print(f"season {SEASON}: {len(players)} players, {len(standings)} ranked")


if __name__ == "__main__":
    main()
