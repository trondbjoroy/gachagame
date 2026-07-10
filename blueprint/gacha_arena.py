from typing import Optional

from hathor import (
    Address, Amount, Blueprint, Context, HATHOR_TOKEN_UID,
    NCDepositAction, NCFail, NCWithdrawalAction, TokenUid,
    export, public, view,
)


@export
class EmberfallArena(Blueprint):
    """Onchain gacha game: pull cards, farm GEMS, fuse, duel.

    - pull(): pay HTR, a fresh 1-of-1 card token is minted from the
      template catalog of an RNG-rolled rarity tier (0..3) with an
      RNG-rolled power stat. Claim it with claim_card().
    - stake()/unstake()/claim_gems(): staked cards accrue GEMS
      (a contract-created reward token) per minute by tier.
    - fuse(): burn two same-tier cards + a GEMS fee, receive a
      next-tier card that inherits part of the parents' power.
    - create_duel()/accept_duel(): wager GEMS on a power-weighted
      RNG duel between two deposited cards; winner takes the pot
      minus the house rake.

    All GEMS bookkeeping is an internal ledger; withdraw_gems() /
    deposit_gems() move real GEMS tokens out of / into the contract.
    Pull proceeds provide the HTR collateral that GEMS minting needs.

    v2.2 — progression, funded from proceeds (never printed):
    - renown: every fee-bearing deed earns renown points, multiplied
      up to 2x by the vigil (consecutive days played, capped at 7).
    - deeds: one-time achievement flags (a bitmask per player) that
      pay a small GEMS bounty into the ledger, backed like all other
      GEMS by pull-proceeds collateral.
    - the Weaver's favor: 10% of every pull payment feeds a favor
      pool; each pull has a 1-in-25 chance to win back up to the pull
      price from that pool (never more than the pool holds).
      claim_favor() withdraws winnings.
    """

    owner: Address
    pull_price: Amount
    weights: list[int]
    gems_uid: TokenUid
    templates_0: list[str]
    templates_1: list[str]
    templates_2: list[str]
    templates_3: list[str]
    card_name: dict[TokenUid, str]
    card_tier: dict[TokenUid, int]
    card_power: dict[TokenUid, int]
    pending: dict[TokenUid, Address]
    staked: dict[TokenUid, Address]
    stake_since: dict[TokenUid, int]
    gems_ledger: dict[Address, Amount]
    duel_card: dict[int, TokenUid]
    duel_wager: dict[int, Amount]
    duel_challenger: dict[int, Address]
    duel_open: dict[int, bool]
    next_duel_id: int
    wins: dict[Address, int]
    total_pulls: int
    pulls_by: dict[Address, int]
    total_minted: int
    proceeds: Amount
    renown: dict[Address, int]
    vigil_day: dict[Address, int]
    vigil_streak: dict[Address, int]
    deed_flags: dict[Address, int]
    favor_pool: Amount
    favor_owed: dict[Address, Amount]

    @public(allow_deposit=True)
    def initialize(self, ctx: Context, owner: Address, pull_price: Amount,
                   weight_common: int, weight_rare: int,
                   weight_epic: int, weight_legendary: int) -> None:
        if pull_price <= 1:
            raise NCFail("pull_price must exceed the 1-cent mint collateral")
        if weight_common < 0 or weight_rare < 0 or weight_epic < 0 or weight_legendary < 0:
            raise NCFail("weights cannot be negative")
        if weight_common + weight_rare + weight_epic + weight_legendary <= 0:
            raise NCFail("weights must sum to a positive number")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction) or action.amount < 2:
            raise NCFail("deposit at least 0.02 HTR to create the GEMS token")
        self.owner = owner
        self.pull_price = pull_price
        self.weights = [weight_common, weight_rare, weight_epic, weight_legendary]
        self.templates_0 = []
        self.templates_1 = []
        self.templates_2 = []
        self.templates_3 = []
        self.card_name = {}
        self.card_tier = {}
        self.card_power = {}
        self.pending = {}
        self.staked = {}
        self.stake_since = {}
        self.gems_ledger = {}
        self.duel_card = {}
        self.duel_wager = {}
        self.duel_challenger = {}
        self.duel_open = {}
        self.next_duel_id = 0
        self.wins = {}
        self.total_pulls = 0
        self.pulls_by = {}
        self.total_minted = 0
        self.renown = {}
        self.vigil_day = {}
        self.vigil_streak = {}
        self.deed_flags = {}
        self.favor_pool = 0
        self.favor_owed = {}
        # deposited HTR beyond the GEMS-creation collateral seeds the reserve
        self.proceeds = action.amount - 1
        self.gems_uid = self.syscall.create_deposit_token(
            token_name="Emberfall Gems",
            token_symbol="GEMS",
            amount=100,
            mint_authority=True,
            melt_authority=False,
        )

    # ------------------------------------------------------------------
    # Tuning tables (gems-cents per minute, base power per tier)
    # ------------------------------------------------------------------

    def _rate_per_min(self, tier: int) -> int:
        return [1, 3, 10, 40][tier]

    def _power_base(self, tier: int) -> int:
        return [10, 25, 60, 150][tier]

    def _fusion_fee(self, tier: int) -> Amount:
        # gems-cents, by the station of the pair being fused
        return [5, 10, 50, 100][tier]

    def _rake_bps(self) -> int:
        return 500  # 5% of the duel pot

    def _favor_bps(self) -> int:
        return 1000  # 10% of each pull payment feeds the favor pool

    def _favor_odds(self) -> int:
        return 25  # 1-in-25 pulls wins the Weaver's favor

    def _fuse_renown(self, tier: int) -> int:
        # renown by the station of the pair being fused
        return [20, 40, 80, 0][tier]

    # deed bits and their one-time GEMS-cent bounties
    # 0 first summoning, 1 first rite of union, 2 forge a highlord,
    # 3 forge a sovereign, 4 first trial won, 5 ten trials won
    def _deed_bounty(self, bit: int) -> Amount:
        return [10, 20, 50, 200, 25, 100][bit]

    # ------------------------------------------------------------------
    # Progression internals
    # ------------------------------------------------------------------

    def _earn_renown(self, who: Address, base: int, now: int) -> None:
        day = now // 86400
        last = self.vigil_day.get(who, 0)
        if day == last:
            streak = self.vigil_streak.get(who, 1)
        elif day == last + 1:
            streak = self.vigil_streak.get(who, 0) + 1
            self.vigil_streak[who] = streak
            self.vigil_day[who] = day
        else:
            streak = 1
            self.vigil_streak[who] = 1
            self.vigil_day[who] = day
        capped = streak if streak < 7 else 7
        # 1x on day one, rising to 2x at a seven-day vigil
        self.renown[who] = self.renown.get(who, 0) + base + base * (capped - 1) // 6

    def _grant_deed(self, who: Address, bit: int) -> None:
        mask = self.deed_flags.get(who, 0)
        flag = 1 << bit
        if mask & flag:
            return
        self.deed_flags[who] = mask | flag
        bounty = self._deed_bounty(bit)
        if bounty > 0:
            self.gems_ledger[who] = self.gems_ledger.get(who, 0) + bounty

    # ------------------------------------------------------------------
    # Operator
    # ------------------------------------------------------------------

    @public
    def add_template(self, ctx: Context, tier: int, name: str) -> None:
        self._check_owner(ctx)
        self._check_tier(tier)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        self._templates(tier).append(name)

    @public
    def set_pull_price(self, ctx: Context, new_price: Amount) -> None:
        self._check_owner(ctx)
        if new_price <= 1:
            raise NCFail("pull_price must exceed the 1-cent mint collateral")
        self.pull_price = new_price

    @public(allow_withdrawal=True)
    def withdraw_proceeds(self, ctx: Context) -> None:
        self._check_owner(ctx)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        if action.amount > self.proceeds:
            raise NCFail(f"only {self.proceeds} available")
        self.proceeds -= action.amount

    # ------------------------------------------------------------------
    # Gacha
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def pull(self, ctx: Context) -> TokenUid:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can pull")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected an HTR deposit")
        if action.amount != self.pull_price:
            raise NCFail(f"pull costs exactly {self.pull_price}")
        tier = self._fallback_tier(self._roll_tier())
        card = self._mint_card(tier, 0)
        self.pending[card] = caller
        self.proceeds += action.amount - 1  # 1 cent consumed as mint collateral
        self.total_pulls += 1
        self.pulls_by[caller] = self.pulls_by.get(caller, 0) + 1
        # a slice of every pull feeds the favor pool (never printed)
        share = action.amount * self._favor_bps() // 10_000
        if share > self.proceeds:
            share = self.proceeds
        self.proceeds -= share
        self.favor_pool += share
        self._earn_renown(caller, 10, ctx.block.timestamp)
        self._grant_deed(caller, 0)
        # the Weaver's favor: a chance to win back up to the pull price
        if self.favor_pool > 0 and self.syscall.rng.randbelow(self._favor_odds()) == 0:
            prize = self.pull_price if self.pull_price <= self.favor_pool else self.favor_pool
            self.favor_pool -= prize
            self.favor_owed[caller] = self.favor_owed.get(caller, 0) + prize
            self.syscall.emit_event(
                f'{{"event":"favor","amount":{prize}}}'.encode()
            )
        self.syscall.emit_event(
            f'{{"event":"pull","tier":{tier},"token":"{card.hex()}"}}'.encode()
        )
        return card

    @public(allow_withdrawal=True)
    def claim_card(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        action = self._single_card_withdrawal(ctx)
        winner = self.pending.get(action.token_uid)
        if winner is None:
            raise NCFail("card not pending")
        if winner != caller:
            raise NCFail("card belongs to someone else")
        del self.pending[action.token_uid]

    # ------------------------------------------------------------------
    # Staking / GEMS farming
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def stake(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can stake")
        action = self._single_card_deposit(ctx)
        card = action.token_uid
        self.staked[card] = caller
        self.stake_since[card] = ctx.block.timestamp

    @public
    def claim_gems(self, ctx: Context, card: TokenUid) -> Amount:
        caller = ctx.get_caller_address()
        if self.staked.get(card) != caller:
            raise NCFail("not your staked card")
        gems = self._accrue(card, ctx.block.timestamp)
        return gems

    @public(allow_withdrawal=True)
    def unstake(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        action = self._single_card_withdrawal(ctx)
        card = action.token_uid
        if self.staked.get(card) != caller:
            raise NCFail("not your staked card")
        self._accrue(card, ctx.block.timestamp)
        del self.staked[card]
        del self.stake_since[card]

    @public(allow_withdrawal=True)
    def withdraw_gems(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can withdraw")
        action = ctx.get_single_action(self.gems_uid)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected a GEMS withdrawal")
        balance = self.gems_ledger.get(caller, 0)
        if action.amount > balance:
            raise NCFail(f"only {balance} GEMS-cents in your ledger")
        held = self.syscall.get_balance_before_current_call(token_uid=self.gems_uid)
        if action.amount > held:
            shortfall = action.amount - held
            collateral = (shortfall + 99) // 100
            if collateral > self.proceeds:
                raise NCFail("reward pool needs more pulls to back this withdrawal")
            self.proceeds -= collateral
            self.syscall.mint_tokens(token_uid=self.gems_uid, amount=shortfall)
        self.gems_ledger[caller] = balance - action.amount

    @public(allow_deposit=True)
    def deposit_gems(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can deposit")
        action = ctx.get_single_action(self.gems_uid)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected a GEMS deposit")
        self.gems_ledger[caller] = self.gems_ledger.get(caller, 0) + action.amount

    # ------------------------------------------------------------------
    # Fusion
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def fuse(self, ctx: Context) -> TokenUid:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can fuse")
        if len(ctx.actions_list) != 2:
            raise NCFail("deposit exactly two cards")
        a = ctx.actions_list[0]
        b = ctx.actions_list[1]
        for act in (a, b):
            if not isinstance(act, NCDepositAction) or act.amount != 100:
                raise NCFail("each action must deposit one full card (100 units)")
            if act.token_uid not in self.card_tier:
                raise NCFail("unknown card")
        if a.token_uid == b.token_uid:
            raise NCFail("two distinct cards required")
        tier = self.card_tier[a.token_uid]
        if self.card_tier[b.token_uid] != tier:
            raise NCFail("cards must be the same tier")
        if tier >= 3:
            raise NCFail("legendary cards cannot be fused")
        fee = self._fusion_fee(tier)
        balance = self.gems_ledger.get(caller, 0)
        if balance < fee:
            raise NCFail(f"fusion costs {fee} GEMS-cents (earn them by staking)")
        self.gems_ledger[caller] = balance - fee
        bonus = (self.card_power[a.token_uid] + self.card_power[b.token_uid]) // 10
        for act in (a, b):
            self.syscall.melt_tokens(token_uid=act.token_uid, amount=100)
            del self.card_name[act.token_uid]
            del self.card_tier[act.token_uid]
            del self.card_power[act.token_uid]
        self.proceeds += 2  # each 100-unit melt refunds 1 cent of collateral
        new_tier = tier + 1
        if len(self._templates(new_tier)) == 0:
            raise NCFail("no templates for the next tier")
        if self.proceeds < 1:
            raise NCFail("reward pool too low to mint")
        self.proceeds -= 1
        card = self._mint_card(new_tier, bonus)
        self.pending[card] = caller
        self._earn_renown(caller, self._fuse_renown(tier), ctx.block.timestamp)
        self._grant_deed(caller, 1)
        if new_tier >= 2:
            self._grant_deed(caller, 2)
        if new_tier >= 3:
            self._grant_deed(caller, 3)
        self.syscall.emit_event(
            f'{{"event":"fuse","tier":{new_tier},"token":"{card.hex()}"}}'.encode()
        )
        return card

    # ------------------------------------------------------------------
    # Duels
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def create_duel(self, ctx: Context, wager: Amount) -> int:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can duel")
        if wager < 0:
            raise NCFail("wager cannot be negative")
        action = self._single_card_deposit(ctx)
        balance = self.gems_ledger.get(caller, 0)
        if balance < wager:
            raise NCFail("not enough GEMS in your ledger for this wager")
        self.gems_ledger[caller] = balance - wager
        duel_id = self.next_duel_id
        self.next_duel_id = duel_id + 1
        self.duel_card[duel_id] = action.token_uid
        self.duel_wager[duel_id] = wager
        self.duel_challenger[duel_id] = caller
        self.duel_open[duel_id] = True
        return duel_id

    @public(allow_deposit=True)
    def accept_duel(self, ctx: Context, duel_id: int) -> int:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can duel")
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        challenger = self.duel_challenger[duel_id]
        if challenger == caller:
            raise NCFail("cannot duel yourself")
        action = self._single_card_deposit(ctx)
        wager = self.duel_wager[duel_id]
        balance = self.gems_ledger.get(caller, 0)
        if balance < wager:
            raise NCFail("not enough GEMS in your ledger for this wager")
        self.gems_ledger[caller] = balance - wager

        their_card = self.duel_card[duel_id]
        my_card = action.token_uid
        pa = self.card_power[their_card]
        pb = self.card_power[my_card]
        roll = self.syscall.rng.randbelow(pa + pb)
        winner = challenger if roll < pa else caller

        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        self.gems_ledger[winner] = self.gems_ledger.get(winner, 0) + pot - rake
        self.gems_ledger[self.owner] = self.gems_ledger.get(self.owner, 0) + rake
        self.wins[winner] = self.wins.get(winner, 0) + 1
        # renown only when a fight actually happens (cannot be farmed by
        # opening and cancelling); the winner takes a flat bonus on top
        self._earn_renown(challenger, 5, ctx.block.timestamp)
        self._earn_renown(caller, 5, ctx.block.timestamp)
        self.renown[winner] = self.renown.get(winner, 0) + 10
        self._grant_deed(winner, 4)
        if self.wins[winner] >= 10:
            self._grant_deed(winner, 5)

        self.pending[their_card] = challenger
        self.pending[my_card] = caller
        self.duel_open[duel_id] = False
        self.syscall.emit_event(
            f'{{"event":"duel","id":{duel_id},"roll":{roll},"pa":{pa},"pb":{pb}}}'.encode()
        )
        return 0 if winner == challenger else 1

    @public(allow_withdrawal=True)
    def claim_favor(self, ctx: Context) -> None:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can claim")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        owed = self.favor_owed.get(caller, 0)
        if action.amount > owed:
            raise NCFail(f"the Weaver owes you {owed}")
        self.favor_owed[caller] = owed - action.amount

    @public
    def cancel_duel(self, ctx: Context, duel_id: int) -> None:
        caller = ctx.get_caller_address()
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        if self.duel_challenger[duel_id] != caller:
            raise NCFail("not your duel")
        self.gems_ledger[caller] = self.gems_ledger.get(caller, 0) + self.duel_wager[duel_id]
        self.pending[self.duel_card[duel_id]] = caller
        self.duel_open[duel_id] = False

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @view
    def get_pull_price(self) -> Amount:
        return self.pull_price

    @view
    def get_gems_uid(self) -> TokenUid:
        return self.gems_uid

    @view
    def get_card_name(self, card: TokenUid) -> str:
        return self.card_name.get(card, "")

    @view
    def get_card_tier(self, card: TokenUid) -> int:
        return self.card_tier.get(card, -1)

    @view
    def get_card_power(self, card: TokenUid) -> int:
        return self.card_power.get(card, 0)

    @view
    def get_pending_owner(self, card: TokenUid) -> Optional[Address]:
        return self.pending.get(card)

    @view
    def get_staker(self, card: TokenUid) -> Optional[Address]:
        return self.staked.get(card)

    @view
    def get_pending_gems(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since.get(card)
        if since is None:
            return 0
        tier = self.card_tier.get(card, 0)
        return (now - since) * self._rate_per_min(tier) // 60

    @view
    def get_gems_balance(self, address: Address) -> Amount:
        return self.gems_ledger.get(address, 0)

    @view
    def get_wins(self, address: Address) -> int:
        return self.wins.get(address, 0)

    @view
    def get_duel_count(self) -> int:
        return self.next_duel_id

    @view
    def get_duel(self, duel_id: int) -> str:
        if duel_id < 0 or duel_id >= self.next_duel_id:
            return ""
        status = "open" if self.duel_open.get(duel_id, False) else "closed"
        card = self.duel_card[duel_id]
        return f"{status}|{card.hex()}|{self.duel_wager[duel_id]}"

    @view
    def get_duel_challenger(self, duel_id: int) -> Optional[Address]:
        return self.duel_challenger.get(duel_id)

    @view
    def get_template_count(self, tier: int) -> int:
        if tier < 0 or tier > 3:
            return 0
        return len(self._templates(tier))

    @view
    def get_total_pulls(self) -> int:
        return self.total_pulls

    @view
    def get_player_pulls(self, address: Address) -> int:
        return self.pulls_by.get(address, 0)

    @view
    def get_proceeds(self) -> Amount:
        return self.proceeds

    @view
    def get_renown(self, address: Address) -> int:
        return self.renown.get(address, 0)

    @view
    def get_vigil_streak(self, address: Address) -> int:
        return self.vigil_streak.get(address, 0)

    @view
    def get_vigil_day(self, address: Address) -> int:
        return self.vigil_day.get(address, 0)

    @view
    def get_deed_flags(self, address: Address) -> int:
        return self.deed_flags.get(address, 0)

    @view
    def get_favor_pool(self) -> Amount:
        return self.favor_pool

    @view
    def get_favor_owed(self, address: Address) -> Amount:
        return self.favor_owed.get(address, 0)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_owner(self, ctx: Context) -> None:
        if ctx.caller_id != self.owner:
            raise NCFail("owner only")

    def _check_tier(self, tier: int) -> None:
        if tier < 0 or tier > 3:
            raise NCFail("tier must be 0-3")

    def _templates(self, tier: int) -> list[str]:
        if tier == 0:
            return self.templates_0
        if tier == 1:
            return self.templates_1
        if tier == 2:
            return self.templates_2
        return self.templates_3

    def _single_card_deposit(self, ctx: Context) -> NCDepositAction:
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCDepositAction) or action.amount != 100:
            raise NCFail("expected a deposit of one full card (100 units)")
        if action.token_uid not in self.card_tier:
            raise NCFail("unknown card")
        return action

    def _single_card_withdrawal(self, ctx: Context) -> NCWithdrawalAction:
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCWithdrawalAction) or action.amount != 100:
            raise NCFail("expected a withdrawal of one full card (100 units)")
        if action.token_uid not in self.card_tier:
            raise NCFail("unknown card")
        return action

    def _roll_tier(self) -> int:
        total = (self.weights[0] + self.weights[1]
                 + self.weights[2] + self.weights[3])
        roll = self.syscall.rng.randbelow(total)
        acc = 0
        for i in range(4):
            acc += self.weights[i]
            if roll < acc:
                return i
        return 3

    def _fallback_tier(self, tier: int) -> int:
        if len(self._templates(tier)) > 0:
            return tier
        step = tier - 1
        while step >= 0:
            if len(self._templates(step)) > 0:
                return step
            step -= 1
        step = tier + 1
        while step <= 3:
            if len(self._templates(step)) > 0:
                return step
            step += 1
        raise NCFail("no card templates configured")

    def _mint_card(self, tier: int, power_bonus: int) -> TokenUid:
        pool = self._templates(tier)
        name = pool[self.syscall.rng.randbelow(len(pool))]
        base = self._power_base(tier)
        power = base + self.syscall.rng.randbelow(base) + power_bonus
        serial = self.total_minted
        self.total_minted = serial + 1
        card = self.syscall.create_deposit_token(
            token_name=name,
            token_symbol=f"G{serial}",
            amount=100,
            mint_authority=False,
            melt_authority=True,
        )
        self.card_name[card] = name
        self.card_tier[card] = tier
        self.card_power[card] = power
        return card

    def _accrue(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since[card]
        tier = self.card_tier[card]
        gems = (now - since) * self._rate_per_min(tier) // 60
        if gems > 0:
            staker = self.staked[card]
            self.gems_ledger[staker] = self.gems_ledger.get(staker, 0) + gems
            self.stake_since[card] = now
        return gems
