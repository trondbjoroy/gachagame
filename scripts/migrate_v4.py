"""Migrate v3 player state into the v4 realm (testnet-india).

Per PLAYER (session fragments consolidated through the live name-lineage
chains), adopt_player carries:
  ember  = v3 gems ledger + wallet-held GEMS tokens + unclaimed accruals
           on cards the group has staked (all GEMS-cents == Ember 1:1)
  renown, wins, pulls = summed; deeds = OR of deed_flags (same bit layout)

v3 CARDS cannot enter the card_unit=1 realm (they are 100-unit tokens), so
each stranded card refunds HTR at the fusion-equivalent acquisition cost of
its tier — [1, 2, 5, 9] HTR — paid from the operator treasury to the
group's identity address. Shards and gauntlet progress are not adoptable
(reported as losses; first-clear bounties can be re-earned).

DRY-RUN by default: prints the full plan. --apply executes adopt_player
via the local wallet-headless operator and sends the refunds. The plan is
written to scripts/migration-report.json either way.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node-partners.testnet.hathor.network/v1a"
V3 = "0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587"
V4 = "00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd"
GEMS = "e05b7b0c7651fabf0424f229abede02fc7d63761a3c48ed2034c557678fd1ef3"
APP = "https://app.emberfall.fun"
OPERATOR = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
CARD_REFUND = [100, 200, 500, 900]  # HTR cents by tier, fusion-equivalent
APPLY = "--apply" in sys.argv


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except (urllib.error.HTTPError, urllib.error.URLError, OSError):
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def post(path, payload):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": "operator"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def views(nc, calls):
    out = {}
    for i in range(0, len(calls), 30):
        qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in calls[i:i + 30])
        st = get(f"{NODE}/nano_contract/state?id={nc}&{qs}")
        for k, v in (st.get("calls") or {}).items():
            out[k] = v.get("value")
    return out


def wallet_token(addr, token):
    try:
        d = get(f"{NODE}/thin_wallet/address_balance?address={addr}")
        t = (d.get("tokens_data") or {}).get(token)
        return max(0, (t.get("received", 0) - t.get("spent", 0))) if t else 0
    except Exception:
        return 0


def discover_players():
    addrs, after = set(), None
    for _ in range(400):
        url = f"{NODE}/nano_contract/history?id={V3}&count=50"
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
    return addrs


def main():
    now = int(time.time())
    names = get(f"{APP}/api/names")
    players = discover_players()
    for a in names:
        players.add(a)

    # group session fragments by their name lineage; addresses with no
    # lineage stand alone
    groups = {}   # identity -> set of addrs
    seen = set()
    for a in sorted(players):
        if a in seen:
            continue
        chain = set([a])
        try:
            chain |= set(get(f"{APP}/api/lineage?addr={a}").get("addrs") or [])
        except Exception:
            pass
        # the identity is the CURRENT name holder in the chain, else a itself
        holder = next((x for x in chain if x in names), None)
        identity = holder or a
        groups.setdefault(identity, set()).update(chain)
        seen |= chain

    # v3 state per address
    fields = ["get_gems_balance", "get_renown", "get_wins",
              "get_player_pulls", "get_deed_flags", "get_shards"]
    all_addrs = sorted(set().union(*groups.values()))
    v = views(V3, [f'{f}("{a}")' for a in all_addrs for f in fields])

    # cards: tier + staker/pending owners + wallet holders + unclaimed accrual
    bal = get(f"{NODE}/nano_contract/state?id={V3}&balances[]=__all__").get("balances") or {}
    uids = [u for u in bal if u not in ("00", GEMS)]
    cv = views(V3, [c for u in uids for c in (
        f'get_card_tier("{u}")', f'get_staker("{u}")',
        f'get_pending_owner("{u}")', f'get_pending_gems("{u}", {now})')])

    card_owner = {}
    pending_gems = {}
    for u in uids:
        tier = cv.get(f'get_card_tier("{u}")')
        if tier is None or tier < 0:
            continue
        owner = cv.get(f'get_staker("{u}")') or cv.get(f'get_pending_owner("{u}")')
        if not owner:
            for a in all_addrs:  # wallet-held: 100 units at some address
                if wallet_token(a, u) >= 100:
                    owner = a
                    break
        if owner:
            card_owner[u] = (owner, tier)
            pg = cv.get(f'get_pending_gems("{u}", {now})') or 0
            if pg and cv.get(f'get_staker("{u}")'):
                pending_gems[u] = pg

    plan = []
    for identity, addrs in sorted(groups.items()):
        g = {"identity": identity, "name": names.get(identity),
             "addrs": sorted(addrs), "ember": 0, "renown": 0, "wins": 0,
             "pulls": 0, "deeds": 0, "lost_shards": 0, "cards": [],
             "refund_htr_cents": 0}
        for a in addrs:
            g["ember"] += v.get(f'get_gems_balance("{a}")') or 0
            g["renown"] += v.get(f'get_renown("{a}")') or 0
            g["wins"] += v.get(f'get_wins("{a}")') or 0
            g["pulls"] += v.get(f'get_player_pulls("{a}")') or 0
            g["deeds"] |= v.get(f'get_deed_flags("{a}")') or 0
            g["lost_shards"] += v.get(f'get_shards("{a}")') or 0
            g["ember"] += wallet_token(a, GEMS)
        for u, (owner, tier) in card_owner.items():
            if owner in addrs:
                g["cards"].append({"uid": u, "tier": tier})
                g["refund_htr_cents"] += CARD_REFUND[tier]
                g["ember"] += pending_gems.get(u, 0)
        if identity == OPERATOR:
            g["refund_htr_cents"] = 0  # the house does not refund itself
        if any([g["ember"], g["renown"], g["wins"], g["pulls"], g["deeds"],
                g["cards"]]):
            plan.append(g)

    with open("scripts/migration-report.json", "w") as f:
        json.dump({"taken_at": now, "v3": V3, "v4": V4, "plan": plan}, f, indent=1)

    total_refund = sum(g["refund_htr_cents"] for g in plan)
    print(f"==== MIGRATION PLAN ({'APPLY' if APPLY else 'DRY-RUN'}) ====")
    for g in plan:
        print(f"{g['name'] or g['identity']}: ember={g['ember']}"
              f" renown={g['renown']} wins={g['wins']} pulls={g['pulls']}"
              f" deeds={g['deeds']:#x} cards={len(g['cards'])}"
              f" refund={g['refund_htr_cents']} lost_shards={g['lost_shards']}")
    print(f"total HTR refunds: {total_refund} cents")
    if not APPLY:
        print("dry-run only; re-run with --apply to execute")
        return

    for g in plan:
        r = post("/wallet/nano-contracts/execute", {
            "nc_id": V4, "method": "adopt_player", "address": OPERATOR,
            "data": {"args": [g["identity"], g["ember"], g["renown"],
                              g["deeds"], g["wins"], g["pulls"]]}})
        print(f"adopt {g['name'] or g['identity']}:",
              r.get("hash") or r.get("error"), flush=True)
        time.sleep(3)
        if g["refund_htr_cents"] > 0 and g["identity"] != OPERATOR:
            r = post("/wallet/simple-send-tx", {
                "address": g["identity"], "value": g["refund_htr_cents"]})
            print(f"refund {g['name'] or g['identity']}"
                  f" {g['refund_htr_cents']}c:", r.get("hash") or r.get("error"),
                  flush=True)
            time.sleep(3)
    print("MIGRATION SUBMITTED")


if __name__ == "__main__":
    main()
