// Keeps the Lovable build congruent with the lingon source of truth.
// app/ (vanilla frontend) is copied verbatim to public/lingon/ and the
// public pages to public/, so every `npm run build` (incl. Lovable hosting)
// serves the current code — never a stale copy.
// The Node/Express backend in server/ is mirrored to src/lingon-server/
// (ESM edge port) by hand; this script verifies the branding strings match
// and warns when they drift so the API identity stays in sync.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function copy(src, dest) {
  const from = join(root, src);
  const to = join(root, dest);
  if (!existsSync(from)) {
    console.error(`sync-lingon: MISSING source ${src}`);
    failures++;
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`sync-lingon: ${src} -> ${dest}`);
}

// Frontend JS/CSS served by the TanStack route from /lingon/*
for (const f of ['app.js', 'auth.js', 'config.js', 'engine.real.js', 'engine.managed.js', 'mascot.js', 'styles.css', 'task-routing.js']) {
  copy(join('app', f), join('public', 'lingon', f));
}
// Static Belna pages served from the site root
for (const f of ['cookies.html', 'pricing.html', 'privacy.html', 'promo.html', 'research.html', 'research-arche-1-0.html', 'research-100m.html', 'research-stlm-sla.html', 'research.css', 'security.html', 'terms.html', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
  copy(join('app', f), join('public', f));
}
copy(join('app', 'research-code', 'belna-100m.zip'), join('public', 'research-code', 'belna-100m.zip'));
copy(join('app', 'research-code', 'belna-stlm-sla.zip'), join('public', 'research-code', 'belna-stlm-sla.zip'));

// Lovable's live Vite server evaluates source files as ESM and cannot execute
// the CommonJS provider directly. Generate an equivalent ESM copy for the
// edge port while keeping server/ compatible with the Node/Express runtime.
function syncAzureProvider() {
  const srcFile = 'server/agents/azure-vm.js';
  const edgeFile = 'src/lingon-server/agents/azure-vm.js';
  const cryptoRequire = "const crypto = require('crypto');";
  const exportsMarker = '\nmodule.exports = {';
  const src = readFileSync(join(root, srcFile), 'utf8');
  const exportsAt = src.lastIndexOf(exportsMarker);
  if (!src.includes(cryptoRequire) || exportsAt < 0) {
    console.error(`sync-lingon: could not convert ${srcFile} to ESM`);
    failures++;
    return;
  }
  const esm = src
    .replace(cryptoRequire, "import crypto from 'node:crypto';")
    .slice(0, exportsAt)
    + '\nexport {'
    + src.slice(exportsAt + exportsMarker.length);
  const to = join(root, edgeFile);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, esm, 'utf8');
  console.log(`sync-lingon: ${srcFile} -> ${edgeFile} (ESM)`);
}

syncAzureProvider();

function syncFoundryProvider() {
  const srcFile = 'server/foundry.js';
  const edgeFile = 'src/lingon-server/foundry.js';
  const exportsMarker = '\nmodule.exports = {';
  const src = readFileSync(join(root, srcFile), 'utf8');
  const exportsAt = src.lastIndexOf(exportsMarker);
  if (exportsAt < 0 || /\brequire\s*\(/.test(src.slice(0, exportsAt))) {
    console.error(`sync-lingon: could not convert ${srcFile} to ESM`);
    failures++;
    return;
  }
  const esm = src.slice(0, exportsAt)
    + '\nexport {'
    + src.slice(exportsAt + exportsMarker.length);
  const to = join(root, edgeFile);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, esm, 'utf8');
  console.log(`sync-lingon: ${srcFile} -> ${edgeFile} (ESM)`);
}

syncFoundryProvider();

// These modules are shared logic; generate the ESM port instead of maintaining
// a second coordinator/state machine that can drift from the Node deployment.
for (const name of ['task-store', 'task-runtime', 'conversation', 'workspace-runtime', 'attachments', 'upkeep']) {
  let src = readFileSync(join(root, `server/agents/${name}.js`), 'utf8');
  src = src.replace(/const (\{[^\n]+\}) = require\('([^']+)'\);/g, (_, bindings, spec) =>
    `import ${bindings} from '${spec.startsWith('.') ? spec + '.js' : spec}';`);
  src = src.replace(/const (\w+) = require\('([^']+)'\);/g, (_, binding, spec) =>
    spec === 'crypto' ? `import ${binding} from 'node:crypto';` : spec === 'path' ? `import path from 'node:path';` : `import * as ${binding} from '${spec}.js';`);
  src = src.replace('module.exports={createCoordinator,handle:coordinator.handle,tasks,startWorker};',
    'const handle=coordinator.handle;\nexport {createCoordinator,handle,tasks,startWorker};');
  src = src.replace(/module\.exports\s*=\s*\{/g, 'export {');
  if (/require\(|module\.exports/.test(src)) throw new Error(`Unconverted CommonJS in ${name}`);
  writeFileSync(join(root, `src/lingon-server/agents/${name}.js`), src, 'utf8');
}

// Backend confidentiality policy must match between server/ (Node) and
// src/lingon-server/ (edge port) so chat + research behave the same way.
for (const [srcFile, edgeFile, marker] of [
  ['server/index.js', 'src/lingon-server/index.js', 'INTERNAL CONFIDENTIALITY'],
  ['server/research.js', 'src/lingon-server/research.js', 'Never discuss internal implementation'],
]) {
  const src = readFileSync(join(root, srcFile), 'utf8');
  const edge = readFileSync(join(root, edgeFile), 'utf8');
  if (!src.includes(marker)) console.error(`sync-lingon: WARN ${srcFile} missing "${marker}"`);
  if (!edge.includes(marker)) {
    console.error(`sync-lingon: WARN ${edgeFile} missing "${marker}" — port the change from ${srcFile}`);
  } else {
    console.log(`sync-lingon: policy OK in ${edgeFile}`);
  }
}

if (failures > 0) {
  console.error(`sync-lingon: ${failures} failure(s)`);
  process.exit(1);
}
console.log('sync-lingon: done');
