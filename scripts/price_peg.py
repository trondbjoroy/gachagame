"""Pull-price peg: keep the on-chain HTR pull price at the USD target.

Mainnet pulls are quoted in USD ($2.50) and settled in HTR at spot
(docs/v4-economy.md). Nano contracts have no price oracle, so this cron
fetches HTR/USD spot, computes the HTR-cents equivalent and calls
set_pull_price when the on-chain price has drifted beyond the threshold.

DRY-RUN BY DEFAULT: prints what it would do. Pass --apply (or PEG_APPLY=1)
to actually send the set_pull_price tx. Mainnet-only — testnet keeps its
fixed 1 HTR price and does not run this cron.

Mainnet cron (every 5 minutes, same host as the season/raffle crons):
  */5 * * * * cd /opt/gacha && ARENA_NC=<mainnet-nc> PEG_APPLY=1 \
    python3 scripts/price_peg.py >> /var/log/gacha-peg.log 2>&1

Sanity rails: the spot quote must be plausible, and a step that would move
the price by more than 2x in either direction is refused (oracle-glitch /
fat-finger guard) — a jump that large needs a human (PEG_FORCE=1).
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node-partners.mainnet.hathor.network/v1a")
ARENA = os.environ.get("ARENA_NC")  # no default: never peg a contract by accident
WALLET = os.environ.get("WALLET_URL", "http://localhost:8000")
WALLET_ID = os.environ.get("WALLET_ID", "operator")
USD_TARGET = float(os.environ.get("PEG_USD", "2.50"))
DRIFT_BPS = int(os.environ.get("PEG_DRIFT_BPS", "200"))  # act beyond 2% drift
APPLY = "--apply" in sys.argv or os.environ.get("PEG_APPLY") == "1"
FORCE = os.environ.get("PEG_FORCE") == "1"

SPOT_URL = "https://api.coingecko.com/api/v3/simple/price?ids=hathor&vs_currencies=usd"


def get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def spot_usd():
    price = float(get(SPOT_URL)["hathor"]["usd"])
    # plausibility rail: HTR has never been near these bounds; outside them
    # the quote is garbage and we must not act on it
    if not (0.001 <= price <= 10.0):
        raise SystemExit(f"implausible HTR/USD spot {price}; refusing to act")
    return price


def onchain_price():
    call = urllib.parse.quote("get_pull_price()")
    st = get(f"{NODE}/nano_contract/state?id={ARENA}&calls[]={call}")
    return int(st["calls"]["get_pull_price()"]["value"])


def set_price(new_price):
    addr = get(f"{WALLET}/wallet/address?index=0",
               headers={"x-wallet-id": WALLET_ID})["address"]
    body = {"nc_id": ARENA, "method": "set_pull_price", "address": addr,
            "data": {"args": [new_price]}}
    req = urllib.request.Request(WALLET + "/wallet/nano-contracts/execute",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": WALLET_ID})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def main():
    if not ARENA:
        raise SystemExit("ARENA_NC not set; refusing to peg an unnamed contract")
    spot = spot_usd()
    target = round(USD_TARGET / spot * 100)  # HTR-cents
    if target <= 1:
        raise SystemExit(f"target {target} cents is at/below the 1-cent floor")
    current = onchain_price()
    drift_bps = abs(target - current) * 10_000 // current if current else 10_000
    line = (f"spot ${spot} -> target {target} cents"
            f" (on-chain {current}, drift {drift_bps} bps)")
    if drift_bps <= DRIFT_BPS:
        print(f"{line}: within threshold, no-op")
        return
    if current and not FORCE and (target > current * 2 or target < current // 2):
        raise SystemExit(f"{line}: step exceeds 2x rail; set PEG_FORCE=1 to override")
    if not APPLY:
        print(f"{line}: DRY-RUN, would set_pull_price({target})")
        return
    r = set_price(target)
    if r.get("hash"):
        print(f"{line}: set_pull_price sent, tx {r['hash']}")
    else:
        raise SystemExit(f"{line}: set_pull_price FAILED: {json.dumps(r)[:300]}")


if __name__ == "__main__":
    main()
