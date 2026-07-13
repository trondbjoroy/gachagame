## Summary

`JSONBigInt.bigIntReviver` (src/utils/bigint.ts) makes every browser wallet built on wallet-lib fail to sync on **all iOS browsers** (Safari, Chrome, Firefox on iOS are all WebKit) and on desktop Safari. The wallet reaches `SYNCING` and then lands in the `ERROR` state as soon as the first JSON response containing a **float** is parsed.

## Root cause

The reviver's float handling catches the `BigInt()` conversion error and decides "this was a float, keep it as a Number" by **comparing the error message string** against V8's and Firefox's wording:

```ts
} catch (e) {
  if (e instanceof SyntaxError && (e.message === `Cannot convert ${context.source} to a BigInt` || e.message === `invalid BigInt syntax`)) {
    // it's a double, keep as Number
    return value;
  }
  // "This should never happen" -> rethrow
  ...
}
```

- V8 (Chrome/Node): `Cannot convert 1.5 to a BigInt` ✔ matched
- Firefox/SpiderMonkey: `invalid BigInt syntax` ✔ matched
- **WebKit/JavaScriptCore: `Failed to parse String to BigInt` ✘ not matched → rethrown**

So on WebKit, any float anywhere in a fullnode API response or websocket message (`weight`, timestamps, etc.) throws:

```
unexpected error in bigIntReviver: SyntaxError: Failed to parse String to BigInt
```

…which propagates out of `JSON.parse`, aborts history sync / websocket message handling, and puts `HathorWallet` in `ERROR`.

Note: this is *not* the missing-API case. Current WebKit (tested on iOS 18.7 / Safari 26) **does** support the `JSON.parse` reviver `context` argument and `JSON.rawJSON`, so any feature detection passes — it's specifically the error-message whitelist that breaks. Engine error message strings are not a stable API and can also change between versions of the same engine.

## Reproduction

On any WebKit browser (an iPhone, or desktop Safari):

```js
JSON.parse('{"weight":16.8}', (key, value, context) => {
  if (typeof value !== 'number') return value;
  try { return BigInt(context.source); }
  catch (e) { console.log(e.message); throw e; }
});
// logs: "Failed to parse String to BigInt" (V8 logs: "Cannot convert 16.8 to a BigInt")
```

Or simply: start a `HathorWallet` from any iOS browser against a public fullnode — it never reaches `READY`.

## Suggested fix

Don't classify by error message. Test the source text itself, e.g.:

```ts
bigIntReviver(_key, value, context) {
  if (typeof value !== 'number') return value;
  if (!/^-?\d+$/.test(context.source)) return value; // float or exponent: keep as Number
  const bigIntValue = BigInt(context.source);
  return bigIntValue < Number.MIN_SAFE_INTEGER || bigIntValue > Number.MAX_SAFE_INTEGER
    ? bigIntValue
    : value;
}
```

(Exponent-notation integers like `1e21` that exceed the safe range would need a decision, but they already hit the mismatch path today.)

As a workaround we swapped `JSONBigInt.parse`/`stringify` for a pure-JS codec (`json-bigint` with `useNativeBigInt: true`), which restored iOS support.

## Related friction worth noting

Two things made this bug very hard to diagnose remotely and would be cheap to improve:

1. In `onConnectionChangedState`, the `catch` calls `setState(HathorWallet.ERROR)` **before** `logger.error('Error loading wallet', { error })` — an app reacting synchronously to the `state` event cannot yet see what went wrong.
2. `onEnterStateProcessing` swallows its exception entirely (`catch (e) { this.setState(HathorWallet.ERROR); }` with no logging).

## Environment

- @hathor/wallet-lib 4.0.0 (bundled for browser with esbuild)
- Fails: iOS 18.7 (Safari 26 / Chrome iOS 150 — both WebKit); works: desktop Chrome (V8), Node 22
- Observed against node1.testnet.hathor.network (testnet-india)
