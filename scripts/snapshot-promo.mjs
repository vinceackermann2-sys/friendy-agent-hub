// Refresh the standalone promo document from the live markup in app/app.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/promo' ? 'index.html' : pathname.slice(1);
  if (!/^[\w.-]+$/.test(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = readFileSync(new URL(`../app/${file}`, import.meta.url));
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const favicon = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8')
  .match(/<link rel="icon"[^>]*>/)?.[0] || '<link rel="icon" href="/favicon.svg">';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/promo`, { waitUntil: 'domcontentloaded' });
  await page.locator('#root .promo-page').waitFor();
  const content = (await page.locator('#root').innerHTML()).replace(/[ \t]+$/gm, '');
  if (!content.includes('Så här får du veckan att gå runt') || !content.includes('id="pform"')) {
    throw new Error('Promo markup did not render completely');
  }

  const scripts = [
    'config.js', 'auth.js', 'mascot.js', 'task-routing.js',
    'engine.real.js', 'engine.managed.js', 'app.js',
  ];
  const document = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Belna — Så här får du veckan att gå runt</title>
<meta name="description" content="Belna är den första agenten som kan sköta handlingen, fakturorna och barnens schema. Du äger din AI-agent — säker, svensk och alltid under din kontroll.">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="https://belna.se/promo">
<meta property="og:type" content="website">
<meta property="og:title" content="Belna — Så här får du veckan att gå runt">
<meta property="og:description" content="Städa, hämta, lämna, handla — tar det någonsin slut? Möt Belna, din egen mini-superman.">
<meta property="og:url" content="https://belna.se/promo">
<meta name="twitter:card" content="summary_large_image">
${favicon}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/lingon/styles.css">
</head>
<body>
<div id="root">${content}</div>
${scripts.map((name) => `<script src="/lingon/${name}"></script>`).join('\n')}
</body>
</html>
`;
  writeFileSync(new URL('../app/promo.html', import.meta.url), document);
  console.log(`Wrote app/promo.html (${document.length} characters)`);
} finally {
  await browser.close();
  server.close();
}
