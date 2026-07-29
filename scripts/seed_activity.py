"""Put real deeds on the Ledger so a first tester has something to answer.

Unlike scripts/demo-fixtures.json (fictional names on a scoreboard), every
move here is a genuine on-chain transaction by the Crown and its sparring
wallet: real champions, real Ember, real escrow. A tester can answer these
duels, buy these champions, and take these trades.

  summon + claim   enough champions for both wallets to act with
  duels            open challenges at modest wagers, left UNANSWERED so a
                   tester can take them
  sales            listings a tester can buy
  trades           swap offers naming a champion the tester might hold

Run: python scripts/seed_activity.py           (dry run: prints the plan)
     python scripts/seed_activity.py --apply
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node-partners.testnet.hathor.network/v1a"
IDS = json.load(open("scripts/v5_ids.json"))
NC, MKT = IDS["nc"], IDS["market"]
APPLY = "--apply" in sys.argv
PULLS_EACH = 3
WAGERS = [25, 60]
PRICES = [140, 260]          # HTR cents


def get(url):
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.loads(r.read())
        except Exception:
            if i == 4:
                raise
            time.sleep(3 * (i + 1))


def call1(nc, c):
    qs = "calls[]=" + urllib.parse.quote(c)
    return (get(f"{NODE}/nano_contract/state?id={nc}&{qs}").get("calls") or {}) \
        .get(c, {}).get("value")


def wallet(path, wid, payload=None):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "x-wallet-id": wid})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def addr(wid):
    return wallet("/wallet/address?index=0", wid)["address"]


def confirm(h, label):
    for _ in range(80):
        try:
            meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
            if meta.get("voided_by"):
                print(f"  VOIDED {label}")
                return False
            if meta.get("first_block"):
                time.sleep(5)
                meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
                ok = not meta.get("voided_by")
                print(f"  {'ok' if ok else 'VOIDED'} {label}")
                return ok
        except Exception:
            pass
        time.sleep(5)
    print(f"  TIMEOUT {label}")
    return False


def execute(wid, method, args=None, actions=None, target=None):
    body = {"nc_id": target or NC, "method": method,
            "address": addr(wid), "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    for attempt in range(4):
        r = wallet("/wallet/nano-contracts/execute", wid, body)
        if r.get("hash"):
            return r["hash"]
        print(f"  retry {method}: {str(r.get('error'))[:90]}")
        time.sleep(12)
    return None


def held(a):
    """Card uids sitting in a wallet (1 unit each)."""
    d = get(f"{NODE}/thin_wallet/address_balance?address={a}")
    return [u for u, t in (d.get("tokens_data") or {}).items()
            if u != "00" and (t.get("received", 0) - t.get("spent", 0)) == 1]


def pending_for(a):
    bal = get(f"{NODE}/nano_contract/state?id={NC}&balances[]=__all__").get("balances") or {}
    out = []
    for u in bal:
        if u == "00":
            continue
        if call1(NC, f'get_pending_owner("{u}")') == a:
            out.append(u)
    return out


def name_of(u):
    return call1(NC, f'get_card_name("{u}")') or u[:8]


def main():
    op, pl = addr("operator"), addr("player")
    print(f"crown   {op}\nsparrer {pl}")
    print(f"\nplan: {PULLS_EACH} summons each, then "
          f"{len(WAGERS)} open duels, {len(PRICES)} sales, 2 trades")
    if not APPLY:
        print("\nDRY RUN — rerun with --apply")
        return

    # ---- summon so both wallets have champions to act with ----
    for wid in ("operator", "player"):
        for i in range(PULLS_EACH):
            h = execute(wid, "pull", None, [{"type": "deposit", "token": "00", "amount": 100}])
            if h:
                confirm(h, f"{wid} summon {i + 1}")
            time.sleep(3)
    for wid, a in (("operator", op), ("player", pl)):
        for u in pending_for(a):
            h = execute(wid, "claim_card", None,
                        [{"type": "withdrawal", "token": u, "amount": 1, "address": a}])
            if h:
                confirm(h, f"{wid} claims {name_of(u)}")
            time.sleep(3)

    op_cards, pl_cards = held(op), held(pl)
    print(f"\ncrown holds {len(op_cards)}, sparrer holds {len(pl_cards)}")

    # ---- open duels, left unanswered for a tester to take ----
    for i, w in enumerate(WAGERS):
        if i >= len(op_cards):
            break
        u = op_cards[i]
        h = execute("operator", "create_duel", [w, ""],
                    [{"type": "deposit", "token": u, "amount": 1}])
        if h:
            confirm(h, f"duel with {name_of(u)} · {w} Ember")
        time.sleep(3)

    # ---- sales a tester can buy ----
    for i, p in enumerate(PRICES):
        idx = i + len(WAGERS)
        if idx >= len(op_cards):
            break
        u = op_cards[idx]
        h = execute("operator", "list_card", [p],
                    [{"type": "deposit", "token": u, "amount": 1}], target=MKT)
        if h:
            confirm(h, f"listed {name_of(u)} for {p / 100:.2f} HTR")
        time.sleep(3)

    # ---- trades: the sparrer offers, naming a champion the crown holds ----
    for i in range(min(2, len(pl_cards))):
        give = pl_cards[i]
        want = op_cards[-(i + 1)] if len(op_cards) > i else None
        if not want:
            break
        h = execute("player", "offer_swap", [want],
                    [{"type": "deposit", "token": give, "amount": 1}], target=MKT)
        if h:
            confirm(h, f"offered {name_of(give)} for {name_of(want)}")
        time.sleep(3)

    print("\nopen duels:", call1(NC, "get_duel_count()"))
    print("listings:  ", call1(MKT, "get_listing_count()"))
    print("swaps:     ", call1(MKT, "get_swap_count()"))


if __name__ == "__main__":
    main()
