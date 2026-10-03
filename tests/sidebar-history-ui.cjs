const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

// Serve the actual app on an ephemeral port and replace its APIs with fixtures.
// A delayed automation list exercises history before and after its links load.
(async () => {
  const root = path.resolve(__dirname, '../app');
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.svg':'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(root, '.' + (pathname === '/app' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, releaseAgents;
  const agentsReady = new Promise(resolve => { releaseAgents = resolve; });
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport:{width:1440,height:900} });
    await context.addInitScript(() => {
      localStorage.setItem('lingon.session', JSON.stringify({ access_token:'sidebar-fixture', user:{id:'sidebar-owner',email:'sidebar@example.invalid'} }));
      const textChat = (id, title, text, source) => ({id,title,source,createdAt:Date.now(),trace:[],messages:[{id:id+'-message',role:'agent',kind:'text',text}]});
      localStorage.setItem('lingon.v1', JSON.stringify({ownerId:'sidebar-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},
        view:'chat',activeChat:'normal-chat',canvasOpen:true,canvasTab:'subagents',subAgents:[],
        chats:[textChat('normal-chat','Conversation','Ordinary conversation.'),
          textChat('updates_owner','Updates','A timely idea from your agent.','automation'),
          textChat('deleted-chat','Deleted automation history','The previous automation result.','automation'),
          textChat('existing-chat','Morning update','The current automation result.','automation')],
        vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    const automation = {id:'auto1',chatId:'existing-chat',name:'Morning update',enabled:true,trigger:{type:'schedule',intervalMinutes:1440}};
    let deleted = false;
    await context.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      let out = {};
      if (pathname === '/api/sub-agents') {
        await agentsReady;
        out = {subAgents:deleted ? [] : [automation]};
      } else if (pathname === '/api/sub-agents/auto1' && request.method() === 'DELETE') deleted = true;
      else if (pathname === '/api/agent/tasks') out = {tasks:[]};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);
    const sidebarChat = id => page.locator(`#side [data-act="openchat"][data-id="${id}"]`);
    await sidebarChat('updates_owner').waitFor({state:'visible'});
    await page.getByRole('button', {name:'Toggle canvas',exact:true}).click();
    assert.equal(await sidebarChat('deleted-chat').isVisible(), true, 'orphaned history stays reachable while automations load');
    assert.equal(await sidebarChat('existing-chat').isVisible(), true, 'an unresolved automation list cannot hide its history');

    releaseAgents();
    await page.locator('[data-act="appr-toggle"][data-key="automation"][data-id="auto1"]').waitFor();
    await sidebarChat('existing-chat').waitFor({state:'detached'});
    assert.equal(await sidebarChat('normal-chat').isVisible(), true);
    await sidebarChat('updates_owner').click();
    await page.locator('#thread').getByText('A timely idea from your agent.', {exact:true}).waitFor();
    await sidebarChat('deleted-chat').click();
    await page.locator('#thread').getByText('The previous automation result.', {exact:true}).waitFor();

    // The existing automation remains accessible from its own panel.
    await page.locator('[data-act="appr-toggle"][data-key="automation"][data-id="auto1"]').click();
    await page.locator('[data-act="open-subagent"][data-id="auto1"]').click();
    await page.locator('#thread').getByText('The current automation result.', {exact:true}).waitFor();
    assert.equal(await sidebarChat('existing-chat').count(), 0, 'existing automation chat uses its panel link');

    // Removing the automation immediately exposes the retained conversation.
    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-act="delete-subagent"][data-id="auto1"]').click();
    await sidebarChat('existing-chat').waitFor({state:'visible'});
    assert.equal(deleted, true);
    await sidebarChat('normal-chat').click();
    await sidebarChat('existing-chat').click();
    await page.locator('#thread').getByText('The current automation result.', {exact:true}).waitFor();
    assert.deepEqual(errors, []);
    console.log('Sidebar history: delayed automation list, Updates, orphaned history, panel access and deletion: ok');
  } finally {
    releaseAgents();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
