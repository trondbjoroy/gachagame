import io, sys, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

start = s.index("const EMOJI = {")
end = s.index("};", start) + 3
s = s[:start] + s[end:]

s = re.sub(r"const emojiFor = .*\n", "", s, count=1)
s = s.replace('<div class="emoji">${emojiFor(c)}</div>', '<div class="emoji">${artSvg(c.name)}</div>')
s = re.sub(r"\$\{c \? emojiFor\(c\) : '[^']*'\}", "${c ? artSvg(c.name, 'card-art duel-art') : '?'}", s)
s = s.replace("$('prizeEmoji').textContent = emojiFor(won);",
              "$('prizeEmoji').innerHTML = artSvg(won.name, 'card-art prize-art');")
assert "emojiFor" not in s, "leftover emojiFor"
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: sigils wired")

p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()
if ".card-art" not in s:
    s += """
/* champion sigils */
.card-art { width: 46px; height: 46px; color: #e7dcc4; filter: drop-shadow(0 0 12px var(--rc, rgba(0,0,0,.4))); }
.duel-art { width: 30px; height: 30px; }
.prize-art { width: 96px; height: 96px; }
"""
    open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("style.css: sigil sizing")

if os.path.exists("frontend/public/art-test.html"):
    os.remove("frontend/public/art-test.html")
    print("test sheet removed")
