"""Launch EmberfallArena v3 on testnet-india from the Hathor-published
blueprint: instantiate, seed all 180 catalog champions, post the ten writs.

Run after wallet-headless (testnet-india) is up with the operator started:
  python scripts/launch_v3.py
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

OP = "Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG"
NODE = "https://node1.testnet.hathor.network/v1a"
BP = "0037896213a4cb7b1b28ae2116fa95a6bff066a6e19bc395eb9a18541f54717f"
PULL_PRICE = 100          # 1 HTR, current live economy
WEIGHTS = (6000, 3000, 900, 100)
DELVE_SECONDS = 28_800    # 8 hours

# The Gauntlet: ten writs of the Sundering, Grim spreads (Dire x2, Black x4)
WRITS = [
    ("The Oathless Levy", 6, 5, 5),
    ("The Shieldbreaker", 14, 3, 5),
    ("The Bog Warden", 4, 14, 6),
    ("The Gutter King", 5, 6, 15),
    ("The Ashen Knight", 12, 12, 6),
    ("The Hollow Priest", 8, 8, 20),
    ("The Broken Banner", 18, 12, 8),
    ("The Wight of Harrow", 14, 18, 12),
    ("The Pale Duchess", 16, 16, 20),
    ("The Hollow King", 24, 22, 24),
]

TIER_OF = {"Footman": 0, "Knight": 1, "Highlord": 2, "Sovereign": 3}


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


def catalog_entries():
    """Parse frontend/public/catalog.js: name -> station."""
    src = open("frontend/public/catalog.js", encoding="utf-8").read()
    out = []
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)':\s*\{\s*station:\s*'(\w+)'", src):
        name = m.group(1).replace("\\'", "'")
        out.append((TIER_OF[m.group(2)], name))
    return out


def main():
    entries = catalog_entries()
    counts = [sum(1 for t, _ in entries if t == i) for i in range(4)]
    print(f"catalog: {len(entries)} champions {counts}", flush=True)
    assert len(entries) == 180, "expected the full catalog"
    assert len(set(n for _, n in entries)) == 180, "catalog contains duplicates"

    r = post("/wallet/nano-contracts/create", {
        "blueprint_id": BP, "address": OP,
        "data": {"args": [OP, PULL_PRICE, *WEIGHTS, DELVE_SECONDS],
                 "actions": [{"type": "deposit", "token": "00", "amount": 2}]}})
    nc = r.get("hash")
    print("v3 contract:", nc, r.get("error", ""), flush=True)
    assert nc, r

    def ncstate(qs):
        return get(f"{NODE}/nano_contract/state?id={nc}&{qs}")

    def call1(c):
        qs = "calls[]=" + urllib.parse.quote(c)
        d = ncstate(qs)
        return (d.get("calls") or {}).get(c, {}).get("value")

    wait(lambda: ncstate("fields[]=gems_uid").get("success"), "contract confirmed")
    gems = ncstate("fields[]=gems_uid")["fields"]["gems_uid"]["value"]
    print("GEMS v3:", gems, flush=True)

    for i, (tier, name) in enumerate(entries):
        r = post("/wallet/nano-contracts/execute", {
            "nc_id": nc, "method": "add_template", "address": OP,
            "data": {"args": [tier, name]}})
        if not r.get("success"):
            print(f"RETRY template {name}: {r.get('error')}", flush=True)
            time.sleep(10)
            r = post("/wallet/nano-contracts/execute", {
                "nc_id": nc, "method": "add_template", "address": OP,
                "data": {"args": [tier, name]}})
        if (i + 1) % 20 == 0:
            print(f"  templates submitted: {i + 1}/180", flush=True)
        time.sleep(1.2)

    for name, v, b, g in WRITS:
        r = post("/wallet/nano-contracts/execute", {
            "nc_id": nc, "method": "add_writ", "address": OP,
            "data": {"args": [name, v, b, g]}})
        print("writ:", name, r.get("success"), flush=True)
        time.sleep(1.5)

    wait(lambda: [call1(f"get_template_count({t})") for t in range(4)] == counts,
         f"all templates registered {counts}", tries=60)
    wait(lambda: call1("get_writ_count()") == len(WRITS), "all writs posted")

    print("\nLAUNCHED")
    print("contract:", nc)
    print("gems:", gems)
    with open("scripts/v3_ids.json", "w") as f:
        json.dump({"nc": nc, "gems": gems, "blueprint": BP}, f)


if __name__ == "__main__":
    main()
