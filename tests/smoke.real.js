/* Lingon REAL smoke — auth + billing + no fakes.
   Requires: npm start on http://127.0.0.1:8000, Foundry config + Supabase set.
   Flow: health → signup test user → auth gate → onboarding → real chat →
   research (live, no fake stats) → vault masked → Apps empty → billing Free 20 credits.
*/
import { chromium } from 'playwright';

(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:8000';
  const errs = [];
  const step = (s) => console.log('• ' + s);

  try {
    const r = await fetch(base + '/api/health');
    const j = await r.json();
    console.log('HEALTH:', JSON.stringify(j));
    if (!j.foundry) throw new Error('foundry:false — set AZURE_FOUNDRY_PROJECT_ENDPOINT and AZURE_FOUNDRY_API_KEY');
    if (!j.supabase) throw new Error('supabase:false — set SUPABASE keys');
  } catch (e) {
    console.error('SMOKE FAIL — backend: ' + e.message);
    process.exit(1);
  }

  // unique test user
  const email = `smoke${Date.now()}@example.com`;
  const password = 'SmokeTest123!';
  let session;
  try {
    const r = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, terms_version: '2026-09-24' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    session = { access_token: j.access_token, refresh_token: j.refresh_token, user: j.user };
    console.log('SIGNED UP:', email);
  } catch (e) {
    console.error('SMOKE FAIL — signup: ' + e.message);
    process.exit(1);
  }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location();
    // Ignore third-party asset failures (fonts etc.) — only first-party errors fail.
    if (loc && loc.url && !loc.url.startsWith(base)) return;
    errs.push('CONSOLE: ' + m.text());
  });

  await p.goto(base, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.evaluate((s) => {
    localStorage.setItem('lingon.session', JSON.stringify(s));
    try { window.LingonConfig.userId = s.user.id; } catch {}
  }, session);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.hero h1', { timeout: 10000 });
  step('landing renders (authed)');

  // Pricing is a dedicated public route; landing copy must not make stale
  // implementation claims.
  const landing = await p.evaluate(() => document.body.innerText);
  if (/Codex-style|OpenAI Agents API/.test(landing)) errs.push('Stale Codex wording on landing');
  await p.goto(base + '/pricing', { waitUntil: 'load' });
  const pricing = await p.evaluate(() => document.body.innerText);
  if (!/20 starter credits/i.test(pricing)) errs.push('Pricing Free 20 credits missing');
  await p.goto(base, { waitUntil: 'load' });
  await p.waitForSelector('.hero h1', { timeout: 10000 });
  step('pricing + harness wording honest');

  await p.click('[data-act="open-app"]');
  await p.waitForSelector('[data-act="ob-claim"]');
  await p.click('[data-act="ob-claim"]');
  await p.waitForSelector('#obname');
  await p.fill('#obname', 'Nova');
  await p.click('[data-act="ob-next"]');
  await p.waitForSelector('.swatches');
  await p.click('[data-act="ob-next"]');
  await p.waitForSelector('[data-act="ob-done"]');
  await p.click('[data-act="ob-done"]');
  await p.waitForSelector('#cprompt', { timeout: 15000 });
  step('onboarding complete');

  await p.fill('#cprompt', 'Reply with exactly the words: lingon real backend check');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(14000);
  const thread = await p.evaluate(() => document.querySelector('#tinner')?.innerText || '');
  console.log('THREAD SAMPLE:\n' + thread.slice(0, 700));
  if (!thread.toLowerCase().includes('lingon')) errs.push('REAL CHAT missing echo');
  if (/1,392 qualifying comments/.test(thread)) errs.push('SIMULATED text leaked');
  if (/couldn't reach the AI backend|exceeded your current quota/i.test(thread)) errs.push('AI backend unreachable (model quota/error) — not verified this run');
  step('real chat answered');

  await p.fill('#cprompt', 'Do you have access to real-time live browsing?');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => {
    const text = document.querySelector('#tinner')?.innerText || '';
    return /supported public sources/i.test(text) && /sandboxed browser/i.test(text);
  }, { timeout: 30000 });
  step('browsing capability is described accurately');

  await p.click('[data-act="newchat"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Browse the web for current Swedish party sentiment on social media');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.qopt', { timeout: 90000 });
  step('research live');
  await p.click('.qopt');
  await p.waitForSelector('#cbody', { timeout: 60000 });
  await p.waitForTimeout(4000);
  const canvas = await p.evaluate(() => document.querySelector('#cbody')?.innerText || '');
  if (/1,392 qualifying comments/.test(canvas)) errs.push('FAKE stats present');
  if (!/source|http/i.test(canvas)) errs.push('No live sources cited');
  step('briefing cites live sources');
  // Real browser use: the browser card must show a real http(s) URL rendered
  // in headless Chromium — not the old 'backend: POST ...' placeholder.
  const browserUrl = await p.evaluate(() => document.querySelector('.win .url')?.textContent || '');
  if (!/^https?:\/\//.test(browserUrl.trim())) errs.push('Browser card has no real URL: ' + browserUrl.slice(0, 80));
  else step('browser card shows real rendered URL');
  // Follow in canvas: run timeline + real screenshot render in the canvas tab.
  await p.click('[data-act="ctab"][data-t="canvas"]');
  await p.waitForSelector('#cbody .runbox', { timeout: 15000 });
  step('canvas run timeline renders');
  await p.waitForSelector('#cbody .shot img', { timeout: 15000 });
  step('canvas shows real page screenshot');
  // Live browser is opened from the browser card and rendered in Canvas.
  await p.click('[data-act="watchlive"]');
  await p.waitForSelector('#liveimg[src^="data:"]', { timeout: 15000 });
  step('live viewport renders (poster)');
  await p.waitForFunction(() => (window.__liveFrames || 0) >= 1, { timeout: 30000 });
  step('live browser streams real frames over WS');
  await p.waitForSelector('#pcout', { timeout: 15000 });
  step('live computer terminal present');
  await p.click('#takebtn');
  await p.waitForFunction(() => document.querySelector('#livestate')?.textContent === 'you drive', { timeout: 15000 });
  step('take over hands control to user');
  await p.click('#takebtn');
  await p.waitForFunction(() => document.querySelector('#takebtn')?.textContent === 'Take over', { timeout: 15000 });
  step('give back returns control');

  await p.click('[data-act="usermenu"]');
  await p.click('.usermenu [data-act="nav"][data-view="settings"]');
  await p.waitForSelector('[data-act="stab"][data-t="secrets"]');
  await p.click('[data-act="stab"][data-t="secrets"]');
  await p.waitForSelector('[data-act="vault-ask"]');
  if (await p.locator('.vault-add input, [data-act="addsecret"]').count()) errs.push('Secrets still has a manual add form');
  step('secrets are added through chat, not a form');

  // Apps must be honestly empty (separate Apps view, real connections only)
  await p.click('[data-act="usermenu"]');
  await p.click('.usermenu [data-act="nav"][data-view="apps"]');
  await p.waitForTimeout(500);
  const apps = await p.evaluate(() => document.querySelector('#main')?.innerText || '');
  if (!/not connected|No connected apps|real connections only/i.test(apps)) errs.push('Apps view not honestly empty: ' + apps.slice(0, 200));
  if (/connected · tokens sealed/.test(apps)) errs.push('Fake connection row still present');
  step('apps honestly empty');

  // Billing shows plans; Usage holds the token meter and gift cards.
  await p.click('[data-act="usermenu"]');
  await p.click('.usermenu [data-act="nav"][data-view="settings"]');
  await p.waitForSelector('[data-act="stab"][data-t="billing"]');
  await p.click('[data-act="stab"][data-t="billing"]');
  await p.waitForSelector('#billbody', { timeout: 15000 });
  await p.waitForFunction(() => !document.querySelector('#billbody')?.textContent?.includes('Loading'), { timeout: 30000 });
  const bill = await p.evaluate(() => document.querySelector('#main')?.innerText || '');
  console.log('BILLING SAMPLE:\n' + bill.slice(0, 600));
  if (!/FREE/i.test(bill)) errs.push('Billing plan missing');
  if (!/Plans/i.test(bill)) errs.push('Billing plans missing');
  await p.click('[data-act="stab"][data-t="usage"]');
  await p.waitForSelector('#giftcode', { timeout: 15000 });
  const usage = await p.evaluate(() => document.querySelector('#main')?.innerText || '');
  if (!await p.$('.billing-usage [role="meter"]')) errs.push('Usage meter missing');
  if (!/Extra tokens/i.test(usage)) errs.push('Extra token balance missing');
  if (!/Redeem gift card/i.test(usage)) errs.push('Gift redeem missing');
  step('billing and usage real');

  await p.waitForTimeout(800);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(errs.length ? 'SMOKE FAIL' : 'SMOKE PASS');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
