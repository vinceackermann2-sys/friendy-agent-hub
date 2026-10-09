const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startAppServer } = require('./helpers/app-server.cjs');

(async () => {
  const server = await startAppServer(), browser = await chromium.launch();
  try {
    for (const width of [320, 393, 760]) {
      const context = await browser.newContext({ viewport: { width, height: 852 } });
      await context.addInitScript(() => {
        window.__clockOffset = 0;
        const now = Date.now.bind(Date); Date.now = () => now() + window.__clockOffset;
        window.BelnaNative = { platform: 'ios', request: async () => ({ name: 'iPhone', capabilities: {} }) };
        localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'panel-test', user: { id: 'owner', email: 'qa@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: 'owner', onboarded: true,
          agent: { name: 'QA', color: 'lingon', pers: 'Precise' }, view: 'chat', activeChat: 'chat',
          chats: [{ id: 'chat', title: 'Hello', messages: [], trace: [] }],
          vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
      });
      const counts = new Map(), errors = [];
      let releaseHistory, releaseRefresh;
      const historyGate = new Promise(resolve => { releaseHistory = resolve; });
      const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
      await context.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        counts.set(path, (counts.get(path) || 0) + 1);
        let data = {};
        if (path === '/api/composio/apps') {
          await new Promise(resolve => setTimeout(resolve, 150));
          data = { apps: [{ toolkit: 'gmail', name: 'Gmail', connected: false, accounts: [] },
            { toolkit: 'googlecalendar', name: 'Google Calendar', connected: true, accounts: [{ id: 'account', email: 'qa@example.invalid' }] }] };
        } else if (path === '/api/belna-wallet') {
          if (counts.get(path) > 1) await refreshGate;
          data = { wallet: { configured: true, status: 'ready', cardProgramAvailable: false,
            balance: { available: counts.get(path) > 1 ? 55 : 42, pending: 0 }, cardReady: true }, activity: [] };
        } else if (path === '/api/wallet-preferences') data = { methods: { saved_card: true } };
        else if (path === '/api/wallet-history') { await historyGate; data = { history: [] }; }
        else if (path === '/api/connectors') data = { connectors: [], available: true };
        else if (path === '/api/client-state') data = { profile: null, chats: [], durable: true };
        else if (path === '/api/auth/me') data = { user: { id: 'owner', email: 'qa@example.invalid' } };
        await route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(server.base + '/app');
      // The panels are fetched while chat is still visible, before navigation.
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).composioApps?.length === 2, null, { timeout: 5000 }).catch(async error => {
        console.error({ errors, counts: [...counts], text: (await page.locator('body').innerText()).slice(0, 1200) }); throw error;
      });
      assert.equal(counts.get('/api/belna-wallet'), 1);
      assert.equal(counts.get('/api/composio/apps'), 1);
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.locator('[data-act="usermenu"]').click();
      await page.locator('[data-act="nav"][data-view="apps"]').click();
      await page.waitForTimeout(350); // Let the navigation drawer finish closing.
      assert.equal(await page.locator('.conn-row.skel').count(), 0, 'warm connectors paint without a loading screen');
      for (const button of await page.locator('.conn-quick').all()) {
        const box = await button.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, 'quick actions fit and remain touch sized');
      }
      assert.equal(await page.getByRole('button', { name: 'Connect Gmail', exact: true }).count(), 1);
      assert.equal(await page.locator('.conn-quick .ic').first().isVisible(), false, 'mobile Connect has no extra plus icon');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 393) await page.screenshot({ path: 'test-results/connectors-mobile.png' });
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.locator('[data-act="nav"][data-view="chat"]').click();
      await page.locator('[data-act="togglecanvas"]').first().click();
      await page.locator('[data-act="ctab"][data-t="wallet"]').click();
      await page.locator('.wl-big').filter({ hasText: '$42.00' }).waitFor();
      await page.locator('.wallet-panel').getByRole('button', { name: /pays for purchases/ }).filter({ hasText: 'Store cards on' }).waitFor();
      assert.equal(counts.get('/api/belna-wallet'), 1, 'opening Wallet reuses a fresh snapshot');
      // The unresolved history request must not hold up payment preferences.
      releaseHistory();
      await page.locator('[data-act="ctab"][data-t="canvas"]').click();
      await page.evaluate(() => { window.__clockOffset = 31000; });
      await page.locator('[data-act="ctab"][data-t="wallet"]').click();
      await page.waitForTimeout(100);
      assert.equal(counts.get('/api/belna-wallet'), 2, 'a stale snapshot refreshes once');
      assert.match(await page.locator('.wl-big').textContent(), /42\.00/, 'old balance remains visible during refresh');
      releaseRefresh();
      await page.locator('.wl-big').filter({ hasText: '$55.00' }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Mobile panels ${width}px: prefetch, no duplicate navigation requests, independent preferences, stale refresh and touch targets passed`);
    }
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
