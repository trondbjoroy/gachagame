# Hathor Gacha — onchain gacha game on Hathor Network

A fully onchain gacha machine (Collector Crypt-style, minus physical items) running on
Hathor's **testnet-playground** as a nano contract. Prizes are 1-of-1 NFT tokens held by
the contract; draws use Hathor's consensus-safe onchain RNG (`syscall.rng`, ChaCha20).

## Deployed on testnet-playground (2026-07-07)

| Thing | ID |
|---|---|
| Blueprint (`GachaMachine`) | `006f4431bcfeea625e5e062913c73a29f5da3ee59548b5ce26ec87725ae5f535` |
| Gacha contract instance | `00afd03115df73ad6aee7c168284144702a70e5d8e2acd820591d36fb76e05fb` |
| Operator wallet | `Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG` (seed in `wallet-headless.config.js`, testnet-only) |
| Player wallet | `WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE` |

Explorer: https://explorer.playground.testnet.hathor.network/

Config at deploy: pull price **5** (0.05 HTR), tier weights **6000/3000/900/100** bps
(common/rare/epic/legendary).

### Prize tokens minted inside the contract

| Prize | Tier | Token UID |
|---|---|---|
| Pixel Slime | 0 common | `a7e5c998087b724593385db9bcc6bcf62f1324321be3859c29d90c8c09497f23` |
| Rusty Dagger | 0 common | `52d170e7aca0c78d8862a7adb127410101412c2274b1793f04093dbbe2601781` |
| Storm Falcon | 1 rare | `d5be17e3d131bf8a97d1c9075e02bddf3f7d4370615812e7a635742dd3c05e45` |
| Crystal Golem | 1 rare | `4bdc8bdcd274a968a9a0e28cc7dd751cc41d424a566f2c88956b78302b2f6cde` |
| Shadow Dragon | 2 epic | `f761a271af407c32bd2bd8dc4ef68edcbdf2c02db703091ebdd3447be82061a3` |
| Genesis Phoenix | 3 legendary | `1c06c1fa6354f13c8f7a70f3bf74621cd53251e8c0553db3d057f23e6394940f` |

Live demo result: 5 pulls by the player wallet won both commons, both rares and the epic;
all 5 claimed to the player wallet. The legendary is still inside the machine.

## How the game works

1. **Operator** instantiates `GachaMachine` with a pull price and 4 tier weights (basis points).
2. **Operator stocks prizes** either way:
   - `mint_prize(name, symbol, tier)` + 1-cent HTR deposit — the contract mints a fresh
     1-of-1 token (no mint/melt authorities, so the supply is frozen at 1 forever).
   - `deposit_prize(name, tier)` + deposit action of exactly 1 unit of an existing NFT.
3. **Player calls `pull()`** with a deposit of exactly `pull_price` HTR. The contract:
   - rolls a rarity tier weighted by the configured basis points (`rng.randbelow`),
   - falls back to the nearest non-empty tier if the rolled one is empty,
   - picks a uniformly random prize inside the tier (swap-and-pop removal),
   - reserves the prize for the caller in `pending` and emits a `pull` event.
4. **Player calls `claim()`** with a withdrawal action of 1 unit of the won token.
5. **Operator calls `withdraw_proceeds()`** to collect accumulated pull fees.

Randomness: `self.syscall.rng` is Hathor's deterministic per-contract ChaCha20 RNG,
seeded by consensus — every node computes the same draw, no oracle needed. (Good for
games; not for secrets.)

## Repo layout

- `blueprint/gacha_machine.py` — the nano contract (published on-chain verbatim).
- `frontend/` — web UI (vanilla JS, no build step). `server.js` is a zero-dependency
  Node server on **http://localhost:8090** that serves `public/` and proxies
  `/api/*` → wallet-headless and `/node/*` → the playground fullnode (avoids CORS).
  Run with `node frontend/server.js`. The UI plays as the `player` wallet: live odds
  and pool counts, PULL with mempool→block-confirmation tracking and a rarity-glow
  reveal, one-click CLAIM, and your NFT collection.
- `miner/miner.py` — minimal local tx-mining service. testnet-playground enforces
  `min_tx_weight=8` with coefficient 0, so PoW is ~256 sha256d hashes; this service
  speaks the official tx-mining protocol (`submit-job`/`job-status`/`health`) and solves
  jobs inline with `hathorlib`. Needed because Hathor's public tx-mining services do not
  serve the playground network.
- `wallet-headless.config.js` — config for hathor-wallet-headless (v0.40.0): playground
  node + local miner + testnet seeds. The service itself is not committed; clone it from
  https://github.com/HathorNetwork/hathor-wallet-headless into `wallet-headless/` and
  copy this file to `wallet-headless/config.js` (and `wallet-headless/dist/config.js`
  after building).

## Running the stack

```bash
# 1. miner (needs: pip install hathorlib — note: pins cryptography 42.x)
python miner/miner.py                      # listens on 127.0.0.1:8035

# 2. wallet-headless (needs Node >= 22; config.js must exist in dist/ too)
git clone https://github.com/HathorNetwork/hathor-wallet-headless wallet-headless
cp wallet-headless.config.js wallet-headless/config.js
cd wallet-headless && npm install && npm run build
cp config.js dist/config.js && node dist/index.js   # listens on :8000

# 3. start wallets
curl -X POST localhost:8000/start -H 'Content-Type: application/json' \
     -d '{"wallet-id":"operator","seedKey":"operator"}'
curl -X POST localhost:8000/start -H 'Content-Type: application/json' \
     -d '{"wallet-id":"player","seedKey":"player"}'
```

Faucet (1 HTR / 24h / IP): `POST https://faucet.hathor.dev/api/drip {"address":"W..."}`

## Playing via the wallet-headless API

```bash
NC=00afd03115df73ad6aee7c168284144702a70e5d8e2acd820591d36fb76e05fb

# pull (player pays 5 cents HTR)
curl -X POST localhost:8000/wallet/nano-contracts/execute \
  -H 'x-wallet-id: player' -H 'Content-Type: application/json' -d '{
  "nc_id":"'$NC'","method":"pull","address":"WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE",
  "data":{"actions":[{"type":"deposit","token":"00","amount":5}]}}'

# see what you won (after block confirmation)
curl "https://node1.playground.testnet.hathor.network/v1a/nano_contract/state?id=$NC&balances[]=__all__"
# then map a token: calls[]=get_prize_name("<uid>")&calls[]=get_pending_winner("<uid>")

# claim the NFT
curl -X POST localhost:8000/wallet/nano-contracts/execute \
  -H 'x-wallet-id: player' -H 'Content-Type: application/json' -d '{
  "nc_id":"'$NC'","method":"claim","address":"WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE",
  "data":{"actions":[{"type":"withdrawal","token":"<won-token-uid>","amount":1,
                      "address":"WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE"}]}}'
```

Nano contract transactions execute when the next block confirms them (typically under
a minute on the playground). Query state any time via the node's
`/v1a/nano_contract/state` endpoint; per-tx execution logs via `/v1a/nano_contract/logs?id=<tx>`.

## Deploying to a public domain

The frontend proxy is hardened for public exposure: it only forwards
`GET /wallet/address?index=0`, `GET /wallet/balance[?token=…]`, and
`POST /wallet/nano-contracts/execute` restricted to `pull`/`claim` on this contract,
with the caller and withdrawal addresses pinned to the shared wallet and per-IP rate
limits (6 tx/min, 90 reads/min). Node reads are limited to state/logs/transaction, GET only.
Everything else returns 403 — wallet-headless itself must never be exposed directly.

On a fresh Ubuntu 22.04/24.04 VPS:

```bash
git clone https://github.com/trondbjoroy/gachagame /opt/gacha
cd /opt/gacha && sudo bash deploy/setup.sh
# point your domain's A record at the VPS, then:
sudo nano /etc/caddy/Caddyfile   # replace gacha.example.com
sudo systemctl reload caddy
```

`deploy/` contains the setup script, four systemd units (miner, wallet-headless,
wallet-start oneshot, frontend) and the Caddyfile (automatic Let's Encrypt TLS).
Everything binds to localhost except Caddy on 80/443.

**This is a custodial shared-wallet demo:** every visitor plays with the same wallet.
Fine for a testnet showcase; for a real game, move to per-user wallets
(WalletConnect / create-hathor-dapp) so players sign their own transactions.

## Notes / caveats

- Testnet seeds are committed in `config.js` on purpose (throwaway, playground-only).
  Never do this with real funds.
- Two-step pull/claim is inherent to the UTXO model: the pull tx can't withdraw a token
  whose identity is only decided during execution.
- `pending` prizes never expire; an unclaimed prize stays reserved for its winner.
- The Hathor MCP server's hosted wallet sessions (`mcp.hathor.dev`) expired mid-build
  ("Session not found") — the local stack above replaces them entirely; the public node
  is still used for all reads.
