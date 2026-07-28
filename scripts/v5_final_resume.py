"""Resume the v5 final check: phases 4 and 5 plus the bet guard.

The first run passed everything through phase 3 and then the local
wallet-headless fell out of sync ("Wallet is not ready"), which failed the
rest as a block. Nothing to do with the contract, so this picks up on the
SAME instance and runs only what is left, recovering whatever cards the
interrupted run left in the contract.

Run: V5_BP=<hash> V5_NC=<hash> python scripts/v5_final_resume.py
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = os.environ["V5_NC"]
BP = os.environ["V5_BP"]


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


def wlocal(path, wallet):
    req = urllib.request.Request("http://localhost:8000" + path,
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def ready(wallet):
    try:
        return wlocal("/wallet/status", wallet).get("statusMessage") == "Ready"
    except Exception:
        return False


def wait_ready(wallet, tries=60):
    for _ in range(tries):
        if ready(wallet):
            return True
        time.sleep(5)
    return False


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
    for attempt in range(5):
        if not ready(wallet):
            print(f"  {wallet} wallet resyncing…", flush=True)
            wait_ready(wallet)
        try:
            r = post("/wallet/nano-contracts/execute", body, wallet)
        except OSError as e:
            r = {"error": f"transport: {e}"}
        if r.get("hash"):
            return r
        print(f"  retry {attempt + 1} {method}: {json.dumps(r)[:120]}", flush=True)
        time.sleep(15)
    return r


def wait_exec(r, label):
    h = r.get("hash")
    if not h:
        print(f"SUBMITFAIL {label}: {r.get('error') or r.get('message')}", flush=True)
        return None                      # unknown, not "refused"
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
    checks.append((label, ok is True))
    print(("PASS " if ok is True else "FAIL ") + label, flush=True)


ADDR = {"operator": wlocal("/wallet/address?index=0", "operator")["address"],
        "player": wlocal("/wallet/address?index=0", "player")["address"]}
OP, PL = ADDR["operator"], ADDR["player"]
for w in ("operator", "player"):
    print(w, "ready:", wait_ready(w), flush=True)

# ---- recover the cards the interrupted run left behind ----
held, staked, pending = [], [], []
for uid in sorted(all_uids()):
    if call1(f'get_staker("{uid}")') == PL:
        staked.append(uid)
    elif call1(f'get_pending_owner("{uid}")') == PL:
        pending.append(uid)
    else:
        b = wlocal(f"/wallet/balance?token={uid}", "player")
        if (b.get("available") or 0) >= 1:
            held.append(uid)
print(f"player: {len(held)} in hand, {len(staked)} mining, {len(pending)} waiting", flush=True)
for uid in staked:
    wait_exec(execute("unstake", None,
        [{"type": "withdrawal", "token": uid, "amount": 1, "address": PL}],
        wallet="player", address=PL), f"recall {uid[:8]}")
    held.append(uid)
for uid in pending:
    wait_exec(execute("claim_card", None,
        [{"type": "withdrawal", "token": uid, "amount": 1, "address": PL}],
        wallet="player", address=PL), f"claim {uid[:8]}")
    held.append(uid)
assert len(held) >= 2, f"need two champions in hand, have {len(held)}"
c1, c2 = held[0], held[1]

# ---------------------------------------------------------------- phase 4
already = call1(f'get_member_guild("{PL}")')
if already is None or already < 0:
    check("guild raised", wait_exec(
        execute("create_guild", ["Final Check"], wallet="player", address=PL), "create_guild"))
else:
    check("guild raised", True)
check("guild view", (call1("get_guild(0)") or "").startswith("Final Check|"))
check("member recorded", call1(f'get_member_guild("{PL}")') == 0)

wk_now = int(time.time()) // 604_800
if not (call1(f"get_world_boss({wk_now})") or ""):
    check("world boss posted", wait_exec(
        execute("post_world_boss", ["Check Colossus", 100, 1, 1, 1]), "post_world_boss"))
else:
    check("world boss posted", True)
wk = call1("get_wb_week()")
wait_exec(execute("stake", None, [{"type": "deposit", "token": c1, "amount": 1}],
                  wallet="player", address=PL), "stake for the colossus")
check("world boss takes a hit", wait_exec(
    execute("fight_world_boss", [c1], wallet="player", address=PL), "fight_world_boss"))
check("damage recorded", (call1(f'get_wb_damage({wk}, "{PL}")') or 0) > 0)
boss = (call1(f"get_world_boss({wk})") or "").split("|")
print(f"  boss hp {boss[1]}/{boss[2]}, pool {boss[6]}, top guild {boss[8]}", flush=True)
wait_exec(execute("unstake", None,
    [{"type": "withdrawal", "token": c1, "amount": 1, "address": PL}],
    wallet="player", address=PL), "recall from the colossus")

# ---------------------------------------------------------------- phase 5
start = int(time.time()) + 300
check("tournament scheduled", wait_exec(
    execute("create_tournament", ["Check Cup", 20, 4, start, 90, 100]), "create_tournament"))
t = call1("get_tournament_count()") - 1
check("tournament view", (call1(f"get_tournament({t})") or "").startswith("Check Cup|0|20|100|4|0"))
check("seat taken", wait_exec(
    execute("enter_tournament", [t], [{"type": "deposit", "token": c2, "amount": 1}],
            wallet="player", address=PL), "enter_tournament"))
check("seat count 1", (call1(f"get_tournament({t})") or "").split("|")[5] == "1")
check("seat given up", wait_exec(
    execute("leave_tournament", [t], wallet="player", address=PL), "leave_tournament"))

# ------------------------------------------------- the v4.1 fold: bet guard
opheld = [u for u in sorted(all_uids())
          if (wlocal(f"/wallet/balance?token={u}", "operator").get("available") or 0) >= 1]
if not opheld:
    print("the Crown holds no champion; skipping the bet guard", flush=True)
else:
    check("duel posts for the bet guard", wait_exec(
        execute("create_duel", [10, ""],
                [{"type": "deposit", "token": opheld[0], "amount": 1}]), "create_duel (OP)"))
    d = call1("get_duel_count()") - 1
    check("a spectator backs it", wait_exec(
        execute("place_bet", [d, 0, 5], wallet="player", address=PL), "place_bet"))
    check("get_bet reports the stake", (call1(f'get_bet({d}, "{PL}")') or "").startswith("5|"))
    r = wait_exec(execute("accept_duel", [d, -1],
        [{"type": "deposit", "token": c2, "amount": 1}], wallet="player", address=PL),
        "accept_duel by the bettor")
    # only a CONFIRMED-and-voided tx proves the contract refused it
    check("a bettor cannot then fight it", r is False)

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL REMAINING CHECKS PASSED")
