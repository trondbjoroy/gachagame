# Gameplay expansion — design document

**Status: approved direction, not yet in development.** Six features that
give players more to do, more to chase, and more ways to grow — both
their standing and their champions. Numbers are starting points for the
balance pass, not final.

A design constraint runs through everything: the live v2.2 blueprints
are immutable, so features are split into what ships **now** (client or
off-chain, no contract change) and what batches into the **v3
blueprint** (one migration event). Each design states its split.

---

## 1. The Gauntlet — PvE boss campaign

**The gap it fills:** Emberfall currently requires other players for all
combat. A lone player at any hour needs someone to fight. The Gauntlet
is that someone.

**Lore.** The Sundering left more than an empty throne: pretender lords,
oathbreaker knights, and the hollow things that rose where houses died.
The Crown posts writs against them. Champions march from the Mines to
answer.

**Mechanics.**

- **Ten writs (bosses), three tiers each** (Grim / Dire / Black), thirty
  stages. Each boss is a contract-defined virtual champion with a
  **public aspect spread** designed as a puzzle:
  specialists (Valor 40/8/22 — concede his round, take the other two),
  walls (10/45/10), tricksters, and balanced brutes. Chapter power
  scales from footman-beatable (~15) through beyond-sovereign (~350 at
  Black tier).
- **Combat is the existing best-of-three engine** — one round per
  aspect, weighted draw, contract RNG. No new combat code; new
  opponents.
- **Staked champions fight.** A champion toiling in the Mines can march
  against a writ without any token movement — the contract already
  custodies it, so a fight is a single cheap method call. This makes the
  Mines the muster ground (tempering already lives there) and means
  collection-sitters must stake to campaign.
- **Attempts:** 3 per champion per boss per day (timestamp-gated).
  Paces farming, rewards owning a stable of champions.
- **Entry and reward:** entry fee ~20% of the champion's station fusion
  fee (sink); victory pays gems ~3x the entry by tier plus renown
  (+3 fight / +6 win — below the Pit's +5/+10 so PvP keeps its premium).
  First clear of each stage: bonus purse + a deed.
- **Progression gate:** Dire unlocks per-boss after its Grim clear;
  Black after Dire. The Codex tracks the campaign map.
- **World Boss (phase 3):** one colossal writ per week; every player's
  round-wins accumulate as "wounds"; leaderboard by wounds dealt; weekly
  settlement pays a purse from proceeds (the weekly-raffle pattern).

**Build split:** core Gauntlet is v3 blueprint (boss table via
append-only `add_writ`, per-player clear bitmasks, per-champion attempt
counters, `fight_writ(uid, boss, tier)`); World Boss settlement starts
off-chain like the raffle.

---

## 2. Daily and weekly trials

**The gap:** the Vigil rewards showing up; nothing rewards *doing
something specific today*. One-time deeds exhaust.

**Mechanics.**

- **One daily trial**, drawn deterministically from a rotation of ~8
  archetypes: *win a trial in the Pit; clear any writ; give two
  champions to the Rite of Union; temper a champion; complete a delve;
  summon a champion; recall a miner with 8+ hours of toil; claim the
  Weaver's favor.*
- Completing it grants **+50% renown on that act plus a small gem
  bounty** (~a footman fusion fee).
- **Weekly trial:** a larger composite (e.g. *settle five fights*),
  settled off-chain like the raffle, paying a bigger purse.
- Trials surface on the summon panel ("Today the Crown asks…") with a
  ribbon + haptic on completion.

**Build split:** Phase 1 ships a **client-side daily trial** (same
deterministic rotation, celebration, and a Codex checklist — no rewards
beyond a client deed). v3 moves the daily bonus on-chain: the trial id
derives from the day number inside the contract, and existing methods
(pull, fuse, temper, duel settlement…) check "does this act match
today's trial?" and credit the bonus inline — no new transaction types.

---

## 3. Champion veterancy (XP and levels)

**The gap:** champions grow only by spending (temper) or by wagered PvP
wins (battle-hardened). Nothing marks a champion's *career*.

**Mechanics.**

- Every **settled** fight grants XP: Gauntlet win 2 / loss 1; Pit win
  4 / loss 2. (Attempt limits and entry fees already pace PvE XP.)
- **Levels** at thresholds ~[5, 15, 35, 70, 120, 200, 320]. Milestone
  levels (every other) grant **+1 to a random aspect**, capped by
  station at **2 / 3 / 4 / 6** — a second, slower growth track alongside
  tempering (paid) and hardening (risk), sized so station bands still
  hold: a maxed footman (~33) still loses to an average knight (~37).
- Battle-hardened stays unchanged — it remains the *wager against a
  worthy foe* prestige track; veterancy is the *mileage* track.
- Level and XP are written on the card (packed attrs, bits 52+), so a
  veteran champion is **provably veteran in the Bazaar and on
  NileSwap** — levels travel with the card and deepen the pedigree
  story.

**Build split:** entirely v3 (attrs packing + XP credit in fight
settlements). Card frame shows level chevrons client-side.

---

## 4. Delves — active risk in the Mines

**The gap:** the Mines are the most-visited tab (64/181 tab views in
launch-week telemetry) but offer zero decisions.

**Mechanics.**

- A staked champion may be sent **delving: locked for 8 hours** (no
  unstake, temper, or Gauntlet), and while delving it does **not** mine.
- On return, contract RNG rolls the outcome:

  | Outcome | Chance | Yield |
  |---|---|---|
  | Seam | 55% | ~1.5x what 8h of mining would have paid |
  | Dust | 25% | nothing |
  | Relic shards | 15% | cosmetic currency (see §6) |
  | Rich vein | 4.9% | 5x mining equivalent |
  | Ancient relic | 0.1% | unique cosmetic + deed |

  Expected value ≈ 1.2x passive mining — a real but modest edge, paid
  for with variance and the lockout. Mining stays the safe baseline.
- Higher stations roll richer absolute tables (yields scale with the
  station's mine rate, so the ratios hold everywhere).

**Build split:** v3 (`begin_delve(uid)` / `claim_delve(uid)`, one
timestamp + RNG roll). UI is a second button on staked cards.

---

## 5. Seasons and leaderboards

**The gap:** renown accumulates forever; veterans run out of rankings to
climb, and newcomers face an unclimbable lifetime board.

**Mechanics.**

- **Eight-week seasons.** Seasonal renown = renown earned within the
  window (computed from snapshots of the on-chain cumulative figure —
  the weekly-raffle infrastructure generalized).
- **Season rewards:** rank-threshold cosmetics (bronze/silver/gold
  banner frames, a season title) for everyone above thresholds, plus a
  **gem purse to the top 10** funded from a fixed slice of the season's
  summon proceeds (the iron rule pattern — a busy season pays more).
- **Legacy renown** (lifetime) remains in the Codex; the weekly raffle
  keeps running inside seasons.
- Codex gains a Season panel: rank, renown to next threshold, days
  remaining, last season's champions.

**Build split:** Phase 1 can ship the whole thing off-chain (snapshot
cron → season.json → client), rewards settled like the raffle. On-chain
season purses are a v3-or-later nicety, not a requirement.

---

## 6. Collection goals and cosmetics

**The gap:** 180 illustrated champions and no reason to collect; gems
need sinks that aren't power (fits the points-not-token direction).

**Mechanics.**

- **The Muster Roll** (Codex): which of the 180 champions you have ever
  sworn, per-station completion, and **type sets** (the catalog already
  tags types — beasts, wights, knights…). Set completions grant deeds;
  full-station musters grant title suffixes ("Warden of the Footmen").
- **Cosmetics, bought with gems and relic shards** (from delves):
  - **card frames** (ember, silver-chased, gold-chased, void),
  - **sigil tints**,
  - **epithets** — a second line under the champion's name chosen from
    a curated list ("the Unbowed", "Thrice-Forged"), no free text.
- Cosmetics are **stored on-chain per card** (a cosmetics byte in the
  packed attrs or a small map), so they travel with the card to new
  owners — bought cosmetics add resale identity, never power.

**Build split:** Muster Roll + set deeds are pure client (phase 1).
Cosmetic purchase/storage is v3.

---

## Implementation order

**Phase 1 — now, on testnet, no contract changes (days):**
1. Muster Roll + collection deeds (§6, client half)
2. Client-side daily trials (§2, phase A)
3. Season scaffolding off-chain: snapshots, season page, first season
   announced for testers (§5)

*Rationale: retention content for the current tester cohort while v3 is
designed; all three also validate demand signals (trial completion rate,
season engagement) before the contract work is committed.*

**Phase 2 — the v3 blueprint (the one migration):**
4. The Gauntlet core (§1) — the structural fix, and the reason v3 exists
5. Veterancy XP (§3) — rides on Gauntlet settlement code
6. Delves (§4)
7. On-chain daily-trial bonuses (§2, phase B)
8. Cosmetics storage + shop (§6, chain half)

*Plus the standing v3 wishlist: remove_template, bundled withdrawals,
on-chain raffle draw, settable economy parameters — and the
ledger-vs-token gems decision, which sets every reward denomination
above and should be finalized before v3 is specced.*

**Phase 3 — post-v3, incremental:**
9. World Boss weekly (off-chain settlement first)
10. On-chain season purses
11. Warbands (three-champion formations, one slot per aspect round) —
    held until the population justifies a composition meta

## Power-creep guardrail (applies across §1/§3)

Total non-birth growth per champion = temper caps (3/5/8/12 rites)
+ hardening caps (2/3/4/6) + veterancy caps (2/3/4/6). Worst-case fully
grown footman ≈ 33 power vs average birth knight 37: the station ladder
holds. Any future growth source must re-run this arithmetic.
