from typing import Optional

from hathor import (
    Address, Amount, Blueprint, Context, HATHOR_TOKEN_UID,
    NCDepositAction, NCFail, NCWithdrawalAction, TokenUid,
    export, public, view,
)


@export
class GachaMachine(Blueprint):
    """Onchain gacha machine.

    The operator loads 1-of-1 NFT prize tokens into four rarity pools
    (0=common, 1=rare, 2=epic, 3=legendary). Players pay a fixed HTR
    price per pull; the contract rolls Hathor's consensus-safe RNG to
    pick a rarity tier (weighted) and then a random prize inside that
    tier. The winner claims the NFT with a withdrawal in a second tx.
    """

    owner: Address
    pull_price: Amount
    weights: list[int]
    pool_0: list[TokenUid]
    pool_1: list[TokenUid]
    pool_2: list[TokenUid]
    pool_3: list[TokenUid]
    prize_name: dict[TokenUid, str]
    prize_tier: dict[TokenUid, int]
    pending: dict[TokenUid, Address]
    total_pulls: int
    proceeds: Amount
    history: list[str]

    @public
    def initialize(self, ctx: Context, owner: Address, pull_price: Amount,
                   weight_common: int, weight_rare: int,
                   weight_epic: int, weight_legendary: int) -> None:
        if pull_price <= 0:
            raise NCFail("pull_price must be positive")
        if weight_common < 0 or weight_rare < 0 or weight_epic < 0 or weight_legendary < 0:
            raise NCFail("weights cannot be negative")
        if weight_common + weight_rare + weight_epic + weight_legendary <= 0:
            raise NCFail("weights must sum to a positive number")
        self.owner = owner
        self.pull_price = pull_price
        self.weights = [weight_common, weight_rare, weight_epic, weight_legendary]
        self.pool_0 = []
        self.pool_1 = []
        self.pool_2 = []
        self.pool_3 = []
        self.prize_name = {}
        self.prize_tier = {}
        self.pending = {}
        self.total_pulls = 0
        self.proceeds = 0
        self.history = []

    # ------------------------------------------------------------------
    # Operator methods
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def mint_prize(self, ctx: Context, name: str, symbol: str, tier: int) -> TokenUid:
        """Mint a fresh 1-of-1 prize token inside the contract.

        Requires a small HTR deposit (1 cent) to cover the token
        creation deposit taken by the chain.
        """
        self._check_owner(ctx)
        self._check_tier(tier)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected an HTR deposit")
        if action.amount < 1:
            raise NCFail("deposit at least 0.01 HTR to cover token creation")
        token = self.syscall.create_deposit_token(
            token_name=name,
            token_symbol=symbol,
            amount=1,
            mint_authority=False,
            melt_authority=False,
        )
        self._add_prize(token, name, tier)
        self.syscall.emit_event(
            f'{{"event":"prize_minted","token":"{token.hex()}","tier":{tier}}}'.encode()
        )
        return token

    @public(allow_deposit=True)
    def deposit_prize(self, ctx: Context, name: str, tier: int) -> None:
        """Deposit an existing 1-of-1 NFT token as a prize."""
        self._check_owner(ctx)
        self._check_tier(tier)
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one deposit action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected a deposit action")
        if action.token_uid == HATHOR_TOKEN_UID:
            raise NCFail("prize cannot be HTR")
        if action.amount != 1:
            raise NCFail("prize must be a single NFT unit")
        if action.token_uid in self.prize_tier:
            raise NCFail("prize already registered")
        self._add_prize(action.token_uid, name, tier)
        self.syscall.emit_event(
            f'{{"event":"prize_deposited","token":"{action.token_uid.hex()}","tier":{tier}}}'.encode()
        )

    @public
    def set_pull_price(self, ctx: Context, new_price: Amount) -> None:
        self._check_owner(ctx)
        if new_price <= 0:
            raise NCFail("pull_price must be positive")
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
    # Player methods
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def pull(self, ctx: Context) -> TokenUid:
        """Pay the pull price and win a random prize NFT."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can pull")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected an HTR deposit")
        if action.amount != self.pull_price:
            raise NCFail(f"pull costs exactly {self.pull_price}")
        total_prizes = (len(self.pool_0) + len(self.pool_1)
                        + len(self.pool_2) + len(self.pool_3))
        if total_prizes == 0:
            raise NCFail("no prizes available")

        tier = self._roll_tier()
        tier = self._fallback_tier(tier)
        token = self._take_random_prize(tier)

        self.pending[token] = caller
        self.proceeds += action.amount
        self.total_pulls += 1
        self.history.append(
            f'pull={self.total_pulls} tier={tier} token={token.hex()}'
        )
        self.syscall.emit_event(
            f'{{"event":"pull","pull":{self.total_pulls},"tier":{tier},'
            f'"token":"{token.hex()}"}}'.encode()
        )
        return token

    @public(allow_withdrawal=True)
    def claim(self, ctx: Context) -> None:
        """Withdraw a prize NFT you won with pull()."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can claim")
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one withdrawal action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected a withdrawal action")
        winner = self.pending.get(action.token_uid)
        if winner is None:
            raise NCFail("prize not pending")
        if winner != caller:
            raise NCFail("prize belongs to someone else")
        if action.amount != 1:
            raise NCFail("prize is a single NFT unit")
        del self.pending[action.token_uid]
        self.syscall.emit_event(
            f'{{"event":"claim","token":"{action.token_uid.hex()}"}}'.encode()
        )

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @view
    def get_pull_price(self) -> Amount:
        return self.pull_price

    @view
    def get_pool_size(self, tier: int) -> int:
        if tier == 0:
            return len(self.pool_0)
        if tier == 1:
            return len(self.pool_1)
        if tier == 2:
            return len(self.pool_2)
        if tier == 3:
            return len(self.pool_3)
        raise NCFail("tier must be 0-3")

    @view
    def get_total_pulls(self) -> int:
        return self.total_pulls

    @view
    def get_prize_name(self, token: TokenUid) -> str:
        return self.prize_name.get(token, "")

    @view
    def get_prize_tier(self, token: TokenUid) -> int:
        return self.prize_tier.get(token, -1)

    @view
    def get_pending_winner(self, token: TokenUid) -> Optional[Address]:
        return self.pending.get(token)

    @view
    def get_proceeds(self) -> Amount:
        return self.proceeds

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_owner(self, ctx: Context) -> None:
        if ctx.caller_id != self.owner:
            raise NCFail("owner only")

    def _check_tier(self, tier: int) -> None:
        if tier < 0 or tier > 3:
            raise NCFail("tier must be 0-3")

    def _pool(self, tier: int) -> list[TokenUid]:
        if tier == 0:
            return self.pool_0
        if tier == 1:
            return self.pool_1
        if tier == 2:
            return self.pool_2
        return self.pool_3

    def _add_prize(self, token: TokenUid, name: str, tier: int) -> None:
        self._pool(tier).append(token)
        self.prize_name[token] = name
        self.prize_tier[token] = tier

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
        # If the rolled tier is empty, fall back to the nearest lower
        # tier with prizes, then upward. pull() guarantees at least one
        # prize exists somewhere.
        if len(self._pool(tier)) > 0:
            return tier
        step = tier - 1
        while step >= 0:
            if len(self._pool(step)) > 0:
                return step
            step -= 1
        step = tier + 1
        while step <= 3:
            if len(self._pool(step)) > 0:
                return step
            step += 1
        raise NCFail("no prizes available")

    def _take_random_prize(self, tier: int) -> TokenUid:
        pool = self._pool(tier)
        idx = self.syscall.rng.randbelow(len(pool))
        token = pool[idx]
        last = pool.pop()
        if idx < len(pool):
            pool[idx] = last
        return token
