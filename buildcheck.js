const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://127.0.0.1:8000', { waitUntil: 'load' });
  // state from previous run persists? localStorage is per-origin per browser instance -> fresh. Onboard quickly:
  await p.click('[data-act="open-app"]');
  await p.click('[data-act="ob-claim"]');
  await p.fill('#obname', 'Berry');
  await p.click('[data-act="ob-next"]'); await p.click('[data-act="ob-next"]'); await p.click('[data-act="ob-done"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Build me a landing page for my bakery');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.qopt', { timeout: 30000 });
  await p.click('.qopt:nth-child(2)');
  await p.waitForSelector('.arti-frame iframe', { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: '/home/user/shots/8-build.png' });
  console.log('BUILD FLOW OK');
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
