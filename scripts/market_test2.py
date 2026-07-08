"""Continue the market test on the deployed CardMarket."""
import json, time, urllib.request, urllib.error

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
PL = "WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE"
GAME = "00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8"
MKT = "00c059067c19717c856364913d2b3950be4379c8762c13c2b5b91d0ed4ab7620"
NODE = "https://node1.playground.testnet.hathor.network/v1a"
DAGGER = "c811b42df80d13225aeed4d7f5a16eb6217eae1f70456343aa078638d06e347f"
GOLEM = "0d8af8ca082be091c7a4cf71a38c277ff5da6f959cb8c1d5bd3d1018c5db4736"

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
def bal(wallet, token):
    req = urllib.request.Request(f"http://localhost:8000/wallet/balance?token={token}",
                                 headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("available", 0)

# R0: operator claims fused golem (dagger already claimed)
ex("operator", OP, GAME, "claim_card", actions=[wd(GOLEM, OP)])
wait(lambda: bal("player", DAGGER) == 100 and bal("operator", GOLEM) == 100, "cards in wallets")

# R1: player lists dagger for 3 cents
ex("player", PL, MKT, "list_card", args=[3], actions=[dep(DAGGER)])
wait(lambda: "open" in str(state(MKT, "calls[]=get_listing(0)")), "listing open")

# R2: operator buys it
ex("operator", OP, MKT, "buy", args=[0], actions=[{"type": "deposit", "token": "00", "amount": 3}])
wait(lambda: "closed" in str(state(MKT, "calls[]=get_listing(0)")), "bought")

# R3: operator claims dagger; player withdraws proceeds
ex("operator", OP, MKT, "claim_card", actions=[wd(DAGGER, OP)])
ex("player", PL, MKT, "withdraw_funds", actions=[{"type": "withdrawal", "token": "00", "amount": 2, "address": PL}])
wait(lambda: bal("operator", DAGGER) == 100, "dagger bought+claimed")

# R4: swap — operator gives dagger, wants golem; accepts with golem
ex("operator", OP, MKT, "offer_swap", args=[GOLEM], actions=[dep(DAGGER)])
wait(lambda: "open" in str(state(MKT, "calls[]=get_swap(0)")), "swap open")
ex("operator", OP, MKT, "accept_swap", args=[0], actions=[dep(GOLEM)])
wait(lambda: "closed" in str(state(MKT, "calls[]=get_swap(0)")), "swap settled")

print("FINAL:", json.dumps(state(MKT, "calls[]=get_listing(0)&calls[]=get_swap(0)"
      f'&calls[]=get_funds("{PL}")&calls[]=get_pending_owner("{DAGGER}")'
      f'&calls[]=get_pending_owner("{GOLEM}")').get("calls")), flush=True)
