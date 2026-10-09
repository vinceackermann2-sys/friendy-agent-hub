const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PGlite } = require('@electric-sql/pglite');
const { createClientStateStore } = require('../server/client-state');

async function sqlChecks() {
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table public.profiles(id text primary key); insert into public.profiles values('alice'),('bob');");
    await db.exec(fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260926120000_client_state.sql'),'utf8'));
    await db.query("insert into public.client_state(user_id,state_key,value) values('alice','profile',$1)",[JSON.stringify({onboarded:true})]);
    assert.equal((await db.query("select value from public.client_state where user_id='alice'")).rows[0].value.onboarded,true);
    await assert.rejects(db.query("insert into public.client_state(user_id,state_key,value) values('bob','invalid','{}')"),/check constraint/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from public.client_state'),/permission denied/);
  } finally { await db.close(); }
}

async function storeChecks() {
  let data = { clientState:[], chats:[], turns:[] };
  const store = createClientStateStore({ supa:() => null, loadLocal:() => data, saveLocal:next => { data=next; },
    ensureProfile:async() => {}, listChatMessages:async() => [] });
  await store.save('alice','profile',{onboarded:true,agent:{name:'Mira',color:'rose',pers:'Calm'},theme:'grey',
    userProfile:{name:'Alice'},vault:{secrets:[{value:'must-not-save'}]}});
  await store.save('alice','chat:chat_1',{id:'chat_1',title:'Cinnamon tea',messages:[{id:'m1',role:'user',kind:'text',text:'Remember cinnamon tea'}],
    createdAt:1,vault:{secrets:[{value:'must-not-save'}]}});
  const restored = await store.list('alice');
  assert.equal(restored.profile.agent.name,'Mira');
  assert.equal(restored.chats[0].messages[0].text,'Remember cinnamon tea');
  assert.doesNotMatch(JSON.stringify(restored),/must-not-save/);
  assert.deepEqual(await store.list('bob'),{profile:null,chats:[],durable:true});
  await assert.rejects(() => store.save('bob','chat:chat_1',{id:'wrong',messages:[]}),error => error.code === 'BAD_INPUT');
  await store.removeChat('alice','chat_1');
  assert.equal((await store.list('alice')).chats.length,0);
}

async function browserChecks() {
  const appDir = path.join(__dirname,'..','app');
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    const file = path.join(appDir,['/','/app'].includes(pathname) ? 'index.html' : path.basename(pathname));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type',file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  const records=new Map();
  const sessions = {
    alice:{access_token:'alice-token',refresh_token:'alice-refresh',user:{id:'alice',email:'alice@example.test'}},
    bob:{access_token:'bob-token',refresh_token:'bob-refresh',user:{id:'bob',email:'bob@example.test'}},
  };
  const fileData='data:text/plain;base64,'+Buffer.from('Cinnamon tea notes').toString('base64');
  const legacyChat={id:'first-chat',title:'Cinnamon tea',messages:[{id:'m1',role:'user',kind:'text',text:'Remember cinnamon tea',
    files:[{name:'notes.txt',size:18,type:'text/plain',storageId:'notes-file',dataUrl:fileData}]},
    {id:'m2',role:'agent',kind:'text',text:'I will remember.'}],trace:[],artifact:null,createdAt:Date.now()-10000};
  const legacyState={ownerId:'alice',onboarded:true,agent:{name:'Mira',color:'rose',pers:'Calm',claimedAt:Date.now()-20000},
    chats:[legacyChat],activeChat:legacyChat.id,view:'chat',theme:'grey'};
  const route = async request => {
    const pathName=new URL(request.request().url()).pathname;
    const owner=request.request().headers().authorization?.includes('bob-token') ? 'bob' : 'alice';
    const key=pathName.startsWith('/api/client-state/') ? decodeURIComponent(pathName.slice('/api/client-state/'.length)) : '';
    let result={};
    if (pathName === '/api/client-state' && request.request().method() === 'GET') {
      result={profile:records.get(`${owner}:profile`) || null,
        chats:[...records].filter(([k]) => k.startsWith(`${owner}:chat:`)).map(([,v]) => v)};
    } else if (key && request.request().method() === 'PUT') {
      const value=request.request().postDataJSON().value;
      records.set(`${owner}:${key}`,value); result={value};
    } else if (pathName.startsWith('/api/client-state/chats/') && request.request().method() === 'DELETE') {
      records.delete(`${owner}:chat:${pathName.split('/').at(-1)}`); result={ok:true};
    } else if (pathName === '/api/memories') result={memories:[{id:'fact-1',text:'Alice likes cinnamon tea',category:'user'}],total:1};
    else if (pathName === '/api/secrets') result={secrets:[],encrypted:true};
    else if (pathName === '/api/automation-chats') result={chats:[]};
    else if (pathName === '/api/agent-context') result={revision:0,agent:null,documents:{}};
    else if (pathName === '/api/agent/conversation') return request.fulfill({contentType:'text/event-stream',body:'data: {"type":"done","status":"completed"}\n\n'});
    await request.fulfill({json:result});
  };
  try {
    const first=await browser.newContext();
    await first.addInitScript(({session,state}) => {
      localStorage.setItem('lingon.session',JSON.stringify(session));
      localStorage.setItem('lingon.v1',JSON.stringify(state));
    },{session:sessions.alice,state:legacyState});
    const pageA=await first.newPage();
    await pageA.route('**/api/**',route);
    await pageA.goto(base+'/app');
    await pageA.waitForSelector('#app');
    // Saves are batched a moment after a change; the seeded state has no memory list until then.
    await pageA.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).memory?.length === 1);
    await pageA.waitForFunction(() => document.querySelector('#thread')?.textContent?.includes('Remember cinnamon tea'));
    for (let i=0; i<100 && !records.has('alice:chat:first-chat'); i++) await new Promise(resolve => setTimeout(resolve,25));
    assert.ok(records.has('alice:chat:first-chat'),'local chats are uploaded to the account');
    assert.ok(records.has('alice:profile'),'agent setup is uploaded to the account');
    assert.equal(records.get('alice:chat:first-chat').messages[0].files[0].dataUrl,fileData,'chat attachments reach account storage');

    const second=await browser.newContext();
    await second.addInitScript(session => localStorage.setItem('lingon.session',JSON.stringify(session)),sessions.alice);
    const pageB=await second.newPage();
    await pageB.route('**/api/**',route);
    await pageB.goto(base+'/app');
    await pageB.waitForSelector('#app');
    assert.equal(await pageB.locator('[data-onboarding-name]').count(),0,'second device skips onboarding');
    assert.match(await pageB.locator('#thread').innerText(),/Remember cinnamon tea/);
    const recovered=await pageB.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')));
    assert.equal(recovered.agent.name,'Mira');
    assert.equal(recovered.memory[0].text,'Alice likes cinnamon tea','knowledge reloads with the account');
    const restoredFile=await pageB.evaluate(() => new Promise((resolve,reject) => {
      const open=indexedDB.open('belna-composer-files',1);
      open.onerror=() => reject(open.error);
      open.onsuccess=() => {
        const req=open.result.transaction('files','readonly').objectStore('files').get('notes-file');
        req.onsuccess=() => { resolve(req.result); open.result.close(); };
        req.onerror=() => reject(req.error);
      };
    }));
    assert.equal(restoredFile,fileData,'a fresh browser restores the attachment content');
    await pageB.reload();
    await pageB.waitForSelector('#app');
    assert.match(await pageB.locator('#thread').innerText(),/Remember cinnamon tea/);
    await pageB.click('[data-act="newchat"]');
    await pageB.fill('#cprompt','Please remember bananas');
    await pageB.click('#csend');
    for (let i=0; i<100 && ![...records].some(([key,value]) => key.startsWith('alice:chat:') && value.messages?.some(m => m.text === 'Please remember bananas')); i++)
      await new Promise(resolve => setTimeout(resolve,25));
    assert.ok([...records].some(([key,value]) => key.startsWith('alice:chat:') && value.messages?.some(m => m.text === 'Please remember bananas')),
      'new messages are saved to the account');
    const third=await browser.newContext();
    await third.addInitScript(session => localStorage.setItem('lingon.session',JSON.stringify(session)),sessions.alice);
    const pageD=await third.newPage();
    await pageD.route('**/api/**',route);
    await pageD.goto(base+'/app');
    await pageD.waitForSelector('#app');
    assert.match(await pageD.locator('#thread').innerText(),/Please remember bananas/);
    const newChatId=(await pageB.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')))).activeChat;
    await pageB.locator(`[data-act="openchat"][data-id="${newChatId}"]`).hover();
    await pageB.click(`[data-act="delchat"][data-id="${newChatId}"]`);
    for (let i=0; i<100 && records.has(`alice:chat:${newChatId}`); i++) await new Promise(resolve => setTimeout(resolve,25));
    assert.equal(records.has(`alice:chat:${newChatId}`),false,'chat deletion reaches the account');
    await pageB.reload();
    await pageB.waitForSelector('#app');
    assert.equal((await pageB.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')))).chats.some(chat => chat.id === newChatId),false,
      'deleted chat stays deleted after refresh');
    await pageD.reload();
    await pageD.waitForSelector('#app');
    // A device that had the chat shows its saved copy at once; the account's deletion follows.
    await pageD.waitForFunction(id => !JSON.parse(localStorage.getItem('lingon.v1')).chats.some(chat => chat.id === id),newChatId).catch(() => {});
    assert.equal((await pageD.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')))).chats.some(chat => chat.id === newChatId),false,
      'a second device does not restore a deleted chat');

    const other=await browser.newContext();
    await other.addInitScript(session => localStorage.setItem('lingon.session',JSON.stringify(session)),sessions.bob);
    const pageC=await other.newPage();
    await pageC.route('**/api/**',route);
    await pageC.goto(base+'/app');
    await pageC.waitForSelector('[data-onboarding-name]');
    assert.doesNotMatch(await pageC.locator('#thread').innerText(),/cinnamon tea/i,'another account cannot see the chat');
    await Promise.all([first.close(),second.close(),third.close(),other.close()]);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

(async() => { await sqlChecks(); await storeChecks(); await browserChecks(); console.log('client state: account recovery and isolation passed'); })()
  .catch(error => { console.error(error); process.exitCode=1; });
