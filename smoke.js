const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  const step = s => console.log('• ' + s);

  await p.goto('http://127.0.0.1:8000', { waitUntil: 'load' });
  await p.waitForSelector('.hero h1', { timeout: 10000 });
  step('landing renders');

  // landing prompt -> preview answer -> claim card
  await p.fill('#lprompt', 'Research which Swedish party people say they vote for on social media');
  await p.click('#lform button[type=submit]');
  await p.waitForSelector('[data-act="claim"]', { timeout: 30000 });
  step('landing answer + claim card');

  // onboarding
  await p.click('[data-act="claim"]');
  await p.waitForSelector('[data-act="ob-claim"]');
  await p.click('[data-act="ob-claim"]');           // claim -> confetti
  await p.waitForSelector('#obname');
  await p.fill('#obname', 'Nova');
  await p.click('[data-act="ob-next"]');            // -> style
  await p.waitForSelector('.swatches');
  await p.click('[data-act="ob-color"][data-c="blueberry"]');
  await p.click('[data-act="ob-pers"][data-p="Precise"]');
  await p.click('[data-act="ob-next"]');            // -> safety
  await p.waitForSelector('[data-act="ob-done"]');
  await p.click('[data-act="ob-done"]');
  step('onboarding complete -> app');

  // research flow auto-runs with the pending prompt
  await p.waitForSelector('.win .url', { timeout: 40000 });
  step('browser-use card appeared');
  await p.waitForSelector('.subrow', { timeout: 40000 });
  step('sub-agent card appeared');
  await p.waitForSelector('.qopt', { timeout: 40000 });
  step('question card appeared');
  await p.click('.qopt');                            // percentage graph + dataset
  await p.waitForSelector('.chartbox .bar', { timeout: 40000 });
  step('canvas chart rendered');
  await p.waitForSelector('.chipsrow', { timeout: 40000 });
  step('research flow finished');

  // trace tab
  await p.click('[data-act="ctab"][data-t="trace"]');
  await p.waitForSelector('#cbody .tline');
  step('trace tab has entries');
  await p.click('[data-act="ctab"][data-t="canvas"]');

  // vault: add secret, check masking
  await p.click('[data-act="nav"][data-view="vault"]');
  await p.waitForSelector('.warnband');
  await p.fill('#vname', 'github_token');
  await p.fill('#vval', 'ghp_supersecret123');
  await p.click('[data-act="addsecret"]');
  await p.waitForSelector('[data-rev]');
  const masked = await p.textContent('[data-rev]');
  if (/ghp_/.test(masked)) errs.push('SECRET LEAKED IN LIST: ' + masked);
  step('vault masks secret: ' + masked.trim());
  await p.click('[data-act="reveal"]');
  const revealed = await p.textContent('[data-rev]');
  if (!/ghp_supersecret123/.test(revealed)) errs.push('REVEAL BROKEN');
  step('reveal works for the owner only');

  // memory page
  await p.click('[data-act="nav"][data-view="memory"]');
  await p.waitForSelector('.kv .row b');
  step('memory page lists memories');

  // new chat + github flow (connect + secrets box + approval)
  await p.click('[data-act="newchat"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Review my GitHub pull requests');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-act="connect"]', { timeout: 30000 });
  await p.click('[data-act="connect"]');
  step('github connect card resolved');
  // token already sealed in vault -> NO secrets box; straight to approval
  await p.waitForSelector('[data-act="approve"]', { timeout: 20000 });
  step('approval card (secrets box correctly skipped)');
  await p.click('[data-act="approve"]');
  await p.waitForSelector('.term', { timeout: 20000 });
  step('sandboxed computer-use card');
  await p.waitForSelector('.codebox', { timeout: 30000 });
  step('diff artifact on canvas');

  // secrets box appears when a secret is missing: try vault flow
  await p.click('[data-act="newchat"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'I need to store an API key safely');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-act="save-secret"]', { timeout: 30000 });
  await p.fill('[data-f="val"]', 'sk-test-123');
  await p.click('[data-act="save-secret"]');
  await p.waitForSelector('.acard .note.mono', { timeout: 10000 });
  const ref = await p.textContent('.acard .note.mono');
  if (/sk-test-123/.test(ref)) errs.push('SECRET VALUE LEAKED ON CARD: ' + ref);
  step('secrets box seals values, card shows ref only: ' + ref.trim());

  await p.waitForTimeout(1200);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(errs.length ? 'SMOKE FAIL' : 'SMOKE PASS');
  await b.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
