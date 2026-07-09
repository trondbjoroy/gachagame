const { build } = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');

build({
  entryPoints: ['entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  outfile: '../public/session-lib.js',
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
}).then(() => console.log('session-lib.js built')).catch(e => { console.error(e.message || e); process.exit(1); });
