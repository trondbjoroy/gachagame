/* Guided tour of the realm. Auto-runs once after a wallet first connects;
   restartable any time from the ? button in the header. */

const TOUR = [
  {
    title: 'Welcome to Emberfall',
    body: 'The throne is empty and a host must be raised. This short tour walks you through the realm, one feature at a time. Step back and forth as you like, or leave with the ✕ and return later from the ? button in the header.',
  },
  {
    target: '.machine-panel', tab: 'collection',
    title: 'The Brazier',
    body: 'Every summoning binds a champion into soulstone: one of a kind, with a rarity (Footman to Sovereign), a power, and three aspects rolled at birth. The price in coin is shown on the button; the Blind Weaver answers within moments. Roughly 1 in 25 summonings, she returns your coin from the favor pool.',
  },
  {
    target: '#trialLine', tab: 'collection',
    title: 'The daily trial',
    body: 'Each day (midnight UTC) the game asks one task of everyone. Complete it and your streak grows.'
      + ' Renown earned during the eight-week season also ranks you in the season standings, and the highest banners bear titles when it closes.',
  },
  {
    target: '#statsRow',
    title: 'Your measures',
    body: 'The game keeps count: your gems, duels won, renown with your daily streak, and your level. Below the numbers, WORLD FEED shows what other players are doing right now; it starts folded, so click its title to open it. Everything here is read straight from the chain; nothing is stored on our servers. Want a name instead of an address? Click your wallet chip and SET NAME.',
  },
  {
    target: '#pane-collection', tab: 'collection',
    title: 'Collection',
    body: 'Champions sworn to your banner live here. Tap any card to see it large and share it; press and hold to select it for fusion, then FUSE two of the same rarity into the next. New champions appear below until claimed; in a session they come home by themselves. Each card also offers MINE, FIGHT, SELL, and TRADE.',
  },
  {
    target: '#pane-farm', tab: 'farm',
    title: 'Mining',
    body: 'Send champions mining and they earn gems by the minute, faster for higher rarities. Gems pay for fusion and wagers. While a champion mines you can TEMPER it (pay gems to raise one aspect), send it on a DELVE (an eight-hour gamble for gems or relic shards), or STYLE it with frames, tints, and epithets that travel with the card forever.',
  },
  {
    target: '#pane-arena', tab: 'arena',
    title: 'Arena',
    body: 'Duels, best of three rounds: attack against attack, defense against defense, cunning against cunning. Wager gems; the winner takes the pot minus a 5% house cut. Champions are never lost, and every settled fight earns them experience. Below the duels wait the BOSSES: ten of them, fought solo by your mining champions, three fights per champion per day.',
  },
  {
    target: '#pane-market', tab: 'market',
    title: 'Market',
    body: 'Sell champions for coin at your asking price, or offer a trade for one specific champion you want. Purchases settle through escrow: claim your side from "In escrow" after the deal closes.',
  },
  {
    target: '#pane-learn', tab: 'learn',
    title: 'Info',
    body: 'The lore of the realm, the how-to-play guide, your achievements (eighteen of them, Wanderer to Sovereign’s Hand), the collection tracker for every champion you have ever owned, and the season standings. The Weaver’s weekly favor is drawn here too; every point of renown you earn this week is a ticket.',
  },
  {
    target: '#headerSessionBtn', tab: 'collection',
    title: 'Quick play',
    body: 'Fund a session once and everything after that signs instantly, with no wallet popups. END SESSION & RETURN ALL sends every champion, gem, and coin back to your main wallet in one move. Sessions survive page reloads in this browser.',
  },
  {
    target: '#walletBtn',
    title: 'Your wallet',
    body: 'Your balance and address live here; click it to connect, reconnect, or part ways. Your champions and coin are always in your own keeping, never ours.',
  },
  {
    title: 'The realm is yours',
    body: 'Summon, mine, fight, trade, and let every deed be witnessed. If you are short on coin, the faucet in the Info guide pays enough testnet HTR for a small army. Fortune favors the vigilant.',
  },
];

let tourIdx = -1;

function tourEls() {
  let dim = document.getElementById('tourDim');
  if (!dim) {
    dim = document.createElement('div');
    dim.id = 'tourDim';
    dim.innerHTML = '<div id="tourSpot"></div><div id="tourTip"></div>';
    document.body.appendChild(dim);
  }
  return { dim, spot: document.getElementById('tourSpot'), tip: document.getElementById('tourTip') };
}

function startTutorial() {
  tourIdx = 0;
  tourEls().dim.style.display = 'block';
  document.addEventListener('keydown', tourKeys);
  window.addEventListener('resize', tourReposition);
  track('tutorial_start');
  showTourStep();
}

function endTutorial(finished) {
  const { dim } = tourEls();
  dim.style.display = 'none';
  document.removeEventListener('keydown', tourKeys);
  window.removeEventListener('resize', tourReposition);
  localStorage.setItem('emberfall_tutorial_seen', '1');
  track(finished ? 'tutorial_done' : 'tutorial_closed', { step: tourIdx });
  tourIdx = -1;
  // the post-first-connect quick-play nudge waits until the tour is gone
  if (window.pendingQpHint) { window.pendingQpHint = false; window.showQpHint?.(); }
}

function tourKeys(e) {
  if (e.key === 'Escape') endTutorial(false);
  else if (e.key === 'ArrowRight') tourNav(1);
  else if (e.key === 'ArrowLeft') tourNav(-1);
}

function tourNav(dir) {
  const next = tourIdx + dir;
  if (next < 0) return;
  if (next >= TOUR.length) { endTutorial(true); return; }
  tourIdx = next;
  track('tutorial_step', { step: tourIdx });
  showTourStep();
}

function tourReposition() { if (tourIdx >= 0) showTourStep(); }

function showTourStep() {
  const s = TOUR[tourIdx];
  if (s.tab) {
    const tabBtn = document.querySelector(`.tab[data-tab="${s.tab}"]`);
    if (tabBtn && !tabBtn.classList.contains('active')) tabBtn.click();
  }
  // let the tab switch settle before measuring
  setTimeout(() => {
    const { dim, spot, tip } = tourEls();
    const el = s.target ? document.querySelector(s.target) : null;
    const visible = el && el.offsetParent !== null && !el.hidden;
    // spotlight steps dim via the spot's giant shadow; centered steps dim here
    dim.style.background = visible ? 'transparent' : 'rgba(4, 3, 2, .62)';

    tip.innerHTML = `
      <button class="tour-x" aria-label="close">✕</button>
      <div class="tour-title">${s.title}</div>
      <div class="tour-body">${s.body}</div>
      <div class="tour-nav">
        <span class="tour-count">${tourIdx + 1} of ${TOUR.length}</span>
        <span>
          <button class="mini-btn alt tour-back" ${tourIdx === 0 ? 'disabled' : ''}>BACK</button>
          <button class="mini-btn tour-next">${tourIdx === TOUR.length - 1 ? 'FINISH' : 'NEXT'}</button>
        </span>
      </div>`;
    tip.querySelector('.tour-x').onclick = () => endTutorial(false);
    tip.querySelector('.tour-back').onclick = () => tourNav(-1);
    tip.querySelector('.tour-next').onclick = () => tourNav(1);

    if (visible) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const pad = 8;
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + 2 * pad) + 'px';
      spot.style.height = (r.height + 2 * pad) + 'px';
      // measure, then place below the target if it fits, else above, else center
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let top = r.bottom + pad + 14;
      if (top + th > vh - 10) top = r.top - pad - th - 14;
      if (top < 10) top = Math.max(10, (vh - th) / 2);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), vw - tw - 12);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.visibility = 'visible';
    } else {
      spot.style.display = 'none';
      tip.style.display = 'block';
      tip.style.visibility = 'hidden';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(12, (window.innerWidth - tw) / 2) + 'px';
      tip.style.top = Math.max(12, (window.innerHeight - th) / 2.4) + 'px';
      tip.style.visibility = 'visible';
    }
  }, s.tab ? 80 : 0);
}

// wire the header button; auto-run is triggered from app.js on first connect
document.getElementById('tutorialBtn').onclick = () => { if (tourIdx < 0) startTutorial(); };
