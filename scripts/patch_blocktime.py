import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
old = "'The Weaver binds a champion the moment the next block witnesses it (~30–90s).'"
assert old in s
s = s.replace(old, "'The Weaver binds a champion the moment the next block witnesses it — usually within seconds.'")
# poll faster to match ~7.5s block cadence
old = "    await new Promise(r => setTimeout(r, 5000));\n    onTick?.(Math.round((Date.now() - start) / 1000));"
assert old in s
s = s.replace(old, "    await new Promise(r => setTimeout(r, 2500));\n    onTick?.(Math.round((Date.now() - start) / 1000));")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: note + faster confirmation polling")

p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
old = """The draw settles when the next block confirms,
        usually 30&ndash;90 seconds; a corner toast tracks it while you keep playing."""
assert old in s
s = s.replace(old, """The draw settles when the next block confirms
        &mdash; blocks land about every 8 seconds, so it is usually done within
        a few heartbeats; a corner toast tracks it while you keep playing.""")
old = """      <div class="qa"><h4>Why does every action take about a minute?</h4>
        <p>Every move is a real blockchain transaction. It confirms when the next
        Hathor block includes it &mdash; typically 30&ndash;90 seconds. Nothing is
        simulated; the toast in the corner shows the live status.</p></div>"""
assert old in s
s = s.replace(old, """      <div class="qa"><h4>Why do actions take a few seconds to land?</h4>
        <p>Every move is a real blockchain transaction. It confirms when the next
        Hathor block includes it &mdash; blocks arrive roughly every 8 seconds, so
        most deeds settle in about 5&ndash;15 seconds. Nothing is simulated; the
        toast in the corner shows the live status.</p></div>"""
)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: codex timings updated")

p = "README.md"
s = open(p, encoding="utf-8").read()
old = "Nano contract transactions execute when the next block confirms them (typically under\na minute on the playground)."
if old in s:
    s = s.replace(old, "Nano contract transactions execute when the next block confirms them (blocks average\n~7.5 seconds on the public testnet and mainnet).")
    open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("README: timing updated")
else:
    print("README: pattern not found, skipped")
