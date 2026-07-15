"""Publish EmberfallArena v3 on testnet-playground and E2E the new surface:
writs (Gauntlet), veterancy XP, delves, daily-trial bonus, cosmetics,
remove_template, and the migration methods.

Prereqs: wallet-headless on :8000 repointed to the playground node with the
local miner on :8035, operator wallet started and funded (faucet drip).

Run: python scripts/v3_playground_test.py
"""
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
NODE = "https://node1.playground.testnet.hathor.network/v1a"
NC = None  # set after create


def post(path, payload):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": "operator"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
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


def execute(method, args=None, actions=None):
    body = {"nc_id": NC, "method": method, "address": OP, "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    return post("/wallet/nano-contracts/execute", body)


def wait_exec(r, label):
    """Wallet 'success' only means submitted. Wait for a block to confirm
    the tx and report whether the nano execution succeeded (not voided)."""
    h = r.get("hash")
    if not h:
        raise SystemExit(f"{label}: submit failed: {r.get('error')}")
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


def dep_card(uid):
    return {"type": "deposit", "token": uid, "amount": 100}


def wd_card(uid):
    return {"type": "withdrawal", "token": uid, "amount": 100, "address": OP}


checks = []


def check(label, ok):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label, flush=True)


# ---------------------------------------------------------------- publish
code = open("blueprint/gacha_arena_v3.py", encoding="utf-8").read()
r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
BP = r.get("hash")
print("v3 blueprint:", BP, r.get("error", ""), flush=True)
assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}").get("name") == "EmberfallArena",
     "blueprint confirmed")

r = post("/wallet/nano-contracts/create", {
    "blueprint_id": BP, "address": OP,
    "data": {"args": [OP, 5, 6000, 3000, 900, 100, 60],
             "actions": [dep_htr(2)]}})
NC = r.get("hash")
print("v3 contract:", NC, r.get("error", ""), flush=True)
assert NC, r
wait(lambda: ncstate("fields[]=gems_uid").get("success"), "contract confirmed")
GEMS = ncstate("fields[]=gems_uid")["fields"]["gems_uid"]["value"]
print("GEMS:", GEMS, flush=True)

# ------------------------------------------------------------- configure
for tier, name in [(0, "Moss Snail"), (0, "Tin Knight"), (1, "Ember Fox"),
                   (2, "Void Kraken"), (3, "Genesis Phoenix")]:
    print("add_template", name, execute("add_template", [tier, name]).get("success"), flush=True)
    time.sleep(2)
for name, v, b, g in [("The Shieldbreaker", 8, 3, 5), ("The Hollow King", 40, 40, 40)]:
    print("add_writ", name, execute("add_writ", [name, v, b, g]).get("success"), flush=True)
    time.sleep(2)
wait(lambda: call1("get_writ_count()") == 2 and call1("get_template_count(0)") == 2,
     "templates + writs registered")
check("get_writ format", call1("get_writ(0)") == "The Shieldbreaker|8|3|5")

# remove_template: add a throwaway, remove it, count returns
n0 = call1("get_template_count(0)")
execute("add_template", [0, "Throwaway"])
wait(lambda: call1("get_template_count(0)") == n0 + 1, "throwaway added")
execute("remove_template", [0, n0])
wait(lambda: call1("get_template_count(0)") == n0, "throwaway removed")
check("remove_template works", True)

# settable tables share the list-assignment mechanism: prove it on-chain
execute("set_mine_rates", [2, 6, 20, 80])
wait(lambda: call1("get_mine_rate(3)") == 80, "mine rates set")
execute("set_mine_rates", [1, 3, 10, 40])
wait(lambda: call1("get_mine_rate(3)") == 40, "mine rates restored")
check("settable economy tables work", True)

# ------------------------------------------------------------------ pull
before = all_uids()
r = execute("pull", None, [dep_htr(5)])
print("pull ->", r.get("success"), r.get("error", ""), flush=True)
CARD = None


def found_card():
    global CARD
    new = [u for u in all_uids() - before if u != GEMS]
    if new:
        CARD = new[0]
        return True
    return False


wait(found_card, "card minted")
print("card:", CARD, flush=True)
aspects = call1(f'get_card_aspects("{CARD}")')
check("aspects view has 8 fields", isinstance(aspects, str) and len(aspects.split("|")) == 8)
tier = call1(f'get_card_tier("{CARD}")')
print("tier:", tier, "aspects:", aspects, flush=True)

now = int(time.time())
trial = call1(f"get_trial_today({now})")
print("today's trial kind:", trial, flush=True)
if trial == 0:
    check("pull satisfied today's trial", call1(f'get_trial_done("{OP}", {now})') is True)

# --------------------------------------------------------- claim + stake
check("claim executed", wait_exec(execute("claim_card", None, [wd_card(CARD)]), "claim_card"))
check("stake executed", wait_exec(execute("stake", None, [dep_card(CARD)]), "stake"))
check("staker recorded", call1(f'get_staker("{CARD}")') is not None)

# fund the ledger via the migration credit so fee-bearing paths can't be
# starved (temper needs cost headroom to prove the delve lock, cosmetics 50+)
wait_exec(execute("adopt_player", [OP, 500, 0, 0, 0, 0]), "adopt_player (gems float)")

# ---------------------------------------------------------------- writs
gems0 = call1(f'get_gems_balance("{OP}")')
print("gems before fights:", gems0, flush=True)
victories = 0
for i in range(3):
    ok = wait_exec(execute("fight_writ", [CARD, 0, 0]), f"fight_writ #{i + 1}")
    check(f"fight #{i + 1} executed", ok)
    if call1(f'get_gauntlet_cleared("{OP}")') & 1:
        victories += 1
check("daily attempt cap enforced",
      not wait_exec(execute("fight_writ", [CARD, 0, 0]), "fight_writ #4 (over cap)"))
gems1 = call1(f'get_gems_balance("{OP}")')
cleared = call1(f'get_gauntlet_cleared("{OP}")')
print("gems after fights:", gems1, "cleared mask:", cleared, "victories:", victories, flush=True)
check("entry fees moved the ledger", gems1 != gems0)
if cleared & 1:
    check("first-clear deed granted (bit 6)", call1(f'get_deed_flags("{OP}")') & (1 << 6))
    check("tier gating on writ 1 Dire",
          not wait_exec(execute("fight_writ", [CARD, 1, 1]), "fight_writ writ1 Dire (gated)"))
    now2 = int(time.time())
    if call1(f"get_trial_today({now2})") == 7:
        check("writ victory satisfied today's trial", call1(f'get_trial_done("{OP}", {now2})') is True)
asp2 = call1(f'get_card_aspects("{CARD}")').split("|")
print("aspects after fights:", "|".join(asp2), flush=True)
check("XP recorded on the card", int(asp2[5]) >= 1)

# ---------------------------------------------------------------- delves
# stretch the delve to its max so "early" survives block latency, prove the
# locks, then shrink it with the setter (also under test) and finish
wait_exec(execute("set_delve_seconds", [172_800]), "set_delve_seconds max")
check("begin_delve executed", wait_exec(execute("begin_delve", [CARD]), "begin_delve"))
check("early claim refused", not wait_exec(execute("claim_delve", [CARD]), "claim_delve (early)"))
check("temper blocked while delving", not wait_exec(execute("temper", [CARD, 0]), "temper (delving)"))
check("unstake blocked while delving",
      not wait_exec(execute("unstake", None, [wd_card(CARD)]), "unstake (delving)"))
wait_exec(execute("set_delve_seconds", [60]), "set_delve_seconds 60")
print("waiting out the delve (60s)...", flush=True)
time.sleep(70)
shards0 = call1(f'get_shards("{OP}")')
gemsd0 = call1(f'get_gems_balance("{OP}")')
check("claim_delve executed", wait_exec(execute("claim_delve", [CARD]), "claim_delve"))
shards1 = call1(f'get_shards("{OP}")')
gemsd1 = call1(f'get_gems_balance("{OP}")')
print(f"delve outcome: gems {gemsd0}->{gemsd1}, shards {shards0}->{shards1}", flush=True)
check("temper works again after the delve",
      wait_exec(execute("temper", [CARD, 0]), "temper (after delve)"))

# ------------------------------------------------------------- cosmetics
gems_now = call1(f'get_gems_balance("{OP}")')
if gems_now >= 50:
    check("buy_cosmetic executed",
          wait_exec(execute("buy_cosmetic", [CARD, 1, 3]), "buy_cosmetic"))
    check("cosmetic stored on card",
          (call1(f'get_card_cosmetics("{CARD}")') >> 8) & 0xFF == 3)
else:
    print("skipping cosmetics (ledger", gems_now, "too low)", flush=True)

# ------------------------------------------------------------- migration
fake = secrets.token_bytes(32).hex()
attrs = 10 | (10 << 12) | (10 << 24)
check("adopt_card executed",
      wait_exec(execute("adopt_card", [fake, "Legacy Hero", 1, 30, attrs, 2]), "adopt_card"))
check("adopted card readable", call1(f'get_card_tier("{fake}")') == 1)
check("adopted card wins carried", call1(f'get_card_wins("{fake}")') == 2)

renown0 = call1(f'get_renown("{OP}")')
check("adopt_player executed",
      wait_exec(execute("adopt_player", [OP, 100, 50, 8, 1, 4]), "adopt_player"))
check("adopted renown credited", call1(f'get_renown("{OP}")') == renown0 + 50)
check("adopted deeds masked in (bit 3, no bounty rerun)",
      call1(f'get_deed_flags("{OP}")') & 8 == 8)

# ------------------------------------------------------------------ done
print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nblueprint: {BP}\ncontract:  {NC}\nGEMS:      {GEMS}\ncard:      {CARD}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
