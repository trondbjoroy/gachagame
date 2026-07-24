"""Snapshot the live v3 realm for the v4 migration decision.

Read-only: discovers every player from public contract history and dumps
per-player state (Ember/gems ledger, renown, wins, streak, shards, gauntlet,
pulls) plus every card (name, tier, power, holder disposition) to
scripts/v3-snapshot.json, with a human summary on stdout.

The output is exactly what adopt_player/adopt_card would need if we migrate,
and exactly what would be lost if we launch v4 fresh.

Run: python scripts/v3_snapshot.py
"""
import json
import time
import urllib.parse
import urllib.request

NODE = "https://node-partners.testnet.hathor.network/v1a"
ARENA = "0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587"
GEMS = "e05b7b0c7651fabf0424f229abede02fc7d63761a3c48ed2034c557678fd1ef3"


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
    after = None
    for _ in range(400):
        url = f"{NODE}/nano_contract/history?id={ARENA}&count=50"
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
    players = discover_players()
    print(f"{len(players)} addresses ever called the v3 arena", flush=True)

    # v3 views keep the old gems naming
    fields = ["get_gems_balance", "get_renown", "get_wins",
              "get_vigil_streak", "get_shards", "get_gauntlet_cleared",
              "get_player_pulls", "get_favor_owed"]
    calls = [f'{f}("{a}")' for a in players for f in fields]
    v = views(calls)
    pdata = {}
    for a in players:
        row = {f.replace("get_", ""): v.get(f'{f}("{a}")') or 0 for f in fields}
        if any(row.values()):
            pdata[a] = row

    bal = get(f"{NODE}/nano_contract/state?id={ARENA}&balances[]=__all__")
    uids = [u for u in (bal.get("balances") or {}) if u not in ("00", GEMS)]
    print(f"{len(uids)} card tokens known to the contract", flush=True)
    card_calls = []
    for u in uids:
        card_calls += [f'get_card_name("{u}")', f'get_card_tier("{u}")',
                       f'get_card_power("{u}")', f'get_card_aspects("{u}")',
                       f'get_staker("{u}")', f'get_pending_owner("{u}")']
    cv = views(card_calls)
    cards = {}
    for u in uids:
        tier = cv.get(f'get_card_tier("{u}")')
        if tier is None or tier < 0:
            continue
        cards[u] = {
            "name": cv.get(f'get_card_name("{u}")'),
            "tier": tier,
            "power": cv.get(f'get_card_power("{u}")'),
            "aspects": cv.get(f'get_card_aspects("{u}")'),
            "staker": cv.get(f'get_staker("{u}")'),
            "pending": cv.get(f'get_pending_owner("{u}")'),
        }

    base = views(["get_total_pulls()", "get_pull_price()", "get_favor_pool()",
                  "get_proceeds()"])
    snap = {
        "taken_at": int(time.time()),
        "arena": ARENA,
        "totals": base,
        "players": pdata,
        "cards": cards,
    }
    with open("scripts/v3-snapshot.json", "w") as f:
        json.dump(snap, f, indent=1)

    staked = sum(1 for c in cards.values() if c["staker"])
    pend = sum(1 for c in cards.values() if c["pending"])
    tiers = [sum(1 for c in cards.values() if c["tier"] == t) for t in range(4)]
    print("\n==== v3 SNAPSHOT ====")
    print(f"players with state: {len(pdata)}")
    for a, row in sorted(pdata.items(), key=lambda kv: -kv[1]["renown"]):
        print(f"  {a}  gems={row['gems_balance']} renown={row['renown']}"
              f" wins={row['wins']} shards={row['shards']}"
              f" gauntlet={row['gauntlet_cleared']:#x} pulls={row['player_pulls']}")
    print(f"cards: {len(cards)} (by tier {tiers}); {staked} staked, {pend} pending claim,"
          f" rest in player wallets")
    print(f"totals: {base}")
    print("written to scripts/v3-snapshot.json")


if __name__ == "__main__":
    main()
