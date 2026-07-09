import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

# surface the contract's own rejection reason instead of a generic message
old = """    if (logs.nc_execution === 'success') return;
    if (logs.nc_execution && logs.nc_execution !== 'pending') {
      throw new Error('the realm refused this deed');
    }"""
assert old in s, "failure branch"
s = s.replace(old, """    if (logs.nc_execution === 'success') return;
    if (logs.nc_execution && logs.nc_execution !== 'pending') {
      let reason = '';
      for (const entries of Object.values(logs.logs || {})) {
        for (const e of entries) {
          const m = (e.error_traceback || '').match(/NCFail: (.+?)\\s*$/m);
          if (m) reason = m[1];
        }
      }
      throw new Error(reason || 'the realm refused this deed');
    }""")

# preflight the fusion fee on the FUSE button
old = "  $('fuseHint').textContent = selCount === 2 ? 'Fuse into next tier:' : 'Select two cards of the same tier —';\n  $('fuseBtn').disabled = !(selCount === 2 && sameTierSelected());"
assert old in s, "fuse gate"
s = s.replace(old, """  const fuseReady = selCount === 2 && sameTierSelected();
  const canPayFuse = S.gemsLedger >= 5;
  $('fuseHint').textContent = !fuseReady ? 'Select two champions of the same station —'
    : (canPayFuse ? 'Forge into the next station:'
       : `Fusion costs 0.05 GEMS — you have ${fmtGems(S.gemsLedger)}. Earn more in the Mines.`);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);""")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: real failure reasons + fusion fee preflight")
