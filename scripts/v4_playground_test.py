"""Publish EmberfallArena v4 on testnet-playground and E2E the new surface:
session delegation (offer/accept/revoke escrow flow), park-not-melt fusion,
card_unit=1 minting, renown-free unwagered duels, commit-reveal duel stances,
and spectator side-bets (payout, refund and cancel paths).

Prereqs: wallet-headless on :8000 repointed to the playground node with the
local miner on :8035, operator + player wallets started and funded.

Run: python scripts/v4_playground_test.py
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = None  # set after create


def post(path, payload, wallet="operator"):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": wallet})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read())


def waddr(wallet, index):
    return get_local(f"/wallet/address?index={index}", wallet)["address"]


def get_local(path, wallet):
    req = urllib.request.Request("http://localhost:8000" + path,
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def wait(fn, label, tries=40, pause=6):
    for _ in range(tries):
        try:
            if fn():
                print("OK:", label, flush=True)
                return
        except Exception:
            pass
        time.sleep(pause)
    raise SystemExit("TIMEOUT: " + label)


def execute(method, args=None, actions=None, wallet="operator", address=None):
    body = {"nc_id": NC, "method": method,
            "address": address or ADDR[wallet], "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    # the wallet occasionally refuses to build a tx right after new tokens
    # confirm (transient; the same call succeeds moments later) — retry
    for attempt in range(4):
        r = post("/wallet/nano-contracts/execute", body, wallet)
        if r.get("hash"):
            return r
        print(f"submit retry {attempt + 1} for {method}: {json.dumps(r)[:300]}", flush=True)
        time.sleep(15)
    return r


def wait_exec(r, label):
    """Wallet 'success' only means submitted. Wait for a block to confirm
    the tx and report whether the nano execution succeeded (not voided)."""
    h = r.get("hash")
    if not h:
        print(f"SUBMITFAIL {label}: {r.get('error')}", flush=True)
        return False
    state = {"voided": False}

    def done():
        tx = get(f"{NODE}/transaction?id={h}")
        meta = tx.get("meta") or {}
        if meta.get("voided_by"):
            state["voided"] = True
            return True
        return bool(meta.get("first_block"))

    wait(done, f"{label} confirmed", tries=40, pause=5)
    # voiding metadata can settle a beat after first_block: re-read once
    if not state["voided"]:
        time.sleep(6)
        meta = (get(f"{NODE}/transaction?id={h}").get("meta") or {})
        state["voided"] = bool(meta.get("voided_by"))
    print(("EXEC " if not state["voided"] else "NCFAIL ") + label, flush=True)
    return not state["voided"]


def ncstate(qs):
    return get(f"{NODE}/nano_contract/state?id={NC}&{qs}")


def calls(*cs):
    qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in cs)
    d = ncstate(qs)
    return {k: v.get("value", v.get("errmsg")) for k, v in (d.get("calls") or {}).items()}


def call1(c):
    return calls(c)[c]


def all_uids():
    d = ncstate("balances[]=__all__")
    return set((d.get("balances") or {}).keys())


def dep_htr(amount):
    return {"type": "deposit", "token": "00", "amount": amount}


def wd_htr(amount, address):
    return {"type": "withdrawal", "token": "00", "amount": amount, "address": address}


def dep_card(uid):
    return {"type": "deposit", "token": uid, "amount": 1}


def wd_card(uid, address):
    return {"type": "withdrawal", "token": uid, "amount": 1, "address": address}


checks = []


def check(label, ok):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label, flush=True)


ADDR = {"operator": None, "player": None}
ADDR["operator"] = waddr("operator", 0)
ADDR["player"] = waddr("player", 0)
OP = ADDR["operator"]
PL = ADDR["player"]
PL_S = waddr("player", 1)   # the "session" address under the player's banner
BET = waddr("operator", 2)  # spectator identities (distinct addresses)
BET2 = waddr("operator", 3)
print("OP:", OP, "\nPL:", PL, "\nPL_S:", PL_S, "\nBET:", BET, "\nBET2:", BET2, flush=True)

# ---------------------------------------------------------------- publish
BP = os.environ.get("V4_BP")
if not BP:
    code = open("blueprint/gacha_arena_v4.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v4 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

r = post("/wallet/nano-contracts/create", {
    "blueprint_id": BP, "address": OP,
    "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],   # all-commons weights, card_unit=1
             "actions": [dep_htr(2)]}})
NC = r.get("hash")
print("v4 contract:", NC, r.get("error", ""), flush=True)
assert NC, r
wait(lambda: ncstate("fields[]=gems_uid").get("success"), "contract confirmed")
GEMS = ncstate("fields[]=gems_uid")["fields"]["gems_uid"]["value"]
print("GEMS:", GEMS, flush=True)
check("card_unit stored", call1("get_card_unit()") == 1)

# ------------------------------------------------------------- configure
for tier, name in [(0, "Moss Snail"), (0, "Tin Knight"), (1, "Ember Fox")]:
    print("add_template", name, execute("add_template", [tier, name]).get("success"), flush=True)
    time.sleep(2)
wait(lambda: call1("get_template_count(0)") == 2 and call1("get_template_count(1)") == 1,
     "templates registered")

# ------------------------------------------------- session delegation
check("accept before any offer refused",
      not wait_exec(execute("accept_session", wallet="player", address=PL_S),
                    "accept_session (no offer)"))
check("offer_session escrows the float",
      wait_exec(execute("offer_session", [PL_S], [dep_htr(30)], wallet="player", address=PL),
                "offer_session"))
check("offer recorded", call1(f'get_session_offer("{PL_S}")') is not None)
check("escrow recorded", call1(f'get_session_fund("{PL_S}")') == 30)
check("accept_session binds and withdraws the escrow",
      wait_exec(execute("accept_session", None, [wd_htr(30, PL_S)],
                        wallet="player", address=PL_S), "accept_session"))
check("delegate resolves session to main", call1(f'get_delegate("{PL_S}")') is not None)
check("main flagged", call1(f'get_is_main("{PL}")') is True)
check("escrow cleared", call1(f'get_session_fund("{PL_S}")') == 0)
check("second accept refused",
      not wait_exec(execute("accept_session", wallet="player", address=PL_S),
                    "accept_session (again)"))

# ------------------------------------------------------- pulls (main+session)
CARDS = []


def pull_from(wallet, address, label):
    before = all_uids()
    r = execute("pull", None, [dep_htr(5)], wallet=wallet, address=address)
    print("pull ->", r.get("success"), r.get("error", ""), flush=True)
    found = {"uid": None}

    def found_card():
        new = [u for u in all_uids() - before if u != GEMS]
        if new:
            found["uid"] = new[0]
            return True
        return False

    wait(found_card, f"{label} minted")
    time.sleep(10)  # let the wallet settle before spending against the mint
    CARDS.append(found["uid"])
    return found["uid"]


card_a = pull_from("player", PL, "card A (main)")
card_b = pull_from("player", PL, "card B (main)")
card_s = pull_from("player", PL_S, "card S (session)")
check("session pull counted for the main identity",
      call1(f'get_player_pulls("{PL}")') == 3 and call1(f'get_player_pulls("{PL_S}")') == 0)
renown_pl = call1(f'get_renown("{PL}")')
check("session pull renown accrued to main", renown_pl >= 30)
check("session address itself accrued nothing", call1(f'get_renown("{PL_S}")') == 0)

# session claims a card the MAIN pulled; main claims the session's pull
check("session claims main's card",
      wait_exec(execute("claim_card", None, [wd_card(card_a, PL_S)],
                        wallet="player", address=PL_S), "claim card A via session"))
check("main claims card B",
      wait_exec(execute("claim_card", None, [wd_card(card_b, PL)],
                        wallet="player", address=PL), "claim card B"))
check("main claims the session's pull",
      wait_exec(execute("claim_card", None, [wd_card(card_s, PL)],
                        wallet="player", address=PL), "claim card S"))

# ------------------------------------------------------ fusion parks parents
before = all_uids()
check("fuse executed (card_unit=1 deposits)",
      wait_exec(execute("fuse", None, [dep_card(card_a), dep_card(card_b)],
                        wallet="player", address=PL), "fuse"))
CHILD = None


def found_child():
    global CHILD
    new = [u for u in all_uids() - before if u != GEMS]
    if new:
        CHILD = new[0]
        return True
    return False


wait(found_child, "child minted")
print("child:", CHILD, flush=True)
check("child is a Knight", call1(f'get_card_tier("{CHILD}")') == 1)
check("parent A parked, not melted", call1(f'get_parked("{card_a}")') is True)
check("parent B parked, not melted", call1(f'get_parked("{card_b}")') is True)
bal = (ncstate("balances[]=__all__").get("balances") or {})
held_a = int((bal.get(card_a) or {}).get("value", 0))
held_b = int((bal.get(card_b) or {}).get("value", 0))
check("parked parents rest in contract custody", held_a == 1 and held_b == 1)
check("parked card refuses re-entry",
      not wait_exec(execute("stake", None, [dep_card(card_a)],
                            wallet="player", address=PL), "stake parked (refused)"))
check("claim fused child",
      wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)],
                        wallet="player", address=PL), "claim child"))

# operator needs a card to answer duels
card_o = pull_from("operator", OP, "card O (operator)")
check("operator claims their card",
      wait_exec(execute("claim_card", None, [wd_card(card_o, OP)],
                        wallet="operator", address=OP), "claim card O"))

# gems float for wagers and bets (owner migration credit)
wait_exec(execute("adopt_player", [PL, 100, 0, 0, 0, 0]), "adopt_player PL gems")
wait_exec(execute("adopt_player", [OP, 100, 0, 0, 0, 0]), "adopt_player OP gems")
wait_exec(execute("adopt_player", [BET, 100, 0, 0, 0, 0]), "adopt_player BET gems")
wait_exec(execute("adopt_player", [BET2, 100, 0, 0, 0, 0]), "adopt_player BET2 gems")

# ------------------------------------------------- duel 0: unwagered classic
renown_pl0 = call1(f'get_renown("{PL}")')
renown_op0 = call1(f'get_renown("{OP}")')
wins0 = call1(f'get_wins("{PL}")') + call1(f'get_wins("{OP}")')
r = execute("create_duel", [0, ""], [dep_card(CHILD)], wallet="player", address=PL)
check("create classic duel (no stance, wager 0)", wait_exec(r, "create_duel #0"))
d0 = call1("get_duel_count()") - 1
check("stance accept on classic duel refused",
      not wait_exec(execute("accept_duel", [d0, 1], [dep_card(card_o)],
                            wallet="operator", address=OP), "accept #0 with stance (refused)"))
check("classic duel settles at accept",
      wait_exec(execute("accept_duel", [d0, -1], [dep_card(card_o)],
                        wallet="operator", address=OP), "accept_duel #0"))
check("unwagered duel granted no renown",
      call1(f'get_renown("{PL}")') == renown_pl0
      and call1(f'get_renown("{OP}")') == renown_op0)
check("the win itself still counted",
      call1(f'get_wins("{PL}")') + call1(f'get_wins("{OP}")') == wins0 + 1)

# both cards go home before the next duel
wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)], wallet="player", address=PL),
          "reclaim child")
wait_exec(execute("claim_card", None, [wd_card(card_o, OP)], wallet="operator", address=OP),
          "reclaim card O")

# --------------------------------------- duel 1: sealed stances + side-bets
STANCE_C = 2
SALT = "weaver-sees-all"
commit = hashlib.sha3_256(f"{STANCE_C}:{SALT}".encode()).digest().hex()
renown_pl1 = call1(f'get_renown("{PL}")')
renown_op1 = call1(f'get_renown("{OP}")')
gems = {a: call1(f'get_gems_balance("{a}")') for a in (PL, OP, BET, BET2)}
print("gems before stance duel:", gems, flush=True)
check("create stance duel (wager 20)",
      wait_exec(execute("create_duel", [20, commit], [dep_card(CHILD)],
                        wallet="player", address=PL), "create_duel #1"))
d1 = call1("get_duel_count()") - 1
check("stance flagged", call1(f"get_duel_has_stances({d1})") is True)
check("spectator bets while open",
      wait_exec(execute("place_bet", [d1, 0, 40], wallet="operator", address=BET),
                "place_bet BET 40 on challenger"))
check("duelist cannot back their own fight",
      not wait_exec(execute("place_bet", [d1, 0, 5], wallet="player", address=PL),
                    "place_bet by challenger (refused)"))
check("classic accept on stance duel refused",
      not wait_exec(execute("accept_duel", [d1, -1], [dep_card(card_o)],
                            wallet="operator", address=OP), "accept #1 without stance (refused)"))
check("stance accept parks the duel for reveal",
      wait_exec(execute("accept_duel", [d1, 0], [dep_card(card_o)],
                        wallet="operator", address=OP), "accept_duel #1"))
check("duel awaits reveal", call1(f"get_duel({d1})").startswith("reveal"))
check("bets stay open through the reveal wait",
      wait_exec(execute("place_bet", [d1, 1, 30], wallet="operator", address=BET2),
                "place_bet BET2 30 on acceptor"))
check("pools recorded",
      call1(f"get_bet_pool({d1}, 0)") == 40 and call1(f"get_bet_pool({d1}, 1)") == 30)
check("forfeit refused while the window is open",
      not wait_exec(execute("claim_forfeit", [d1], wallet="operator", address=BET),
                    "claim_forfeit (early, refused)"))
check("wrong stance reveal refused",
      not wait_exec(execute("reveal_duel", [d1, 1, SALT], wallet="player", address=PL),
                    "reveal with wrong stance (refused)"))
check("reveal settles the duel",
      wait_exec(execute("reveal_duel", [d1, STANCE_C, SALT], wallet="player", address=PL),
                "reveal_duel #1"))
gems_after = {a: call1(f'get_gems_balance("{a}")') for a in (PL, OP, BET, BET2)}
print("gems after stance duel:", gems_after, flush=True)
# who won? the winner's ledger moved +38 (pot 40 minus 5% rake) minus their 20 stake
pl_delta = gems_after[PL] - gems[PL]
op_delta = gems_after[OP] - gems[OP]
challenger_won = pl_delta > op_delta
winner = "challenger(PL)" if challenger_won else "acceptor(OP)"
print("winner:", winner, "pl_delta:", pl_delta, "op_delta:", op_delta, flush=True)
# OP is also the contract owner: when OP wins they additionally collect the
# duel rake (+2), the side-bet rake (+2), the first-win deed bounty (+25 if
# fresh) and the daily-trial bonus (+5 if today's trial is a duel win)
check("duel pot ledger math",
      (pl_delta, op_delta) == (18, -20) if challenger_won
      else (pl_delta == -20 and op_delta - 18 in (4, 9, 29, 34)))
check("wagered duel paid renown", call1(f'get_renown("{PL}")') > renown_pl1
      and call1(f'get_renown("{OP}")') > renown_op1)
# side-bet settlement: winners get stake + share of losing pool minus 5% rake
bet_delta = gems_after[BET] - gems[BET]
bet2_delta = gems_after[BET2] - gems[BET2]
if challenger_won:
    check("winning backer paid from the losing pool", bet_delta == -40 + 40 + 40 * 29 // 40)
    check("losing backer paid nothing back", bet2_delta == -30)
else:
    check("winning backer paid from the losing pool", bet2_delta == -30 + 30 + 30 * 38 // 30)
    check("losing backer paid nothing back", bet_delta == -40)
check("pools zeroed after settlement",
      call1(f"get_bet_pool({d1}, 0)") == 0 and call1(f"get_bet_pool({d1}, 1)") == 0)

# cards home again
wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)], wallet="player", address=PL),
          "reclaim child after duel 1")
wait_exec(execute("claim_card", None, [wd_card(card_o, OP)], wallet="operator", address=OP),
          "reclaim card O after duel 1")

# ------------------------------------------------- duel 2: cancel refunds all
gems_bet = call1(f'get_gems_balance("{BET}")')
gems_pl = call1(f'get_gems_balance("{PL}")')
check("create duel to cancel",
      wait_exec(execute("create_duel", [10, commit], [dep_card(CHILD)],
                        wallet="player", address=PL), "create_duel #2"))
d2 = call1("get_duel_count()") - 1
check("bet on the doomed duel",
      wait_exec(execute("place_bet", [d2, 1, 15], wallet="operator", address=BET),
                "place_bet BET 15"))
check("cancel_duel executed",
      wait_exec(execute("cancel_duel", [d2], wallet="player", address=PL), "cancel_duel #2"))
check("wager returned on cancel", call1(f'get_gems_balance("{PL}")') == gems_pl)
check("bet refunded on cancel", call1(f'get_gems_balance("{BET}")') == gems_bet)
wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)], wallet="player", address=PL),
          "reclaim child after cancel")

# --------------------------------------------- session withdraws main's gems
gems_pl2 = call1(f'get_gems_balance("{PL}")')
check("session withdraws from the main ledger",
      wait_exec(execute("withdraw_gems", None,
                        [{"type": "withdrawal", "token": GEMS, "amount": 5, "address": PL_S}],
                        wallet="player", address=PL_S), "withdraw_gems via session"))
check("main ledger debited", call1(f'get_gems_balance("{PL}")') == gems_pl2 - 5)

# ------------------------------------------------------------------ done
print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}\nGEMS:      {GEMS}\ncards:     {CARDS} child {CHILD}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
