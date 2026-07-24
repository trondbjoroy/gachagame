"""Verify the v4 market at fee_bps=500 (5%) on testnet-playground.

Publishes card_market.py, instantiates it against a v4 arena (card_unit=1),
lists a player card, buys it, and checks: seller nets price minus 5%, the
5% accrues to fees, the seller withdraws, the buyer claims the card.

Prereqs: the v4 arena E2E already ran (v4_playground_test.py) so the player
wallet holds a genuine v4 card.

Run: V4_NC=<arena nc> CARD=<card uid> python scripts/v4_market_fee_test.py
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = "https://node1.playground.testnet.hathor.network/v1a"
ARENA = os.environ["V4_NC"]
CARD = os.environ["CARD"]
PRICE = 40  # HTR cents; 5% fee = 2, seller nets 38


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
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read())


def get_local(path, wallet):
    req = urllib.request.Request("http://localhost:8000" + path,
        headers={"x-wallet-id": wallet})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def wait(fn, label, tries=40, pause=5):
    for _ in range(tries):
        try:
            if fn():
                print("OK:", label, flush=True)
                return
        except Exception:
            pass
        time.sleep(pause)
    raise SystemExit("TIMEOUT: " + label)


def wait_exec(r, label):
    h = r.get("hash")
    if not h:
        print(f"SUBMITFAIL {label}: {r.get('error')}", flush=True)
        return False
    voided = {"v": False}

    def done():
        meta = get(f"{NODE}/transaction?id={h}").get("meta") or {}
        if meta.get("voided_by"):
            voided["v"] = True
            return True
        return bool(meta.get("first_block"))

    wait(done, f"{label} confirmed")
    if not voided["v"]:
        time.sleep(6)
        meta = get(f"{NODE}/transaction?id={h}").get("meta") or {}
        voided["v"] = bool(meta.get("voided_by"))
    print(("EXEC " if not voided["v"] else "NCFAIL ") + label, flush=True)
    return not voided["v"]


def execute(nc, method, args, actions, wallet, address):
    body = {"nc_id": nc, "method": method, "address": address, "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    for attempt in range(4):
        r = post("/wallet/nano-contracts/execute", body, wallet)
        if r.get("hash"):
            return r
        print(f"submit retry {attempt + 1} for {method}: {json.dumps(r)[:200]}", flush=True)
        time.sleep(15)
    return r


def mkt_state(qs):
    return get(f"{NODE}/nano_contract/state?id={MKT}&{qs}")


def call1(c):
    d = mkt_state("calls[]=" + urllib.parse.quote(c))
    return (d.get("calls") or {}).get(c, {}).get("value")


checks = []


def check(label, ok):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label, flush=True)


OP = get_local("/wallet/address?index=0", "operator")["address"]
PL = get_local("/wallet/address?index=0", "player")["address"]

BP = os.environ.get("MKT_BP")
if not BP:
    code = open("blueprint/card_market.py", encoding="utf-8").read()
    r = post("/wallet/nano-contracts/create-on-chain-blueprint", {"code": code, "address": OP})
    BP = r.get("hash")
    print("market blueprint:", BP, r.get("error", ""), flush=True)
    assert BP, r
wait(lambda: get(f"{NODE}/nano_contract/blueprint/info?blueprint_id={BP}")
     .get("name") == "EmberfallCardMarket", "market blueprint confirmed")

r = post("/wallet/nano-contracts/create", {
    "blueprint_id": BP, "address": OP,
    "data": {"args": [OP, ARENA, 500, 1]}})   # fee_bps=500, card_unit=1
MKT = r.get("hash")
print("market contract:", MKT, r.get("error", ""), flush=True)
assert MKT, r
wait(lambda: call1("get_listing_count()") == 0, "market confirmed")

check("list a genuine v4 card (card_unit=1)",
      wait_exec(execute(MKT, "list_card", [PRICE],
                        [{"type": "deposit", "token": CARD, "amount": 1}],
                        "player", PL), "list_card"))
lid = call1("get_listing_count()") - 1

check("buy at the exact price",
      wait_exec(execute(MKT, "buy", [lid],
                        [{"type": "deposit", "token": "00", "amount": PRICE}],
                        "operator", OP), "buy"))
seller_net = call1(f'get_funds("{PL}")')
fees = (mkt_state("fields[]=fees_accrued").get("fields") or {}) \
    .get("fees_accrued", {}).get("value")
print("seller_net:", seller_net, "fees_accrued:", fees, flush=True)
check("seller nets price minus 5%", seller_net == PRICE - PRICE * 500 // 10_000)
check("5% fee accrued to the operator", fees == PRICE * 500 // 10_000)

check("seller withdraws proceeds",
      wait_exec(execute(MKT, "withdraw_funds", None,
                        [{"type": "withdrawal", "token": "00",
                          "amount": seller_net, "address": PL}],
                        "player", PL), "withdraw_funds"))
check("funds drained", call1(f'get_funds("{PL}")') == 0)
check("buyer claims the card",
      wait_exec(execute(MKT, "claim_card", None,
                        [{"type": "withdrawal", "token": CARD, "amount": 1,
                          "address": OP}],
                        "operator", OP), "claim_card"))

print("\n==== SUMMARY ====", flush=True)
fails = [l for l, ok in checks if not ok]
for l, ok in checks:
    print(("PASS" if ok else "FAIL"), l)
print(f"\nmarket blueprint: {BP}\nmarket contract:  {MKT}")
if fails:
    raise SystemExit(f"{len(fails)} checks failed")
print("ALL CHECKS PASSED")
