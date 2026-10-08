import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['app/wallet/privy-entry.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  logLevel: 'warning',
});
for (const dir of ['app', 'public/lingon']) {
  mkdirSync(root + dir, { recursive: true });
  writeFileSync(root + dir + '/privy-wallet.js', result.outputFiles[0].contents);
}
console.log('Built lazy Privy wallet SDK for the app and Lovable runtime.');
