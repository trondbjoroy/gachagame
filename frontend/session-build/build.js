const { build } = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');
const fs = require('fs');

// json-bigint feeds ANY number string longer than 15 chars to BigInt(),
// floats included; a tx weight like 20.727035991356306 then throws and kills
// the whole wallet sync. Only integers may take the BigInt path. Patched at
// bundle time so reinstalling node_modules cannot quietly resurrect the bug.
const fixJsonBigintFloats = {
  name: 'fix-json-bigint-floats',
  setup(b) {
    b.onLoad({ filter: /json-bigint[\\/]lib[\\/]parse\.js$/ }, args => {
      const src = fs.readFileSync(args.path, 'utf8');
      const broken = 'if (string.length > 15)';
      if (!src.includes(broken)) throw new Error('json-bigint patch target not found: ' + args.path);
      return {
        contents: src.replace(broken,
          "if (string.length > 15 && string.indexOf('.') === -1 && string.indexOf('e') === -1 && string.indexOf('E') === -1)"),
        loader: 'js',
      };
    });
  },
};

const common = {
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
  plugins: [
    fixJsonBigintFloats,
    {
      name: 'assert-shim',
      setup(b) {
        b.onResolve({ filter: /^assert$/ }, () => ({ path: require('path').resolve(__dirname, 'shims/assert.js') }));
      },
    },
    polyfillNode({
      globals: { buffer: true, process: true },
      polyfills: { crypto: true, buffer: true, stream: true, events: true, util: true, url: true, assert: false, path: true, os: true, fs: 'empty', net: 'empty', tls: 'empty' },
    }),
  ],
  logLevel: 'warning',
};

Promise.all([
  build({ ...common, entryPoints: ['entry.js'], outfile: '../public/session-lib.js' })
    .then(() => console.log('session-lib.js built')),
  build({ ...common, entryPoints: ['wc-entry.js'], outfile: '../public/wc-lib.js' })
    .then(() => console.log('wc-lib.js built')),
]).catch(e => { console.error(e.message || e); process.exit(1); });
