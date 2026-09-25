const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'billing-ui', user: { id: 'billing-ui', email: 'billing@example.invalid' } }));
      localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: 'billing-ui', onboarded: true, agent: { name: 'Audit', color: 'lingon', pers: 'Precise' }, view: 'settings', settingsTab: 'billing', chats: [], vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
    });
    const billing = { plan: 'pro', status: 'active', planTokens: 100000000, planTokensUsed: 25000000,
      packTokens: 10000000, packTokensUsed: 2000000, tokens: 83000000,
      imagesToday: 2, imagesPerDay: 10, transcriptionsToday: 1, transcriptionsPerDay: 15,
      resetAt: '2026-10-24T12:00:00.000Z', plans: [], purchasedGifts: [],
      tokenPacks: [{ tokens: 10000000, millions: 10, usd: 10 }, { tokens: 50000000, millions: 50, usd: 45 }] };
    let redeemedCode = '';
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/billing/redeem') redeemedCode = JSON.parse(route.request().postData() || '{}').code;
      const body = url.pathname === '/api/billing' ? billing : url.pathname === '/api/billing/redeem'
        ? { billing, tokens: 1000000, amount: 5 } : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('[data-act="stab"][data-t="billing"]').click();
    await page.locator('[data-act="portal"]').waitFor();
    assert.equal(await page.locator('#plancards .pcard').count(), 3);
    assert.equal(await page.locator('.billing-extra-balance, #giftcode').count(), 0);
    await page.locator('[data-act="stab"][data-t="usage"]').click();
    await page.locator('#giftcode').waitFor();
    assert.equal(await page.locator('[data-act="portal"], #plancards').count(), 0);
    assert.equal(await page.locator('.billing-extra-balance').count(), 1);
    assert.match(await page.locator('#billbody').innerText(), /Images today|Transcriptions today/);
    await page.locator('.billing-select-trigger').click();
    assert.equal(await page.locator('.billing-select').getAttribute('open'), '');
    if (process.env.BILLING_MENU_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_MENU_SCREENSHOT, fullPage: true });
    await page.locator('[data-act="select-pack"][data-pack="50000000"]').click();
    assert.equal(await page.locator('#buypack').inputValue(), '50000000');
    assert.match(await page.locator('.billing-select-trigger').innerText(), /50M tokens/);
    assert.equal(await page.locator('.billing-select').getAttribute('open'), null);
    assert.match(await page.locator('#buypack-rate').innerText(), /\$0\.90 per million/);
    await page.locator('.billing-select-trigger').press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.billing-select').getAttribute('open'), null);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.billing-select-trigger')).borderColor
      === getComputedStyle(document.querySelector('#giftcode')).borderColor);
    assert.equal(await page.locator('.billing-select-trigger').evaluate(el => getComputedStyle(el).borderColor),
      await page.locator('#giftcode').evaluate(el => getComputedStyle(el).borderColor));
    assert.equal(await page.locator('.billing-redeem-button').evaluate(el => getComputedStyle(el).backgroundColor),
      await page.locator('.billing-primary').first().evaluate(el => getComputedStyle(el).backgroundColor));
    await page.locator('#giftcode').fill('LNG-TEST-CARD');
    await page.locator('[data-act="redeem"]').click();
    await page.waitForFunction(() => document.querySelector('#giftcode')?.value === '');
    assert.equal(redeemedCode, 'LNG-TEST-CARD');
    if (process.env.BILLING_SCREENSHOT) {
      await page.locator('#main .page').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.screenshot({ path: process.env.BILLING_SCREENSHOT, fullPage: true });
    }
    await page.locator('[data-act="stab"][data-t="issue"]').click();
    assert.equal(await page.locator('#issue-topic').evaluate(el => getComputedStyle(el).appearance), 'none');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-act="stab"][data-t="usage"]').click();
    await page.locator('.billing-select-trigger').click();
    const menu = await page.locator('.billing-select-menu').boundingBox();
    assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= 1280, 'token menu stays inside the desktop viewport');
    if (process.env.BILLING_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_DESKTOP_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []);
    console.log('billing settings UI: Billing and Usage sections, limits, token picker and gift cards: ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
