"""Smoke-test the live v3 arena on testnet-india: pull, claim, stake,
fight writ 0 (Grim), begin a delve. Run: python scripts/v3_india_smoke.py"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
NODE = "https://node1.testnet.hathor.network/v1a"
NC = json.load(open("scripts/v3_ids.json"))["nc"]
GEMS = json.load(open("scripts/v3_ids.json"))["gems"]


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
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def wait_exec(r, label, tries=40):
    h = r.get("hash")
    if not h:
        raise SystemExit(f"{label}: submit failed: {r.get('error')}")
    for _ in range(tries):
        meta = (get(f"{NODE}/transaction?id={h}").get("meta") or {})
        if meta.get("voided_by"):
            print("NCFAIL", label, flush=True)
            return False
        if meta.get("first_block"):
            time.sleep(6)
            meta = (get(f"{NODE}/transaction?id={h}").get("meta") or {})
            ok = not meta.get("voided_by")
            print(("EXEC " if ok else "NCFAIL ") + label, flush=True)
            return ok
        time.sleep(5)
    raise SystemExit(f"TIMEOUT: {label}")


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    d = get(f"{NODE}/nano_contract/state?id={NC}&{qs}")
    return (d.get("calls") or {}).get(c, {}).get("value")


def execute(method, args=None, actions=None):
    body = {"nc_id": NC, "method": method, "address": OP, "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    return post("/wallet/nano-contracts/execute", body)


def all_uids():
    d = get(f"{NODE}/nano_contract/state?id={NC}&balances[]=__all__")
    return set((d.get("balances") or {}).keys())


before = all_uids()
assert wait_exec(execute("pull", None, [{"type": "deposit", "token": "00", "amount": 100}]), "pull")
card = None
for _ in range(20):
    new = [u for u in all_uids() - before if u != GEMS]
    if new:
        card = new[0]
        break
    time.sleep(5)
print("card:", card, call1(f'get_card_name("{card}")'), "tier", call1(f'get_card_tier("{card}")'), flush=True)
assert wait_exec(execute("claim_card", None,
    [{"type": "withdrawal", "token": card, "amount": 100, "address": OP}]), "claim_card")
assert wait_exec(execute("stake", None,
    [{"type": "deposit", "token": card, "amount": 100}]), "stake")
gems0 = call1(f'get_gems_balance("{OP}")')
won = wait_exec(execute("fight_writ", [card, 0, 0]), "fight_writ writ0 Grim")
gems1 = call1(f'get_gems_balance("{OP}")')
asp = call1(f'get_card_aspects("{card}")')
print(f"fight executed: gems {gems0}->{gems1}, aspects {asp}", flush=True)
assert won, "fight_writ execution failed"
assert wait_exec(execute("begin_delve", [card]), "begin_delve")
print("delving:", call1(f'get_delve_since("{card}")') > 0, flush=True)
print("\nSMOKE TEST PASSED — v3 live on testnet-india")
