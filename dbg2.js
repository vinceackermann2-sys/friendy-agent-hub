const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
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
  const info = await p.evaluate(() => {
    const w = document.querySelector('.win');
    const r = w.getBoundingClientRect();
    const th = document.getElementById('thread');
    return { rect: { t: r.top, h: r.height }, scroll: { top: th.scrollTop, h: th.scrollHeight, c: th.clientHeight }, html: w.outerHTML.slice(0, 200) };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const th = document.getElementById('thread'); th.scrollTop = th.scrollHeight; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/shots/9-browser-card.png' });
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
