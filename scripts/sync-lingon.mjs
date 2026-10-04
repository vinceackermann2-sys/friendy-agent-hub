// Keeps the Lovable build congruent with the lingon source of truth.
// app/ (vanilla frontend) is copied verbatim to public/lingon/ and the
// public pages to public/, so every `npm run build` (incl. Lovable hosting)
// serves the current code — never a stale copy.
// The Node/Express backend in server/ is mirrored to src/lingon-server/
// (ESM edge port) by hand; this script verifies the branding strings match
// and warns when they drift so the API identity stays in sync.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
for (const f of ['app.js', 'auth.js', 'config.js', 'engine.real.js', 'engine.managed.js', 'mascot.js', 'styles.css', 'task-routing.js', 'apple-native.js']) {
  copy(join('app', f), join('public', 'lingon', f));
}
// Standalone public pages load /styles.css, while the app loads /lingon/styles.css.
copy(join('app', 'styles.css'), join('public', 'styles.css'));
// Mascot sprites rendered by design/mascot/build_mascot.py
for (const f of readdirSync(join(root, 'app', 'mascot')).filter((name) => name.endsWith('.webp'))) {
  copy(join('app', 'mascot', f), join('public', 'lingon', 'mascot', f));
}
// Static Belna pages served from the site root
for (const f of ['cookies.html', 'pricing.html', 'privacy.html', 'support.html', 'promo.html', 'research.html', 'research-arche-1-0.html', 'research-100m.html', 'research-stlm-sla.html', 'research.css', 'security.html', 'terms.html', 'withdrawal.html', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
  copy(join('app', f), join('public', f));
}
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
  const esm = src.slice(0, exportsAt)
    .replace(cryptoRequire, "import crypto from 'node:crypto';")
    .replace("const { createAzureAccountErasure } = require('./azure-erasure');", "import { createAzureAccountErasure } from './azure-erasure.js';")
    + '\nexport {'
    + src.slice(exportsAt + exportsMarker.length);
  const to = join(root, edgeFile);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, esm, 'utf8');
  console.log(`sync-lingon: ${srcFile} -> ${edgeFile} (ESM)`);
}

syncAzureProvider();

{
  const source = readFileSync(join(root,'server/agents/azure-erasure.js'),'utf8');
  const esm = source.replace("const crypto = require('crypto');", "import crypto from 'node:crypto';")
    .replace("const { XMLParser } = require('fast-xml-parser');", "import { XMLParser } from 'fast-xml-parser';")
    .replace('module.exports = {','export {');
  writeFileSync(join(root,'src/lingon-server/agents/azure-erasure.js'),esm,'utf8');
}

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

function syncStripeProvider() {
  const src = readFileSync(join(root, 'server/stripe.js'), 'utf8');
  const esm = src
    .replace("const { PLANS, PRELANDER_OFFERS, creditPackFor, tokenPackFor, GIFT_AMOUNTS } = require('./plans');", "import { PLANS, PRELANDER_OFFERS, creditPackFor, tokenPackFor, GIFT_AMOUNTS } from './plans.js';\nimport Stripe from 'stripe';")
    .replace("const store = require('./store');", "import * as store from './store.js';")
    .replace("stripe = require('stripe')(key);", "stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });")
    .replace("require('stripe').createSubtleCryptoProvider()", "Stripe.createSubtleCryptoProvider()")
    .replace(/module\.exports\s*=\s*\{/g, 'export {');
  if (/require\(|module\.exports/.test(esm)) throw new Error('Unconverted Stripe provider');
  writeFileSync(join(root, 'src/lingon-server/stripe.js'), esm, 'utf8');
}

syncStripeProvider();

// Security boundaries must stay identical across the two runtimes.
for (const name of ['oauth-security', 'request-limits', 'shoppay']) {
  const src = readFileSync(join(root, `server/${name}.js`), 'utf8');
  const esm = src
    .replace("const crypto = require('crypto');", "import crypto from 'node:crypto';")
    .replace("const store = require('./store');", "import * as store from './store.js';")
    .replace("const { currencyFor, USD_RATE } = require('./agents/product-search');", "import { currencyFor, USD_RATE } from './agents/product-search.js';")
    .replace("const { publicUrlProblem, pinnedFetch } = require('./agents/sandbox');", "import { publicUrlProblem } from './agents/public-web.js';\nconst pinnedFetch = (url, init) => fetch(url, init);")
    .replace(/module\.exports\s*=\s*\{/g, 'export {');
  if (/require\(|module\.exports/.test(esm)) throw new Error(`Unconverted security module: ${name}`);
  writeFileSync(join(root, `src/lingon-server/${name}.js`), esm, 'utf8');
}

{
  const src = readFileSync(join(root, 'server/agents/wallet-tools.js'), 'utf8');
  writeFileSync(join(root, 'src/lingon-server/agents/wallet-tools.js'), src.replace('module.exports = { createWalletTools };', 'export { createWalletTools };'), 'utf8');
}

for (const [name, factory] of [['whop-user-auth','createWhopUserAuth'],['personal-wallet','createPersonalWallet'],['belna-wallet', 'createBelnaWallet'], ['belna-wallet-store', 'createBelnaWalletStore'], ['wallet-purchases','createWalletPurchases'], ['private-checkout-client','createPrivateCheckoutClient']]) {
  const src = readFileSync(join(root, `server/${name}.js`), 'utf8');
  const esm = src.replace(/^const \{\s*([^}]+)\s*\}\s*=\s*require\('([^']+)'\);/gm,(_,symbols,path)=>`import {${symbols}} from '${path}.js';`).replace(/module\.exports\s*=\s*\{([^}]+)\};?/g,(_,symbols)=>`export {${symbols}};`);
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted Belna wallet module');
  writeFileSync(join(root, `src/lingon-server/${name}.js`), esm, 'utf8');
}
{
  const src = readFileSync(join(root, 'server/whop-webhook.js'), 'utf8');
  writeFileSync(join(root, 'src/lingon-server/whop-webhook.js'), src.replace('module.exports = { verifyWhopWebhook };', 'export { verifyWhopWebhook };'), 'utf8');
}

// The wallet uses injected persistence dependencies, so its implementation is
// identical in the Express and edge runtimes.
{
  const src = readFileSync(join(root, 'server/token-wallet.js'), 'utf8');
  const esm = src.replace('module.exports = { createTokenWallet };', 'export { createTokenWallet };');
  if (/module\.exports/.test(esm)) throw new Error('Unconverted token wallet');
  writeFileSync(join(root, 'src/lingon-server/token-wallet.js'), esm, 'utf8');
}
// Goals and Library persistence use the same injected-dependency pattern.
{
  const src = readFileSync(join(root, 'server/personal-store.js'), 'utf8');
  const esm = src.replace('module.exports = { createPersonalStore };', 'export { createPersonalStore };');
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted personal store');
  writeFileSync(join(root, 'src/lingon-server/personal-store.js'), esm, 'utf8');
}
// Account-scoped chat UI snapshots use the same store in both runtimes.
{
  const src = readFileSync(join(root, 'server/client-state.js'), 'utf8');
  const esm = src.replace('module.exports = { createClientStateStore };', 'export { createClientStateStore };');
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted client state store');
  writeFileSync(join(root, 'src/lingon-server/client-state.js'), esm, 'utf8');
}
// Support form validation and storage are shared by both API runtimes.
{
  const src = readFileSync(join(root, 'server/support.js'), 'utf8');
  const esm = src.replace('module.exports = { saveSupportSubmission };', 'export { saveSupportSubmission };');
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted support module');
  writeFileSync(join(root, 'src/lingon-server/support.js'), esm, 'utf8');
}
// The owner's own API and MCP connectors, and their storage.
{
  const src = readFileSync(join(root, 'server/custom-connector-store.js'), 'utf8');
  const esm = src.replace('module.exports = { createCustomConnectorStore };', 'export { createCustomConnectorStore };');
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted custom connector store');
  writeFileSync(join(root, 'src/lingon-server/custom-connector-store.js'), esm, 'utf8');
}
{
  const src = readFileSync(join(root, 'server/connectors.js'), 'utf8');
  const esm = src
    .replace("const store = require('./store');", "import * as store from './store.js';")
    .replace("const { compactParams, compactResult } = require('./composio');", "import { compactParams, compactResult } from './composio.js';")
    // Workers cannot open connections into private networks, so the address check is the boundary there.
    .replace("const { publicUrlProblem, hostResolvesPublic, pinnedFetch } = require('./agents/sandbox');", "import { publicUrlProblem } from './agents/public-web.js';\nconst hostResolvesPublic = async () => true;\nconst pinnedFetch = (url, init) => fetch(url, init);")
    .replace(/module\.exports\s*=\s*\{/, 'export {');
  if (/module\.exports|require\(/.test(esm)) throw new Error('Unconverted connectors module');
  writeFileSync(join(root, 'src/lingon-server/connectors.js'), esm, 'utf8');
}


// These modules are shared logic; generate the ESM port instead of maintaining
// a second coordinator/state machine that can drift from the Node deployment.
for (const name of ['apple-tools', 'page-validation', 'goal-work', 'permission-policy', 'documents', 'task-checkpoint', 'task-store', 'task-runtime', 'conversation', 'workspace-runtime', 'attachments', 'upkeep', 'automations', 'personal-tools', 'cards', 'payment-safety', 'purchase', 'runner', 'memory', 'guardrails', 'vm-harness', 'product-docs', 'product-search']) {
  let src = readFileSync(join(root, `server/agents/${name}.js`), 'utf8');
  if (name === 'automations') src = "import { tasks } from './conversation.js';\n" + src.replace(/^[ \t]*const \{ tasks \} = require\('\.\/conversation'\);\r?\n/gm, '');
  src = src.replace(/const (\{[^\n]+\}) = require\('([^']+)'\);/g, (_, bindings, spec) =>
    `import ${bindings} from '${spec.startsWith('.') ? spec + '.js' : spec}';`);
  src = src.replace(/const (\w+) = require\('([^']+)'\);/g, (_, binding, spec) =>
    spec === 'crypto' ? `import ${binding} from 'node:crypto';` : spec === 'path' ? `import path from 'node:path';` : `import * as ${binding} from '${spec}.js';`);
  src = src.replace('module.exports={createCoordinator,updateChatSummary,acknowledgeTask,finishTaskMemory,handle:coordinator.handle,tasks,startWorker};',
    'const handle=coordinator.handle;\nexport {createCoordinator,updateChatSummary,acknowledgeTask,finishTaskMemory,handle,tasks,startWorker};');
  src = src.replace(/module\.exports\s*=\s*\{/g, 'export {');
  if (/require\(|module\.exports/.test(src)) throw new Error(`Unconverted CommonJS in ${name}`);
  writeFileSync(join(root, `src/lingon-server/agents/${name}.js`), src, 'utf8');
}

// Backend confidentiality policy must match between server/ (Node) and
// src/lingon-server/ (edge port) so chat + research behave the same way.
for (const [srcFile, edgeFile, marker] of [
  ['server/agents/vm-harness.js', 'src/lingon-server/agents/vm-harness.js', 'INTERNAL CONFIDENTIALITY'],
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

for (const name of ['apple-devices','apple-identity','apple-auth','account-deletion']) {
  const source = readFileSync(join(root, `server/${name}.js`), 'utf8');
  const esm = source.replace("const crypto = require('crypto');", "import crypto from 'node:crypto';")
    .replace("const { adminClient } = require('./auth');", "import { adminClient } from './auth.js';")
    .replace("const { seal, unseal } = require('./apple-devices');", "import { seal, unseal } from './apple-devices.js';")
    .replace("const { appleIdentity } = require('./apple-identity');", "import { appleIdentity } from './apple-identity.js';")
    .replace("const { eraseLibraryStorage } = require('./account-deletion');", "import { eraseLibraryStorage } from './account-deletion.js';")
    .replace('module.exports = {', 'export {');
  if (/module\.exports|require\(/.test(esm)) throw new Error(`Unconverted Apple module: ${name}`);
  writeFileSync(join(root, `src/lingon-server/${name}.js`), esm, 'utf8');
}

{const src=readFileSync(join(root,'server/scoped-permissions.js'),'utf8');writeFileSync(join(root,'src/lingon-server/scoped-permissions.js'),src.replace('module.exports={','export {'));}
