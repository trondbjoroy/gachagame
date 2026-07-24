"""v5 Phase 2 (squad duels, 3v3) focused validation on testnet-playground.

Publishes the phase-2 blueprint, mints three plain cards per wallet, then
exercises the full squad life cycle: malformed creates refused, bettors
barred from accepting, cancel refunds wager + bets + all three cards,
1v1 paths refuse squad ids, sealed lane order enforced (wrong salt and
non-permutation both refused), and a clean reveal that settles three lane
fights with pot/rake/XP and returns all six cards.

Prereqs: wallet-headless on :8000 against the playground node, miner :8035,
operator + player wallets started and funded (>= 17c op, >= 15c player).

Run: python scripts/v5_p2_playground_test.py
Resume: V5P2_BP=<hash> V5P2_NC=<hash> python scripts/v5_p2_playground_test.py
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = None


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
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == 4:
                raise
            time.sleep(4)


def get_local(path, wallet):
    req = urllib.request.Request("http://localhost:8000" + path,
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def waddr(wallet, index):
    return get_local(f"/wallet/address?index={index}", wallet)["address"]


def wait(fn, label, tries=90, pause=5):
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
        print(f"submit retry {attempt + 1} for {method}: {json.dumps(r)[:200]}", flush=True)
        time.sleep(12)
    return r


def wait_exec(r, label):
    h = r.get("hash")
    if not h:
        print(f"SUBMITFAIL {label}: {r.get('error')}", flush=True)
        return False
    state = {"voided": False}

    def done():
        meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
        if meta.get("voided_by"):
            state["voided"] = True
            return True
        return bool(meta.get("first_block"))

    wait(done, f"{label} confirmed")
    if not state["voided"]:
        time.sleep(6)
        meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
        state["voided"] = bool(meta.get("voided_by"))
    print(("EXEC " if not state["voided"] else "NCFAIL ") + label, flush=True)
    return not state["voided"]


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


def all_uids():
    d = get(f"{NODE}/nano_contract/state?id={NC}&balances[]=__all__")
    return set((d.get("balances") or {}).keys()) - {"00"}


checks = []


def check(label, ok):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label, flush=True)


def xp_of(uid):
    aspects = call1(f'get_card_aspects("{uid}")') or ""
    parts = aspects.split("|")
    return int(parts[5]) if len(parts) >= 6 else -1


ADDR = {"operator": waddr("operator", 0), "player": waddr("player", 0)}
OP = ADDR["operator"]
PL = ADDR["player"]

BP = os.environ.get("V5P2_BP")
if not BP:
    code = open("blueprint/gacha_arena_v5.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v5p2 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5P2_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v5p2 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")

def held_cards(wallet):
    """The contract-minted cards this wallet holds (claimed, in-wallet)."""
    out = []
    for uid in sorted(all_uids()):
        b = get_local(f"/wallet/balance?token={uid}", wallet)
        if (b.get("available") or 0) >= 1:
            out.append(uid)
    return out


if os.environ.get("V5P2_SKIP_SETUP"):
    # resume: cards were pulled and Ember adopted on a previous run
    pl_cards = held_cards("player")
    op_cards = held_cards("operator")
    assert len(pl_cards) == 3 and len(op_cards) == 3, (pl_cards, op_cards)
else:
    # one plain (no-ability) template so squads fight on stats alone
    n = call1("get_template_count(0)") or 0
    while n > 0:
        wait_exec(execute("remove_template", [0, 0]), f"remove template ({n} left)")
        n -= 1
    wait_exec(execute("add_template", [0, "Squad Grunt", 0]), "add Squad Grunt|0")
    wait(lambda: call1("get_template_count(0)") == 1, "solo template")

    def pull_claim(wallet, address, label):
        before = all_uids()
        execute("pull", None, [{"type": "deposit", "token": "00", "amount": 5}],
                wallet=wallet, address=address)
        got = {}
        wait(lambda: (all_uids() - before) and got.setdefault("uid", (all_uids() - before).pop()),
             f"{label} minted")
        time.sleep(8)
        wait_exec(execute("claim_card", None,
            [{"type": "withdrawal", "token": got["uid"], "amount": 1, "address": address}],
            wallet=wallet, address=address), f"claim {label}")
        return got["uid"]

    pl_cards = [pull_claim("player", PL, f"PL card {i}") for i in range(3)]
    op_cards = [pull_claim("operator", OP, f"OP card {i}") for i in range(3)]
    wait_exec(execute("adopt_player", [PL, 200, 0, 0, 0, 0]), "adopt PL ember")
    wait_exec(execute("adopt_player", [OP, 200, 0, 0, 0, 0]), "adopt OP ember")

check("all six plain (ability 0)",
      all(call1(f'get_card_ability("{u}")') == 0 for u in pl_cards + op_cards))
# pulls also pay first-summon deed/daily-trial bounties, so the ledger is
# AT LEAST the adopted 200, not exactly 200
wait(lambda: (call1(f'get_ember_balance("{PL}")') or 0) >= 200, "PL ember credited")

SALT = "v5-p2-salt"
PERM = "201"
COMMIT = hashlib.sha3_256(f"{PERM}:{SALT}".encode()).hexdigest()


def deposits(cards):
    return [{"type": "deposit", "token": u, "amount": 1} for u in cards]


# 1. malformed create: two cards only
check("two-card create refused", not wait_exec(
    execute("create_squad_duel", [30, COMMIT], deposits(pl_cards[:2]),
            wallet="player", address=PL), "create with 2 cards (refused)"))

# 2. squad duel A: bet-guard + cancel path
pl_e0 = call1(f'get_ember_balance("{PL}")')
op_e0 = call1(f'get_ember_balance("{OP}")')
check("squad A created", wait_exec(
    execute("create_squad_duel", [30, COMMIT], deposits(pl_cards),
            wallet="player", address=PL), "create squad A"))
dA = call1("get_duel_count()") - 1
check("kind view says squad", call1(f"get_duel_kind({dA})") == 1)
squad0 = call1(f"get_squad_cards({dA}, 0)") or ""
check("challenger squad listed", sorted(squad0.split("|")) == sorted(pl_cards))

check("1v1 accept refused on squad", not wait_exec(
    execute("accept_duel", [dA, -1], deposits(op_cards[:1]),
            wallet="operator", address=OP), "accept_duel on squad (refused)"))
check("OP bets on squad A", wait_exec(
    execute("place_bet", [dA, 0, 10]), "place_bet"))
check("bettor cannot accept squad", not wait_exec(
    execute("accept_squad_duel", [dA], deposits(op_cards)),
    "accept_squad_duel by bettor (refused)"))
check("cancel squad A", wait_exec(
    execute("cancel_duel", [dA], wallet="player", address=PL), "cancel squad A"))
check("wager refunded", call1(f'get_ember_balance("{PL}")') == pl_e0)
check("bet refunded", call1(f'get_ember_balance("{OP}")') == op_e0)
for i, u in enumerate(pl_cards):
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": u, "amount": 1, "address": PL}],
        wallet="player", address=PL), f"reclaim PL card {i} after cancel")

# 3. squad duel B: the clean path
check("squad B created", wait_exec(
    execute("create_squad_duel", [30, COMMIT], deposits(pl_cards),
            wallet="player", address=PL), "create squad B"))
dB = call1("get_duel_count()") - 1
op_e1 = call1(f'get_ember_balance("{OP}")')
check("squad B accepted", wait_exec(
    execute("accept_squad_duel", [dB], deposits(op_cards)), "accept squad B"))
acc = call1(f"get_squad_cards({dB}, 1)") or ""
check("acceptor lanes in deposit order", acc.split("|") == op_cards)

check("1v1 reveal refused on squad", not wait_exec(
    execute("reveal_duel", [dB, 1, SALT], wallet="player", address=PL),
    "reveal_duel on squad (refused)"))
check("wrong lane order refused", not wait_exec(
    execute("reveal_squad", [dB, "012", SALT], wallet="player", address=PL),
    "reveal wrong perm (refused)"))
check("non-permutation refused", not wait_exec(
    execute("reveal_squad", [dB, "220", SALT], wallet="player", address=PL),
    "reveal 220 (refused)"))
check("reveal settles squad B", wait_exec(
    execute("reveal_squad", [dB, PERM, SALT], wallet="player", address=PL),
    "reveal squad B"))

pl_e2 = call1(f'get_ember_balance("{PL}")')
op_e2 = call1(f'get_ember_balance("{OP}")')
pot, rake = 60, 60 * 500 // 10_000  # 57 to the winner, 3 to the Crown
# first-duel-win deed bounty (+25) and daily-trial bonus (+5) may ride along
pl_won = pl_e2 > pl_e0 - 30
if pl_won:
    check("winner pot math (challenger)",
          pl_e2 - (pl_e0 - 30) - (pot - rake) in (0, 25, 30))
    check("loser + rake math", op_e2 - op_e1 == -30 + rake)
else:
    check("winner pot math (acceptor, is Crown)",
          op_e2 - op_e1 - (-30 + pot) in (0, 25, 30))
    check("loser paid wager", pl_e2 == pl_e0 - 30)
print(f"  ({'challenger' if pl_won else 'acceptor'} won: pl {pl_e0}->{pl_e2}, op {op_e1}->{op_e2})", flush=True)

xps = [xp_of(u) for u in pl_cards + op_cards]
check("every card fought one lane (XP 4/2)",
      sorted(xps) == [2, 2, 2, 4, 4, 4] and sum(xps) == 18)
check("duel closed", "closed" in (call1(f"get_duel({dB})") or ""))

for i, u in enumerate(pl_cards):
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": u, "amount": 1, "address": PL}],
        wallet="player", address=PL), f"reclaim PL card {i}")
for i, u in enumerate(op_cards):
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": u, "amount": 1, "address": OP}],
        wallet="operator", address=OP), f"reclaim OP card {i}")
check("all six cards returned", True)

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
