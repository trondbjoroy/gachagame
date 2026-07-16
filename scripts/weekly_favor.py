"""The Weaver's Weekly Favor: a transparent weekly raffle over on-chain renown.

Tickets are the renown each player earned on the Ledger during the week
(current renown minus last week's snapshot). The winner is drawn with a
deterministic, auditable algorithm (sha256 over the week id, the arena
contract id, and the sorted ticket list), and the prize (5% of the week's
summon revenue, capped by half the operator's balance) is paid from
operator proceeds. Anyone can re-run the draw from public data and this
script to verify the result.

Runs from cron (daily is fine; it only draws when a new week has started):
  python3 scripts/weekly_favor.py

State: /opt/gacha/raffle-state.json (baseline snapshots, past winners).
Output: frontend/public/raffle.json (served to players).

This is an interim, off-chain implementation; v2.3 moves the draw into the
contract with consensus RNG.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NODE = os.environ.get("NODE_URL", "https://node1.testnet.hathor.network/v1a")
# v3 arena (renown migrated 1:1; discovery also scans the retired realm)
ARENA = os.environ.get("ARENA_NC", "0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587")
OLD_ARENA = os.environ.get("OLD_ARENA_NC", "00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258")
WALLET = os.environ.get("WALLET_URL", "http://localhost:8000")
WALLET_ID = os.environ.get("WALLET_ID", "operator")
STATE = os.environ.get("RAFFLE_STATE", "/opt/gacha/raffle-state.json")
OUT = os.environ.get("RAFFLE_OUT", "/opt/gacha/frontend/public/raffle.json")
PRIZE_BPS = 500        # 5% of the week's summon revenue
WEEK = 7 * 24 * 3600   # weeks tick at unix epoch boundaries (Thursday 00:00 UTC)


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def views(calls):
    out = {}
    for i in range(0, len(calls), 30):
        qs = "&".join("calls[]=" + urllib.parse.quote(c) for c in calls[i:i + 30])
        st = get(f"{NODE}/nano_contract/state?id={ARENA}&{qs}")
        for k, v in (st.get("calls") or {}).items():
            out[k] = v.get("value")
    return out


def discover_players():
    """Every address that ever called either arena, from public history."""
    addrs = set()
    for nc in (ARENA, OLD_ARENA):
        addrs |= _discover_one(nc)
    return sorted(addrs)


def _discover_one(nc):
    addrs = set()
    after = None
    for _ in range(200):  # generous page cap
        url = f"{NODE}/nano_contract/history?id={nc}&count=50"
        if after:
            url += f"&after={after}"
        h = get(url)
        hist = h.get("history") or []
        if not hist:
            break
        for tx in hist:
            a = tx.get("nc_address")
            if a:
                addrs.add(a)
            for inp in tx.get("inputs") or []:
                da = (inp.get("decoded") or {}).get("address")
                if da:
                    addrs.add(da)
        after = hist[-1].get("hash")
        if len(hist) < 50:
            break
    return addrs


def snapshot(players):
    calls = [f'get_renown("{a}")' for a in players]
    v = views(calls)
    return {a: int(v.get(f'get_renown("{a}")') or 0) for a in players}


def draw(week_id, tickets):
    """Deterministic winner: sha256(week | arena | sorted addr:tickets)."""
    entries = sorted((a, n) for a, n in tickets.items() if n > 0)
    total = sum(n for _, n in entries)
    if total <= 0:
        return None, 0, entries
    seed = hashlib.sha256(
        f"{week_id}|{ARENA}|" + ",".join(f"{a}:{n}" for a, n in entries)
        .encode().hex().encode()).hexdigest()
    roll = int(seed, 16) % total
    acc = 0
    for a, n in entries:
        acc += n
        if roll < acc:
            return a, total, entries
    return entries[-1][0], total, entries


def ensure_wallet():
    """Start the operator wallet in wallet-headless if it isn't running."""
    try:
        req = urllib.request.Request(WALLET + "/start",
            data=json.dumps({"wallet-id": WALLET_ID, "seedKey": WALLET_ID}).encode(),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=60).read()
        time.sleep(8)
    except Exception:
        pass  # already running or wallet-headless will report on pay()


def pay(address, amount):
    ensure_wallet()
    req = urllib.request.Request(WALLET + "/wallet/simple-send-tx",
        data=json.dumps({"address": address, "value": amount}).encode(),
        headers={"Content-Type": "application/json", "x-wallet-id": WALLET_ID})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def main():
    now = int(time.time())
    week_id = now // WEEK
    state = {}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state = json.load(f)

    players = discover_players()
    base = views(["get_total_pulls()", "get_pull_price()"])
    total_pulls = int(base.get("get_total_pulls()") or 0)
    price = int(base.get("get_pull_price()") or 0)
    current = snapshot(players)

    if not state:
        # first ever run: start the week from here
        state = {"week": week_id, "baseline": current, "pulls": total_pulls, "winners": []}
        print(f"initialized week {week_id} with {len(players)} known players")
    elif state["week"] < week_id:
        baseline = state.get("baseline", {})
        tickets = {a: current.get(a, 0) - baseline.get(a, 0) for a in current}
        winner, total, entries = draw(state["week"], tickets)
        pulls_delta = max(0, total_pulls - state.get("pulls", 0))
        prize = pulls_delta * price * PRIZE_BPS // 10_000
        ensure_wallet()
        try:
            bal = json.loads(urllib.request.urlopen(urllib.request.Request(
                WALLET + "/wallet/balance", headers={"x-wallet-id": WALLET_ID}),
                timeout=30).read()).get("available", 0)
        except Exception:
            bal = 0
        prize = min(prize, bal // 2)
        entry = {"week": state["week"], "winner": winner, "tickets": total,
                 "prize": prize, "players": len([1 for _, n in entries if n > 0]),
                 "tx": None, "drawn_at": now}
        if winner and prize > 0:
            r = pay(winner, prize)
            entry["tx"] = r.get("hash")
            print(f"week {state['week']}: {winner} wins {prize} cents "
                  f"({total} tickets, tx {r.get('hash')})")
        else:
            print(f"week {state['week']}: no draw (tickets={total}, prize={prize})")
        state["winners"] = (state.get("winners") or [])[-11:] + [entry]
        state["week"] = week_id
        state["baseline"] = current
        state["pulls"] = total_pulls
    else:
        print(f"week {week_id} still running; {len(players)} players tracked")

    with open(STATE, "w") as f:
        json.dump(state, f, indent=1)

    # what players see: current pool estimate + past winners (no addresses beyond short form)
    pulls_this_week = max(0, total_pulls - state.get("pulls", total_pulls))
    pool = pulls_this_week * price * PRIZE_BPS // 10_000
    public = {
        "week": state["week"],
        "week_ends": (state["week"] + 1) * WEEK,
        "pool": pool,
        "winners": [
            {"week": w["week"], "winner": (w["winner"] or "")[:10] + "…" if w.get("winner") else None,
             "prize": w.get("prize", 0), "tickets": w.get("tickets", 0)}
            for w in (state.get("winners") or [])[-5:]
        ],
    }
    with open(OUT, "w") as f:
        json.dump(public, f, indent=1)
    print("raffle.json written:", json.dumps(public))


if __name__ == "__main__":
    main()
