/* Wallet adapters for GachaArena.
   Every adapter exposes: connect() -> address, executeNano(method, args, actions),
   tokenBalance(uid) -> int, label, mode.

   - snap:  Hathor MetaMask Snap (npm:@hathor/snap), htr_* JSON-RPC
   - wc:    WalletConnect / Reown pairing with the Hathor mobile/desktop
            wallet, same htr_* JSON-RPC over the relay                     */

const SNAP_ID = 'npm:@hathor/snap';

// Hathor base58 address prefixes: testnet P2PKH starts 'W', mainnet 'H'.
function addressNetwork(addr) {
  const c = (addr || '')[0];
  return c === 'W' ? 'testnet' : c === 'H' ? 'mainnet' : null;
}
function wrongNetworkError(onNet) {
  const want = window.GAME.network;
  return new Error(
    `Your MetaMask Hathor snap is on ${onNet || 'the wrong network'}, but Emberfall runs on `
    + `${want}. Switch the Hathor snap to ${want} in MetaMask, then connect again.`);
}

// Locate a Snaps-capable MetaMask provider. Other wallet extensions
// (Brave Wallet, Coinbase, ...) often shadow window.ethereum, and
// MetaMask Mobile's in-app browser does not support Snaps at all.
// The provider object is stable for the page's lifetime (account changes
// fire events, they don't swap the provider), so we discover once and cache.
let mmProvider = null;
function findMetaMask() {
  if (mmProvider) return Promise.resolve(mmProvider);
  return new Promise(resolve => {
    let done = false;
    const finish = p => {
      if (done) return;
      done = true;
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (p) mmProvider = p;
      resolve(p);
    };
    // resolve the instant MetaMask announces (usually within a frame) rather
    // than waiting a fixed timeout — that delay was paid on every connect
    const onAnnounce = e => {
      if (/metamask/i.test(e.detail?.info?.name || '')) finish(e.detail.provider);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    // fallback for wallets that don't do EIP-6963 or announce late
    setTimeout(() => {
      const multi = window.ethereum?.providers;
      const legacy = (Array.isArray(multi) && multi.find(x => x.isMetaMask)) || window.ethereum || null;
      finish(legacy);
    }, 250);
  });
}

// amounts in htr_sendNanoContractTx actions are strings per the spec.
// changeAddress pins deposit change back to the shared address so the
// node-side balance display stays accurate for multi-address wallets.
function rpcActions(actions, changeAddress) {
  return actions.map(a => ({
    ...a, amount: String(a.amount),
    ...(a.type === 'deposit' && changeAddress ? { changeAddress } : {}),
  }));
}

// Prompt-free balance reads for self-custody wallets: query the node for
// the shared address instead of htr_getBalance (which opens a MetaMask
// confirmation for every call). Cached briefly to avoid hammering the node.
let balCache = { addr: null, at: 0, data: null };
async function addrBalance(address, token) {
  const now = Date.now();
  if (balCache.addr !== address || now - balCache.at > 5000) {
    const r = await fetch(`/node/thin_wallet/address_balance?address=${address}`);
    const d = await r.json();
    balCache = { addr: address, at: now, data: d.tokens_data || {} };
  }
  const t = balCache.data[token];
  return t ? Math.max(0, (t.received || 0) - (t.spent || 0)) : 0;
}

/* ---------------- MetaMask Snap ---------------- */

class SnapWallet {
  constructor() { this.mode = 'snap'; this.label = 'MetaMask (Hathor Snap)'; this.address = null; }

  async invoke(method, params) {
    const r = await this.provider.request({
      method: 'wallet_invokeSnap',
      params: { snapId: SNAP_ID, request: { method, params } },
    });
    // some provider/snap combinations return the result JSON-stringified
    if (typeof r === 'string' && (r.startsWith('{') || r.startsWith('['))) {
      try { return JSON.parse(r); } catch { return r; }
    }
    return r;
  }

  async connect() {
    this.provider = await findMetaMask();
    if (!this.provider) throw new Error('MetaMask is not installed');
    // wallet_getSnaps is a permission read (no popup, no registry fetch); if the
    // Hathor snap is already connected to this dapp we skip wallet_requestSnaps,
    // which otherwise re-checks the snap registry and stalls the popup for seconds
    let connected = false;
    try {
      const snaps = await this.provider.request({ method: 'wallet_getSnaps' });
      connected = !!(snaps && snaps[SNAP_ID]);
    } catch { /* older providers lack getSnaps; fall through to requestSnaps */ }
    if (!connected) {
      try {
        await this.provider.request({ method: 'wallet_requestSnaps', params: { [SNAP_ID]: {} } });
      } catch (e) {
        const msg = e?.message || String(e);
        if (/unsupported method|method not found|does not exist|not supported/i.test(msg)) {
          throw new Error('This browser wallet cannot run MetaMask Snaps. ' +
            'Use the MetaMask browser extension (v11+) on desktop Chrome/Firefox, and if you have ' +
            'several wallet extensions, disable the others; Snaps do not work in MetaMask Mobile.');
        }
        throw e;
      }
    }
    // the snap signs and derives on ITS configured network (the per-call
    // network param is ignored), so a mainnet snap on this testnet game binds a
    // mainnet address and breaks auto-funding and every tx. Detect it and ask
    // MetaMask to switch, exactly as other Hathor dapps do.
    await this.ensureNetwork();

    const info = await this.invoke('htr_getWalletInformation', { network: window.GAME.network });
    this.address = info && (info.response?.address0 ?? info.address ?? info.response?.address);
    if (!this.address) {
      const a = await this.invoke('htr_getAddress', { type: 'index', index: 0, network: window.GAME.network });
      this.address = typeof a === 'string' ? a : a?.address ?? a?.response?.address;
    }
    if (!this.address || !/^[A-Za-z0-9]{30,40}$/.test(this.address)) {
      throw new Error('snap returned an unexpected address format');
    }
    // final guard: the address prefix must match the game's network (covers
    // snaps too old for htr_getConnectedNetwork/htr_changeNetwork)
    if (addressNetwork(this.address) !== window.GAME.network) {
      throw wrongNetworkError(addressNetwork(this.address));
    }
    return this.address;
  }

  // the snap's current network, from htr_getConnectedNetwork with an
  // address-prefix fallback for older snaps
  async snapNetwork() {
    try {
      const n = await this.invoke('htr_getConnectedNetwork', {});
      const net = n?.network ?? n?.response?.network ?? (typeof n === 'string' ? n : null);
      if (net) return net;
    } catch { /* older snap; infer from the address below */ }
    try {
      const info = await this.invoke('htr_getWalletInformation', {});
      return addressNetwork(info?.response?.address0 ?? info?.address ?? info?.response?.address);
    } catch { return null; }
  }

  // if the snap is on the wrong network, ask MetaMask to switch. htr_changeNetwork
  // opens the snap's "New network" confirmation; on approval the snap updates its
  // network and subsequent address reads/signing use it.
  async ensureNetwork() {
    const want = window.GAME.network;
    const current = await this.snapNetwork();
    if (!current || current === want) return; // already right, or unknown -> prefix guard catches it
    try {
      await this.invoke('htr_changeNetwork', { network: current, newNetwork: want });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/reject|denied|cancel/i.test(msg)) {
        throw new Error(`Emberfall runs on ${want}. Approve the network change in MetaMask `
          + `(or switch the Hathor snap to ${want} yourself), then connect again.`);
      }
      throw wrongNetworkError(current); // change unsupported: fall back to instructing
    }
    // confirm it took; if not, don't bind a wrong-chain address
    if ((await this.snapNetwork()) !== want) throw wrongNetworkError(current);
  }

  async executeNano(method, args, actions, target) {
    const res = await this.invoke('htr_sendNanoContractTx', {
      method,
      blueprint_id: (target || window.GAME).blueprint,
      nc_id: (target || window.GAME).nc,
      actions: rpcActions(actions, this.address),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash ?? res?.txId;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }

  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.invoke('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount) }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }

  async sendData(data) {
    const res = await this.invoke('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ type: 'data', data }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }
}

/* ---------------- WalletConnect / Reown ---------------- */

let wcLibLoading = null;
function loadWcLib() {
  if (window.WcSignClient) return Promise.resolve();
  if (!wcLibLoading) {
    wcLibLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'wc-lib.js?v=1';
      el.onload = resolve;
      el.onerror = () => {
        wcLibLoading = null; // a later attempt may retry the load
        el.remove();
        reject(new Error('failed to load the WalletConnect client'));
      };
      document.head.appendChild(el);
    });
  }
  return wcLibLoading;
}

class WcWallet {
  constructor() {
    this.mode = 'wc'; this.label = 'WalletConnect (Hathor wallet)';
    this.address = null; this.client = null; this.session = null;
    this.chain = `hathor:${window.GAME.network}`;
  }

  async initClient() {
    if (this.client) return this.client;
    if (!window.GAME.wcProjectId) {
      throw new Error('WalletConnect needs a (free) Reown Cloud project id; set wcProjectId in config.js');
    }
    // self-hosted bundle first ("Importing a module script failed" on phones
    // was the on-demand esm.sh build timing out); the CDN is a last resort
    let SignClient;
    try {
      await loadWcLib();
      SignClient = window.WcSignClient;
    } catch {
      ({ SignClient } = await import('https://esm.sh/@walletconnect/sign-client@2.17.2?bundle'));
    }
    this.client = await SignClient.init({
      projectId: window.GAME.wcProjectId,
      metadata: {
        name: 'Hathor Gacha Arena',
        description: 'Onchain gacha: pull, farm, fuse, duel',
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.png`],
      },
    });
    this.client.on('session_delete', e => {
      if (this.session && e.topic === this.session.topic) this.session = null;
    });
    return this.client;
  }

  // adopt a still-valid pairing from a previous visit, if one exists.
  // Stored sessions can be zombies (the wallet app forgot them, e.g. after
  // a settings reset), so ping before trusting one: an unacked ping means
  // requests would vanish into the relay with nobody listening.
  async restore() {
    await this.initClient();
    const live = this.client.session.getAll().filter(s =>
      s.namespaces?.hathor && s.expiry * 1000 > Date.now() + 60_000);
    const s = live.sort((a, b) => b.expiry - a.expiry)[0];
    if (!s) return null;
    try {
      await Promise.race([
        this.client.ping({ topic: s.topic }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 8000)),
      ]);
    } catch {
      try { await this.client.disconnect({ topic: s.topic, reason: { code: 6000, message: 'stale' } }); }
      catch { /* already gone */ }
      return null;
    }
    this.session = s;
    const accounts = s.namespaces.hathor?.accounts ?? [];
    this.address = accounts[0]?.split(':')[2] || null;
    return this.address;
  }

  async connect(onUri) {
    await this.initClient();
    const restored = await this.restore().catch(() => null);
    if (restored) return restored;
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        hathor: {
          methods: ['htr_sendNanoContractTx', 'htr_sendTransaction', 'htr_getBalance',
                    'htr_getAddress', 'htr_getConnectedNetwork', 'htr_signWithAddress'],
          chains: [this.chain],
          events: [],
        },
      },
    });
    if (uri && onUri) onUri(uri);
    this.session = await approval();
    const accounts = this.session.namespaces.hathor?.accounts ?? [];
    this.address = accounts[0]?.split(':')[2];
    if (!this.address) throw new Error('wallet did not share an address');
    return this.address;
  }

  async request(method, params) {
    return this.client.request({
      topic: this.session.topic,
      chainId: this.chain,
      request: { method, params },
    });
  }

  async executeNano(method, args, actions, target) {
    const res = await this.request('htr_sendNanoContractTx', {
      network: window.GAME.network,
      method,
      blueprint_id: (target || window.GAME).blueprint,
      nc_id: (target || window.GAME).nc,
      actions: rpcActions(actions, this.address),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }

  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.request('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount) }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }

  async sendData(data) {
    const res = await this.request('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ type: 'data', data }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the transaction');
    return { hash };
  }

  async disconnect() {
    if (this.client && this.session) {
      await this.client.disconnect({
        topic: this.session.topic,
        reason: { code: 6000, message: 'user disconnected' },
      }).catch(() => {});
    }
  }
}

/* ---------------- Session (promptless, browser-held key) ---------------- */

let sessionLibLoading = null;
function loadSessionLib() {
  if (window.SessionKit) return Promise.resolve();
  if (!sessionLibLoading) {
    sessionLibLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      // versioned: phones pin heuristically-cached copies of this 3.7MB
      // bundle even after the server starts sending no-cache
      el.src = 'session-lib.js?v=13';
      el.onload = resolve;
      el.onerror = () => reject(new Error('failed to load the session signer'));
      document.head.appendChild(el);
    });
  }
  return sessionLibLoading;
}

class SessionWallet {
  constructor(handle, mainAddr) {
    this.mode = 'session';
    this.label = 'Session (promptless)';
    this.handle = handle;
    this.address = handle.address;
    this.mainAddr = mainAddr;
  }

  static async create() {
    await loadSessionLib();
    return window.SessionKit.generateWords();
  }

  // address 0 for a seed, derived offline: lets the funding step show an
  // address without waiting on (or risking) a full wallet sync
  static async addressFor(words) {
    await loadSessionLib();
    return window.SessionKit.addressFor(words);
  }

  static async open(words, mainAddr) {
    await loadSessionLib();
    const handle = await window.SessionKit.open(words);
    return new SessionWallet(handle, mainAddr);
  }

  async executeNano(method, args, actions, target) {
    return this.handle.executeNano(method, {
      ncId: (target || window.GAME).nc,
      blueprintId: (target || window.GAME).blueprint,
      args,
      actions,
    });
  }

  async tokenBalance(uid) { return this.handle.balance(uid); }
  async htrBalance() { return this.handle.balance('00'); }
  async sendData(data) { return this.handle.sendData(data); }
  async sweep() { return this.handle.sweep(this.mainAddr); }
  async disconnect() { await this.handle.stop().catch(() => {}); }
}

// HTR balance of any address over plain HTTP: immune to the wallet's live
// sync sleeping through a transfer while the tab is suspended (phones).
// prefetchSession warms the 3.7MB session bundle so the funding request can
// publish the instant the player taps, before any app switch suspends us.
window.WALLETS = {
  SnapWallet, WcWallet, SessionWallet,
  addrHtr: a => addrBalance(a, '00'),
  prefetchSession: () => loadSessionLib().catch(() => {}),
  prefetchWc: () => loadWcLib().catch(() => {}),
  // discover + cache the MetaMask provider ahead of the click so connect()
  // reaches wallet_requestSnaps with no discovery delay
  prefetchSnap: () => findMetaMask().catch(() => {}),
};
