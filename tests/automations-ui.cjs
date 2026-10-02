const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('node:http');
const { chromium } = require('playwright');

(async () => {
  // Both deployments must reject the retired manual creation route.
  for (const file of ['server/index.js', 'src/lingon-server/index.js']) {
    const source = await fs.readFile(path.join(__dirname, '..', file), 'utf8');
    const route = source.slice(source.indexOf("app.post('/api/sub-agents',"), source.indexOf("app.patch('/api/sub-agents/:id'"));
    let handler;
    vm.runInNewContext(route, { app:{ post:(_path, _limit, fn) => { handler = fn; } }, rateLimit:() => null, requireAuth:fn => fn });
    let status, body;
    await handler({ user:{ id:'owner' }, body:{ name:'Manual', prompt:'Check', trigger:{ type:'schedule', intervalMinutes:60 } } }, {
      status(code) { status = code; return this; }, json(value) { body = value; },
    });
    assert.equal(status, 403, file);
    assert.match(body.error, /Ask your agent in chat/);
  }
  const root = path.resolve(__dirname, '../app');
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.svg':'image/svg+xml' };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/app' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' }).end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport:{ width, height:900 } });
      await context.addInitScript(() => {
        localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{ id:'ui-audit', email:'ui@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId:'ui-audit', onboarded:true, agent:{ name:'Audit', color:'lingon', pers:'Precise' }, view:'chat', activeChat:'chat1', canvasOpen:true, canvasTab:'subagents', subAgentComposer:true, subAgentDraft:'Old draft', chats:[{ id:'chat1', title:'Chat', createdAt:Date.now(), messages:[], trace:[] }], vault:{ secrets:[], apps:[], approvals:[], mode:'default' } }));
      });
      const requests = [], errors = [];
      const automation = { id:'auto1', chatId:'auto-chat', name:'Morning update', enabled:true, trigger:{ type:'schedule', intervalMinutes:1440 } };
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        requests.push({ path:url.pathname, method:request.method() });
        let out = {};
        if (url.pathname === '/api/sub-agents') out = { subAgents:[automation] };
        if (url.pathname === '/api/sub-agents/auto1' && request.method() === 'PATCH') {
          automation.enabled = JSON.parse(request.postData()).enabled;
          out = { subAgent:automation };
        }
        await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out) });
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/app`);
      await page.getByRole('button', { name:'Toggle canvas', exact:true }).click();
      const ask = page.locator('[data-act="ask-automation"]');
      await ask.waitFor({ state:'visible' });
      assert.equal(await page.locator('#subname, #subprompt, #subtrigger, [data-act="new-subagent"], [data-act="create-subagent"]').count(), 0);
      await page.locator('[data-act="appr-toggle"][data-id="auto1"]').click();
      await page.locator('[data-act="toggle-subagent"]').click();
      await page.getByRole('button', { name:'Enable', exact:true }).waitFor();
      assert.equal(await page.locator('[data-act="run-subagent"]').isDisabled(), true);
      assert.equal(await page.locator('[data-act="delete-subagent"]').count(), 1);
      await ask.click();
      await page.waitForFunction(() => document.querySelector('#cprompt')?.value === 'Help me set up an automation. I want to ');
      assert.equal(await page.locator('#cprompt').isVisible(), true, 'chat composer must be reachable on mobile too');
      assert.equal(requests.filter(r => r.path === '/api/sub-agents' && r.method === 'POST').length, 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Automations: agent setup, desktop/mobile UI, existing controls, and manual API rejection passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
