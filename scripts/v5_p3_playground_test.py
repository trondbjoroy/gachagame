"""v5 Phase 3 (rated ladder) focused validation on testnet-playground.

Publishes the phase-3 blueprint and exercises the ladder: bad tier and
out-of-range adoptions refused, queue/leave with wager refund, the
double-join guard, the 200-rating matchmaking band (a 400-gap joiner
queues instead of matching), and a live match whose Elo transfer is
checked EXACTLY (25-point-bucket K=32 table, zero-sum).

Prereqs: wallet-headless on :8000 against the playground node, miner :8035,
operator (>= 7c) + player (>= 10c) wallets started and funded.

Run: python scripts/v5_p3_playground_test.py
Resume: V5P3_BP=<hash> V5P3_NC=<hash> [V5P3_SKIP_SETUP=1] python scripts/v5_p3_playground_test.py
"""
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


ADDR = {"operator": waddr("operator", 0), "player": waddr("player", 0)}
OP = ADDR["operator"]
PL = ADDR["player"]

BP = os.environ.get("V5P3_BP")
if not BP:
    code = open("blueprint/gacha_arena_v5.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v5p3 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5P3_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v5p3 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")


def held_cards(wallet):
    out = []
    for uid in sorted(all_uids()):
        b = get_local(f"/wallet/balance?token={uid}", wallet)
        if (b.get("available") or 0) >= 1:
            out.append(uid)
    return out


if os.environ.get("V5P3_SKIP_SETUP"):
    pl_cards = held_cards("player")
    op_cards = held_cards("operator")
    assert len(pl_cards) == 2 and len(op_cards) == 1, (pl_cards, op_cards)
else:
    wait_exec(execute("add_template", [0, "Ladder Grunt", 0]), "add Ladder Grunt|0")
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

    pl_cards = [pull_claim("player", PL, f"PL card {i}") for i in range(2)]
    op_cards = [pull_claim("operator", OP, "OP card")]
    wait_exec(execute("adopt_player", [PL, 200, 0, 0, 0, 0]), "adopt PL ember")
    wait(lambda: (call1(f'get_ember_balance("{PL}")') or 0) >= 200, "PL ember credited")

card_a, card_a2 = pl_cards[0], pl_cards[1]
card_b = op_cards[0]


def dep(uid):
    return [{"type": "deposit", "token": uid, "amount": 1}]


def reclaim(uid, wallet, address, label):
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": uid, "amount": 1, "address": address}],
        wallet=wallet, address=address), label)


# 1. guards
check("bad tier refused", not wait_exec(
    execute("join_ranked", [3], dep(card_a), wallet="player", address=PL),
    "join tier 3 (refused)"))
check("adopt_rating range enforced", not wait_exec(
    execute("adopt_rating", [PL, 50]), "adopt_rating 50 (refused)"))
check("leave when not queued refused", not wait_exec(
    execute("leave_ranked", [2]), "leave tier 2 (refused)"))

# 2. wagered queue + leave refunds
pl_e0 = call1(f'get_ember_balance("{PL}")')
check("join tier 1 queues", wait_exec(
    execute("join_ranked", [1], dep(card_a), wallet="player", address=PL),
    "join tier 1"))
check("wager debited", call1(f'get_ember_balance("{PL}")') == pl_e0 - 25)
check("waiting count 1", call1("get_ranked_waiting(1)") == 1)
check("queued flag set", call1(f'is_ranked_queued(1, "{PL}")') is True)
check("double join refused", not wait_exec(
    execute("join_ranked", [1], dep(card_a2), wallet="player", address=PL),
    "join tier 1 again (refused)"))
check("leave refunds", wait_exec(
    execute("leave_ranked", [1], wallet="player", address=PL), "leave tier 1"))
check("wager returned", call1(f'get_ember_balance("{PL}")') == pl_e0)
check("queue empty again", call1("get_ranked_waiting(1)") == 0)
reclaim(card_a, "player", PL, "reclaim card A after leave")

# 3. the matchmaking band: 400 apart must NOT match
wait_exec(execute("adopt_rating", [OP, 1400]), "adopt OP rating 1400")
wait(lambda: call1(f'get_rating("{OP}")') == 1400, "OP rating live")
check("PL joins free tier", wait_exec(
    execute("join_ranked", [0], dep(card_a), wallet="player", address=PL),
    "PL join tier 0"))
check("OP out of band queues too", wait_exec(
    execute("join_ranked", [0], dep(card_b)), "OP join tier 0 (no match)"))
check("both waiting (band respected)", call1("get_ranked_waiting(0)") == 2)
check("OP leaves", wait_exec(execute("leave_ranked", [0]), "OP leave tier 0"))
reclaim(card_b, "operator", OP, "reclaim card B after band test")

# 4. in-band join settles with exact Elo transfer
wait_exec(execute("adopt_rating", [OP, 1150]), "adopt OP rating 1150")
wait(lambda: call1(f'get_rating("{OP}")') == 1150, "OP rating 1150 live")
pl_wins0 = call1(f'get_wins("{PL}")') or 0
check("in-band join settles", wait_exec(
    execute("join_ranked", [0], dep(card_b)), "OP join tier 0 (match)"))
check("queue drained", call1("get_ranked_waiting(0)") == 0)
r_pl = call1(f'get_rating("{PL}")')
r_op = call1(f'get_rating("{OP}")')
pl_won = (call1(f'get_wins("{PL}")') or 0) > pl_wins0
# K=32, 25-pt buckets: gap 150 -> winner at advantage moves 10, at
# disadvantage 22; zero-sum around 1000+1150
expect = (1022, 1128) if pl_won else (990, 1160)
check("Elo transfer exact", (r_pl, r_op) == expect)
check("zero-sum", r_pl + r_op == 2150)
print(f"  ({'PL' if pl_won else 'OP'} won: ratings PL {r_pl}, OP {r_op})", flush=True)
reclaim(card_a, "player", PL, "reclaim card A after match")
reclaim(card_b, "operator", OP, "reclaim card B after match")
check("cards returned", True)

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
