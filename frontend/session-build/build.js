const { build } = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');

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
