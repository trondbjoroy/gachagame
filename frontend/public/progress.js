/* Emberfall progression layer (phase 1, client-side): daily trials,
   the Muster Roll, and seasons. Loads after app.js and rides on its
   globals (S, $, CATALOG, ribbon, short, render, track). */

(function () {
  if (!window.CATALOG) return;

  /* ---------------- daily trials ---------------- */
  // order and rotation MUST match the v3 contract: kinds 0..7 are
  // pull, stake, duel win, fuse, temper, claim gems, recall 8h+, writ won,
  // and the day's trial is ((day * 5 + 2) % 8). The contract pays the
  // bonus (renown + gems) on the first matching act each UTC day.
  const TRIALS = [
    { id: 'pull', text: 'Summon a champion' },
    { id: 'stake', text: 'Send a champion mining' },
    { id: 'duel_win', text: 'Win a duel' },
    { id: 'fuse', text: 'Fuse two champions' },
    { id: 'temper', text: 'Temper a mining champion' },
    { id: 'claim_gems', text: 'Claim mined gems' },
    { id: 'recall8', text: 'Recall a miner after 8+ hours' },
    { id: 'writ_win', text: 'Beat a boss' },
  ];
  const METHOD_KIND = {
    pull: 'pull', stake: 'stake', fuse: 'fuse', temper: 'temper',
    claim_gems: 'claim_gems',
  };
  const dayNum = () => Math.floor(Date.now() / 86400000);
  const todaysTrial = () => TRIALS[(dayNum() * 5 + 2) % TRIALS.length];
  const tKey = () => 'emberfall_trials_' + (S.addr || '');
  function tState() {
    try { return JSON.parse(localStorage.getItem(tKey())) || {}; } catch { return {}; }
  }
  // the chain is the source of truth once connected; localStorage keeps streaks
  const trialDone = () => !!((tState().days || {})[dayNum()]) || S.trialDoneChain === true;

  function markDoneLocally() {
    const st = tState();
    const d = dayNum();
    st.days = st.days || {};
    if (st.days[d]) return false;
    st.days[d] = true;
    st.streak = st.days[d - 1] ? (st.streak || 0) + 1 : 1;
    st.best = Math.max(st.best || 0, st.streak);
    localStorage.setItem(tKey(), JSON.stringify(st));
    return true;
  }

  window.trialEvent = function (kindOrMethod, data) {
    try {
      if (!S.addr) return;
      const kind = METHOD_KIND[kindOrMethod] || kindOrMethod;
      const trial = todaysTrial();
      if (trial.id !== kind) return;
      if (kind === 'recall8' && !(data && data.hours >= 8)) return;
      if (!markDoneLocally()) return;
      ribbon('Daily trial done: ' + trial.text + ' (bonus paid)', 'level', 'deed');
      track('trial_complete', { trial: trial.id, streak: tState().streak });
      renderProgress();
    } catch { /* progression must never break the game */ }
  };

  function renderTrial() {
    // the contract settled a trial we didn't catch locally (e.g. a duel or
    // writ won elsewhere): sync the streak and celebrate
    try {
      if (S.addr && S.trialDoneChain === true && markDoneLocally()) {
        ribbon('Daily trial done: ' + todaysTrial().text + ' (bonus paid)', 'level', 'deed');
        track('trial_complete', { trial: todaysTrial().id, streak: tState().streak });
      }
    } catch { /* progression must never break the game */ }
    const t = todaysTrial();
    const done = S.addr && trialDone();
    const line = $('trialLine');
    if (line) {
      line.innerHTML = `⚜ Daily trial: <b>${t.text}</b>`
        + (done ? ' · <span class="trial-done">DONE ✓</span>' : '');
    }
    const c = $('trialCodex');
    if (c) {
      const st = tState();
      c.innerHTML = `Each day (midnight UTC) there is one trial.
        Today: <b>${t.text}</b>${done ? ' · <span class="trial-done">DONE ✓</span>' : ''}
        ${S.addr && st.streak ? `<br>Days in a row: <b>${st.streak}</b>
        (best ${st.best || st.streak})` : ''}`;
    }
  }

  /* ---------------- the muster roll ---------------- */
  const mKey = () => 'emberfall_muster_' + (S.addr || '');
  const setsKey = () => 'emberfall_sets_' + (S.addr || '');

  function ownedNow() {
    const names = new Set();
    for (const c of S.cards.values()) {
      if (c.tier < 0) continue;
      if (c.mine || c.staker === S.addr || c.pending === S.addr
          || c.marketPending === S.addr) names.add(c.name);
    }
    return names;
  }

  function renderMuster() {
    const el = $('musterRoll');
    if (!el) return;
    if (!S.addr) {
      el.innerHTML = '<div class="lore"><p>Connect a wallet and every champion '
        + 'you have ever owned is tracked here.</p></div>';
      return;
    }
    let ever;
    try { ever = new Set(JSON.parse(localStorage.getItem(mKey())) || []); }
    catch { ever = new Set(); }
    for (const n of ownedNow()) ever.add(n);
    localStorage.setItem(mKey(), JSON.stringify([...ever]));

    const byStation = {}, byType = {};
    for (const [name, m] of Object.entries(CATALOG)) {
      (byStation[m.station] = byStation[m.station] || []).push(name);
      (byType[m.type] = byType[m.type] || []).push(name);
    }
    const bar = (label, have, total) => {
      const pct = Math.round(100 * have / total);
      return `<div class="m-row"><span class="m-label">${label}</span>
        <span class="m-bar"><span class="m-fill${have === total ? ' full' : ''}"
        style="width:${pct}%"></span></span>
        <span class="m-count mono">${have}/${total}</span></div>`;
    };
    const total = Object.keys(CATALOG).length;
    let html = `<div class="lore"><p>Every champion you have ever owned, of the
      ${total} in the game. Complete a rarity or a kind and it is
      remembered.</p></div>`;
    const PLURAL = { Footman: 'Footmen', Knight: 'Knights', Highlord: 'Highlords', Sovereign: 'Sovereigns' };
    html += bar('All champions', [...ever].length, total);
    for (const st of ['Footman', 'Knight', 'Highlord', 'Sovereign']) {
      const pool = byStation[st] || [];
      html += bar(PLURAL[st], pool.filter(n => ever.has(n)).length, pool.length);
    }
    const chips = Object.entries(byType)
      .filter(([, pool]) => pool.length >= 4)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([type, pool]) => {
        const have = pool.filter(n => ever.has(n)).length;
        return `<span class="m-chip${have === pool.length ? ' done' : ''}">${type}
          <b class="mono">${have}/${pool.length}</b></span>`;
      }).join('');
    html += `<div class="m-chips">${chips}</div>`;
    el.innerHTML = html;

    // one-time celebrations for completed sets
    let seen;
    try { seen = new Set(JSON.parse(localStorage.getItem(setsKey())) || []); }
    catch { seen = new Set(); }
    const checkSet = (label, pool) => {
      if (pool.length >= 4 && pool.every(n => ever.has(n)) && !seen.has(label)) {
        seen.add(label);
        ribbon('Set complete: ' + label, 'level', 'deed');
        track('muster_set', { set: label });
      }
    };
    for (const [st, pool] of Object.entries(byStation)) checkSet(PLURAL[st] || st, pool);
    for (const [ty, pool] of Object.entries(byType)) checkSet(ty, pool);
    localStorage.setItem(setsKey(), JSON.stringify([...seen]));
  }

  /* ---------------- seasons ---------------- */
  async function loadSeason() {
    try {
      const r = await fetch('/season.json');
      if (r.ok) { S.season = await r.json(); renderSeason(); }
    } catch { /* season display is optional */ }
  }

  function renderSeason() {
    const el = $('seasonPanel');
    if (!el) return;
    const sn = S.season;
    if (!sn) {
      el.innerHTML = '<div class="lore"><p>The first season is being prepared…</p></div>';
      return;
    }
    const days = Math.max(0, Math.ceil((sn.ends * 1000 - Date.now()) / 86400000));
    const rows = (sn.standings || []).slice(0, 10).map((s, i) => {
      const me = S.addr && s.addr === S.addr;
      return `<div class="s-row${me ? ' me' : ''}"><span class="s-rank mono">${i + 1}</span>
        <span class="mono">${who(s.addr)}${me ? ' · you' : ''}</span>
        <span class="s-pts mono">${s.seasonal}</span></div>`;
    }).join('');
    const mine = S.addr ? (sn.standings || []).findIndex(s => s.addr === S.addr) : -1;
    const mineLine = S.addr
      ? (mine >= 0
        ? `Your rank: <b>#${mine + 1}</b> with <b>${sn.standings[mine].seasonal}</b> seasonal renown.`
        : 'Earn renown this season to enter the standings.')
      : 'Connect a wallet to take your place in the standings.';
    el.innerHTML = `<div class="lore"><p><b>Season ${sn.season} · ${sn.name}</b>
      closes in <b>${days} day${days === 1 ? '' : 's'}</b>. Renown earned during the
      season ranks all players; the top players earn season titles when it
      closes. ${mineLine}</p></div>
      <div class="s-table">${rows || '<div class="lore"><p>No renown earned yet this season.</p></div>'}</div>`;
  }

  /* ---------------- wiring ---------------- */
  function renderProgress() {
    try { renderTrial(); renderMuster(); renderSeason(); }
    catch { /* progression must never break the game */ }
  }
  const appRender = render;
  render = function () { appRender(); renderProgress(); };
  loadSeason();
  setInterval(loadSeason, 10 * 60 * 1000);
  renderProgress();
})();
