// Keeps the Lovable build congruent with the lingon source of truth.
// app/ (vanilla frontend) is copied verbatim to public/lingon/ and the
// public pages to public/, so every `npm run build` (incl. Lovable hosting)
// serves the current code — never a stale copy.
// The Node/Express backend in server/ is mirrored to src/lingon-server/
// (ESM edge port) by hand; this script verifies the branding strings match
// and warns when they drift so the API identity stays in sync.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
for (const f of ['app.js', 'auth.js', 'config.js', 'engine.js', 'engine.real.js', 'mascot.js', 'styles.css']) {
  copy(join('app', f), join('public', 'lingon', f));
}
// Static Belna pages served from the site root
for (const f of ['cookies.html', 'faq.html', 'models.html', 'pricing.html', 'privacy.html', 'security.html', 'terms.html', 'sitemap.xml']) {
  copy(join('app', f), join('public', f));
}

// Backend identity strings must match between server/ (Node) and
// src/lingon-server/ (edge port) so chat + research identify the same way.
for (const [srcFile, edgeFile, marker] of [
  ['server/index.js', 'src/lingon-server/index.js', 'Arche 1.0 by Belna'],
  ['server/research.js', 'src/lingon-server/research.js', 'Arche 1.0 by Belna'],
]) {
  const src = readFileSync(join(root, srcFile), 'utf8');
  const edge = readFileSync(join(root, edgeFile), 'utf8');
  if (!src.includes(marker)) console.error(`sync-lingon: WARN ${srcFile} missing "${marker}"`);
  if (!edge.includes(marker)) {
    console.error(`sync-lingon: WARN ${edgeFile} missing "${marker}" — port the change from ${srcFile}`);
  } else {
    console.log(`sync-lingon: branding OK in ${edgeFile}`);
  }
}

if (failures > 0) {
  console.error(`sync-lingon: ${failures} failure(s)`);
  process.exit(1);
}
console.log('sync-lingon: done');
