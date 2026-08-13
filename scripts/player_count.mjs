/* Unique players who have summoned at least once, counted from the chain.

   Two traps this avoids:
   - a session key signs on its own address, so raw signers over-count; every
     caller is resolved through get_delegate to the identity the contract
     itself keys state by (the same _player() the blueprint uses)
   - a voided pull never happened, so voided txs are dropped

   The seeded demo banners in scripts/demo-fixtures.json are feed-only and
   never touched the chain, so walking history excludes them by construction.

   Usage: node scripts/player_count.mjs [--days 7] */

const NODES = [
  'https://node-partners.testnet.hathor.network/v1a',
  'https://node1.testnet.hathor.network/v1a',
];

// every realm this game has lived in on testnet-india, newest first
const REALMS = [
  { name: 'v5', nc: '0061589e138059dcc670e392442c55bd6a55487adaa0b519ad41cf09bb0129b4', delegation: true },
  { name: 'v4', nc: '00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd', delegation: true },
  { name: 'v3', nc: '0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587', delegation: false },
  { name: 'v2.2', nc: '00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258', delegation: false },
  { name: 'v2', nc: '00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb', delegation: false },
];

const DAYS = Number((process.argv[process.argv.indexOf('--days') + 1]) || 7);

let nodeIdx = 0;
async function get(pathAndQuery) {
  let last;
  for (let i = 0; i < 6; i++) {
    const base = NODES[(nodeIdx + i) % NODES.length];
    try {
      const r = await fetch(base + pathAndQuery, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      nodeIdx = (nodeIdx + i) % NODES.length; // stay on what works
      return j;
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

async function walkPulls(nc) {
  const pulls = [];   // {who, ts}
  let after = '', pages = 0, txs = 0;
  for (;;) {
    const d = await get(`/nano_contract/history?id=${nc}&count=100` + (after ? `&after=${after}` : ''));
    const h = d.history || [];
    if (!h.length) break;
    txs += h.length;
    for (const tx of h) {
      if (tx.is_voided) continue;
      if (tx.nc_method !== 'pull') continue;
      if (!tx.nc_address) continue;
      pulls.push({ who: tx.nc_address, ts: tx.timestamp });
    }
    pages++;
    if (!d.has_more) break;
    after = h[h.length - 1].hash;
    await new Promise(r => setTimeout(r, 120)); // stay under the node's limits
  }
  return { pulls, txs, pages };
}

/* resolve session keys to the main identity the contract keys state by */
async function resolveIdentities(nc, addrs) {
  const map = new Map();
  const list = [...addrs];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const qs = chunk.map(a => 'calls[]=' + encodeURIComponent(`get_delegate("${a}")`)).join('&');
    const d = await get(`/nano_contract/state?id=${nc}&${qs}`);
    for (const a of chunk) {
      const v = (d.calls || {})[`get_delegate("${a}")`];
      map.set(a, (v && v.value) || a);
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return map;
}

const now = Math.floor(Date.now() / 1000);
const cutoff = now - DAYS * 86_400;
const firstSummon = new Map();   // identity -> earliest ts across all realms
const perRealm = [];

for (const realm of REALMS) {
  let walked;
  try { walked = await walkPulls(realm.nc); }
  catch (e) { console.log(`${realm.name}: history unreadable (${e.message})`); continue; }
  const { pulls, txs, pages } = walked;
  const signers = new Set(pulls.map(p => p.who));
  const idOf = realm.delegation
    ? await resolveIdentities(realm.nc, signers)
    : new Map([...signers].map(a => [a, a]));
  const ids = new Map();  // identity -> {first, pulls}
  for (const p of pulls) {
    const id = idOf.get(p.who) || p.who;
    const cur = ids.get(id);
    if (!cur) ids.set(id, { first: p.ts, pulls: 1 });
    else { cur.pulls++; if (p.ts < cur.first) cur.first = p.ts; }
    const g = firstSummon.get(id);
    if (g === undefined || p.ts < g) firstSummon.set(id, p.ts);
  }
  perRealm.push({ realm: realm.name, txs, pages, summons: pulls.length, signers: signers.size, players: ids.size, ids });
  console.log(`${realm.name}: ${txs} txs over ${pages} pages · ${pulls.length} summons · `
    + `${signers.size} signing addresses → ${ids.size} identities`);
}

console.log('\n--- totals ---');
const allTime = firstSummon.size;
const newThisWeek = [...firstSummon.values()].filter(ts => ts >= cutoff).length;
console.log(`unique players ever (>=1 summon): ${allTime}`);
console.log(`first summon in the last ${DAYS} days: ${newThisWeek}`);

const v5 = perRealm.find(r => r.realm === 'v5');
if (v5) {
  const v5New = [...v5.ids.entries()].filter(([id, v]) => v.first >= cutoff && firstSummon.get(id) >= cutoff).length;
  console.log(`\ncurrent realm (v5): ${v5.ids.size} players, ${v5.summons} summons`);
  console.log(`v5 newcomers in the last ${DAYS} days: ${v5New}`);
  const top = [...v5.ids.entries()].sort((a, b) => b[1].pulls - a[1].pulls);
  console.log('\nv5 players by summons:');
  for (const [id, v] of top) {
    const first = new Date(v.first * 1000).toISOString().slice(0, 10);
    const fresh = firstSummon.get(id) >= cutoff ? '  NEW' : '';
    console.log(`  ${id}  ${String(v.pulls).padStart(4)} summons  first ${first}${fresh}`);
  }
}
