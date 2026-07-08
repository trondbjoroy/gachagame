import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# ---------------- index.html ----------------
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
s = s.replace(
    '<link href="https://fonts.googleapis.com/css2?family=Aldrich&family=Inter:wght@400;500;600;700;800&family=Fragment+Mono&display=swap" rel="stylesheet" />',
    '<link href="https://fonts.googleapis.com/css2?family=Aldrich&family=Outfit:wght@400;500;600;700;800&family=Fragment+Mono&display=swap" rel="stylesheet" />')
s = s.replace('<title>Hathor Gacha Arena</title>',
    '''<title>Gacha Arena — onchain card game on Hathor</title>
<meta name="description" content="Pull cards minted by a nano contract, farm GEMS, fuse rarities, and duel other players — every move settles on the Hathor blockchain." />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎰</text></svg>" />''')
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: font swap, favicon, meta")

# ---------------- style.css ----------------
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()

# palette: one accent (acid), navy-tinted neutrals, kill cyan as accent
s = s.replace("""  --acid: #bff658;
  --acid-hot: #6eff00;
  --cyan: #0dcbff;""",
"""  --acid: #b8e65c;      /* single accent, sat < 80% */
  --acid-hot: #a4e635;
  --cyan: #b8e65c;      /* cyan retired: aliases to the one accent */
  --r-lg: 18px; --r-md: 12px; --r-sm: 8px;""")

# body font: Outfit replaces Inter
s = s.replace("font-family: 'Inter', system-ui, sans-serif;",
              "font-family: 'Outfit', system-ui, sans-serif;")
s = s.replace("font-family: 'Inter', sans-serif;", "font-family: 'Outfit', sans-serif;")

# background: drop the blue/cyan AI-gradient glows, single hue family
s = s.replace("""    radial-gradient(900px 600px at 90% -10%, rgba(13, 203, 255, .13), transparent 60%),
    radial-gradient(800px 500px at -10% 110%, rgba(191, 246, 88, .10), transparent 60%),""",
"""    radial-gradient(1000px 640px at 85% -12%, rgba(184, 230, 92, .07), transparent 62%),
    radial-gradient(820px 520px at -8% 108%, rgba(184, 230, 92, .05), transparent 60%),""")
s = s.replace("""    linear-gradient(rgba(13, 203, 255, .07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(13, 203, 255, .07) 1px, transparent 1px);""",
"""    linear-gradient(rgba(184, 230, 92, .05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(184, 230, 92, .05) 1px, transparent 1px);""")
s = s.replace(".glow.a { top: -140px; left: -100px; width: 420px; height: 420px; background: #12246e; opacity: .55; }",
              ".glow.a { top: -140px; left: -100px; width: 420px; height: 420px; background: #16251a; opacity: .8; }")
s = s.replace(".glow.b { bottom: -180px; right: -140px; width: 480px; height: 480px; background: #0dcbff; opacity: .16; }",
              ".glow.b { bottom: -180px; right: -140px; width: 480px; height: 480px; background: #2a3d1f; opacity: .35; }")

# headline: presence + balance
s = s.replace(".pull-col h1 { font-size: 37px; line-height: 1.12; margin: 0 0 14px; font-weight: 800; letter-spacing: -.015em; }",
              ".pull-col h1 { font-size: 42px; line-height: 1.04; margin: 0 0 14px; font-weight: 800; letter-spacing: -.03em; text-wrap: balance; }")
s = s.replace(".sub { color: var(--ink-muted); font-size: 14.5px; line-height: 1.65; margin: 0 0 22px; max-width: 480px; }",
              ".sub { color: var(--ink-muted); font-size: 14.5px; line-height: 1.7; margin: 0 0 22px; max-width: 56ch; text-wrap: pretty; }")

# radius scale instead of uniform radii
s = s.replace("border: 1px solid var(--line); background: var(--panel); border-radius: 22px; padding: 36px;",
              "border: 1px solid var(--line); background: var(--panel); border-radius: var(--r-lg); padding: 40px 36px 44px;")

# stats: one strip with dividers instead of four identical cards
s = s.replace(""".stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-top: 18px; }
.stat { border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 16px 18px; }""",
""".stats-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0;
  margin-top: 18px; border: 1px solid var(--line); background: var(--panel);
  border-radius: var(--r-md); overflow: hidden;
}
.stats-row .stat { border: none; border-left: 1px solid var(--line); border-radius: 0; padding: 16px 18px; background: none; }
.stats-row .stat:first-child { border-left: none; }
.farm-summary .stat { border: 1px solid var(--line); background: var(--panel); border-radius: var(--r-md); padding: 16px 18px; }""")
s = s.replace(".stat .v { font-family: 'Fragment Mono', monospace; font-size: 22px; margin-top: 6px; color: var(--ink); }",
              ".stat .v { font-family: 'Fragment Mono', monospace; font-variant-numeric: tabular-nums; font-size: 22px; margin-top: 6px; color: var(--ink); }")

# cards: drop border+shadow+bg trifecta -> background + rarity bar only,
# tinted hover glow, buttons pinned to bottom
s = s.replace(""".card {
  position: relative; border-radius: 16px; padding: 20px 18px 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .05), rgba(255, 255, 255, .015));
  border: 1px solid var(--line); overflow: hidden;
  transition: transform .15s ease;
}
.card:hover { transform: translateY(-3px); }""",
""".card {
  position: relative; border-radius: var(--r-md); padding: 20px 18px 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .05), rgba(255, 255, 255, .015));
  overflow: hidden; display: flex; flex-direction: column;
  transition: transform .2s ease, box-shadow .2s ease;
}
.card:hover { transform: translateY(-3px); box-shadow: 0 18px 44px -18px var(--rc, rgba(0,0,0,.6)); }
.card .row-btns, .card .claim-mini { margin-top: auto; }
.card .row-btns { padding-top: 12px; }
.card .claim-mini { margin-top: auto; }""")
s = s.replace(".card .uid { font-family: 'Fragment Mono', monospace; font-size: 10px; color: var(--ink-dim); margin-top: 10px; word-break: break-all; }",
              ".card .uid { font-family: 'Fragment Mono', monospace; font-size: 10px; color: var(--ink-dim); margin: 10px 0 12px; word-break: break-all; }")

# tabs radius + duel/list rows
s = s.replace("border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 14px 18px;",
              "border: 1px solid var(--line); background: var(--panel); border-radius: var(--r-md); padding: 14px 18px;")

# interactive states: press feedback + transitions + focus rings + grain
s += """
/* taste pass: states, texture, focus */
button { transition: transform .18s ease, filter .18s ease, background-color .18s ease, border-color .18s ease, box-shadow .18s ease; }
button:active:not(:disabled) { transform: scale(.98); }
:focus-visible { outline: 2px solid var(--acid); outline-offset: 2px; border-radius: 4px; }
html { scroll-behavior: smooth; }

.mini-btn:hover:not(:disabled) { filter: brightness(1.1); }
.mini-btn.alt:hover:not(:disabled) { border-color: var(--acid); color: var(--ink); filter: none; }
.tab:hover { color: var(--ink-muted); }
.tab.active:hover { color: var(--acid); }
.claim-mini:hover:not(:disabled) { filter: brightness(1.08); }
.connect-opt:active { transform: scale(.99); }

/* fixed grain overlay: breaks digital flatness (pointer-events: none) */
body::after {
  content: ''; position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: .05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* tinted shadows on primary actions (match background hue, not black) */
.pull-btn { box-shadow: 0 14px 45px -12px rgba(164, 230, 53, .4), 0 4px 14px -6px rgba(5, 8, 23, .8); }
.toast { box-shadow: 0 14px 40px -12px rgba(5, 8, 23, .85); }

/* machine dome: same hue family as the accent, not cyan */
.machine svg circle[stroke] { stroke: rgba(184, 230, 92, .3); }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("style.css: palette, typography, states, texture")
