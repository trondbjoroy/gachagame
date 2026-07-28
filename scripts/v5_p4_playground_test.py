"""v5 Phase 4 (guilds + world boss) focused validation on testnet-playground.

Publishes the phase-4 blueprint at pull price 10 so the bounty-pool math is
exactly checkable (each pull feeds pull_price//10 = 1 Ember to the week's
pool). Exercises: guild cost/uniqueness/one-per-identity guards, join and
leave, boss posting guards (owner-only, once per week), the staked-only and
3-per-day fight rules, HP drawdown to the kill, and a pro-rata bounty claim
whose top-guild +25% bonus is verified to the point (pool 4 -> share 5).

Prereqs: wallet-headless on :8000 against the playground node, miner :8035,
operator (>= 7c) + player (>= 45c) wallets started and funded.

Run: python scripts/v5_p4_playground_test.py
Resume: V5P4_BP=<hash> V5P4_NC=<hash> [V5P4_SKIP_SETUP=1] python scripts/v5_p4_playground_test.py
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

BP = os.environ.get("V5P4_BP")
if not BP:
    code = open("blueprint/gacha_arena_v5.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v5p4 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5P4_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 10, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v5p4 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")


def held_cards(wallet):
    out = []
    for uid in sorted(all_uids()):
        b = get_local(f"/wallet/balance?token={uid}", wallet)
        if (b.get("available") or 0) >= 1:
            out.append(uid)
    return out


def reclaimable(wallet, address, uid, label):
    return wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": uid, "amount": 1, "address": address}],
        wallet=wallet, address=address), label)


# guild guard BEFORE any Ember lands
check("guild without ember refused", not wait_exec(
    execute("create_guild", ["The Wolves"], wallet="player", address=PL),
    "create_guild broke (refused)"))

if os.environ.get("V5P4_SKIP_SETUP"):
    my_cards = held_cards("player")
    assert len(my_cards) >= 2, my_cards
    my_cards = my_cards[:2]
else:
    wait_exec(execute("add_template", [0, "Boss Fodder", 0]), "add Boss Fodder|0")
    wait(lambda: call1("get_template_count(0)") == 1, "solo template")
    # four pulls at price 10: the week's bounty pool accrues exactly 4 Ember
    minted = []
    for i in range(4):
        before = all_uids()
        execute("pull", None, [{"type": "deposit", "token": "00", "amount": 10}],
                wallet="player", address=PL)
        got = {}
        wait(lambda: (all_uids() - before) and got.setdefault("uid", (all_uids() - before).pop()),
             f"pull {i} minted")
        minted.append(got["uid"])
        time.sleep(8)
    my_cards = minted[:2]
    for i, u in enumerate(my_cards):
        reclaimable("player", PL, u, f"claim card {i}")
    wait_exec(execute("adopt_player", [PL, 1000, 0, 0, 0, 0]), "adopt PL ember")
    wait_exec(execute("adopt_player", [OP, 1000, 0, 0, 0, 0]), "adopt OP ember")
    wait(lambda: (call1(f'get_ember_balance("{PL}")') or 0) >= 1000, "PL ember credited")

card_a, card_b = my_cards[0], my_cards[1]

# ---- guilds ----
pl_e0 = call1(f'get_ember_balance("{PL}")')
check("guild created", wait_exec(
    execute("create_guild", ["The Wolves"], wallet="player", address=PL), "create The Wolves"))
check("guild view", call1("get_guild(0)") == "The Wolves|1")
check("membership recorded", call1(f'get_member_guild("{PL}")') == 0)
check("500 Ember burned", call1(f'get_ember_balance("{PL}")') == pl_e0 - 500)
check("second banner refused", not wait_exec(
    execute("create_guild", ["Other Band"], wallet="player", address=PL),
    "second guild (refused)"))
check("case-insensitive dupe refused", not wait_exec(
    execute("create_guild", ["the wolves"]), "dupe name (refused)"))
check("join bad id refused", not wait_exec(
    execute("join_guild", [9]), "join guild 9 (refused)"))
check("OP joins", wait_exec(execute("join_guild", [0]), "OP joins The Wolves"))
check("member count 2", call1("get_guild(0)") == "The Wolves|2")
check("OP leaves", wait_exec(execute("leave_guild", None), "OP leaves"))
check("member count 1", call1("get_guild(0)") == "The Wolves|1")
check("leave without banner refused", not wait_exec(
    execute("leave_guild", None), "leave again (refused)"))

# ---- world boss ----
check("fight before post refused", not wait_exec(
    execute("fight_world_boss", [card_a], wallet="player", address=PL),
    "fight unposted boss (refused)"))
check("non-owner post refused", not wait_exec(
    execute("post_world_boss", ["Fake", 100, 1, 1, 1], wallet="player", address=PL),
    "player posts boss (refused)"))
check("boss posted", wait_exec(
    execute("post_world_boss", ["Test Colossus", 100, 1, 1, 1]), "post boss"))
week = call1("get_wb_week()")
boss0 = (call1(f"get_world_boss({week})") or "").split("|")
check("boss view + pool from summons",
      boss0[:6] == ["Test Colossus", "100", "100", "1", "1", "1"] and boss0[6] == "4")
check("duplicate post refused", not wait_exec(
    execute("post_world_boss", ["Again", 100, 1, 1, 1]), "post again (refused)"))

check("unstaked fight refused", not wait_exec(
    execute("fight_world_boss", [card_a], wallet="player", address=PL),
    "fight unstaked (refused)"))
for i, u in enumerate(my_cards):
    wait_exec(execute("stake", None, [{"type": "deposit", "token": u, "amount": 1}],
        wallet="player", address=PL), f"stake card {i}")

# hammer the boss down; 1/1/1 aspects make each round ~90% ours
fights_left = {card_a: 3, card_b: 3}
claim_early_checked = False
for _ in range(6):
    hp = int((call1(f"get_world_boss({week})") or "|1").split("|")[1])
    if hp <= 0:
        break
    card = card_a if fights_left[card_a] > 0 else card_b
    if fights_left[card] <= 0:
        break
    fights_left[card] -= 1
    wait_exec(execute("fight_world_boss", [card], wallet="player", address=PL),
              f"boss fight (hp {hp})")
    if not claim_early_checked:
        claim_early_checked = True
        hp_now = int((call1(f"get_world_boss({week})") or "|1").split("|")[1])
        if hp_now > 0:
            check("claim while standing refused", not wait_exec(
                execute("claim_world_bounty", [week], wallet="player", address=PL),
                "early claim (refused)"))

boss1 = (call1(f"get_world_boss({week})") or "").split("|")
hp_final = int(boss1[1] or 1)
check("boss slain", hp_final == 0)
dmg = call1(f'get_wb_damage({week}, "{PL}")')
check("damage recorded (>= hp0)", (dmg or 0) >= 100)
check("fight after fall refused", not wait_exec(
    execute("fight_world_boss", [card_b], wallet="player", address=PL),
    "fight fallen boss (refused)"))

# sole damager in the top guild: share = pool(4) + 4//4 = 5, exactly
pl_e1 = call1(f'get_ember_balance("{PL}")')
check("bounty claimed", wait_exec(
    execute("claim_world_bounty", [week], wallet="player", address=PL), "claim bounty"))
pl_e2 = call1(f'get_ember_balance("{PL}")')
check("pro-rata + top-guild bonus exact (5)", pl_e2 - pl_e1 == 5)
check("claim flag set", call1(f'get_wb_claimed({week}, "{PL}")') is True)
check("double claim refused", not wait_exec(
    execute("claim_world_bounty", [week], wallet="player", address=PL),
    "claim again (refused)"))

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
