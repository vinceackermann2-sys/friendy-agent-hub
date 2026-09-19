const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:8000', { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: '/home/user/shots/1-landing.png' });

  await p.fill('#lprompt', 'Research which Swedish party people say they vote for on social media');
  await p.click('#lform button[type=submit]');
  await p.waitForSelector('[data-act="claim"]', { timeout: 30000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/shots/2-landing-answer.png' });

  await p.click('[data-act="claim"]');
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/home/user/shots/3-claim.png' });
  await p.click('[data-act="ob-claim"]');
  await p.waitForTimeout(300);
  await p.fill('#obname', 'Nova');
  await p.click('[data-act="ob-next"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/shots/4-style.png' });
  await p.click('[data-act="ob-next"]');
  await p.waitForTimeout(200);
  await p.click('[data-act="ob-done"]');
  await p.waitForSelector('#cprompt');
  await p.fill('#cprompt', 'Research which Swedish party people say they vote for on social media');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.qopt', { timeout: 40000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/shots/5-chat-subagents.png' });
  await p.click('.qopt');
  await p.waitForSelector('.chartbox .bar', { timeout: 40000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/home/user/shots/6-chat-chart.png' });

  await p.click('[data-act="nav"][data-view="vault"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/shots/7-vault.png' });
  await b.close();
  console.log('shots done');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
