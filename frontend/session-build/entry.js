/* Emberfall session signer — a full Hathor light wallet on a throwaway seed,
   running entirely in the player's browser. Signs game transactions without
   wallet prompts; sweeps everything back to the main wallet on demand. */
import { HathorWallet, Connection, walletUtils } from '@hathor/wallet-lib';
import { P2PKH_ACCT_PATH } from '@hathor/wallet-lib/lib/constants';
import { deriveAddressFromXPubP2PKH } from '@hathor/wallet-lib/lib/utils/address';
import { JSONBigInt } from '@hathor/wallet-lib/lib/utils/bigint';
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

const NODE = (typeof window !== 'undefined' && window.GAME && window.GAME.sessionNode)
  || 'https://node1.testnet.hathor.network/v1a/';
const NETWORK = 'testnet';
const PIN = 'emberfall-session';

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

    async balance(token) {
      const b = await wallet.getBalance(token || '00');
      return Number(b[0]?.balance?.unlocked ?? 0);
    },

    async tokens() {
      return wallet.getTokens();
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
  generateWords: () => walletUtils.generateWalletWords(),
  addressFor,
  open,
};
