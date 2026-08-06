/* Emberfall session signer — a full Hathor light wallet on a throwaway seed,
   running entirely in the player's browser. Signs game transactions without
   wallet prompts; sweeps everything back to the main wallet on demand. */
import { HathorWallet, Connection, walletUtils, config as libConfig } from '@hathor/wallet-lib';
import { P2PKH_ACCT_PATH } from '@hathor/wallet-lib/lib/constants';
import { deriveAddressFromXPubP2PKH } from '@hathor/wallet-lib/lib/utils/address';
import { JSONBigInt } from '@hathor/wallet-lib/lib/utils/bigint';
import walletApi from '@hathor/wallet-lib/lib/api/wallet';
import JSONBigIntFactory from 'json-bigint';

// wallet-lib's BigInt JSON codec is engine-specific twice over: it needs the
// V8-only JSON.parse reviver `context` argument and JSON.rawJSON, and its
// float handling whitelists V8's and Firefox's BigInt SyntaxError message
// strings — WebKit throws "Failed to parse String to BigInt", which is not
// on the list, so any float in any response kills the sync on iOS. No
// feature detection can catch a message-string mismatch, so the pure-JS
// codec (same semantics: unsafe-range integers become BigInts) is used
// unconditionally.
(function patchBigIntCodec() {
  const JB = JSONBigIntFactory({ useNativeBigInt: true });
  JSONBigInt.parse = text => JB.parse(text);
  JSONBigInt.stringify = (value, space) => JB.stringify(value, null, space);
})();

/* Token metadata, batched. wallet-lib calls getGeneralTokenInfo(uid) once
   per token it holds — 28 requests for 28 cards, and it grows with the
   collection. Name and symbol are struck at creation and never change, so
   the uids are collected within a tick and answered from ONE /api/tokens
   call against our own server (which caches them for good). If that path
   fails for any reason the original per-token request still runs, so a
   proxy hiccup cannot stall a wallet sync. */
(function batchTokenInfo() {
  if (typeof window === 'undefined' || !walletApi || !walletApi.getGeneralTokenInfo) return;
  const original = walletApi.getGeneralTokenInfo.bind(walletApi);
  const cache = new Map();
  let queue = [];       // {uid, resolve, reject}
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    const uids = [...new Set(batch.map(w => w.uid))];
    let got = {};
    try {
      const r = await fetch(location.origin + '/api/tokens?ids=' + uids.join(','));
      if (r.ok) got = await r.json();
    } catch { /* fall through to the per-token path below */ }
    for (const w of batch) {
      const info = got[w.uid];
      if (info && info.success) {
        cache.set(w.uid, info);
        try { w.resolve(info); } catch { /* the caller's own handler threw */ }
      } else {
        // never seen, or the batch could not be reached: ask the node directly
        original(w.uid, w.resolve).catch(w.reject);
      }
    }
  };

  walletApi.getGeneralTokenInfo = (uid, resolve) => {
    const hit = cache.get(uid);
    if (hit) {
      resolve(hit);
      return Promise.resolve();
    }
    return new Promise((res, rej) => {
      queue.push({
        uid,
        resolve: info => { resolve(info); res(); },
        reject: err => rej(err),
      });
      if (!scheduled) {
        scheduled = true;
        // a tick is enough: the lib queues every token of a wallet in one pass
        setTimeout(flush, 0);
      }
    });
  };
})();

const NODE = (typeof window !== 'undefined' && window.GAME && window.GAME.sessionNode)
  || 'https://node-partners.testnet.hathor.network/v1a/';
const NETWORK = 'testnet';
const PIN = 'emberfall-session';

// dev realms (testnet-playground) have no public tx-mining service: let the
// game config point session txs at the local one
if (typeof window !== 'undefined' && window.GAME && window.GAME.txMiningUrl) {
  libConfig.setTxMiningUrl(window.GAME.txMiningUrl);
}

// address 0 straight from the seed words: pure key derivation, no network.
// mirrors generateAccessDataFromSeed's path (acct path -> change 0 -> index)
function addressFor(words) {
  const root = walletUtils.getXPrivKeyFromSeed(words, { networkName: NETWORK });
  const change = root.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
  return deriveAddressFromXPubP2PKH(change.xpubkey, 0, NETWORK).base58;
}

const HOST = new URL(NODE).host;

function waitReady(wallet, detail) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`sync timeout via ${HOST}: ${detail() || 'no detail'}`)), 90_000);
    wallet.on('state', state => {
      if (state === HathorWallet.READY) { clearTimeout(timer); resolve(); }
      if (state === HathorWallet.ERROR) {
        clearTimeout(timer);
        // the lib emits ERROR one statement BEFORE logging the actual error;
        // wait a beat so the detail buffer catches it
        setTimeout(() => reject(new Error(`sync error via ${HOST}: ${detail() || 'no detail'}`)), 120);
      }
    });
    if (wallet.isReady()) { clearTimeout(timer); resolve(); }
  });
}

// serialize whatever the wallet's logger was handed, Errors included
function logToString(args) {
  try {
    return args.map(x => {
      if (x instanceof Error) return x.message || String(x);
      if (typeof x === 'object' && x !== null) {
        return JSON.stringify(x, (k, v) => (v instanceof Error ? (v.message || String(v)) : v));
      }
      return String(x);
    }).join(' ').slice(0, 300);
  } catch { return 'unserializable error'; }
}

async function open(words) {
  // preflight so failures name the exact broken stage, not a generic sync error
  try {
    const r = await fetch(NODE + 'version');
    if (!r.ok) throw new Error('http ' + r.status);
  } catch (e) {
    throw new Error(`node unreachable via ${HOST} (${(e && e.message) || e})`);
  }
  const connection = new Connection({ network: NETWORK, servers: [NODE] });
  // capture the wallet's own error logs: they carry the real failure cause,
  // which the generic ERROR state hides. Keep the FIRST error (root cause).
  let lastError = '';
  const record = a => { if (!lastError) lastError = logToString(a); };
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (...a) => { record(a); console.error(...a); },
  };
  // parts of the lib log through their own default logger (console), not the
  // injected one; mirror console.error into the buffer while opening
  const origConsoleError = console.error.bind(console);
  console.error = (...a) => { record(a); origConsoleError(...a); };
  const restoreConsole = () => { console.error = origConsoleError; };
  const wallet = new HathorWallet({
    connection, seed: words, password: PIN, pinCode: PIN, logger,
  });
  // breadcrumbs: wallet + connection state transitions for failure reports
  const crumbs = [];
  wallet.on('state', s => crumbs.push('w' + s));
  connection.on('state', s => crumbs.push('c' + s));
  // the PROCESSING state's catch swallows its exception, so shadow the
  // method and capture the real error before rethrowing
  const origQueue = wallet.processTxQueue.bind(wallet);
  wallet.processTxQueue = async () => {
    try { return await origQueue(); }
    catch (e) {
      if (!lastError) {
        lastError = `processing: ${(e && (e.message || String(e))) || e}`
          + (e && e.stack ? ` | ${String(e.stack).slice(0, 160)}` : '');
      }
      throw e;
    }
  };
  try {
    try {
      await wallet.start();
    } catch (e) {
      throw new Error(`wallet start failed via ${HOST}: ${(e && e.message) || e}`);
    }
    await waitReady(wallet, () => `[v9 ${crumbs.join('>')}] ${lastError}`);
  } finally {
    restoreConsole();
  }
  const address = await wallet.getAddressAtIndex(0);

  /* Nano nonce, from the chain rather than from us.
     wallet-lib reads seqnum out of its own storage (addressInfo.seqnum + 1).
     A session wallet whose history sync has slipped — a dropped socket, a
     tab restored from cache — then signs every nano tx with a stale nonce and
     the chain accepts and voids it: "invalid seqnum (diff=-28)", which the
     player sees as "transaction failed" on claim, guild join, ranked, over
     and over, with nothing wrong on either side. The server reports the max
     nc_seqnum the chain has seen for this caller, and we take the higher of
     that and the local count. */
  const libSeqnum = wallet.getNanoHeaderSeqnum.bind(wallet);
  /* A nonce is spent the moment it is SIGNED, not when it confirms. Both the
     local count and the chain-derived one lag an in-flight tx, so a second
     action started before the first confirmed reused a number and the chain
     answered "invalid seqnum (diff=0)". Every value this wallet issues is
     remembered for the page's life and never handed out twice. */
  /* survives reloads: a nonce signed just before a refresh is still spent */
  const seqKey = 'emberfall_issued_seq_' + address;
  let issued = Number(localStorage.getItem(seqKey) || -1);
  wallet.getNanoHeaderSeqnum = async addr => {
    const local = await libSeqnum(addr).catch(() => 0);
    let next = local;
    try {
      const r = await fetch(`/api/seqnum?addr=${addr}`);
      if (r.ok) {
        const j = await r.json();
        if (Number.isInteger(j.next) && j.next > next) next = j.next;
      }
    } catch { /* offline or blocked: the local count still stands */ }
    if (next <= issued) next = issued + 1;
    issued = next;
    try { localStorage.setItem(seqKey, String(next)); } catch { /* private mode */ }
    return next;
  };

  return {
    address,

    async executeNano(method, data) {
      const hydrated = {
        ...data,
        actions: (data.actions || []).map(a => ({
          ...a,
          amount: BigInt(a.amount),
          // keep everything on address 0 so balances stay legible
          ...(a.type === 'deposit' ? { changeAddress: address } : {}),
        })),
      };
      const tx = await wallet.createAndSendNanoContractTransaction(
        method, address, hydrated, { pinCode: PIN });
      return { hash: tx.hash };
    },

    /* Pull the wallet's own index back in line with the chain. A freshly
       claimed champion exists on chain before this wallet has indexed its
       output, and until it does a deposit fails with "not enough utxos" —
       which reads as an empty wallet and is nothing of the kind. */
    async resync() {
      try { await wallet.reloadStorage(); } catch { /* best effort */ }
    },

    async balance(token) {
      const b = await wallet.getBalance(token || '00');
      return Number(b[0]?.balance?.unlocked ?? 0);
    },

    async tokens() {
      return wallet.getTokens();
    },

    // one data output (0.01 HTR, burned by the protocol): used for on-chain
    // name claims; the signed inputs prove who wrote the data
    async sendData(data) {
      // data must be a plain string: the lib utf8-encodes it (ScriptData).
      // change stays pinned to address 0 like every other session flow
      const tx = await wallet.sendManyOutputsTransaction(
        [{ type: 'data', data }], { pinCode: PIN, changeAddress: address });
      return { hash: tx.hash };
    },

    // plain HTR transfer: session top-ups and the dev main-wallet adapter
    async sendHtr(to, amount) {
      const tx = await wallet.sendTransaction(to, BigInt(amount),
        { pinCode: PIN, changeAddress: address });
      return { hash: tx.hash };
    },

    // hand one champion to another address of the player's (session -> main)
    async sendToken(to, uid, amount) {
      const tx = await wallet.sendTransaction(to, BigInt(amount),
        { token: uid, pinCode: PIN, changeAddress: address });
      return { hash: tx.hash };
    },

    async sweep(toAddress) {
      const uids = await wallet.getTokens();
      const outputs = [];
      for (const uid of uids) {
        const b = await wallet.getBalance(uid);
        const amount = b[0]?.balance?.unlocked ?? 0n;
        if (amount > 0n || Number(amount) > 0) {
          outputs.push({ address: toAddress, value: BigInt(amount), token: uid });
        }
      }
      if (!outputs.length) return null;
      const tx = await wallet.sendManyOutputsTransaction(outputs, { pinCode: PIN });
      return { hash: tx.hash, moved: outputs.length };
    },

    stop() { return wallet.stop({ cleanStorage: true, cleanAddresses: true }); },
  };
}

window.SessionKit = {
  // token metadata through the batched path, so the coalescing can be
  // checked from a console instead of taken on faith
  tokenInfo: uid => new Promise((res, rej) => {
    const p = walletApi.getGeneralTokenInfo(uid, res);
    if (p && p.catch) p.catch(rej);
  }),
  generateWords: () => walletUtils.generateWalletWords(),
  addressFor,
  open,
};
