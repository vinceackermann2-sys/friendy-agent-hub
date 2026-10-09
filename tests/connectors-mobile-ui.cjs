const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startAppServer } = require('./helpers/app-server.cjs');

(async () => {
  const server = await startAppServer(), browser = await chromium.launch();
  try {
    for (const returnEvent of ['visibilitychange', 'belna-apple-changed']) {
      const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
      await context.addInitScript(() => {
        window.__providerUrls = []; window.__clockOffset = 0; window.__hidden = false;
        const schedule = window.setTimeout.bind(window);
        // A suspended WKWebView may leave the old polling timer frozen on return.
        window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 4000 ? 60000 : ms, ...args);
        const now = Date.now.bind(Date); Date.now = () => now() + window.__clockOffset;
        Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
        Object.defineProperty(document, 'visibilityState', { get: () => window.__hidden ? 'hidden' : 'visible' });
        window.open = url => { window.__providerUrls.push(url); return null; }; // WKWebView opens Safari and returns no popup handle.
        window.BelnaNative = { platform: 'ios', request: async () => ({ name: 'QA iPhone', capabilities: {} }) };
        localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'mobile-qa', user: { id: 'mobile-owner', email: 'qa@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: 'mobile-owner', onboarded: true,
          agent: { name: 'QA', color: 'lingon', pers: 'Precise' }, view: 'chat', activeChat: 'qa-chat', chats: [{
            id: 'qa-chat', title: 'Connect Gmail', trace: [], messages: [{ id: 'qa-connect', kind: 'card', card: {
              type: 'connect', toolkit: 'gmail', name: 'Gmail', status: 'pending', managedCallId: 'qa-call', taskId: 'qa-task', taskVersion: 1 } }],
            managedTasks: { 'qa-task': { id: 'qa-task', title: 'Read Gmail', status: 'waiting_approval', version: 1, sequence: 0 } },
          }], vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
      });
      let connected = false;
      const decisions = [], requests = [];
      await context.route('**/api/**', async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        const body = request.postData() ? JSON.parse(request.postData()) : {};
        requests.push({ pathname, method: request.method() });
        let value = {};
        if (pathname === '/api/composio/apps') value = { apps: [{ toolkit: 'gmail', name: 'Gmail', connected,
          accounts: connected ? [{ id: 'qa-account', email: 'qa@example.invalid' }] : [] }] };
        else if (pathname === '/api/composio/connect') value = { redirectUrl: 'https://connect.example.invalid/gmail' };
        else if (pathname === '/api/connectors') value = { connectors: [], available: true };
        else if (pathname === '/api/client-state') value = { profile: null, chats: [], durable: true };
        else if (pathname === '/api/auth/me') value = { user: { id: 'mobile-owner', email: 'qa@example.invalid' } };
        else if (pathname === '/api/agent/tasks/control') { decisions.push(body); value = { task: { id: 'qa-task', status: 'queued', version: 2, sequence: 0, events: [] } }; }
        await route.fulfill({ json: value });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.base + '/app');
      await page.locator('[data-act="cv-connect"]').click();
      await page.waitForFunction(() => window.__providerUrls.length === 1);
      assert.equal(await page.evaluate(() => window.__providerUrls[0]), 'https://connect.example.invalid/gmail');
      await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__clockOffset += 121000; });
      connected = true;
      const count = requests.filter(r => r.pathname === '/api/composio/apps').length;
      // iOS resumes a suspended WKWebView via visibilitychange; it need not emit window.focus.
      await page.evaluate(event => {
        window.__hidden = false;
        (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
      }, returnEvent);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages[0].card.status === 'connected', null, { timeout: 2500 });
      assert.ok(requests.filter(r => r.pathname === '/api/composio/apps').length > count, 'returning from Safari refreshes connected apps');
      for (let i = 0; i < 20 && !decisions.length; i++) await page.waitForTimeout(50);
      assert.equal(decisions.length, 1, 'the waiting agent task resumes once');
      assert.equal(decisions[0].action, 'decide'); assert.equal(decisions[0].allow, true);
      await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
      await page.waitForTimeout(300);
      assert.equal(decisions.length, 1, 'focus and visibility cannot approve the same task twice');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      console.log('Mobile OAuth: Safari handoff, ' + returnEvent + ' return after polling expiry, connected account refresh and single agent-task resume passed');
      await context.close();
    }
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
