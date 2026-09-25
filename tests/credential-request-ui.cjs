const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Agent-requested credentials use a visual card and save only vault refs in chat state.
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      const card = (id, taskId, fields) => ({ id, kind: 'card', card: { type: 'secret', status: 'pending', managedCallId: `call_${id}`, taskId, taskVersion: 1, ...fields } });
      localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'ui-audit', user: { id: 'ui-audit', email: 'ui-audit@example.invalid' } }));
      localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: 'ui-audit', onboarded: true, agent: { name: 'Audit', color: 'lingon', pers: 'Precise' }, view: 'chat', activeChat: 'chat1', chats: [{ id: 'chat1', title: 'Sign in', createdAt: Date.now(), messages: [
        card('login1', 'task_login', { kind: 'login', suggest: 'GitHub password', host: 'github.com', note: 'To sign in' }),
        card('key1', 'task_key', { kind: 'api_key', suggest: 'Service API key', host: 'service.example', note: 'To connect the service' }),
      ], trace: [], managedTasks: { task_login: { id: 'task_login', title: 'Sign in', status: 'waiting_approval', version: 1, sequence: 0 }, task_key: { id: 'task_key', title: 'Connect', status: 'waiting_approval', version: 1, sequence: 0 } } }], vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
    });
    const posted = [], decisions = [];
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let body = {};
      if (url.pathname === '/api/secrets' && route.request().method() === 'POST') {
        const { name, value } = JSON.parse(route.request().postData() || '{}');
        posted.push({ name, value });
        body = { secret: { id: `secret_${posted.length}`, ref: `sec_t${posted.length}`, name, at: Date.now() } };
      } else if (url.pathname === '/api/secrets') body = { secrets: [], encrypted: true };
      else if (url.pathname === '/api/agent/tasks/control') {
        decisions.push(JSON.parse(route.request().postData() || '{}'));
        body = { tasks: [] };
      } else if (url.pathname === '/api/agent/tasks') body = { tasks: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8080/app');
    const login = page.locator('[data-mid="login1"]');
    await login.locator('[data-f="username"]').waitFor();
    assert.match(await login.textContent(), /github\.com sign-in/);
    assert.equal(await login.locator('[data-f="password"]').getAttribute('type'), 'password');
    if (process.env.CREDENTIAL_SCREENSHOT) await login.locator('.secret-card').screenshot({ path: process.env.CREDENTIAL_SCREENSHOT });
    await login.locator('[data-f="username"]').fill('octo@example.com');
    await login.locator('[data-f="password"]').fill('hunter2 secret');
    await login.locator('[data-act="save-secret"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages[0].card.status === 'saved');
    assert.deepEqual(posted.slice(0, 2), [{ name: 'github.com username', value: 'octo@example.com' }, { name: 'github.com password', value: 'hunter2 secret' }]);
    assert.equal(decisions[0]?.allow, true);
    const key = page.locator('[data-mid="key1"]');
    assert.equal(await key.locator('[data-f="username"]').count(), 0);
    assert.equal(await key.locator('[data-f="val"]').getAttribute('aria-label'), 'API key');
    await key.locator('[data-f="val"]').fill('sk-test-123');
    await key.locator('[data-act="save-secret"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages[1].card.status === 'saved');
    assert.deepEqual(posted[2], { name: 'Service API key', value: 'sk-test-123' });
    const saved = await page.evaluate(() => localStorage.getItem('lingon.v1'));
    for (const { value } of posted) assert.equal(saved.includes(value), false, `browser storage never holds ${value}`);
    assert.deepEqual(errors, []);
    console.log('credential request UI: login and API key cards save encrypted vault refs without values in browser storage');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
