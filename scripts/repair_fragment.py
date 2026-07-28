"""Repair a pre-cutover session fragment's v5 ledger (2026-07-28 incident).

Session delegations live inside the contract, so v4 bindings did not
migrate: the desktop session key WUKnc… (delegate of heyman in v4) played
v5 unbound and accrued state as its own address — 4 pulls, a ranked win
(rating 1016), 45 renown, 40 Ember, 1 win.

This mirrors those earnings onto the identity that earned them and resets
the fragment's rating to the 1000 baseline so the ladder shows no ghost.
The fragment's renown/Ember copies cannot be removed (adopt_player only
adds) and are left as accepted testnet noise. Card custody is NOT touched:
the player claims/recalls on the session, ends it, and the sweep brings
everything home.

DRY-RUN by default; --apply executes via the local wallet-headless
operator (must be started and pointed at testnet-india).
"""
import json
import sys
import time
import urllib.parse
import urllib.request

NODE = "https://node-partners.testnet.hathor.network/v1a"
V5 = json.load(open("scripts/v5_ids.json"))["nc"]
FRAGMENT = next((a for a in sys.argv[1:] if a.startswith("W")), "WUKncFssq2GQnpXi8UQngn94Zqkc2byKG3")
IDENTITY = "WgcXmT2YZzBVefQTzhHWQFvjkWLhsJSaFQ"  # heyman main
APPLY = "--apply" in sys.argv


def call1(c):
    qs = "calls[]=" + urllib.parse.quote(c)
    with urllib.request.urlopen(f"{NODE}/nano_contract/state?id={V5}&{qs}", timeout=30) as r:
        d = json.load(r)
    return (d.get("calls") or {}).get(c, {}).get("value")


def execute(method, args):
    req = urllib.request.Request("http://localhost:8000/wallet/nano-contracts/execute",
        data=json.dumps({"nc_id": V5, "method": method, "address": OP,
                         "data": {"args": args}}).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def main():
    global OP
    req = urllib.request.Request("http://localhost:8000/wallet/address?index=0",
        headers={"x-wallet-id": "operator"})
    with urllib.request.urlopen(req, timeout=30) as r:
        OP = json.loads(r.read())["address"]

    frag = {f: call1(f'{f}("{FRAGMENT}")') or 0 for f in
            ("get_ember_balance", "get_renown", "get_wins",
             "get_player_pulls", "get_deed_flags", "get_rating")}
    print("fragment state:", frag)
    if frag["get_rating"] == 1000 and not frag["get_renown"]:
        print("nothing to repair")
        return
    # a fragment that never fought sits at the 1000 default: carrying that
    # onto the identity would OVERWRITE a rating the player actually earned
    mine = call1(f'get_rating("{IDENTITY}")') or 1000
    plan = [
        ("adopt_player", [IDENTITY, frag["get_ember_balance"], frag["get_renown"],
                          frag["get_deed_flags"], frag["get_wins"], frag["get_player_pulls"]]),
    ]
    if frag["get_rating"] and frag["get_rating"] != 1000 and frag["get_rating"] > mine:
        plan.append(("adopt_rating", [IDENTITY, frag["get_rating"]]))
    else:
        print(f"keeping identity rating {mine} (fragment {frag['get_rating']})")
    if frag["get_rating"] != 1000:
        plan.append(("adopt_rating", [FRAGMENT, 1000]))
    for m, a in plan:
        print("plan:", m, a)
    if not APPLY:
        print("DRY RUN — rerun with --apply")
        return
    for m, a in plan:
        r = execute(m, a)
        print(m, "->", r.get("success"), r.get("error", ""))
        if not r.get("success"):
            sys.exit(1)
        time.sleep(10)
    time.sleep(20)
    print("verify identity rating:", call1(f'get_rating("{IDENTITY}")'))
    print("verify fragment rating:", call1(f'get_rating("{FRAGMENT}")'))
    print("verify identity renown:", call1(f'get_renown("{IDENTITY}")'))


if __name__ == "__main__":
    main()
