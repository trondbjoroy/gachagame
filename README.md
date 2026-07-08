# Hathor Gacha Arena — a complete onchain game on Hathor Network

Gacha pulls, NFT staking ("GEM farming", MOBOX-style), card fusion (Illuvium-style)
and power-weighted PvP duels (Gods Unchained-lite) — implemented as a single Hathor
nano contract with the consensus-safe onchain RNG. No oracle, no backend game server.

## Game design

- **Pull (0.05 HTR)** — the contract rolls a rarity tier (60/30/9/1% in basis points),
  picks a card template, and **mints a fresh 1-of-1 card token** (100 base units =
  "1.00") with an RNG-rolled **power stat** (base per tier + roll). Claim it to your wallet.
- **GEM Farm** — stake cards into the contract; they accrue **GEMS** (a
  contract-created token) per minute by tier: 0.01 / 0.03 / 0.10 / 0.40. Rewards
  live in an in-contract ledger; withdraw them as real GEMS tokens any time (pull
  proceeds provide the HTR collateral that GEMS minting requires — the economy is
  self-funding).
- **Fusion (0.05 GEMS)** — burn (melt) two same-tier cards and receive a next-tier
  card that inherits 10% of the parents' combined power.
- **Arena** — open a duel by depositing a card + a GEMS wager; an opponent accepts
  with their card; the contract rolls `randbelow(powerA + powerB)` — winner takes
  the pot minus a 5% house rake. Cards always return to their owners; win counts
  are tracked onchain.

## Deployed on testnet-playground (2026-07-08, v2)

| Thing | ID |
|---|---|
| Blueprint (`GachaArena`) | `00d087732f8c308833fb49cd5ed177384e49666a6fc40f0676cf5e1980d2c588` |
| Game contract | `00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8` |
| GEMS token | `3647ee44cf81b74dd8e8e26d7b6237cc7c6b588e53cc30dd0a2eb3dbdf5c63f2` |
| Operator wallet | `Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG` (seed in `wallet-headless.config.js`, testnet-only) |
| Demo player wallet | `WSAici31LzwhrgKaRiXHFjWx3XF4eGTiUE` |

All mechanics verified live onchain: pulls with power rolls, claims, staking + GEMS
accrual, ledger withdrawals (with mint-collateral path), fusion (two Pixel Slimes
melted -> rare Crystal Golem, power bonus applied), and a duel resolved by the RNG.

The v1 pre-stocked `GachaMachine` (blueprint
`006f4431bcfeea625e5e062913c73a29f5da3ee59548b5ce26ec87725ae5f535`, contract
`00afd03115df73ad6aee7c168284144702a70e5d8e2acd820591d36fb76e05fb`) remains onchain;
its source is kept at `blueprint/gacha_machine.py`.

## Wallet connection

The frontend has three interchangeable wallet adapters (`frontend/public/wallets.js`),
all speaking Hathor's wallet-dapp JSON-RPC (`htr_sendNanoContractTx` etc.):

1. **MetaMask (Hathor Snap)** — connects via `wallet_requestSnaps` to `npm:@hathor/snap`.
2. **WalletConnect / Reown** — pairs the official Hathor mobile/desktop wallet by QR.
   Needs a free project id from https://cloud.reown.com in `frontend/public/config.js`.
3. **Demo wallet** — the shared custodial wallet through the hardened server proxy;
   zero-setup instant play.

Caveat: the Snap and WalletConnect paths are implemented to spec but could not be
end-to-end tested here — user wallets don't serve the playground network's
tx-mining, so they become fully usable when the contract is redeployed to a network
the official wallets serve (testnet/mainnet). The demo adapter is fully tested.

## Card tokenomics note

Cards are minted with 100 base units (displayed "1.00") rather than the classic
1-unit NFT because the node rejects melting a single unit (the melt fee rounds to
zero). 100 units keep the same 1-cent mint collateral, make melts legal, and the
whole supply always moves as one indivisible chunk enforced by the contract.

## Repo layout

- `blueprint/gacha_arena.py` — the game contract (published on-chain verbatim);
  `blueprint/gacha_machine.py` is the simpler v1.
- `scripts/arena_test.py` — phased on-chain test driver used to verify every mechanic.
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
