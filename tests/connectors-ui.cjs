const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// The owner's own APIs and MCP servers. The agent sets them up from chat: a key card shows
// where the key goes, the owner pastes it, and the card adds the connector and resumes the
// task. Connectors lists them with their permissions and has no manual form. The key goes to
// the server vault only.
const TOKEN = 'mcp-secret-token-42';
const tools = [
  { slug:'search_docs', name:'Search docs', description:'Search the docs.', kind:'read', enabled:true },
  { slug:'create_ticket', name:'Create ticket', description:'Open a ticket.', kind:'write', enabled:true },
];
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
    await context.addInitScript(() => {
      // Seeded once, so a reload keeps the view the test switched to.
      if (localStorage.getItem('lingon.v1')) return;
      const card = (id, taskId, fields) => ({ id, kind:'card', card:{ type:'connector', status:'pending', managedCallId:`call_${id}`, taskId, taskVersion:1, ...fields } });
      localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{ id:'ui-audit', email:'ui-audit@example.invalid' } }));
      localStorage.setItem('lingon.v1', JSON.stringify({ ownerId:'ui-audit', onboarded:true, agent:{ name:'Audit', color:'lingon', pers:'Precise' }, view:'chat', activeChat:'chat1',
        chats:[{ id:'chat1', title:'Connect Docs', createdAt:Date.now(), trace:[], messages:[
          card('docs1', 'task_docs', { kind:'mcp', name:'Docs', url:'https://mcp.example.com/mcp', host:'mcp.example.com', auth:{ type:'bearer' }, keyUrl:'https://mcp.example.com/settings/tokens', note:'To search your company docs' }),
          card('wx1', 'task_wx', { kind:'api', name:'Weather', url:'https://api.weather.example/v1', host:'api.weather.example', auth:{ type:'header', header:'X-API-Key' }, warning:'You get this key on weather.com, but it is sent to api.weather.example. Continue only if api.weather.example belongs to Weather.' }),
        ], managedTasks:{ task_docs:{ id:'task_docs', title:'Connect Docs', status:'waiting_approval', version:1, sequence:0 }, task_wx:{ id:'task_wx', title:'Connect Weather', status:'waiting_approval', version:1, sequence:0 } } }],
        vault:{ secrets:[], apps:[], approvals:[], mode:'default' } }));
    });
    const connectors = [], vault = [], requests = [], decisions = [];
    let refuseNext = true;
    await context.route('**/api/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      requests.push({ method, path:url.pathname, body });
      let out = {};
      if (url.pathname === '/api/composio/apps') out = { apps:[{ toolkit:'gmail', name:'Gmail', connected:false, accounts:[] }] };
      else if (url.pathname === '/api/connectors' && method === 'GET') out = { connectors, available:true };
      else if (url.pathname === '/api/connectors' && method === 'POST') {
        // The first key is wrong: the card shows why and waits.
        if (refuseNext) { refuseNext = false; return route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'The MCP server refused access (HTTP 401). Check the key or token under Connectors.' }) }); }
        const n = connectors.length + 1;
        const secret = body.secret ? { id:`sec_c${n}_x`, ref:`sec_c${n}`, name:`${body.name} ${body.kind === 'mcp' ? 'MCP token' : 'API key'}`, at:Date.now() } : null;
        if (secret) vault.push(secret);
        const c = { id:`con_${n}`, kind:body.kind, slug:body.name.toLowerCase(), name:body.name, url:body.url, host:new URL(body.url).hostname, description:body.description || '',
          auth:body.auth, secretId:secret?.id || null, status:'connected', lastError:'', checkedAt:Date.now(), at:Date.now(), server:{ name:'Docs MCP', version:'2.1' }, docsUrl:'', testPath:'',
          permissions:body.kind === 'mcp' ? tools.map((t) => ({ ...t })) : [{ slug:'GET', name:'Read data', description:'GET requests', kind:'read', enabled:true }, { slug:'POST', name:'Create and run', description:'POST requests', kind:'write', enabled:true }] };
        connectors.push(c);
        out = { connector:c, secret };
      } else if (/\/api\/connectors\/[^/]+\/permissions$/.test(url.pathname)) {
        const c = connectors.find((x) => x.id === url.pathname.split('/')[3]);
        c.permissions = c.permissions.map((p) => ({ ...p, enabled:!body.disabled.includes(p.slug) }));
        out = { connector:c };
      } else if (/\/api\/connectors\/[^/]+$/.test(url.pathname) && method === 'DELETE') {
        const [gone] = connectors.splice(connectors.findIndex((x) => x.id === url.pathname.split('/')[3]), 1);
        vault.splice(vault.findIndex((s) => s.id === gone.secretId), 1);
        out = { ok:true };
      } else if (url.pathname === '/api/secrets') out = { secrets:vault, encrypted:true };
      else if (url.pathname === '/api/agent/tasks/control') { decisions.push(body); out = { tasks:[] }; }
      else if (url.pathname === '/api/agent/tasks') out = { tasks:[] };
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out) });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:8080/app');

    // The key card: where the key goes, a masked field and a link to get the key.
    const docs = page.locator('[data-mid="docs1"]');
    await docs.locator('[data-f="key"]').waitFor();
    assert.match(await docs.textContent(), /Connect Docs/);
    assert.match(await docs.textContent(), /MCP server · mcp\.example\.com/);
    assert.match(await docs.locator('.connector-card-where').textContent(), /Your token is sent only to mcp\.example\.com/);
    assert.equal(await docs.locator('[data-f="key"]').getAttribute('type'), 'password');
    assert.equal(await docs.locator('.connector-card-link').getAttribute('href'), 'https://mcp.example.com/settings/tokens');
    if (process.env.CONNECTORS_SCREENSHOT) await docs.locator('.connector-card').screenshot({ path:process.env.CONNECTORS_SCREENSHOT.replace(/\.png$/, '-card.png') });

    // No key: nothing is sent.
    await docs.locator('[data-act="connector-save"]').click();
    assert.equal(requests.filter((r) => r.method === 'POST' && r.path === '/api/connectors').length, 0);
    // A refused key: the card says why and keeps waiting; the task is not resumed.
    await docs.locator('[data-f="key"]').fill('wrong-token');
    await docs.locator('[data-act="connector-save"]').click();
    await docs.locator('.cc-error').waitFor();
    assert.match(await docs.locator('.cc-error').textContent(), /refused access/);
    assert.equal(decisions.length, 0);
    // The right key connects and resumes the task.
    await docs.locator('[data-f="key"]').fill(TOKEN);
    await docs.locator('[data-act="connector-save"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages[0].card.status === 'connected');
    const posted = requests.filter((r) => r.method === 'POST' && r.path === '/api/connectors').at(-1);
    assert.deepEqual(posted.body, { kind:'mcp', name:'Docs', url:'https://mcp.example.com/mcp', description:'', testPath:'', docsUrl:'', auth:{ type:'bearer' }, secret:TOKEN });
    assert.deepEqual({ taskId:decisions[0].taskId, allow:decisions[0].allow, callId:decisions[0].callId }, { taskId:'task_docs', allow:true, callId:'call_docs1' });
    assert.match(await docs.textContent(), /2 tools ready/);
    assert.equal(await docs.locator('[data-act="cc-open"]').count(), 1);

    // Not now: nothing is added and the task hears no.
    const wx = page.locator('[data-mid="wx1"]');
    assert.match(await wx.locator('.connector-card-where').textContent(), /Your API key is sent only to api\.weather\.example/);
    // A key made on one site and sent to another is spelled out, and the button names where it goes.
    assert.match(await wx.locator('.connector-card-warning').textContent(), /on weather\.com, but it is sent to api\.weather\.example/);
    assert.match(await wx.locator('[data-act="connector-save"]').textContent(), /Send API key to api\.weather\.example/);
    assert.equal(await page.locator('[data-mid="docs1"] .connector-card-warning').count(), 0);
    await wx.locator('[data-act="connector-skip"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages[1].card.status === 'skipped');
    assert.equal(decisions.at(-1).allow, false);
    assert.equal(connectors.length, 1);

    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    assert.equal(stored.includes(TOKEN), false, 'browser storage never holds the key');
    assert.equal(stored.includes('wrong-token'), false);

    // Connectors: the connector is there, connected, with permissions. There is no manual form.
    await docs.locator('[data-act="cc-open"]').click();
    const row = page.locator('.cc-row.is-open');
    await row.locator('.conn-body').waitFor();
    assert.equal(await page.locator('[data-act="cc-new"], .cc-form').count(), 0, 'no Add your own form on Connectors');
    assert.match(await page.locator('.conn-ask').textContent(), /Ask Audit in chat/);
    assert.match(await row.locator('.conn-meta span').textContent(), /MCP server · mcp\.example\.com · 2 tools/);
    assert.equal(await row.locator('.chip.green').textContent(), 'Connected');
    assert.match(await row.locator('.cc-kv').textContent(), /Bearer token · sec_c1 in your vault/);
    if (process.env.CONNECTORS_SCREENSHOT) await page.screenshot({ path:process.env.CONNECTORS_SCREENSHOT, fullPage:true });
    await row.locator('[data-act="cc-perm"][data-slug="create_ticket"]').click();
    await page.waitForFunction(() => document.querySelector('[data-act="cc-perm"][data-slug="create_ticket"]')?.getAttribute('aria-checked') === 'false');
    assert.deepEqual(requests.filter((r) => r.path.endsWith('/permissions')).at(-1).body, { disabled:['create_ticket'] });

    // Settings › Secrets: the token shows as the connector's key; the manual form remains there.
    await page.locator('[data-act="usermenu"]').click();
    await page.locator('.sitem[data-view="settings"]').click();
    await page.locator('[data-act="stab"][data-t="secrets"]').click();
    await page.locator('.vault-item').first().waitFor();
    assert.equal(await page.locator('.vault-item-type').first().textContent(), 'MCP server');
    assert.match(await page.locator('.vault-item-connector').first().textContent(), /Connected in Connectors/);
    await page.locator('[data-act="vault-kind"][data-k="api"]').click();
    await page.locator('.vault-add [data-cc="name"]').fill('Weather');
    await page.locator('.vault-add [data-cc="url"]').fill('https://api.example.com/v1');
    await page.locator('.vault-add [data-cc="secret"]').fill('weather-key-1');
    await page.locator('.vault-add [data-act="cc-save"]').click();
    await page.locator('.vault-item').nth(1).waitFor();
    assert.equal(await page.locator('.vault-item-type').first().textContent(), 'API connection');

    // Removing a connector removes its key.
    await page.locator('.vault-item [data-act="cc-open"]').first().click();
    await page.locator('.cc-row.is-open [data-act="cc-remove"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.cc-row').length === 1);
    assert.ok(requests.some((r) => r.method === 'DELETE' && r.path === '/api/connectors/con_2'));

    // Phone width: nothing overflows.
    await page.setViewportSize({ width:390, height:844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'no horizontal scroll at phone width');
    assert.deepEqual(errors, []);
    console.log('connectors ui: agent key card connects and resumes the task, Connectors has no manual form, keys stay out of browser storage');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
