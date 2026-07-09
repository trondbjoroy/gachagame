# Emberfall — an onchain card game on Hathor

**Live at https://emberfall.fun** on the public Hathor testnet.

Gacha summons, NFT staking ("GEM farming", MOBOX-style), card fusion
(Illuvium-style) and power-weighted PvP duels (Gods Unchained-lite), plus a
player-to-player marketplace — implemented as two Hathor nano contracts using the
consensus-safe onchain RNG. No oracle, no backend game server, self-custody only.

## Game design

Lore: the throne of Emberfall sits empty; champions are bound into soulstone tokens
on the Great Ledger. Rarity tiers are stations: **Footman / Knight / Highlord /
Sovereign** (60/30/9/1%).

- **Summon (0.05 HTR)** — the contract rolls a station, picks a card template, and
  **mints a fresh 1-of-1 card token** (100 base units = "1.00") with an RNG-rolled
  **power stat**. Claim it to your wallet. Blocks average ~7.5s, so deeds settle in
  ~5–15 seconds.
- **The Mines** — stake cards; they accrue **GEMS** (a contract-created token) per
  minute by station: 0.01 / 0.03 / 0.10 / 0.40. Rewards accrue to an in-contract
  ledger; withdraw as real tokens any time. Summon proceeds provide the HTR
  collateral GEMS minting requires — the economy is self-funding.
- **Rite of Union (0.05 GEMS)** — melt two same-station cards, receive a
  next-station card inheriting 10% of the parents' combined power.
- **The Pit** — open a duel with a card + GEMS wager; an opponent accepts with
  theirs; the contract rolls `randbelow(powerA + powerB)` — winner takes the pot
  minus a 5% rake. Cards always return to their owners; wins are tracked onchain.
- **The Bazaar** — a second contract escrows fixed-price HTR listings (2% fee,
  seller proceeds ledger) and card-for-card swap offers.

## Live deployment (Hathor public testnet, testnet-india)

| Thing | ID |
|---|---|
| GachaArena blueprint | `00fd125434accb0f6eeb50936ea0a60b4f8f930e401d3095cb9fa77c2b88d7b5` |
| Game contract | `00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb` |
| CardMarket blueprint | `00ddf5d21557d3d6dd9d34e88c43abc1a399faeb1bd5088dc5af617ed5be8938` |
| Market contract | `006318ef0471d957345db139f9b5e0b1d830e596180de558ea37b289845d1391` |
| GEMS token | `357ec146e2492361474c4d6d685a9e7747360b44a5ec829c856f020a10f834d5` |
| Operator (owner/treasury) | `Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG` — seed in `wallet-headless.config.js` (testnet-only) |

Blueprints were published by the Hathor team (on-chain blueprint publishing on the
public testnet is allowlisted); the instances, the 18-champion template catalog, and
all mechanics were verified live, including summons signed by real user wallets.

Earlier playground-network deployments (v1 `GachaMachine`, the first `GachaArena`)
remain onchain but unused; sources live in `blueprint/`.

## Wallets

Self-custody only — the frontend has two adapters (`frontend/public/wallets.js`),
both speaking Hathor's wallet-dapp JSON-RPC (`htr_sendNanoContractTx` etc.):

1. **MetaMask (Hathor Snap)** — `npm:@hathor/snap`, discovered via EIP-6963.
   Snap quirks handled: responses may arrive JSON-stringified; the address comes
   from `htr_getWalletInformation.response.address0`; `htr_getBalance` opens a
   MetaMask prompt per call, so balances are read from the node instead
   (`/thin_wallet/address_balance`, prompt-free).
2. **WalletConnect / Reown** — QR pairing with the Hathor mobile/desktop wallet.
   Requires a project id in `frontend/public/config.js` and the domain allowlisted
   in the Reown dashboard. `htr_sendNanoContractTx` requires a `network` param.

Wallets must be set to **testnet**. Deposit actions pin `changeAddress` to the
player's main address so the node-side balance display stays accurate.

Card art: 18 hand-drawn heraldic SVG sigils (`frontend/public/art.js`) rendered
in-game. Official wallets show only the token symbol — wallet-side media for
contract-minted tokens isn't possible today (no data/URI param on the
`create_deposit_token` syscall, and wallet media requires Hathor's curated
metadata registry).

## Repo layout

- `blueprint/gacha_arena.py` — the game contract (published verbatim);
  `blueprint/card_market.py` — the marketplace; `blueprint/gacha_machine.py` — v1.
- `frontend/` — vanilla JS, no build step. `server.js` is a zero-dependency Node
  server (`:8090`) serving `public/` and proxying `/node/*` to the fullnode with a
  strict allowlist and per-IP rate limits (legacy `/api/*` wallet endpoints remain
  but the UI no longer uses them).
- `scripts/` — deployment and on-chain test drivers (`instantiate_testnet.py`,
  `arena_test.py`, `market_deploy_test.py`) plus the patch scripts used during
  development.
- `deploy/` — VPS kit: `setup.sh` (Ubuntu one-shot), systemd units, Caddyfile,
  daily treasury top-up cron.
- `miner/miner.py` — legacy local tx-mining service; only needed for the
  playground network. The public testnet uses Hathor's official tx-mining.
- `wallet-headless.config.js` — operator/player wallet config for
  hathor-wallet-headless (clone it separately; copy this file to
  `wallet-headless/config.js` and `dist/config.js` after building).

## Operating the game

The operator wallet owns both contracts. With wallet-headless running locally
(`node dist/index.js`, then `POST /start` for the `operator` seed):

```bash
GAME=00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb
MKT=006318ef0471d957345db139f9b5e0b1d830e596180de558ea37b289845d1391
OP=<operator address index 0>

# add a new champion template (tier 0-3)
curl -X POST localhost:8000/wallet/nano-contracts/execute -H 'x-wallet-id: operator' \
  -H 'Content-Type: application/json' -d '{"nc_id":"'$GAME'","method":"add_template",
  "address":"'$OP'","data":{"args":[1,"New Champion"]}}'

# withdraw summon proceeds (leave float for GEMS collateral!)
# withdraw_proceeds / withdraw_gems on the game, withdraw_fees on the market —
# all owner-gated; amounts in cents via a withdrawal action.
```

Fee streams: summon proceeds (HTR, on the game contract), 5% duel rake (GEMS,
owner ledger), 2% sale fee (HTR, on the market contract).

## Deploying

`https://emberfall.fun` runs on a 1GB Linode via `deploy/setup.sh`: four systemd
services (wallet, wallet-start, frontend; the miner unit is disabled on testnet)
behind Caddy with automatic TLS. Deploy an update:

```bash
ssh root@<vps> 'cd /opt/gacha && git pull && systemctl restart gacha-frontend'
```

Always verify the service picked up the change — `systemctl is-active` plus a
curl against the served file.

## Notes

- Cards are 100-base-unit tokens ("1.00") rather than 1-unit NFTs: the node
  rejects melting a single unit (melt fee rounds to zero), and fusion needs melts.
  The contract enforces cards always move as one indivisible 100-unit chunk.
- The committed seeds are testnet-only and intentionally public. Never reuse this
  pattern with real funds; the operator seed controls all game treasuries.
- The RNG is Hathor's consensus-deterministic ChaCha20 (`syscall.rng`) — fair for
  draws and duels, and auditable against this source.
