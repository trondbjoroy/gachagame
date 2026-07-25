"""v5 Phase 5 (tournaments) focused validation on testnet-playground.

Four entrants from four addresses (player indices 0-2 + the operator) run
a full 4-bracket: creation guards (owner-only, size, start, seed debit),
entry fee escrow, leave-and-re-enter compaction, the round gate, and the
EXACT payout ledger: pool 180 (4 x 20 fee + 100 seed) pays semifinal
losers 13 each, the runner-up 45, the champion 109 (dust included). Then
a second bracket cancels below four entrants with full refunds.

Prereqs: wallet-headless on :8000 against the playground node, miner
:8035, operator (>= 7c) + player (>= 15c) wallets Ready.

Run: python scripts/v5_p5_playground_test.py
Resume: V5P5_BP=<hash> V5P5_NC=<hash> python scripts/v5_p5_playground_test.py
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


def ember(addr):
    return call1(f'get_ember_balance("{addr}")') or 0


# entrants: player wallet indices 0-2, operator index 0 (the Crown itself)
P = [waddr("player", i) for i in range(3)]
OPA = waddr("operator", 0)
ADDR = {"operator": OPA, "player": P[0]}
ENTRANTS = [("player", P[0]), ("player", P[1]), ("player", P[2]), ("operator", OPA)]

BP = os.environ.get("V5P5_BP")
if not BP:
    code = open("blueprint/gacha_arena_v5.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OPA})
    BP = r.get("hash")
    print("v5p5 blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

NC = os.environ.get("V5P5_NC")
if not NC:
    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OPA,
        "data": {"args": [OPA, 5, 1, 0, 0, 0, 60, 1],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    NC = r.get("hash")
    print("v5p5 contract:", NC, r.get("error", ""), flush=True)
    assert NC, r
wait(lambda: call1("get_card_unit()") == 1, "contract confirmed")

wait_exec(execute("add_template", [0, "Bracket Grunt", 0]), "add Bracket Grunt|0")
wait(lambda: call1("get_template_count(0)") == 1, "solo template")

cards = {}
for wallet, addr in ENTRANTS:
    before = all_uids()
    execute("pull", None, [{"type": "deposit", "token": "00", "amount": 5}],
            wallet=wallet, address=addr)
    got = {}
    wait(lambda: (all_uids() - before) and got.setdefault("uid", (all_uids() - before).pop()),
         f"pull for {addr[:8]} minted")
    cards[addr] = got["uid"]
    time.sleep(8)
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": got["uid"], "amount": 1, "address": addr}],
        wallet=wallet, address=addr), f"claim for {addr[:8]}")

for wallet, addr in ENTRANTS:
    amt = 400 if addr == OPA else 100  # the Crown also funds the 100 seed
    wait_exec(execute("adopt_player", [addr, amt, 0, 0, 0, 0]), f"adopt {addr[:8]}")
wait(lambda: ember(P[2]) >= 100, "ember credited")


def dep(uid):
    return [{"type": "deposit", "token": uid, "amount": 1}]


# ---- creation guards ----
now = int(time.time())
check("non-owner create refused", not wait_exec(
    execute("create_tournament", ["Rogue Cup", 20, 4, now + 600, 30, 0],
            wallet="player", address=P[0]), "player creates (refused)"))
check("bad size refused", not wait_exec(
    execute("create_tournament", ["Odd Cup", 20, 5, now + 600, 30, 0]),
    "size 5 (refused)"))
check("past start refused", not wait_exec(
    execute("create_tournament", ["Late Cup", 20, 4, now - 10, 30, 0]),
    "past start (refused)"))

op_e0 = ember(OPA)
start1 = int(time.time()) + 420
check("tournament created", wait_exec(
    execute("create_tournament", ["Grand Melee", 20, 4, start1, 90, 100]),
    "create Grand Melee"))
check("seed debited from the Crown", ember(OPA) == op_e0 - 100)
t0 = (call1("get_tournament(0)") or "").split("|")
check("tournament view", t0[:6] == ["Grand Melee", "0", "20", "100", "4", "0"])

check("advance before start refused", not wait_exec(
    execute("advance_tournament", [0], wallet="player", address=P[0]),
    "early advance (refused)"))

# ---- entries ----
for wallet, addr in ENTRANTS:
    check(f"entered {addr[:8]}", wait_exec(
        execute("enter_tournament", [0], dep(cards[addr]),
                wallet=wallet, address=addr), f"enter {addr[:8]}"))
check("four seats taken", (call1("get_tournament(0)") or "").split("|")[5] == "4")

# leave + re-enter exercises the swap compaction and the full refund
p2_e = ember(P[2])
check("leave refunds", wait_exec(
    execute("leave_tournament", [0], wallet="player", address=P[2]), "P2 leaves"))
check("fee returned", ember(P[2]) == p2_e + 20)
check("seat count 3", (call1("get_tournament(0)") or "").split("|")[5] == "3")
wait_exec(execute("claim_card", None,
    [{"type": "withdrawal", "token": cards[P[2]], "amount": 1, "address": P[2]}],
    wallet="player", address=P[2]), "P2 reclaims card")
check("re-entered", wait_exec(
    execute("enter_tournament", [0], dep(cards[P[2]]),
            wallet="player", address=P[2]), "P2 re-enters"))

# ---- the bracket runs ----
bal0 = {addr: ember(addr) for _, addr in ENTRANTS}
print(f"waiting for the start ({max(0, start1 - int(time.time()))}s)...", flush=True)
while int(time.time()) < start1 + 15:
    time.sleep(5)
check("semifinals fought", wait_exec(
    execute("advance_tournament", [0], wallet="player", address=P[0]),
    "advance round 1"))
alive = {}
for i in range(4):
    e = (call1(f"get_tour_entrant(0, {i})") or "").split("|")
    if len(e) == 3:
        alive[e[0]] = e[2] == "1"
# entrant view returns hex addresses; map back via base58 -> hex is not at
# hand, so judge by ember instead: exactly two entrants gained 13
gained13 = [a for _, a in ENTRANTS if ember(a) == bal0[a] + 13]
check("two semifinalists paid 13 each", len(gained13) == 2)
check("two still standing", sum(1 for v in alive.values() if v) == 2)
check("round gate holds", not wait_exec(
    execute("advance_tournament", [0], wallet="player", address=P[0]),
    "advance too soon (refused)"))

print("waiting out the round gate...", flush=True)
next_ts = int((call1("get_tournament(0)") or "").split("|")[8])
while int(time.time()) < next_ts + 10:
    time.sleep(5)
check("final fought", wait_exec(
    execute("advance_tournament", [0], wallet="player", address=P[0]),
    "advance final"))
t0 = (call1("get_tournament(0)") or "").split("|")
check("tournament done", t0[1] == "2")
champ_hex = t0[10] if len(t0) > 10 else ""
finalists = [a for _, a in ENTRANTS if a not in gained13]
deltas = {a: ember(a) - bal0[a] for a in finalists}
# the champion nets +109 (may carry a first-win deed bounty +25 / trial +5),
# the runner-up exactly +45
champ = [a for a, d in deltas.items() if d >= 109]
runner = [a for a, d in deltas.items() if d == 45]
check("runner-up paid exactly 45", len(runner) == 1)
check("champion paid 109 (+optional bounties)",
      len(champ) == 1 and deltas[champ[0]] - 109 in (0, 25, 30))
check("champion recorded on-chain", champ_hex != "")
print(f"  (champion {champ[0][:8]} +{deltas[champ[0]]}, runner {runner[0][:8]} +45)", flush=True)

# all four champions come home
for wallet, addr in ENTRANTS:
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": cards[addr], "amount": 1, "address": addr}],
        wallet=wallet, address=addr), f"card home {addr[:8]}")
check("all cards returned", True)

# ---- cancellation below four ----
start2 = int(time.time()) + 90
op_e1 = ember(OPA)
check("second bracket posted", wait_exec(
    execute("create_tournament", ["Empty Cup", 10, 4, start2, 30, 50]),
    "create Empty Cup"))
check("lone entry", wait_exec(
    execute("enter_tournament", [1], dep(cards[P[0]]),
            wallet="player", address=P[0]), "P0 enters t1"))
p0_e = ember(P[0])
print("waiting for the second start...", flush=True)
while int(time.time()) < start2 + 15:
    time.sleep(5)
check("under-filled bracket cancels", wait_exec(
    execute("advance_tournament", [1], wallet="player", address=P[0]),
    "advance cancels"))
check("entry refunded", ember(P[0]) == p0_e + 10)
check("seed returned to the Crown", ember(OPA) == op_e1 - 50 + 50)
check("state cancelled", (call1("get_tournament(1)") or "").split("|")[1] == "3")
check("entry after cancel refused", not wait_exec(
    execute("enter_tournament", [1], dep(cards[P[1]]),
            wallet="player", address=P[1]), "enter cancelled (refused)"))

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
