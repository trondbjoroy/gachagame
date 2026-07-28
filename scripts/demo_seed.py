"""Seed the testnet realm with fictional company: eight banners in the
season standings and a few hours of world-feed activity.

WHY THIS FILE EXISTS AND HOW TO REMOVE IT
An empty realm reads as a dead game to a first-time tester, so this seeds
plausible neighbours to play against the scoreboard of. Everything it
writes lives in ONE place — scripts/demo-fixtures.json — and three
consumers merge it in:

  season.py   merges fixture players into the standings each run
  server.js   serves fixture names from /api/names and fixture lines in
              the world feed
  this script writes the fixture file and pushes it to the VPS

Delete scripts/demo-fixtures.json (and rerun the deploy) and every trace
is gone: nothing is written into names.json or feed-state.json, so the
real registries stay honest.

IMPORTANT: these deeds are NOT on chain. The game's claim is that real
deeds are verifiable, and these would not survive a look at the explorer.
They must not outlive the testnet playtest.

  python scripts/demo_seed.py            # write the fixture locally
  python scripts/demo_seed.py --push     # ...and copy it to the VPS
"""
import json
import random
import subprocess
import sys
import time

OUT = "scripts/demo-fixtures.json"
VPS = "root@104.105.106.165"
PUSH = "--push" in sys.argv

# names in the shapes real people pick: a full name, a handle, a role-play
# title, initials, a first name, something lowercase and fond, a short tag
PLAYERS = [
    ("Mira Halvorsen", 384),
    ("tunnelrat", 246),
    ("Ser Bedwyr", 173),
    # the tail is deliberately soft: a tester should pass these in an
    # evening of bosses and duels, not a week of grinding
    ("Olu Adeyemi", 96),
    ("grandma juno", 74),
    ("kp_", 58),
    ("Little Wolf", 41),
    ("VEX", 27),
]

CARDS = ["Grain Weevil", "Bell Sheep", "Cart Mule", "Sewer Baron", "Pit Pony",
         "Straw Effigy", "Tomb Herald", "Larder Mouse", "Bent Copper",
         "Candle Moth", "River Serpent", "Grave Beetle", "Rook Fledgling"]
GUILDS = ["Bravo", "The Ninth Hearth"]
BOSSES = ["The Oathless Levy", "The Shieldbreaker", "The Bog Warden",
          "The Gutter King", "The Ashen Knight"]

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def addr_for(name, rng):
    """A stable, plausible testnet address. Never collides with a real one:
    real addresses come from real keys, and nothing here can spend."""
    return "W" + "".join(rng.choice(B58) for _ in range(33))


def main():
    rng = random.Random(20260728)          # stable across runs
    now = int(time.time())
    players = []
    for name, seasonal in PLAYERS:
        players.append({"addr": addr_for(name, rng), "name": name,
                        "seasonal": seasonal, "lifetime": seasonal + rng.randint(20, 260)})

    a = {p["name"]: p["addr"] for p in players}
    feed = []

    def ev(mins_ago, kind, who, **rest):
        feed.append({"ts": now - mins_ago * 60, "kind": kind, "who": who, **rest})

    # a few hours of a realm going about its business, newest last
    ev(214, "pull", a["Mira Halvorsen"], card="Rook Fledgling")
    ev(203, "listed", a["tunnelrat"], id=41, card="Cart Mule", price=180)
    ev(197, "challenge", a["Ser Bedwyr"], id=12, wager=40)
    ev(191, "writ", a["Olu Adeyemi"], writ="The Bog Warden", tier=0)
    ev(184, "answer", a["grandma juno"], id=12, sealed=True)
    ev(179, "delve", a["kp_"])
    ev(171, "bought", a["Little Wolf"], id=41, card="Cart Mule", price=180,
       seller=a["tunnelrat"])
    ev(166, "reveal", a["Ser Bedwyr"], id=12,
       verdict={"winner": a["Ser Bedwyr"], "loser": a["grandma juno"]})
    ev(158, "fuse", a["Mira Halvorsen"], card="Sewer Baron")
    ev(149, "temper", a["VEX"])
    ev(141, "swap_offer", a["Olu Adeyemi"], id=7, card="Bell Sheep", want="Pit Pony")
    ev(134, "guild_join", a["Little Wolf"], name="Bravo")
    ev(126, "ranked", a["tunnelrat"], tier=1, result="queued")
    ev(119, "ranked", a["Mira Halvorsen"], tier=1, result="won")
    ev(113, "writ", a["Ser Bedwyr"], writ="The Gutter King", tier=1)
    ev(104, "swap_done", a["kp_"], id=7, card="Pit Pony", want="Bell Sheep",
       maker=a["Olu Adeyemi"])
    ev(97, "pull", a["grandma juno"], card="Candle Moth")
    ev(88, "bet", a["VEX"], id=13, side=0, amount=25)
    ev(84, "challenge", a["Olu Adeyemi"], id=13, wager=60)
    ev(77, "answer", a["Mira Halvorsen"], id=13,
       verdict={"winner": a["Mira Halvorsen"], "loser": a["Olu Adeyemi"]})
    ev(69, "wb_fight", a["Ser Bedwyr"], damage=340)
    ev(61, "listed", a["grandma juno"], id=42, card="Tomb Herald", price=420)
    ev(52, "delve", a["Little Wolf"])
    ev(46, "writ", a["tunnelrat"], writ="The Ashen Knight", tier=0)
    ev(38, "pull", a["kp_"], card="Grave Beetle")
    ev(31, "wb_fight", a["Mira Halvorsen"], damage=515)
    ev(24, "challenge", a["grandma juno"], id=14, wager=0)
    ev(17, "guild_join", a["VEX"], name="Bravo")
    ev(9, "fuse", a["Olu Adeyemi"], card="River Serpent")
    ev(4, "pull", a["Little Wolf"], card="Straw Effigy")

    doc = {
        "note": "FICTIONAL testnet company. Not on chain. Delete this file to "
                "remove every seeded player and feed line.",
        "written": now,
        "players": players,
        "feed": feed,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    print(f"{OUT}: {len(players)} players, {len(feed)} feed lines")
    for p in players:
        print(f"  {p['name']:16} {p['seasonal']:>4} seasonal  {p['addr'][:12]}…")

    if PUSH:
        subprocess.run(["scp", "-i", "/c/Users/trond/.ssh/id_ed25519", OUT,
                        f"{VPS}:/opt/gacha/{OUT}"], check=True)
        print("pushed to the VPS")


if __name__ == "__main__":
    main()
