# -*- coding: utf-8 -*-
"""Emberfall mainnet economy model: capped GEMS supply with a circular
reward pool, seeded with testnet behavior (PostHog week of 2026-07-07 +
on-chain aggregates).

Two emission designs compared:
  A) FLAT   - per-champion GEMS/day rates (testnet design). Emissions scale
              with the champion population, which grows without bound; a
              fixed pool cannot survive it at any multiplier.
  B) BUDGET - each month the pool emits a fixed share of itself, split
              pro-rata among staked champions by station weight (1/3/10/40).
              Yields self-dilute as staking grows: the pool can never
              exhaust, and a bot farm dilutes its own returns.

Run: python scripts/economy_model.py
"""

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Tunables under study (outputs below are recommendations for these)
# ---------------------------------------------------------------------------
CAP = 1_000_000.0
POOL0 = 850_000.0          # reward pool at launch (rest: liquidity/treasury)
MODE = 'BUDGET'            # 'FLAT' or 'BUDGET'
BUDGET_MONTHLY = 0.035     # BUDGET mode: share of remaining pool emitted/month
MAX_YIELD_DAY = 0.5        # BUDGET mode: cap, GEMS/day per weight unit
                           # (footman <= 0.5/day, sovereign <= 20/day);
                           # unspent budget stays in the pool. Prevents a
                           # dead or newborn realm from showering stakers.
EMIT_MULT = 0.02           # FLAT mode: global multiplier on testnet rates
FEE_SCALE = 10.0           # global multiplier on testnet fee tables
SUMMON_HTR = 5.0           # mainnet summon price (HTR)
PRICE_HTR = 0.5            # assumed Dozer price, HTR per GEMS (for payback)

WEIGHT = [1, 3, 10, 40]    # station staking weight (mirrors testnet ratios)
RATE_DAY = [14.4, 43.2, 144.0, 576.0]   # FLAT mode testnet GEMS/day
FUSION_FEE = [0.05, 0.10, 0.50, 1.00]   # testnet fee tables (GEMS)
TEMPER_BASE = [0.10, 0.20, 0.80, 1.50]
ODDS = [0.60, 0.30, 0.09, 0.01]

BURN_TEMPER = 0.50         # share of temper fees destroyed (existing rule)
BURN_FUSION = 0.20         # share of fusion fees destroyed (proposed)
RAKE = 0.05                # duel pot rake (existing) -> recycled to pool
STAKED_SHARE = 0.75        # share of active players' champions staked
                           # (Mines dominate tab telemetry: 64/181 views)

# ---------------------------------------------------------------------------
# Player behavior per segment, per month. Testnet week: 6.3 pulls/active/wk
# on free coin; mainnet rates discounted for real money.
# ---------------------------------------------------------------------------
@dataclass
class Segment:
    share: float
    pulls: float      # summons / month
    fusions: float    # rites / month
    tempers: float
    duels: float

SEGMENTS = [
    Segment(0.70, 3, 0.2, 0.1, 0.5),    # casual
    Segment(0.25, 10, 1.5, 1.0, 4.0),   # regular
    Segment(0.05, 40, 8.0, 6.0, 25.0),  # whale
]

@dataclass
class Growth:
    name: str
    launch: int
    growth: float     # monthly new players as share of current actives
    churn: float      # monthly share of actives who quit

SCENARIOS = [
    Growth('pessimistic', 50, 0.06, 0.15),
    Growth('expected', 200, 0.15, 0.10),
    Growth('optimistic', 1000, 0.25, 0.08),
]

CHECKPOINTS = (6, 12, 18, 24, 30, 36)


def simulate(g: Growth, months=36):
    active = float(g.launch)
    champs = [0.0, 0.0, 0.0, 0.0]   # actively-held champions by station
    pool = POOL0
    circulating = 0.0
    burned_total = 0.0
    rows = []
    for m in range(1, months + 1):
        # population; churned players' champions stop mining and paying fees
        joined = active * g.growth
        champs = [c * (1 - g.churn) for c in champs]
        active = active * (1 - g.churn) + joined

        pulls = fusions = tempers = duels = 0.0
        for s in SEGMENTS:
            n = active * s.share
            pulls += n * s.pulls
            fusions += n * s.fusions
            tempers += n * s.tempers
            duels += n * s.duels

        for t in range(4):
            champs[t] += pulls * ODDS[t]

        # fusions consume two of station t, mint one of t+1
        fee_fusion = 0.0
        remaining = fusions
        for t in (0, 1, 2):
            can = min(remaining, champs[t] / 2)
            champs[t] -= 2 * can
            champs[t + 1] += can
            fee_fusion += can * FUSION_FEE[t] * FEE_SCALE
            remaining -= can
            if remaining <= 0:
                break

        # tempering fee ~ 1.5x first-rite cost of the tier, holdings-weighted
        total_ch = sum(champs) or 1.0
        temper_avg = sum(TEMPER_BASE[t] * 1.5 * champs[t] / total_ch for t in range(4))
        fee_temper = tempers * temper_avg * FEE_SCALE

        # duels: wager ~ 2x knight fusion fee; rake recycles, rest is p2p
        wager = 2 * FUSION_FEE[1] * FEE_SCALE
        fee_rake = duels * (2 * wager) * RAKE

        # emissions
        staked_weight = sum(champs[t] * STAKED_SHARE * WEIGHT[t] for t in range(4))
        if MODE == 'BUDGET':
            emit = pool * BUDGET_MONTHLY if staked_weight > 0 else 0.0
            emit = min(emit, staked_weight * MAX_YIELD_DAY * 30)
        else:
            emit = sum(champs[t] * STAKED_SHARE * RATE_DAY[t] for t in range(4))
            emit *= 30 * EMIT_MULT * 0.5 ** ((m - 1) // 12)
        emit = min(emit, pool)
        sov_daily = (WEIGHT[3] * emit / staked_weight / 30) if staked_weight else 0.0

        # players can only pay fees out of what circulates
        fees_wanted = fee_fusion + fee_temper + fee_rake
        pay = min(1.0, (circulating + emit) / fees_wanted) if fees_wanted else 0.0
        fee_fusion *= pay; fee_temper *= pay; fee_rake *= pay

        burned = fee_temper * BURN_TEMPER + fee_fusion * BURN_FUSION
        recycled = (fee_temper * (1 - BURN_TEMPER)
                    + fee_fusion * (1 - BURN_FUSION) + fee_rake)

        pool = pool - emit + recycled
        circulating = circulating + emit - recycled - burned
        burned_total += burned

        rows.append(dict(month=m, players=active, pool=pool, circ=circulating,
                         emit=emit, recycled=recycled, burned=burned_total,
                         champs=sum(champs), sov_daily=sov_daily,
                         staked_weight=staked_weight))
    return rows


def report(g: Growth, rows):
    print(f"\n=== {g.name.upper()} (launch {g.launch}, +{g.growth:.0%}/mo, "
          f"-{g.churn:.0%}/mo churn) ===")
    print('month  players     pool      circ   emit/mo  recyc/mo   burned'
          '  sov GEMS/d  sov payback')
    for r in rows:
        if r['month'] in CHECKPOINTS:
            # a sovereign acquired ~35x summon price (fusion path), repaid
            # by its daily yield at the assumed Dozer price
            sov_cost_htr = 35 * SUMMON_HTR
            pb = sov_cost_htr / (r['sov_daily'] * PRICE_HTR) if r['sov_daily'] else float('inf')
            print(f"{r['month']:>5}  {r['players']:>7.0f}  {r['pool']:>9,.0f}"
                  f"  {r['circ']:>8,.0f}  {r['emit']:>7,.0f}  {r['recycled']:>8,.0f}"
                  f"  {r['burned']:>7,.0f}  {r['sov_daily']:>10.2f}  {pb:>8.0f} d")
    end = rows[-1]
    last_sf = ((end['recycled'] + (end['burned'] - rows[-2]['burned'])) / end['emit']
               if end['emit'] else 0)
    print(f"  -> pool {end['pool'] / POOL0:.0%} of launch size; "
          f"final-month sink/faucet {last_sf:.2f}")


def sanity(rows):
    """Effort parity in the expected scenario at month 6: how long the
    rites take to afford from mining."""
    r = rows[5]
    if not r['staked_weight']:
        return
    per_weight_day = r['emit'] / r['staked_weight'] / 30
    foot_day = WEIGHT[0] * per_weight_day
    knight_day = WEIGHT[1] * per_weight_day
    sov_day = WEIGHT[3] * per_weight_day
    print('\nEFFORT PARITY (expected scenario, month 6)')
    print(f'  footman {foot_day:.3f} GEMS/day, knight {knight_day:.3f}, sovereign {sov_day:.2f}')
    print(f'  footman-pair fusion {FUSION_FEE[0] * FEE_SCALE:.2f} GEMS = '
          f'{FUSION_FEE[0] * FEE_SCALE / foot_day:.0f} footman-days')
    print(f'  knight-pair fusion {FUSION_FEE[1] * FEE_SCALE:.2f} GEMS = '
          f'{FUSION_FEE[1] * FEE_SCALE / knight_day:.0f} knight-days')
    print(f'  sovereign temper rite {TEMPER_BASE[3] * 1.5 * FEE_SCALE:.2f} GEMS = '
          f'{TEMPER_BASE[3] * 1.5 * FEE_SCALE / sov_day:.0f} sovereign-days')


if __name__ == '__main__':
    print(f'mode {MODE} | cap {CAP:,.0f} | pool {POOL0:,.0f} | '
          f'budget {BUDGET_MONTHLY:.1%}/mo | fee scale x{FEE_SCALE:.0f} | '
          f'summon {SUMMON_HTR:.0f} HTR | GEMS assumed {PRICE_HTR} HTR')
    expected_rows = None
    for g in SCENARIOS:
        rows = simulate(g)
        report(g, rows)
        if g.name == 'expected':
            expected_rows = rows
    if expected_rows:
        sanity(expected_rows)
