# Bug report: `htr_sendTransaction` over WalletConnect fails after approval (testnet-india)

**Reporter:** Emberfall (https://emberfall.fun) — an onchain game on the public
Hathor testnet.

## Summary

A dApp calls `htr_sendTransaction` over WalletConnect/Reown to send a simple HTR
output. The Hathor mobile wallet receives the request, shows the approval screen, the
user approves — and the wallet then fails with **"Error while sending transaction."**
No transaction is broadcast.

The same wallet, over the same WalletConnect pairing, signs `htr_sendNanoContractTx`
successfully (deposits, withdrawals, nano-contract method calls all work). Only the
plain-transfer path fails.

## Environment

- Network: **testnet-india** (custom network configured in the mobile wallet)
- Transport: WalletConnect / Reown, `hathor:testnet` chain
- dApp side: `@walletconnect/sign-client` in the browser
- Wallet: Hathor mobile wallet (iOS), "Custom network: testnet-india"

## Request payload

```json
{
  "method": "htr_sendTransaction",
  "params": {
    "network": "testnet",
    "outputs": [
      { "address": "<session address>", "value": "100" }
    ]
  }
}
```

`value` is a decimal string per the spec (validated as `z.coerce.bigint().positive()`
in hathor-rpc-lib). `token` is omitted (defaults to native HTR). We also tried with
`"token": "00"` explicitly — same result.

## Expected

The wallet builds a transaction with one 1.00 HTR output to the given address, signs,
and broadcasts it (or returns the tx for the dApp to push).

## Actual

After approval the wallet shows "Error while sending transaction" and nothing is
broadcast. `htr_sendNanoContractTx` from the same session works, so the pairing,
namespace methods, and network selection are all correct.

## Notes / hypothesis

- Method IS in the approved namespace (adding it fixed an earlier "Missing or invalid
  request() method" rejection), so this is a wallet-side build/broadcast failure, not a
  permission issue.
- Possibly the plain-transfer path uses the wallet's default tx-mining/broadcast
  configuration rather than the custom-network settings that the nano-contract path
  uses correctly.

## Workaround in production

Emberfall now skips `htr_sendTransaction` for WalletConnect entirely and asks the user
to send HTR to the target address from the wallet's normal send screen (which works),
detecting the transfer by polling. We would happily switch back to the RPC once fixed.
