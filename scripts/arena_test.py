"""Helpers + phased on-chain test driver for GachaArena. Usage: python arena_test.py <phase>"""
import json
import sys
import time
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
PL = "WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE"
NC = "00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8"
GEMS = "3647ee44cf81b74dd8e8e26d7b6237cc7c6b588e53cc30dd0a2eb3dbdf5c63f2"
NODE = "https://node1.playground.testnet.hathor.network/v1a"

CARDS = {
    "op_golem":  "894e9526cf42" ,
    "pl_golem":  "a26f4dbe56ab",
    "op_knight": "af02615cb211",
    "pl_dagger": "d1ef982bce8b",
    "op_slime":  "de00a15f3ddd",
}

def full_uids():
    d = ncstate("balances[]=__all__")
    return {u for u in d["balances"]}

def resolve(short):
    for u in ALL_UIDS:
        if u.startswith(short):
            return u
    raise SystemExit(f"cannot resolve {short}")

def execute(wallet, addr, method, args=None, actions=None):
    body = {"nc_id": NC, "method": method, "address": addr, "data": {}}
    if args is not None:
        body["data"]["args"] = args
    if actions is not None:
        body["data"]["actions"] = actions
    req = urllib.request.Request("http://localhost:8000/wallet/nano-contracts/execute",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": wallet})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def ncstate(qs):
    with urllib.request.urlopen(f"{NODE}/nano_contract/state?id={NC}&{qs}", timeout=20) as r:
        return json.loads(r.read())

def calls(*cs):
    qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in cs)
    d = ncstate(qs)
    return {k: v.get("value", v.get("errmsg")) for k, v in d["calls"].items()}

def dep(token, addr=None):
    a = {"type": "deposit", "token": token, "amount": 1}
    return a

def wd(token, addr, amount=1):
    return {"type": "withdrawal", "token": token, "amount": amount, "address": addr}

def show(label, r):
    print(label, "->", r.get("success"), (r.get("error") or r.get("hash", ""))[:60])

ALL_UIDS = full_uids()
C = {k: resolve(v) for k, v in CARDS.items()}

phase = sys.argv[1] if len(sys.argv) > 1 else ""

if phase == "claims":
    for w, a, key in [("operator", OP, "op_golem"), ("operator", OP, "op_knight"),
                      ("operator", OP, "op_slime"), ("player", PL, "pl_golem"),
                      ("player", PL, "pl_dagger")]:
        show(f"claim {key}", execute(w, a, "claim_card", actions=[wd(C[key], a)]))
        time.sleep(2)

elif phase == "stake_and_duel":
    show("op stake slime", execute("operator", OP, "stake", actions=[dep(C["op_slime"])]))
    time.sleep(2)
    show("pl stake dagger", execute("player", PL, "stake", actions=[dep(C["pl_dagger"])]))
    time.sleep(2)
    show("op create_duel golem w=0",
         execute("operator", OP, "create_duel", args=[0], actions=[dep(C["op_golem"])]))

elif phase == "accept_and_farm":
    show("pl accept_duel 0", execute("player", PL, "accept_duel", args=[0], actions=[dep(C["pl_golem"])]))
    time.sleep(2)
    show("op claim_gems slime", execute("operator", OP, "claim_gems", args=[C["op_slime"]]))

elif phase == "unstake":
    show("op unstake slime", execute("operator", OP, "unstake", actions=[wd(C["op_slime"], OP)]))

elif phase == "fuse":
    show("op fuse knight+slime", execute("operator", OP, "fuse",
         actions=[dep(C["op_knight"]), dep(C["op_slime"])]))

elif phase == "withdraw_gems":
    show("op withdraw 3 gems", execute("operator", OP, "withdraw_gems",
         actions=[wd(GEMS, OP, 3)]))

elif phase == "status":
    print(json.dumps(calls(
        f'get_gems_balance("{OP}")', f'get_gems_balance("{PL}")',
        'get_duel(0)', 'get_duel_count()',
        f'get_wins("{OP}")', f'get_wins("{PL}")',
        f'get_staker("{C["op_slime"]}")', f'get_staker("{C["pl_dagger"]}")',
        f'get_pending_gems("{C["op_slime"]}", {int(time.time())})',
        'get_proceeds()', 'get_total_pulls()',
    ), indent=1))
else:
    print("phases: claims stake_and_duel accept_and_farm unstake fuse withdraw_gems status")
