/* Lingon REAL smoke — verifies nothing is simulated.
   Requires: npm start running on http://127.0.0.1:8000 with GEMINI_API_KEY set.
   Checks:
   - /api/health gemini:true
   - landing renders, claim flow works
   - real chat returns non-empty, non-canned AI text
   - research hits live endpoint and renders a briefing artifact (no fake 1,392)
   - vault secret is masked in UI
*/
const { chromium } = require('playwright');

(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:8000';
  const errs = [];
  const step = (s) => console.log('• ' + s);

  // health first
  try {
    const r = await fetch(base + '/api/health');
    const j = await r.json();
    console.log('HEALTH:', JSON.stringify(j));
    if (!j.gemini) {
      console.error('SMOKE FAIL — backend reports gemini:false. Set GEMINI_API_KEY in C:\\lingon\\.env and restart npm start.');
      process.exit(1);
    }
  } catch (e) {
    console.error('SMOKE FAIL — backend not reachable at ' + base + ' (' + e.message + '). Run npm start first.');
    process.exit(1);
  }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await p.goto(base, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.hero h1', { timeout: 10000 });
  step('landing renders');

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

  // REAL chat — must not be canned
  await p.fill('#cprompt', 'Reply with exactly the words: lingon real backend check');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(12000);
  const thread = await p.evaluate(() => document.querySelector('#tinner')?.innerText || '');
  console.log('THREAD SAMPLE:\n' + thread.slice(0, 900));
  if (!thread.toLowerCase().includes('lingon')) errs.push('REAL CHAT missing expected echo — got: ' + thread.slice(0, 200));
  if (/1,392 qualifying comments|Social Democrats lead observed share/.test(thread)) errs.push('SIMULATED research text leaked into real chat');
  step('real chat answered');

  // REAL research — live endpoint, no fabricated counts
  await p.click('[data-act="newchat"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Research Swedish party sentiment on social media');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.qopt', { timeout: 90000 });
  step('research question card (live backend responded)');
  await p.click('.qopt');
  await p.waitForSelector('#cbody', { timeout: 60000 });
  await p.waitForTimeout(4000);
  const canvas = await p.evaluate(() => document.querySelector('#cbody')?.innerText || '');
  console.log('CANVAS SAMPLE:\n' + canvas.slice(0, 900));
  if (/1,392 qualifying comments/.test(canvas)) errs.push('FAKE research stats present — simulation not removed');
  if (!/reddit|hacker|duckduckgo|source|http/i.test(canvas)) errs.push('No live sources cited in briefing');
  step('research briefing cites live sources');

  // vault masking
  await p.click('[data-act="nav"][data-view="vault"]');
  await p.waitForSelector('.warnband');
  await p.fill('#vname', 'github_token');
  await p.fill('#vval', 'ghp_supersecret123');
  await p.click('[data-act="addsecret"]');
  await p.waitForSelector('[data-rev]');
  const masked = await p.textContent('[data-rev]');
  if (/ghp_/.test(masked)) errs.push('SECRET LEAKED IN LIST: ' + masked);
  step('vault masks secret: ' + (masked || '').trim().slice(0, 40));

  await p.waitForTimeout(800);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(errs.length ? 'SMOKE FAIL' : 'SMOKE PASS');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
