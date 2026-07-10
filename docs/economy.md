# The Economy of Emberfall — a guide for early testers

Everything in Emberfall runs on rules that no one — not even the game's
keepers — can bend after the fact. Every summoning, every gem, every trial
is written to the Great Ledger and can be checked by anyone. This document
explains how value moves through the realm, and *why* we built it the way
we did. You're testing the game; this is the machinery under it.

---

## The three currencies of the realm

**Coin (HTR).** The realm's money. On the test realm it's free — the
[faucet](https://faucet.testnet.hathor.network) pays enough for a small
army. Coin buys summons and funds promptless sessions; it's also what
sellers earn in the Bazaar.

**Gems (GEMS).** The realm's working currency, earned — never bought.
Champions toiling in the deep Mines sweat gems by the minute, faster for
higher stations (0.01/min for a Footman up to 0.40/min for a Sovereign).
Gems pay for the Rite of Union (fusion) and are what you wager on trials
in the Pit.

**Champions (cards).** Each summoning binds a unique champion into
soulstone — its name, station, and power struck at birth and recorded
forever. Champions are yours: hold them, mine them, fight them, fuse
them, or sell them to other players.

---

## Where coin flows

When you summon (price shown on the button), your coin goes three ways:

1. **A slice backs the gems.** Gem tokens can't be conjured freely — the
   realm demands collateral to mint them. Summon proceeds provide it.
   This is why gems are never given away arbitrarily: every gem that
   leaves the contract is backed by coin someone actually paid in.
2. **A slice feeds the Weaver's favor pool** *(arriving with the next
   update)* — 10% of every summon goes into a shared pot that the Blind
   Weaver hands back out (see below).
3. **The rest is the realm's keep** — the operator's revenue. A game
   must feed its keepers, or there is no game.

The Crown also takes small tithes elsewhere: **5%** of every trial pot in
the Pit, and **2%** of every sale in the Bazaar.

## Where gems flow

Gems have exactly one faucet and several drains, and that balance is
deliberate:

- **Faucet:** the Mines. Gems enter the realm only through champions
  staked over time (plus small one-time deed bounties — see below).
- **Drains:** fusion fees (rising steeply by station — fusing Footmen is
  cheap, forging toward a Sovereign is dear), trial tithes, and wagers
  lost to better fighters.

Because the faucet is rate-limited by real champions staked over real
time, gems can't be farmed by bots or printed into worthlessness. Their
value is anchored to the one thing nobody can fake: time.

## Where champions flow

Summons mint champions in; the Rite of Union burns them. Every fusion
destroys **two** champions and creates **one** of the next station — so
climbing toward Sovereigns permanently shrinks the supply of lesser
champions. Rarity comes from the odds (60 / 30 / 9 / 1), but *scarcity*
comes from the forge.

---

## Deeds, standing, and the Weaver's favor

We're adding progression in two steps, and the same iron rule governs
both: **rewards are funded from real proceeds, never conjured from
nothing.**

**Live now — Deeds of Renown.** The Codex records eighteen deeds — from
your first muster up to commanding an army of forty and winning fifteen
trials — each read straight from what the Ledger already knows about
you. Deeds raise your **standing**, seven levels from Level 1 · Wanderer
to Level 7 · Sovereign's Hand. The gaps widen as you climb: early levels
come in an evening, but the last ones demand a real host, real coin
spent summoning, and hours of champions toiling in the Mines. Level 7
requires every deed in the book. Standing is prestige, not power — it
can't be bought outright, only earned.

**Arriving with the next update — Renown, the Vigil, and the Favor.**
- **Renown**: every meaningful act earns points on the Ledger itself —
  summons, fusions, and *settled* fights in the Pit (you can't farm
  renown by opening and cancelling challenges; only fights that happen
  count).
- **The Vigil**: play on consecutive days and your renown earnings climb,
  up to double at a seven-day vigil. Miss a day and the vigil resets.
- **Deed bounties**: the first summoning, the first Rite, forging a
  Highlord or a Sovereign, and trial milestones each pay a one-time gem
  bounty — backed by the same collateral as all other gems.
- **The Weaver's favor**: every summoning has a **1-in-25 chance** that
  the Weaver smiles and returns up to the summon's full price. The prize
  comes from the favor pool that summons themselves fill — the pot grows
  when the realm is busy and never pays out more than it holds.
- **Aspects**: every champion's power splits at birth into **valor,
  bulwark, and guile**, and trials in the Pit become best-of-three —
  one round per aspect. A balanced champion fights steadily; a
  specialist crushes one round and gambles the rest.
- **The Rite of Tempering**: while a champion toils in the Mines, you
  may pay gems to raise one chosen aspect. Each tempering costs half
  again as much as the last, with a hard cap by station — a tempered
  Footman deepens, but never outgrows a Knight. Half of every fee is
  destroyed forever (good for everyone's gems), half goes to the Crown.
- **Battle-hardened**: champions remember their victories — every duel
  won is written on the card itself, and veterans will carry that
  pedigree into the Bazaar. A winner also grows: +1 to a random aspect,
  but only from wagered fights against an equal or stronger foe, and
  only up to a modest cap. Glory earned against weaklings teaches
  nothing.

## Why "funded from proceeds, never printed"?

Games that conjure rewards from nothing die the same death: rewards
outrun the things that absorb them, the currency's worth collapses, and
with it every reason to play. (The graveyard of play-to-earn games is
full of this exact failure.) So Emberfall follows one rule everywhere:

> Every reward traces back to coin that a player actually spent.

Concretely: gem emissions are collateral-backed by summon proceeds; the
favor pool is filled only by a fixed slice of summon payments; deed
bounties are one-time, capped, and backed the same way; and standing —
the biggest reward of all — costs nothing to grant because prestige
can't be counterfeited or inflated. A busy week means a fatter favor
pool; a quiet week means a leaner one. The economy breathes with the
realm instead of bleeding it.

One more consequence worth naming: because every point of renown costs
something real to earn, there is no profitable way to bot it. The
cheapest path to progression is simply *playing*.

## What's different on the test realm

Prices are tuned for testing, not for balance — summons are nearly free
so you can test every mechanic without grinding, and the coin itself is
free from the faucet. Before any real-money launch, every number in this
document (summon price, mine rates, fusion fees, tithes, favor odds)
gets a dedicated balancing pass. What will *not* change is the
architecture: the rule above, the collateral backing, and the fact that
all of it stays open on the Ledger for anyone to verify.

## Questions we'd love your help answering

1. Do the Mines feel worth it — do you *want* to keep champions staked?
2. Is fusion priced fairly at each station, or does the climb stall?
3. Does the Pit's 5% tithe feel fair when you win?
4. Do deeds and standing make you want one more summon — and which deed
   did you chase first?
5. Anything that feels exploitable? Try to break it — that's the point
   of a test realm.

Tell us what feels generous, what feels stingy, and where you stopped
caring. That last one is the most valuable answer of all.
