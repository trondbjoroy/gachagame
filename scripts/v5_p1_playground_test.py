"""v5 Phase 1 (keyword abilities) focused validation on testnet-playground.

Deterministic ability control: exactly one template exists at pull time, so
each minted card carries the keyword under test; templates are swapped
between pulls. Asserts the deterministic effects (stamping, name encoding,
add_template validation, Plunderer rake, Scholar XP, adopt ability) and
executes the probabilistic hooks (round boosts, Stancebreaker) for
no-revert coverage.

Prereqs: wallet-headless on :8000 against the playground node, miner :8035,
operator + player wallets started and funded.

Run: python scripts/v5_p1_playground_test.py
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

BP = os.environ.get("V5_BP")
if not BP:
    code = open("blueprint/gacha_arena_v5.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v5 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v5 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")

# template validation: ability out of range is refused
check("ability 10 refused", not wait_exec(
    execute("add_template", [0, "Bad Egg", 10]), "add_template ability=10 (refused)"))


def set_solo_template(name, ability):
    """Make (name, ability) the ONLY tier-0 template."""
    n = call1("get_template_count(0)") or 0
    while n > 0:
        wait_exec(execute("remove_template", [0, 0]), f"remove template ({n} left)")
        n -= 1
    wait_exec(execute("add_template", [0, name, ability]), f"add {name}|{ability}")
    wait(lambda: call1("get_template_count(0)") == 1, f"solo template {name}")


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


# card A: a Plunderer for the player
set_solo_template("Test Drake", 8)
card_a = pull_claim("player", PL, "Plunderer card")
check("Plunderer stamped", call1(f'get_card_ability("{card_a}")') == 8)
check("name clean of encoding", call1(f'get_card_name("{card_a}")') == "Test Drake")

# card B: a Scholar for the operator
set_solo_template("Test Flame", 9)
card_b = pull_claim("operator", OP, "Scholar card")
check("Scholar stamped", call1(f'get_card_ability("{card_b}")') == 9)

# Ember for wagers
wait_exec(execute("adopt_player", [PL, 200, 0, 0, 0, 0]), "adopt PL ember")
wait_exec(execute("adopt_player", [OP, 200, 0, 0, 0, 0]), "adopt OP ember")

# wagered duel: Plunderer (challenger) vs Scholar (acceptor)
owner_ember0 = call1(f'get_ember_balance("{OP}")')
pl_ember0 = call1(f'get_ember_balance("{PL}")')
check("create wagered duel", wait_exec(execute("create_duel", [40, ""],
    [{"type": "deposit", "token": card_a, "amount": 1}],
    wallet="player", address=PL), "create_duel w40"))
d = call1("get_duel_count()") - 1
check("settle at accept", wait_exec(execute("accept_duel", [d, -1],
    [{"type": "deposit", "token": card_b, "amount": 1}],
    wallet="operator", address=OP), "accept_duel"))

pl_ember1 = call1(f'get_ember_balance("{PL}")')
owner_ember1 = call1(f'get_ember_balance("{OP}")')
plunderer_won = pl_ember1 > pl_ember0 - 40
pot = 80
rake = pot * 500 // 10_000  # 4
# the winner may also collect the first-win deed bounty (+25) and the
# daily-trial bonus (+5): accept base, base+25, base+30
if plunderer_won:
    # full pot, no rake anywhere
    check("Plunderer took the whole pot (no rake)",
          pl_ember1 - pl_ember0 - (pot - 40) in (0, 25, 30))
    check("no rake reached the Crown",
          owner_ember1 - owner_ember0 == -40)
    print(f"  (Plunderer won: pl {pl_ember0}->{pl_ember1}, op {owner_ember0}->{owner_ember1})", flush=True)
else:
    # normal rake path; OP is also the Crown so wager -40, pot +76, rake +4
    check("normal rake when the Plunderer loses",
          owner_ember1 - owner_ember0 - (-40 + (pot - rake) + rake) in (0, 25, 30))
    print(f"  (Scholar won: pl {pl_ember0}->{pl_ember1}, op {owner_ember0}->{owner_ember1})", flush=True)

# Scholar XP: winner 8 (vs 4), loser 4 (vs 2). card_b is the Scholar.
xp_b = xp_of(card_b)
xp_a = xp_of(card_a)
if plunderer_won:
    check("Scholar loser XP doubled (4)", xp_b == 4)
    check("normal winner XP (4)", xp_a == 4)
else:
    check("Scholar winner XP doubled (8)", xp_b == 8)
    check("normal loser XP (2)", xp_a == 2)

# reclaim both cards
wait_exec(execute("claim_card", None,
    [{"type": "withdrawal", "token": card_a, "amount": 1, "address": PL}],
    wallet="player", address=PL), "reclaim card A")
wait_exec(execute("claim_card", None,
    [{"type": "withdrawal", "token": card_b, "amount": 1, "address": OP}],
    wallet="operator", address=OP), "reclaim card B")

# stance duel including a Stancebreaker: exercises the edge-void path
set_solo_template("Test Relic", 7)
card_c = pull_claim("operator", OP, "Stancebreaker card")
salt = "v5-p1-salt"
commit = hashlib.sha3_256(f"1:{salt}".encode()).hexdigest()
check("sealed duel vs Stancebreaker created", wait_exec(execute("create_duel", [0, commit],
    [{"type": "deposit", "token": card_a, "amount": 1}],
    wallet="player", address=PL), "create sealed"))
d2 = call1("get_duel_count()") - 1
check("Stancebreaker answers", wait_exec(execute("accept_duel", [d2, 2],
    [{"type": "deposit", "token": card_c, "amount": 1}],
    wallet="operator", address=OP), "accept sealed"))
check("reveal settles (edge-void path executed)", wait_exec(
    execute("reveal_duel", [d2, 1, salt], wallet="player", address=PL), "reveal"))

# adopt_card carries an ability
fake_uid = "ff" * 32
check("adopt_card with ability", wait_exec(
    execute("adopt_card", [fake_uid, "Old Friend", 1, 40, 0, 0, 6]),
    "adopt_card ability=6"))
check("adopted ability readable", call1(f'get_card_ability("{fake_uid}")') == 6)

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
