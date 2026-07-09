import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

GAME_BP = "00fd125434accb0f6eeb50936ea0a60b4f8f930e401d3095cb9fa77c2b88d7b5"
GAME = "00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb"
GEMS = "357ec146e2492361474c4d6d685a9e7747360b44a5ec829c856f020a10f834d5"
MKT_BP = "00ddf5d21557d3d6dd9d34e88c43abc1a399faeb1bd5088dc5af617ed5be8938"
MKT = "006318ef0471d957345db139f9b5e0b1d830e596180de558ea37b289845d1391"

# ---- config.js ----
p = "frontend/public/config.js"
s = open(p, encoding="utf-8").read()
s = s.replace("00d087732f8c308833fb49cd5ed177384e49666a6fc40f0676cf5e1980d2c588", GAME_BP)
s = s.replace("00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8", GAME)
s = s.replace("3647ee44cf81b74dd8e8e26d7b6237cc7c6b588e53cc30dd0a2eb3dbdf5c63f2", GEMS)
s = s.replace("00837059d28414c67004c1ec6c08187b2c559c8db374210c00022077262e68e4", MKT_BP)
s = s.replace("00d0f42e839ea9dd4ff82fc48205844a6ee549f06ba14c16fb8d8b761b9cab13", MKT)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("config.js -> testnet ids")

# ---- server.js ----
p = "frontend/server.js"
s = open(p, encoding="utf-8").read()
s = s.replace("https://node1.playground.testnet.hathor.network/v1a", "https://node1.testnet.hathor.network/v1a")
s = s.replace("00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8", GAME)
s = s.replace("3647ee44cf81b74dd8e8e26d7b6237cc7c6b588e53cc30dd0a2eb3dbdf5c63f2", GEMS)
s = s.replace("00d0f42e839ea9dd4ff82fc48205844a6ee549f06ba14c16fb8d8b761b9cab13", MKT)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("server.js -> testnet node + ids")

# ---- copy: wallets can sign now ----
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
old = """<b>MetaMask (Hathor Snap)</b> and <b>WalletConnect</b> pair your own wallet;
        they connect today, and signing goes live once the game is deployed on a
        network the official wallets serve.</p>"""
assert old in s
s = s.replace(old, """<b>MetaMask (Hathor Snap)</b> and <b>WalletConnect</b> pair your own wallet
        on the Hathor testnet — every deed signed by you, owned by you.</p>""")
old = """        <p>Pulls cost <span class="mono">0.05 HTR</span>. On the playground network the
        <a href="https://faucet.hathor.dev" target="_blank" rel="noopener">faucet</a> sends
        1 HTR per day &mdash; that is 20 pulls.</p>"""
assert old in s
s = s.replace(old, """        <p>Pulls cost <span class="mono">0.05 HTR</span> in testnet coin. The demo
        wallet comes pre-funded; if you bring your own wallet, the
        <a href="https://faucet.testnet.hathor.network" target="_blank" rel="noopener">testnet
        faucet</a> pays enough for a small army.</p>""")
old = """      <div class="qa"><h4>My own wallet says &ldquo;Invalid blueprint ID&rdquo;.</h4>
        <p>Your wallet runs on a different Hathor network than this deployment
        (testnet-playground). Use the Demo wallet for now; Snap and WalletConnect
        signing activates when the game moves to the public testnet or mainnet.</p></div>"""
assert old in s
s = s.replace(old, """      <div class="qa"><h4>My own wallet says &ldquo;Invalid blueprint ID&rdquo;.</h4>
        <p>Your wallet is on a different Hathor network than the game. Emberfall runs
        on the public <b>testnet</b> &mdash; switch your wallet's network to testnet
        and try again.</p></div>""")
s = s.replace("The contract ID is in the footer &mdash; you can audit every rule described here.",
              "You can audit every rule described here.")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html copy updated")

# ---- app.js faucet hint ----
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
s = s.replace('href="https://faucet.hathor.dev"', 'href="https://faucet.testnet.hathor.network"')
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js faucet link updated")

# ---- setup.sh: cron now tops up from the operator treasury ----
p = "deploy/setup.sh"
s = open(p, encoding="utf-8").read()
old_cron = """cat > /etc/cron.daily/gacha-faucet <<'CRON'
#!/bin/sh
ADDR=$(curl -s -m 10 localhost:8090/api/wallet/address?index=0 | grep -o 'W[1-9A-HJ-NP-Za-km-z]*')
[ -n "$ADDR" ] && curl -s -m 30 -X POST https://faucet.hathor.dev/api/drip -H 'Content-Type: application/json' -d "{\\"address\\":\\"$ADDR\\"}" >/dev/null 2>&1
CRON"""
assert old_cron in s
s = s.replace(old_cron, """cat > /etc/cron.daily/gacha-faucet <<'CRON'
#!/bin/sh
# top up the shared demo wallet from the operator treasury when it runs low
ADDR=$(curl -s -m 10 localhost:8090/api/wallet/address?index=0 | grep -o 'W[1-9A-HJ-NP-Za-km-z]*')
BAL=$(curl -s -m 10 localhost:8000/wallet/balance -H 'x-wallet-id: player' | grep -o '"available":[0-9]*' | cut -d: -f2)
[ -n "$ADDR" ] && [ "${BAL:-0}" -lt 500 ] && curl -s -m 60 -X POST localhost:8000/wallet/simple-send-tx \\
  -H 'x-wallet-id: operator' -H 'Content-Type: application/json' \\
  -d "{\\"address\\":\\"$ADDR\\",\\"value\\":500}" >/dev/null 2>&1
CRON""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("setup.sh cron -> operator top-up")
