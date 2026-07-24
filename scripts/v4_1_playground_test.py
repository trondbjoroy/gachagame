"""Focused validation of the v4.1 blueprint changes on testnet-playground:
bet-then-accept refusal, the get_bet view, and syscall.log outcome lines
surfacing through the node's logs API. (The unchanged surface was fully
validated in the v4 runs.)

Prereqs: wallet-headless on :8000 repointed to the playground node with the
local miner on :8035, operator + player wallets started and funded.

Run: python scripts/v4_1_playground_test.py
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
BET = waddr("operator", 2)

BP = os.environ.get("V41_BP")
if not BP:
    code = open("blueprint/gacha_arena_v4_1.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("v4.1 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V41_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v4.1 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")

if not call1("get_template_count(0)"):
    wait_exec(execute("add_template", [0, "Test Moth"]), "add_template")
wait(lambda: call1("get_template_count(0)") == 1, "template registered")


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


card_pl = pull_claim("player", PL, "player card")
card_op = pull_claim("operator", OP, "operator card")

wait_exec(execute("adopt_player", [PL, 100, 0, 0, 0, 0]), "adopt PL ember")
wait_exec(execute("adopt_player", [OP, 100, 0, 0, 0, 0]), "adopt OP ember")
wait_exec(execute("adopt_player", [BET, 100, 0, 0, 0, 0]), "adopt BET ember")

# player posts a wagered duel
check("create duel", wait_exec(execute("create_duel", [5, ""],
    [{"type": "deposit", "token": card_pl, "amount": 1}],
    wallet="player", address=PL), "create_duel"))
d = call1("get_duel_count()") - 1

# BET backs the challenger, then tries to become the acceptor
check("spectator bet placed", wait_exec(
    execute("place_bet", [d, 0, 20], wallet="operator", address=BET), "place_bet"))
check("get_bet shows the stake", call1(f'get_bet({d}, "{BET}")') == "20|0")
check("get_bet empty for a stranger", call1(f'get_bet({d}, "{OP}")') == "0|0")
# the caller address (BET) is what the guard judges; the card UTXO comes
# from the same headless wallet either way
check("bettor refused as acceptor", not wait_exec(
    execute("accept_duel", [d, -1],
            [{"type": "deposit", "token": card_op, "amount": 1}],
            wallet="operator", address=BET), "bettor accept (refused)"))
check("clean acceptor settles the duel", wait_exec(
    execute("accept_duel", [d, -1],
            [{"type": "deposit", "token": card_op, "amount": 1}],
            wallet="operator", address=OP), "operator accept"))

# the self.log entry must surface through the node's logs API
def duel_log_found():
    d2 = get(f"{NODE}/nano_contract/logs?id={NC}")
    txt = json.dumps(d2)
    return "duel_settled" in txt and "winner_side" in txt


wait(duel_log_found, "self.log visible in logs API", tries=12, pause=5)
check("self.log outcome entry surfaces via logs API", duel_log_found())

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
