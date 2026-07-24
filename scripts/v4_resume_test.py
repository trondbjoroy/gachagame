"""Resume v4_playground_test.py from the duel-1 reveal (one-off).

The 2026-07-24 run timed out on a transient wallet-headless stall right
after "PASS pools recorded" (all 30 prior checks green). On-chain state:
duel d1 awaiting reveal, bets 40/30 placed. This picks up at line 352 of
the original and runs the remaining checks against the same contract.

Run: python scripts/v4_resume_test.py
"""
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = "00b03c0a36422c638bb08cbcba5312e230ba187685adfb45f9b4b43778de67db"
CHILD = "eb01c02436b69388fad9727eee43da4eda694b53ab0add185bd1292a2933433d"
# ledgers snapshotted by the original run before the stance duel
GEMS_BEFORE = {
    "WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE": 150,   # PL
    "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG": 110,   # OP
    "WQj99S9eg7wtw8QzsfLvRuxuJYBWhtWJrT": 100,   # BET
    "WabfYH2yZKNj5P5dP3WAz6Nu9W7obY89PY": 100,   # BET2
}
STANCE_C = 2
SALT = "weaver-sees-all"


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


def get_local(path, wallet):
    req = urllib.request.Request("http://localhost:8000" + path,
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def waddr(wallet, index):
    return get_local(f"/wallet/address?index={index}", wallet)["address"]


def wait(fn, label, tries=40, pause=5):
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
    for attempt in range(4):
        try:
            r = post("/wallet/nano-contracts/execute", body, wallet)
        except OSError as e:
            r = {"error": f"transport: {e}"}
        if r.get("hash"):
            return r
        print(f"submit retry {attempt + 1} for {method}: {json.dumps(r)[:300]}", flush=True)
        time.sleep(15)
    return r


def wait_exec(r, label):
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


def dep_card(uid):
    return {"type": "deposit", "token": uid, "amount": 1}


def wd_card(uid, address):
    return {"type": "withdrawal", "token": uid, "amount": 1, "address": address}


checks = []


def check(label, ok):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label, flush=True)


ADDR = {"operator": waddr("operator", 0), "player": waddr("player", 0)}
OP = ADDR["operator"]
PL = ADDR["player"]
BET = waddr("operator", 2)
BET2 = waddr("operator", 3)
assert PL in GEMS_BEFORE and OP in GEMS_BEFORE, "addresses drifted from the original run"

d1 = call1("get_duel_count()") - 1
assert call1(f"get_duel({d1})").startswith("reveal"), "duel 1 is not awaiting reveal"

# discover the operator's duel card: held by the contract, not parked, not the child
bal = (ncstate("balances[]=__all__").get("balances") or {})
held = [u for u, v in bal.items()
        if u not in ("00", CHILD) and int(v.get("value", 0)) >= 1]
card_o = next(u for u in held if call1(f'get_parked("{u}")') is not True)
print("d1:", d1, "card_o:", card_o, flush=True)

commit = hashlib.sha3_256(f"{STANCE_C}:{SALT}".encode()).digest().hex()
gems = GEMS_BEFORE
renown_pl1 = call1(f'get_renown("{PL}")')   # renown only moves at settlement,
renown_op1 = call1(f'get_renown("{OP}")')   # so pre-reveal reads equal the originals

# ---- resume at original line 352 ----
check("forfeit refused while the window is open",
      not wait_exec(execute("claim_forfeit", [d1], wallet="operator", address=BET),
                    "claim_forfeit (early, refused)"))
check("wrong stance reveal refused",
      not wait_exec(execute("reveal_duel", [d1, 1, SALT], wallet="player", address=PL),
                    "reveal with wrong stance (refused)"))
check("reveal settles the duel",
      wait_exec(execute("reveal_duel", [d1, STANCE_C, SALT], wallet="player", address=PL),
                "reveal_duel #1"))
gems_after = {a: call1(f'get_ember_balance("{a}")') for a in (PL, OP, BET, BET2)}
print("gems after stance duel:", gems_after, flush=True)
pl_delta = gems_after[PL] - gems[PL]
op_delta = gems_after[OP] - gems[OP]
challenger_won = pl_delta > op_delta
winner = "challenger(PL)" if challenger_won else "acceptor(OP)"
print("winner:", winner, "pl_delta:", pl_delta, "op_delta:", op_delta, flush=True)
# OP is the contract owner: rakes land on OP's ledger whoever wins (duel
# rake 2 + side-bet rake 1 when the challenger takes it)
check("duel pot ledger math",
      (pl_delta - 18 in (0, 5, 25, 30) and op_delta == -20 + 2 + 1) if challenger_won
      else (pl_delta == -20 and op_delta - 18 in (4, 9, 29, 34)))
check("wagered duel paid renown", call1(f'get_renown("{PL}")') > renown_pl1
      and call1(f'get_renown("{OP}")') > renown_op1)
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

wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)], wallet="player", address=PL),
          "reclaim child after duel 1")
wait_exec(execute("claim_card", None, [wd_card(card_o, OP)], wallet="operator", address=OP),
          "reclaim card O after duel 1")

# ---- duel 2: cancel refunds all ----
gems_bet = call1(f'get_ember_balance("{BET}")')
gems_pl = call1(f'get_ember_balance("{PL}")')
check("create duel to cancel",
      wait_exec(execute("create_duel", [10, commit], [dep_card(CHILD)],
                        wallet="player", address=PL), "create_duel #2"))
d2 = call1("get_duel_count()") - 1
check("bet on the doomed duel",
      wait_exec(execute("place_bet", [d2, 1, 15], wallet="operator", address=BET),
                "place_bet BET 15"))
check("cancel_duel executed",
      wait_exec(execute("cancel_duel", [d2], wallet="player", address=PL), "cancel_duel #2"))
check("wager returned on cancel", call1(f'get_ember_balance("{PL}")') == gems_pl)
check("bet refunded on cancel", call1(f'get_ember_balance("{BET}")') == gems_bet)
wait_exec(execute("claim_card", None, [wd_card(CHILD, PL)], wallet="player", address=PL),
          "reclaim child after cancel")

# ---- Ember is closed points, not a token ----
PL_S = waddr("player", 1)
ember_pl = call1(f'get_ember_balance("{PL}")')
check("Ember has no withdraw_gems method",
      not wait_exec(execute("withdraw_gems", None,
                            [{"type": "withdrawal", "token": "00", "amount": 1, "address": PL_S}],
                            wallet="player", address=PL_S), "withdraw_gems (gone)"))
check("Ember still on the main ledger", call1(f'get_ember_balance("{PL}")') == ember_pl)

proceeds = call1('get_proceeds()')
if proceeds > 0:
    check("owner withdraws all proceeds (no reserve)",
          wait_exec(execute("withdraw_proceeds", None,
              [{"type": "withdrawal", "token": "00", "amount": proceeds, "address": OP}],
              wallet="operator", address=OP), "withdraw all proceeds"))
    check("proceeds drained to zero", call1("get_proceeds()") == 0)

print("\n==== SUMMARY (resumed checks) ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\ncontract: {NC}\ncard_o:   {card_o}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL RESUMED CHECKS PASSED")
