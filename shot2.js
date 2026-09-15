const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:8000', { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.click('[data-act="open-app"]');
  await p.click('[data-act="ob-claim"]');
  await p.fill('#obname', 'Nova');
  await p.click('[data-act="ob-next"]'); await p.click('[data-act="ob-next"]'); await p.click('[data-act="ob-done"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Research which Swedish party people say they vote for on social media');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.win .url', { timeout: 40000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/shots/9-browser-card.png' });
  // mobile landing
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://127.0.0.1:8000', { waitUntil: 'load' });
  await m.evaluate(() => localStorage.clear());
  await m.reload({ waitUntil: 'load' });
  await m.waitForTimeout(400);
  await m.screenshot({ path: '/home/user/shots/10-mobile.png' });
  console.log('done');
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
