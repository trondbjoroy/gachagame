"""Migrate the v2.2 realm into the v3 arena: every living card's metadata
(adopt_card) and every player's standings (adopt_player). Cards are tokens
in players' wallets and never move; only the new contract's knowledge of
them is created here. Deed flags are carried without re-paying bounties.

Cards are enumerated from the v2.2 contract history (each pull/fuse tx
creates its card token), then filtered to those still alive (tier >= 0).

Run after scripts/launch_v3.py:  python scripts/migrate_v3.py
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
NODE = "https://node1.testnet.hathor.network/v1a"
OLD = "00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258"
NEW = json.load(open("scripts/v3_ids.json"))["nc"]
OLD_GEMS = "d99c0aae27eae400cd7eac85eed44064dfedafb47800a481ce90c3c01b0dbd15"


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


def calls(nc, cs):
    out = {}
    for i in range(0, len(cs), 25):
        qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in cs[i:i + 25])
        d = get(f"{NODE}/nano_contract/state?id={nc}&{qs}")
        for k, v in (d.get("calls") or {}).items():
            out[k] = v.get("value")
    return out


def history(nc):
    txs = []
    after = None
    for _ in range(400):
        url = f"{NODE}/nano_contract/history?id={nc}&count=50"
        if after:
            url += f"&after={after}"
        h = get(url)
        page = h.get("history") or []
        if not page:
            break
        txs.extend(page)
        after = page[-1].get("hash")
        if len(page) < 50:
            break
    return txs


def execute(method, args):
    return post("/wallet/nano-contracts/execute", {
        "nc_id": NEW, "method": method, "address": OP, "data": {"args": args}})


def main():
    txs = history(OLD)
    players = sorted({t.get("nc_address") for t in txs if t.get("nc_address")})
    uids = sorted({tok for t in txs for tok in (t.get("tokens") or [])
                   if isinstance(tok, str) and len(tok) == 64 and tok != OLD_GEMS})
    print(f"v2.2 history: {len(txs)} txs, {len(players)} players, "
          f"{len(uids)} card tokens seen", flush=True)

    # ---- cards ----
    card_calls = []
    for u in uids:
        card_calls += [f'get_card_tier("{u}")', f'get_card_name("{u}")',
                       f'get_card_power("{u}")', f'get_card_aspects("{u}")',
                       f'get_card_wins("{u}")']
    cv = calls(OLD, card_calls)
    adopted = 0
    for u in uids:
        tier = cv.get(f'get_card_tier("{u}")')
        if tier is None or tier < 0:
            continue  # fused away or unknown
        name = cv.get(f'get_card_name("{u}")') or "Unknown"
        power = cv.get(f'get_card_power("{u}")') or 1
        wins = cv.get(f'get_card_wins("{u}")') or 0
        parts = (cv.get(f'get_card_aspects("{u}")') or "").split("|")
        if len(parts) >= 5:
            v, b, g, t, h = (int(x) for x in parts[:5])
        else:
            v, b, g, t, h = power - 2, 1, 1, 0, 0
        attrs = v | (b << 12) | (g << 24) | (t << 36) | (h << 44)
        r = execute("adopt_card", [u, name, tier, power, attrs, wins])
        print(f"adopt_card {name} (t{tier} p{power} w{wins}):",
              r.get("success"), r.get("error", ""), flush=True)
        adopted += 1
        time.sleep(1.5)

    # ---- players ----
    p_calls = []
    for a in players:
        p_calls += [f'get_gems_balance("{a}")', f'get_renown("{a}")',
                    f'get_deed_flags("{a}")', f'get_wins("{a}")',
                    f'get_player_pulls("{a}")', f'get_favor_owed("{a}")']
    pv = calls(OLD, p_calls)
    for a in players:
        gems = pv.get(f'get_gems_balance("{a}")') or 0
        renown = pv.get(f'get_renown("{a}")') or 0
        deeds = pv.get(f'get_deed_flags("{a}")') or 0
        wins = pv.get(f'get_wins("{a}")') or 0
        pulls = pv.get(f'get_player_pulls("{a}")') or 0
        owed = pv.get(f'get_favor_owed("{a}")') or 0
        if owed:
            print(f"NOTE: {a} has favor_owed={owed} on the old contract "
                  f"(claimable there, or refund manually)", flush=True)
        if not any([gems, renown, deeds, wins, pulls]):
            continue
        r = execute("adopt_player", [a, gems, renown, deeds, wins, pulls])
        print(f"adopt_player {a[:10]}… g{gems} r{renown} d{deeds:x} w{wins} p{pulls}:",
              r.get("success"), r.get("error", ""), flush=True)
        time.sleep(1.5)

    # ---- old wallet-held GEMS accounting ----
    tok = get(f"{NODE}/thin_wallet/token?id={OLD_GEMS}")
    total = tok.get("total") or 0
    held = get(f"{NODE}/nano_contract/state?id={OLD}&balances[]={OLD_GEMS}")
    contract_held = int(((held.get("balances") or {}).get(OLD_GEMS) or {}).get("value") or 0)
    print(f"\nold GEMS: total supply {total}, contract holds {contract_held}, "
          f"in wallets {total - contract_held} (credit manually via adopt_player "
          f"if anyone deposits proof)", flush=True)

    print(f"\nMIGRATED: {adopted} cards, {len(players)} players examined")


if __name__ == "__main__":
    main()
