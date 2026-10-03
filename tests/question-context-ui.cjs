const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

// Exercise the real app and managed adapter with local fixtures, without accounts
// or model calls. The server exists only for this test and uses an ephemeral port.
(async () => {
  const root = path.resolve(__dirname, '../app');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(root, '.' + (pathname === '/app' || pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (localStorage.getItem('lingon.v1')) return;
      localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{id:'ui-audit',email:'ui-audit@example.invalid'} }));
      const question = (id, q, options, extra = {}) => ({id,managedId:'ask_'+id,role:'agent',kind:'card',card:{type:'question',ask:true,status:'pending',q,options,allowOther:true,
        context:'Keep the original request and the selected option meanings.',originalPrompt:'Plan a trip to Stockholm for two under 500 EUR.',...extra}});
      localStorage.setItem('lingon.v1', JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'chat1',
        chats:[{id:'chat1',title:'Trip',createdAt:Date.now(),trace:[],messages:[
          {id:'original',role:'user',kind:'text',text:'Plan a trip to Stockholm for two under 500 EUR.'},
          question('old','Which pace?', [{label:'Relaxed',description:'One activity per day.'},{label:'Busy',description:'Several activities each day.'}]),
          question('multi','What matters?', [{label:'Food, coffee',description:'Local cafés.'},{label:'Museums',description:'Indoor attractions.'}],{multi:true}),
          question('skip','Which hotel?', [{label:'Central'},{label:'Waterfront'}]),
          question('typed','When should we travel?', [{label:'June'},{label:'July'}]),
          question('latest','How should we travel?', [{label:'Train',description:'Take the overnight train.'},{label:'Flight',description:'Direct flights only.'}]),
        ]}],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    const posted = [];
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/agent/conversation') {
        posted.push(JSON.parse(route.request().postData()));
        return route.fulfill({status:200,contentType:'text/event-stream',body:'data: {"type":"session","status":"running"}\n\ndata: {"type":"message","id":"answer_'+posted.length+'","phase":"final_answer","text":"Continuing your trip plan."}\n\ndata: {"type":"done","status":"completed"}\n\n'});
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(pathname === '/api/agent/tasks' ? {tasks:[]} : {})});
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);
    const card = id => page.locator(`[data-mid="${id}"]`);
    await card('old').getByRole('button', {name:'Relaxed'}).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages.some(m => m.managedId === 'answer_1'));
    assert.equal(posted[0].prompt, 'Relaxed');
    assert.equal(posted[0].context.questionReply.id, 'ask_old', 'clicking an older question answers that question by its server ID');
    assert.equal(posted[0].context.questionReply.options[0].description, 'One activity per day.');
    assert.match(posted[0].context.questionReply.originalPrompt, /Stockholm.*500 EUR/);
    assert.equal(posted[0].context.replyTo.id, 'old');
    await card('multi').getByRole('button', {name:'Food, coffee'}).click();
    await card('multi').getByRole('button', {name:'Museums'}).click();
    await card('multi').locator('[data-act="qsubmit"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages.some(m => m.managedId === 'answer_2'));
    assert.deepEqual(posted[1].context.questionReply.selected, ['Food, coffee','Museums']);
    await card('skip').getByRole('button', {name:'Skip', exact:true}).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages.some(m => m.managedId === 'answer_3'));
    assert.equal(posted[2].context.questionReply.skipped, true);
    assert.equal(posted[2].context.questionReply.id, 'ask_skip');
    await page.reload();
    assert.equal(await card('multi').locator('.cv-opt.on').count(), 2, 'selection labels containing commas survive reload');
    assert.equal(await card('multi').locator('.cv-own').count(), 0, 'a selected label containing commas is not mistaken for a custom answer');
    assert.equal(await card('old').locator('[data-act="qopt"]').count(), 0, 'answered cards cannot submit twice');
    assert.ok(posted[2].history.some(m => m.metadata?.questionReply?.id === 'ask_old'), 'history retains the answer relation');

    // A fresh question sent after earlier answers can also be answered by typing.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('lingon.v1'));
      saved.chats[0].messages.push({id:'fresh',role:'agent',kind:'card',card:{type:'question',ask:true,status:'pending',allowOther:true,q:'When should we travel?',
        options:[{label:'June',description:'Early summer.'},{label:'July',description:'Midsummer.'}],originalPrompt:'Plan a trip to Stockholm for two under 500 EUR.'}});
      localStorage.setItem('lingon.v1', JSON.stringify(saved));
    });
    await page.reload();
    await page.locator('#cprompt').fill('June, for five days');
    await page.locator('#cprompt').press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages.some(m => m.managedId === 'answer_4'));
    assert.equal(posted[3].prompt, 'June, for five days');
    assert.equal(posted[3].context.questionReply.id, 'fresh');
    const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')).chats[0].messages.find(m => m.id === 'fresh'));
    assert.equal(fresh.card.status, 'answered');
    assert.equal(fresh.card.choice, 'June, for five days');
    assert.deepEqual(errors, []);
    console.log('question context UI: targeted options, multi-select, skip follow-up, reload and typed answers: ok');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
