"""v5 final check: the whole blueprint as it stands, on a fresh instance.

The five phases each passed their own E2E, but the boss rebalance landed
afterwards, so this validates the file as one piece before the publish ask:
the new boss maths exactly (multipliers, the power floor, set_writ), a real
boss fight, and one entry method from every phase to prove the refactors
left them alone.

Prereqs: wallet-headless on :8000 against the playground, miner :8035,
operator (>= 15c) + player (>= 15c) Ready.

Run: V5_BP=<hash> python scripts/v5_final_check.py
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


def waddr(wallet, index=0):
    req = urllib.request.Request(f"http://localhost:8000/wallet/address?index={index}",
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["address"]


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
        print(f"  retry {attempt + 1} {method}: {json.dumps(r)[:140]}", flush=True)
        time.sleep(12)
    return r


def wait_exec(r, label):
    h = r.get("hash")
    if not h:
        print(f"SUBMITFAIL {label}: {r.get('error')}", flush=True)
        return False
    st = {"voided": False}

    def done():
        meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
        if meta.get("voided_by"):
            st["voided"] = True
            return True
        return bool(meta.get("first_block"))

    wait(done, f"{label} confirmed")
    if not st["voided"]:
        time.sleep(6)
        meta = (get(f"{NODE}/transaction?id={h}") or {}).get("meta") or {}
        st["voided"] = bool(meta.get("voided_by"))
    print(("EXEC " if not st["voided"] else "NCFAIL ") + label, flush=True)
    return not st["voided"]


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


ADDR = {"operator": waddr("operator"), "player": waddr("player")}
OP, PL = ADDR["operator"], ADDR["player"]

BP = os.environ["V5_BP"]
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract live")

# ---------------------------------------------------------------- setup
wait_exec(execute("add_template", [0, "Check Grunt", 4]), "template (Momentum)")
wait(lambda: call1("get_template_count(0)") == 1, "template live")
wait_exec(execute("add_writ", ["The Test Warden", 4, 14, 6]), "post a boss 4/14/6")
wait(lambda: (call1("get_writ(0)") or "").startswith("The Test Warden"), "boss live")
wait_exec(execute("adopt_player", [PL, 4000, 0, 0, 0, 0]), "fund PL")
wait_exec(execute("adopt_player", [OP, 4000, 0, 0, 0, 0]), "fund OP")
wait(lambda: (call1(f'get_ember_balance("{PL}")') or 0) >= 4000, "PL funded")


def pull_claim(wallet, addr, label):
    before = all_uids()
    execute("pull", None, [{"type": "deposit", "token": "00", "amount": 5}],
            wallet=wallet, address=addr)
    got = {}
    wait(lambda: (all_uids() - before) and got.setdefault("uid", (all_uids() - before).pop()),
         f"{label} minted")
    time.sleep(8)
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": got["uid"], "amount": 1, "address": addr}],
        wallet=wallet, address=addr), f"claim {label}")
    return got["uid"]


pl = [pull_claim("player", PL, f"PL {i}") for i in range(3)]
op1 = pull_claim("operator", OP, "OP 1")

# ---------------------------------------------------------------- phase 1
check("ability stamped from the template", call1(f'get_card_ability("{pl[0]}")') == 4)

# ------------------------------------------------- the rebalanced bosses
power = call1(f'get_card_power("{pl[0]}")')
print(f"  champion power {power}", flush=True)


def expect_spread(writ_v, writ_b, writ_g, tier, p):
    mult = [1, 3, 9][tier]
    bv, bb, bg = writ_v * mult, writ_b * mult, writ_g * mult
    total = bv + bb + bg
    floor = p * [45, 80, 115][tier] // 100
    if 0 < total < floor:
        bv, bb, bg = bv * floor // total, bb * floor // total, bg * floor // total
    return f"{bv}|{bb}|{bg}"


for tier in range(3):
    want = expect_spread(4, 14, 6, tier, power)
    got = call1(f'get_writ_spread(0, {tier}, {power})')
    check(f"tier {tier} spread is {want}", got == want)
# the floor must bite for a mighty champion on the lowest tier
mighty = 400
floored = call1(f'get_writ_spread(0, 0, {mighty})')
check("the floor lifts a weak boss against a 400-power champion",
      floored == expect_spread(4, 14, 6, 0, mighty) and floored != "4|14|6")
check("set_writ retunes a live boss", wait_exec(
    execute("set_writ", [0, 9, 9, 9]), "set_writ 9/9/9"))
wait(lambda: (call1("get_writ(0)") or "").endswith("|9|9|9"), "retune visible")
check("the view follows the retune",
      call1(f'get_writ_spread(0, 2, {power})') == expect_spread(9, 9, 9, 2, power))

# a real boss fight on the new maths
wait_exec(execute("stake", None, [{"type": "deposit", "token": pl[0], "amount": 1}],
                  wallet="player", address=PL), "stake for the boss")
check("fight_writ settles on the new spread", wait_exec(
    execute("fight_writ", [pl[0], 0, 0], wallet="player", address=PL), "fight_writ Grim"))
wait_exec(execute("unstake", None,
    [{"type": "withdrawal", "token": pl[0], "amount": 1, "address": PL}],
    wallet="player", address=PL), "recall")

# ---------------------------------------------------------------- phase 2
salt = "final-check"
commit = hashlib.sha3_256(f"120:{salt}".encode()).hexdigest()
check("squad duel posts", wait_exec(
    execute("create_squad_duel", [10, commit],
            [{"type": "deposit", "token": u, "amount": 1} for u in pl],
            wallet="player", address=PL), "create_squad_duel"))
sq = call1("get_duel_count()") - 1
check("squad kind + trio visible",
      call1(f"get_duel_kind({sq})") == 1
      and len((call1(f"get_squad_cards({sq}, 0)") or "").split("|")) == 3)
check("squad cancels and refunds", wait_exec(
    execute("cancel_duel", [sq], wallet="player", address=PL), "cancel squad"))
for i, u in enumerate(pl):
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": u, "amount": 1, "address": PL}],
        wallet="player", address=PL), f"reclaim {i}")

# ---------------------------------------------------------------- phase 3
check("ranked queue takes a champion", wait_exec(
    execute("join_ranked", [1], [{"type": "deposit", "token": pl[0], "amount": 1}],
            wallet="player", address=PL), "join_ranked"))
check("queued flag + rating", call1(f'is_ranked_queued(1, "{PL}")') is True
      and call1(f'get_rating("{PL}")') == 1000)
check("ranked queue releases", wait_exec(
    execute("leave_ranked", [1], wallet="player", address=PL), "leave_ranked"))
wait_exec(execute("claim_card", None,
    [{"type": "withdrawal", "token": pl[0], "amount": 1, "address": PL}],
    wallet="player", address=PL), "reclaim from queue")

# ---------------------------------------------------------------- phase 4
check("guild raised", wait_exec(
    execute("create_guild", ["Final Check"], wallet="player", address=PL), "create_guild"))
check("guild view", call1("get_guild(0)") == "Final Check|1")
check("world boss posted", wait_exec(
    execute("post_world_boss", ["Check Colossus", 100, 1, 1, 1]), "post_world_boss"))
wk = call1("get_wb_week()")
wait_exec(execute("stake", None, [{"type": "deposit", "token": pl[0], "amount": 1}],
                  wallet="player", address=PL), "stake for the colossus")
check("world boss takes a hit", wait_exec(
    execute("fight_world_boss", [pl[0]], wallet="player", address=PL), "fight_world_boss"))
check("damage recorded", (call1(f'get_wb_damage({wk}, "{PL}")') or 0) > 0)

# ---------------------------------------------------------------- phase 5
start = int(time.time()) + 300
check("tournament scheduled", wait_exec(
    execute("create_tournament", ["Check Cup", 20, 4, start, 90, 100]), "create_tournament"))
t = call1("get_tournament_count()") - 1
check("tournament view", (call1(f"get_tournament({t})") or "").startswith("Check Cup|0|20|100|4|0"))
check("seat taken", wait_exec(
    execute("enter_tournament", [t], [{"type": "deposit", "token": pl[1], "amount": 1}],
            wallet="player", address=PL), "enter_tournament"))
check("seat given up", wait_exec(
    execute("leave_tournament", [t], wallet="player", address=PL), "leave_tournament"))

# ------------------------------------------------- the v4.1 fold: bet guard
check("duel posts for the bet guard", wait_exec(
    execute("create_duel", [10, ""], [{"type": "deposit", "token": op1, "amount": 1}]),
    "create_duel (OP)"))
d = call1("get_duel_count()") - 1
check("a spectator backs it", wait_exec(
    execute("place_bet", [d, 0, 5], wallet="player", address=PL), "place_bet"))
check("a bettor cannot then fight it", not wait_exec(
    execute("accept_duel", [d, -1], [{"type": "deposit", "token": pl[2], "amount": 1}],
            wallet="player", address=PL), "accept_duel by bettor (refused)"))
check("get_bet reports the stake", (call1(f'get_bet({d}, "{PL}")') or "").startswith("5|"))

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
