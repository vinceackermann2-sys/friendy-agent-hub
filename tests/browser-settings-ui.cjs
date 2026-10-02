const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// On phones Settings opens sections from its list; go back to the list first when a section is open.
const openSettingsTab=async(page,t)=>{await page.locator('#main .set-page, #main .settings-tabs').first().waitFor();const back=page.locator('.set-sub-head [data-act="stab"][data-t="home"]');if(await back.count())await back.click();await page.locator(`:is(.set-row,.settings-tabs button)[data-act="stab"][data-t="${t}"]`).click();};
(async () => {
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(() => {
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'ui-audit@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',chats:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    const modes={web:'ask_some',connectors:'ask_some',knownHosts:[]};
    let imported=[];
    await context.route('**/api/**',async route => {
      const url=new URL(route.request().url());
      let body={};
      if(url.pathname==='/api/agent-permissions'){
        if(route.request().method()==='PUT')Object.assign(modes,JSON.parse(route.request().postData() || '{}'));
        body={permissions:{...modes}};
      }else if(url.pathname==='/api/memories/import'){
        imported=JSON.parse(route.request().postData() || '{}').memories || [];
        body={imported:imported.length};
      }else if(url.pathname==='/api/memories')body={memories:imported.map((m,i)=>({...m,id:`m${i}`,at:Date.now(),src:'user_import'})),total:imported.length};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('.mobile-nav-toggle').click();
    await page.locator('[data-act="usermenu"]').click();
    await page.locator('[data-act="nav"][data-view="settings"]').click();
    await openSettingsTab(page,'browser');
    await page.locator('.browser-settings-card').first().waitFor();
    assert.equal(await page.locator('.browser-settings-card').count(),3);
    assert.equal(await page.locator('#browser-agent-name').inputValue(),'Audit');
    assert.equal(await page.locator('[data-group="web"][data-mode="ask_some"]').getAttribute('aria-checked'),'true');
    await page.locator('[data-group="web"][data-mode="always_ask"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).agentPermissions?.web==='always_ask');
    assert.equal(modes.web,'always_ask');
    await page.locator('[data-group="connectors"][data-mode="always_ask"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).agentPermissions?.connectors==='always_ask');
    assert.equal(modes.connectors,'always_ask');
    await page.locator('#browser-memory-file').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('I like concise answers\n- I live in Stockholm')});
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).memoryTotal===2);
    assert.equal(imported.length,2);
    await page.locator('#browser-agent-name').fill('Nova');
    await page.locator('#browser-agent-name').blur();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).agent?.name==='Nova');
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-act="browser-reset-agent"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).agent?.name==='Your agent');
    await page.waitForFunction(() => document.querySelector('#browser-agent-name')?.value==='Your agent');
    assert.equal(await page.locator('#browser-agent-name').inputValue(),'Your agent');
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('browser settings UI: passed');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
