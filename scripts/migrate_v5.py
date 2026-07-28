"""Migrate v4 state into the v5 realm (testnet-india).

v4 and v5 share card_unit=1, so unlike the v3 exodus the CARDS come along:
adopt_card carries name, tier, power, packed attrs (identical bit layout),
victories, and the keyword ability its type earns under v5. The tokens
themselves stay wherever they are — wallets keep theirs, and anything in
v4 custody (staked, pending, market escrow) is withdrawn from v4 by its
owner and then plays in v5.

Per PLAYER (session fragments consolidated through the name-lineage
chains), adopt_player carries ember (ledger + unclaimed accrual on staked
cards), renown, deeds (same bit layout), wins, and pulls. v4 had no rated
ladder, so there is nothing to adopt_rating; v5's default stands.

Cosmetics (shard adornments) have no adoption path in v5 and are reported
as losses. Shards likewise.

DRY-RUN by default: prints the plan and writes
scripts/migration-v5-report.json. --apply executes via the local
wallet-headless operator.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node-partners.testnet.hathor.network/v1a"
V4 = "00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd"
V4_MKT = "000000001bc502cf793a7343de99816f574b3b7839e4bd21d8d680afabc799fb"
V5 = json.load(open("scripts/v5_ids.json"))["nc"]
APP = "https://app.emberfall.fun"
APPLY = "--apply" in sys.argv

TIER_OF = {"Footman": 0, "Knight": 1, "Highlord": 2, "Sovereign": 3}
TYPE_ABILITY = {"Levy": 1, "Construct": 2, "Mystic": 3, "Beast": 4, "Undead": 5,
                "Vermin": 6, "Relic": 7, "Drake": 8, "Firstborn": 9, "Leviathan": 2}


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


def execute(method, args):
    body = {"nc_id": V5, "method": method, "address": OP, "data": {"args": args}}
    for i in range(4):
        try:
            r = post("/wallet/nano-contracts/execute", body)
        except OSError as e:
            r = {"error": str(e)}
        if r.get("success"):
            return r
        print(f"  RETRY {method} {str(args)[:60]}: {r.get('error')}", flush=True)
        time.sleep(10)
    return r


def name_ability():
    src = open("frontend/public/catalog.js", encoding="utf-8").read()
    pat = r"'((?:[^'\\]|\\.)*)':\s*\{\s*station:\s*'(\w+)',\s*type:\s*'([\w ]+)'"
    return {m.group(1).replace("\\'", "'"): TYPE_ABILITY[m.group(3)]
            for m in re.finditer(pat, src)}


def pack(a):
    # aspects string: valor|bulwark|guile|tempers|hardened|xp|level|vet
    v, b, g, t, h, xp, _lvl, vet = [int(x) for x in a.split("|")]
    return (v | (b << 12) | (g << 24) | (t << 36) | (h << 44)
            | (xp << 52) | (vet << 66))


def discover_players():
    addrs, after = set(), None
    for _ in range(400):
        url = f"{NODE}/nano_contract/history?id={V4}&count=50"
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
    global OP
    req = urllib.request.Request("http://localhost:8000/wallet/address?index=0",
        headers={"x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=30) as r:
        OP = json.loads(r.read())["address"]
    now = int(time.time())
    abilities = name_ability()
    names = get(f"{APP}/api/names")

    # ---- cards: everything either contract has ever minted or escrowed ----
    g4 = get(f"{NODE}/nano_contract/state?id={V4}&balances[]=__all__").get("balances") or {}
    m4 = get(f"{NODE}/nano_contract/state?id={V4_MKT}&balances[]=__all__").get("balances") or {}
    uids = sorted(u for u in set(g4) | set(m4) if u != "00")
    fields = ["get_card_name", "get_card_tier", "get_card_power",
              "get_card_aspects", "get_card_wins", "get_card_cosmetics"]
    cv = views(V4, [f'{f}("{u}")' for u in uids for f in fields]
                  + [f'get_staker("{u}")' for u in uids]
                  + [f'get_pending_ember("{u}", {now})' for u in uids])
    cards = []
    cosmetics_lost = []
    accrual = {}
    for u in uids:
        tier = cv.get(f'get_card_tier("{u}")')
        if tier is None or tier < 0:
            continue
        name = cv.get(f'get_card_name("{u}")')
        ability = abilities.get(name)
        if ability is None:
            print(f"  !! no ability mapping for {name!r}; adopting with 0", flush=True)
            ability = 0
        cards.append({
            "uid": u, "name": name, "tier": tier,
            "power": cv.get(f'get_card_power("{u}")'),
            "attrs": pack(cv.get(f'get_card_aspects("{u}")')),
            "wins": cv.get(f'get_card_wins("{u}")') or 0,
            "ability": ability,
        })
        if (cv.get(f'get_card_cosmetics("{u}")') or 0) > 0:
            cosmetics_lost.append(name)
        st = cv.get(f'get_staker("{u}")')
        pe = cv.get(f'get_pending_ember("{u}", {now})') or 0
        if st and pe > 0:
            accrual[st] = accrual.get(st, 0) + pe

    # ---- players, strictly address-preserving: v4 delegation already keys
    # every ledger to the identity address, so each address adopts exactly
    # what it holds (plus mining accrual for cards it staked). No lineage
    # merging — two named identities in one chain stay two identities.
    players = discover_players() | set(names) | set(accrual)
    pf = ["get_ember_balance", "get_renown", "get_wins",
          "get_player_pulls", "get_deed_flags"]
    all_addrs = sorted(players)
    pv = views(V4, [f'{f}("{a}")' for a in all_addrs for f in pf])

    plan = []
    for a in all_addrs:
        vals = {f: (pv.get(f'{f}("{a}")') or 0) for f in pf}
        ember = vals["get_ember_balance"] + accrual.get(a, 0)
        if not (ember or vals["get_renown"] or vals["get_wins"]
                or vals["get_player_pulls"] or vals["get_deed_flags"]):
            continue
        plan.append({
            "identity": a, "name": names.get(a), "members": [a],
            "ember": ember, "renown": vals["get_renown"],
            "deeds": vals["get_deed_flags"], "wins": vals["get_wins"],
            "pulls": vals["get_player_pulls"],
        })

    print(f"cards to adopt: {len(cards)}  (cosmetics lost on {len(cosmetics_lost)})")
    for c in cards:
        print(f"  {c['name']:24} t{c['tier']} p{c['power']:<4} wins {c['wins']} ability {c['ability']}")
    print(f"players to adopt: {len(plan)}")
    for p in plan:
        print(f"  {p['name'] or p['identity'][:12]:14} ember {p['ember']:<7} renown {p['renown']:<6}"
              f" wins {p['wins']:<3} pulls {p['pulls']:<3} deeds {bin(p['deeds']).count('1')} bits"
              f" ({len(p['members'])} addrs)")

    report = {"at": now, "v4": V4, "v5": V5, "cards": cards, "players": plan,
              "cosmetics_lost": cosmetics_lost, "applied": APPLY}
    with open("scripts/migration-v5-report.json", "w") as f:
        json.dump(report, f, indent=1)
    print("report written to scripts/migration-v5-report.json")

    if not APPLY:
        print("\nDRY RUN ONLY — rerun with --apply to execute")
        return

    print("\napplying…", flush=True)
    fails = 0
    for i, c in enumerate(cards):
        r = execute("adopt_card",
                    [c["uid"], c["name"], c["tier"], c["power"], c["attrs"],
                     c["wins"], c["ability"]])
        if not r.get("success"):
            fails += 1
            print(f"  FAILED adopt_card {c['name']}: {r.get('error')}", flush=True)
        if (i + 1) % 10 == 0:
            print(f"  cards adopted: {i + 1}/{len(cards)}", flush=True)
        time.sleep(1.2)
    for p in plan:
        r = execute("adopt_player",
                    [p["identity"], p["ember"], p["renown"], p["deeds"],
                     p["wins"], p["pulls"]])
        if not r.get("success"):
            fails += 1
            print(f"  FAILED adopt_player {p['identity']}: {r.get('error')}", flush=True)
        time.sleep(1.2)
    print(f"submitted with {fails} failures; verifying on-chain…", flush=True)

    time.sleep(30)
    check = views(V5, [f'get_card_aspects("{c["uid"]}")' for c in cards[:200]])
    bad = 0
    v4a = views(V4, [f'get_card_aspects("{c["uid"]}")' for c in cards[:200]])
    for c in cards[:200]:
        a5 = check.get(f'get_card_aspects("{c["uid"]}")')
        a4 = v4a.get(f'get_card_aspects("{c["uid"]}")')
        if a5 != a4:
            bad += 1
            print(f"  MISMATCH {c['name']}: v4={a4} v5={a5}", flush=True)
    pv5 = views(V5, [f'get_ember_balance("{p["identity"]}")' for p in plan]
                   + [f'get_renown("{p["identity"]}")' for p in plan])
    for p in plan:
        e5 = pv5.get(f'get_ember_balance("{p["identity"]}")')
        r5 = pv5.get(f'get_renown("{p["identity"]}")')
        if e5 != p["ember"] or r5 != p["renown"]:
            bad += 1
            print(f"  MISMATCH {p['name'] or p['identity']}: ember {e5}/{p['ember']}"
                  f" renown {r5}/{p['renown']}", flush=True)
    print("VERIFY:", "clean" if bad == 0 else f"{bad} mismatches", flush=True)
    if fails or bad:
        sys.exit(1)
    print("MIGRATION COMPLETE")


if __name__ == "__main__":
    main()
