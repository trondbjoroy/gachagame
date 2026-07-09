import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

applied, missed = [], []
def rep(s, old, new, label, required=True):
    # tolerate either literal unicode or \uXXXX escapes in the source
    variants = [old, old.replace("…", "\\u2026").replace("—", "\\u2014").replace("→", "\\u2192")]
    for v in variants:
        if v in s:
            applied.append(label)
            return s.replace(v, new if v == old else
                             new.replace("…", "\\u2026").replace("—", "\\u2014").replace("→", "\\u2192"))
    (missed if required else applied).append(("MISS " if required else "skip ") + label)
    return s

# ================= index.html =================
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()

s = rep(s, "every deed witnessed on the Hathor blockchain.",
        "every deed witnessed forever in the realm of Emberfall.", "meta description")
s = rep(s, "a realm bound to the chain · summon · mine · forge · fight",
        "a realm written in soulstone · summon · mine · forge · fight", "netline")
s = rep(s, """      <p class="sub">The Blind Weaver binds a champion into soulstone with every summoning —
      each one a 1-of-1 token with its power struck onchain. Send them to the deep mines
      for <b>GEMS</b>, forge two of a station into a greater bloodline, and stake gems on
      trial by combat in the Pit. Every deed is witnessed on the Great Ledger. No lord,
      no oracle, no take-backs.</p>""",
"""      <p class="sub">The Blind Weaver binds a champion into soulstone with every summoning —
      each one unique in all the realm, its power struck at birth. Send them to the deep
      mines for <b>GEMS</b>, forge two of a station into a greater bloodline, and stake
      gems on trial by combat in the Pit. Every deed is witnessed on the Great Ledger.
      No lord, no luck-twisting, no take-backs.</p>""", "hero sub")
s = rep(s, "Her threads are spun from the chain itself.",
        "Her threads are spun from the Ledger itself.", "chronicle chain")
s = rep(s, "Transaction in the mempool…", "The Weaver is at work…", "overlay title")
s = rep(s, "waiting for a block to confirm", "your deed awaits witness", "overlay sub")

# remove the code-and-contract FAQ entry
start = s.find('<div class="qa"><h4>Where is the code and the contract?</h4>')
assert start > 0, "code/contract qa not found"
end = s.find("</div>", s.find("</p>", start)) + len("</div>")
s = s[:start] + s[end:]
applied.append("codex: code/contract Q&A removed")
open(p, "w", encoding="utf-8", newline="\n").write(s)

# ================= app.js =================
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

s = rep(s, "<span class=\"t-sub\">sign & push…</span>", "<span class=\"t-sub\">sealing the deed…</span>", "toast initial")
s = rep(s, "sub.textContent = 'tx ' + hash.slice(0, 12) + '… confirming';",
        "sub.textContent = 'the realm bears witness…';", "toast confirming")
s = rep(s, "sub.textContent = 'confirmed';", "sub.textContent = 'done';", "toast done")
s = rep(s, "throw new Error('transaction was voided');",
        "throw new Error('the deed was undone by fate — try again');", "voided error")
s = rep(s, "throw new Error(`contract rejected the call (${logs.nc_execution})`);",
        "throw new Error('the realm refused this deed');", "rejected error")
s = rep(s, "if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {",
        "if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {", "hint condition", required=False)
s = rep(s, "msg += ' — your wallet is on a different Hathor network than this deployment. Use the Demo wallet for now (Snap/WalletConnect work once the game is deployed on public testnet/mainnet).';",
        "msg = 'Your wallet is on a different Hathor network — switch it to testnet and try again.';", "network hint")
s = rep(s, "'The Weaver binds a champion the moment the next block witnesses it — usually within seconds.'",
        "'Speak, and the Weaver answers within moments.'", "pull note")
s = rep(s, '>faucet</a>', '>claim free coin</a>', "faucet link text", required=False)
open(p, "w", encoding="utf-8", newline="\n").write(s)

# ================= wallets.js =================
p = "frontend/public/wallets.js"
s = open(p, encoding="utf-8").read()
s = s.replace("'snap did not return a transaction id'", "'your wallet did not confirm the deed'")
s = s.replace("'wallet did not return a transaction id'", "'your wallet did not confirm the deed'")
applied.append("wallets.js error copy")
open(p, "w", encoding="utf-8", newline="\n").write(s)

print("APPLIED:", len(applied))
for a in applied: print(" ", a)
if missed:
    print("MISSED:")
    for m in missed: print(" ", m)
    sys.exit(1)
