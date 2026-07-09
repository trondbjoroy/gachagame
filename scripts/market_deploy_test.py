"""Deploy CardMarket and run the full buy/sell/trade test. Prints MARKET_IDS line."""
import json, time, urllib.request, urllib.error

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
PL = "WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE"
GAME = "00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8"
NODE = "https://node1.playground.testnet.hathor.network/v1a"
DAGGER = "c811b42df80d13225aeed4d7f5a16eb6217eae1f70456343aa078638d06e347f"
GOLEM = "0d8af8ca08bcc0a290e5290f2f5a5be6b8bd3f5a06c85fcafeee1acb537bc1af"

def post(path, wallet, payload):
    req = urllib.request.Request("http://localhost:8000" + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": wallet})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def ex(wallet, addr, nc, method, args=None, actions=None):
    body = {"nc_id": nc, "method": method, "address": addr, "data": {}}
    if args is not None: body["data"]["args"] = args
    if actions is not None: body["data"]["actions"] = actions
    r = post("/wallet/nano-contracts/execute", wallet, body)
    print(method, "->", r.get("success"), (r.get("error") or "")[:80], flush=True)
    return r

def state(nc, qs):
    try:
        with urllib.request.urlopen(f"{NODE}/nano_contract/state?id={nc}&{qs}", timeout=20) as r:
            return json.loads(r.read())
    except Exception:
        return {}

def wait(fn, label, tries=40):
    for _ in range(tries):
        time.sleep(12)
        if fn():
            print("OK:", label, flush=True)
            return
    raise SystemExit("TIMEOUT: " + label)

def dep(t, n=100): return {"type": "deposit", "token": t, "amount": n}
def wd(t, a, n=100): return {"type": "withdrawal", "token": t, "amount": n, "address": a}

code = open("../blueprint/card_market.py", encoding="utf-8").read()
r = post("/wallet/nano-contracts/create-on-chain-blueprint", "operator", {"code": code, "address": OP})
BP = r["hash"]; print("market blueprint:", BP, flush=True)
wait(lambda: state(GAME, "fields[]=total_pulls") and json.loads(json.dumps(
    __import__("urllib.request", fromlist=["r"]) and True)) or _bp_ok(), "bp", 1) if False else None

def bp_ok():
    try:
        with urllib.request.urlopen(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}", timeout=20) as r:
            return json.loads(r.read()).get("name") == "EmberfallCardMarket"
    except Exception:
        return False
wait(bp_ok, "blueprint confirmed")

r = post("/wallet/nano-contracts/create", "operator", {
    "blueprint_id": BP, "address": OP, "data": {"args": [OP, GAME, 200]}})
MKT = r["hash"]; print("market contract:", MKT, flush=True)
wait(lambda: state(MKT, "calls[]=get_listing_count()").get("success"), "market confirmed")

# R2: player lists dagger for 3 cents
ex("player", PL, MKT, "list_card", args=[3], actions=[dep(DAGGER)])
wait(lambda: "open" in str(state(MKT, "calls[]=get_listing(0)")), "listing open")

# R3: operator buys it + claims fused golem from the game
ex("operator", OP, MKT, "buy", args=[0], actions=[{"type": "deposit", "token": "00", "amount": 3}])
ex("operator", OP, GAME, "claim_card", actions=[wd(GOLEM, OP)])
wait(lambda: "closed" in str(state(MKT, "calls[]=get_listing(0)")), "bought")

# R4: operator claims dagger from market; player withdraws proceeds
ex("operator", OP, MKT, "claim_card", actions=[wd(DAGGER, OP)])
ex("player", PL, MKT, "withdraw_funds", actions=[{"type": "withdrawal", "token": "00", "amount": 3, "address": PL}])
wait(lambda: str(state(MKT, f'calls[]=get_funds("{PL}")')).find("'value': 0") >= 0
     or '"value": 0' in json.dumps(state(MKT, f'calls[]=get_funds("{PL}")')), "settled")

# R5: swap - operator gives dagger, wants golem
ex("operator", OP, MKT, "offer_swap", args=[GOLEM], actions=[dep(DAGGER)])
wait(lambda: "open" in str(state(MKT, "calls[]=get_swap(0)")), "swap open")

# R6: operator accepts own swap with the golem (mechanics test)
ex("operator", OP, MKT, "accept_swap", args=[0], actions=[dep(GOLEM)])
wait(lambda: "closed" in str(state(MKT, "calls[]=get_swap(0)")), "swap settled")

print("FINAL:", json.dumps(state(MKT, "calls[]=get_listing(0)&calls[]=get_swap(0)"
      f'&calls[]=get_funds("{PL}")&calls[]=get_pending_owner("{DAGGER}")'
      f'&calls[]=get_pending_owner("{GOLEM}")').get("calls")), flush=True)
print("MARKET_IDS", json.dumps({"blueprint": BP, "nc": MKT}), flush=True)
