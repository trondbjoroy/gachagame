# Champions, Combat, and Renown — how Emberfall's mechanics work

This guide covers the three systems that decide how you and your champions
grow: **aspects and champion growth**, **trial by combat**, and **leveling**
(renown, the Vigil, and your standing). For how value and currencies move,
see [economy.md](economy.md). Everything below runs inside the game's rules
on the Great Ledger; none of it can be bent, and all of it can be verified.

---

## 1. Champions and their aspects

Every champion is born with a **station** and a **power**, and that power is
split across three **aspects**:

| Aspect | Symbol | Meaning | Combat role |
|---|---|---|---|
| **Valor** | ⚔ | ferocity, the charge | the offense round |
| **Bulwark** | 🛡 | endurance, the shield-wall | the defense round |
| **Guile** | 🗡 | cunning, the knife in the dark | the trickery round |

Power is always the exact sum of the three aspects. At summoning, the
Weaver rolls power by station, then divides it three ways at random (every
aspect gets at least 1):

| Station | Power range at birth |
|---|---|
| Footman | 10–19 |
| Knight | 25–49 |
| Highlord | 60–119 |
| Sovereign | 150–299 |

The split is what gives champions personality. A 19-power Footman might be
a balanced 7/6/6 — or a 14/2/3 berserker who crushes the Valor round and
prays through the other two. Neither is strictly better; see combat below.

## 2. Growing a champion

There are exactly three ways a champion gets stronger, and they are
deliberately different in what they cost:

**The Rite of Union (fusion) — costs champions and gems.**
Two champions of the same station, plus a gems fee (0.05 / 0.10 / 0.50 /
1.00 GEMS by the station being fused), are burned to forge one champion of
the next station. The child inherits **10% of the parents' combined power**
as a bonus on top of its fresh roll, and rolls **fresh aspects** — tempering
and hardening do not carry through the forge, so fuse for the power, not to
smuggle bonuses upward.

**The Rite of Tempering — costs gems and time.**
While a champion toils in the Mines, you may pay gems to raise **one chosen
aspect by 1–3**. Each tempering of the same champion costs roughly half
again as much as the last, and every station has a hard cap:

| Station | First tempering | Cap | Max total gain |
|---|---|---|---|
| Footman | 0.10 GEMS | 3 temperings | about +9 |
| Knight | 0.20 GEMS | 5 | about +15 |
| Highlord | 0.80 GEMS | 8 | about +24 |
| Sovereign | 1.50 GEMS | 12 | about +36 |

The caps are chosen so tempering **deepens a champion without breaking the
ladder**: a fully tempered Footman (~29 power) still loses to an average
Knight (~37). Half of every tempering fee is destroyed forever; half goes
to the Crown.

**Battle-Hardened — costs risk.**
A champion that wins a trial grows +1 to a random aspect, but **only** if
the fight was wagered (at least your station's fusion fee in gems) **and**
the defeated champion's power was equal or greater than yours. Beating
weaklings, or fighting for free, teaches nothing. Hardening caps at about
half of tempering's ceiling (2 / 3 / 4 / 6 by station).

Separately from hardening, **every settled victory is written on the card
itself** — the ★ count on the frame. A ten-victory veteran is provably a
ten-victory veteran to any buyer in the Bazaar, forever. Pedigree is real
here, and it travels with the card.

## 3. Trial by combat (the Pit)

A trial is **best of three rounds**, one per aspect:

1. **Valor round**: your ⚔ against theirs
2. **Bulwark round**: your 🛡 against theirs
3. **Guile round**: your 🗡 against theirs

Each round is a weighted draw: your chance to take it equals **your aspect
divided by the sum of both** (12 Valor vs 6 Valor wins that round two times
in three). Take two rounds and the pot is yours, minus the Crown's 5%
tithe. Champions are never at risk — win or lose, both fighters return to
their owners; only the gems wager changes hands.

What this means in practice:

- **Total power still rules on average.** A 40-power champion beats a
  20-power champion most of the time, whatever their shapes.
- **But shape decides the close fights.** A specialist (14/2/3) against a
  balanced peer (6/7/6) is heavily favored in one round, an underdog in
  two — it must convert its strong round *and* steal a coin-flip. Balanced
  builds are steadier; specialists are streakier.
- **Everything is public.** Your opponent's aspects are on their card
  before you accept a challenge. Reading a matchup — "my Guile edges
  theirs, and their Valor round is lost anyway, so contest Bulwark" — is
  the actual skill of the Pit. Temper accordingly.
- **Wager sizing matters** if you want your champion to harden: only fights
  wagered at your station's fusion fee or more, against an equal-or-stronger
  foe, leave a mark.

## 4. Renown and the Vigil

**Renown** is the realm's measure of what you have actually done. It is
earned on the Ledger itself, only through real deeds:

| Deed | Renown |
|---|---|
| A summoning | 10 |
| A fusion | 20 / 40 / 80 (by the station fused) |
| A tempering | 5 |
| Fighting a settled trial | 5 (each side) |
| Winning that trial | +10 more |

**The Vigil** multiplies it: play on consecutive days and your renown
earnings climb steadily, up to **double at a seven-day vigil**. Miss a day
and the vigil resets to one. (Only fights that actually settle count for
renown — opening and cancelling challenges earns nothing, by design.)

Renown feeds two things: the **Weaver's weekly favor** (every point earned
in a week is one raffle ticket — see the economy guide), and your bragging
rights, since it is public and unfakeable.

## 5. Standing: the Deeds of Renown and your level

Your **standing** is the long game: seven levels, earned by completing the
eighteen **Deeds of Renown** recorded in the Codex — from *First Muster*
(one champion sworn) up to *The Legion of Emberfall* (forty champions at
once) and *Pit Champion* (fifteen trials won).

| Level | Title | Deeds required |
|---|---|---|
| 1 | Wanderer | 0 |
| 2 | Footman | 2 |
| 3 | Man-at-Arms | 4 |
| 4 | Knight | 7 |
| 5 | Banneret | 10 |
| 6 | Highlord | 14 |
| 7 | Sovereign's Hand | **all 18** |

The gaps widen on purpose. The first levels come in an evening; the last
demand a real host, hours of mining, a Sovereign in your ranks, and a
fighting record. Standing is **prestige, not power** — it grants no combat
advantage and cannot be bought outright, only assembled.

Six of the deeds are milestones the contract itself rewards with one-time
gem bounties, straight to your ledger:

| Milestone | Bounty |
|---|---|
| Your first summoning | 0.10 GEMS |
| Your first Rite of Union | 0.20 GEMS |
| Forging a Highlord | 0.50 GEMS |
| Forging a Sovereign | 2.00 GEMS |
| Your first trial won | 0.25 GEMS |
| Ten trials won | 1.00 GEMS |

## The design in one paragraph

Champions are born random (the Weaver), grown by three paths that cost
three different things (champions, gems, risk), and proven in a combat
system where information is public and shape beats size in close fights.
Players climb two parallel ladders — renown for *doing*, standing for
*achieving* — and every number on both is written on a Ledger nobody can
edit. If you find a way to climb either ladder without paying its intended
cost, that is a bug, and we very much want to hear about it.
