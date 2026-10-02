const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Settings › Secrets: no form for adding credentials by hand. The owner asks the agent in
// chat (the chips start that chat), and the saved list groups vault refs, reveals values
// only on request and deletes them. Values never land in browser storage.
(async () => {
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(() => {
      if(localStorage.getItem('lingon.v1'))return;
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'ui-audit@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'settings',settingsTab:'secrets',chats:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    const now=Date.now();
    const vault=[
      {id:'sec_t1_x',ref:'sec_t1',name:'github.com username',at:now,value:'octo'},
      {id:'sec_t2_x',ref:'sec_t2',name:'github.com password',at:now,value:'hunter2 secret'},
      {id:'sec_t3_x',ref:'sec_t3',name:'OpenAI API key',at:now,value:'sk-test-123'},
      {id:'sec_t4_x',ref:'sec_t4',name:'Wi-Fi credential',at:now,value:'private-value'},
    ];
    const posted=[],deleted=[];
    await context.route('**/api/**',async route => {
      const url=new URL(route.request().url()),method=route.request().method();
      let body={};
      if(url.pathname==='/api/secrets' && method==='POST')posted.push(route.request().postData());
      else if(url.pathname==='/api/secrets')body={secrets:vault.map(({value,...s})=>s),encrypted:true};
      else if(url.pathname.endsWith('/reveal'))body={value:vault.find(s=>s.id===url.pathname.split('/')[3])?.value};
      else if(method==='DELETE'){deleted.push(url.pathname);const i=vault.findIndex(s=>s.id===url.pathname.split('/')[3]);if(i>=0)vault.splice(i,1);body={ok:true};}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('.vault-item').nth(2).waitFor();

    // No manual form: no kind picker, no fields, no save button.
    assert.equal(await page.locator('.vault-add input, .vault-add select, .vault-add textarea, [data-act="vault-kind"], [data-act="addsecret"], .cc-form').count(),0,'no manual add form');
    assert.equal(await page.locator('.vault-payment, [data-pm], [data-act="save-merchant-card"]').count(),0,'no card details are collected in settings');
    assert.match(await page.locator('.vault-ask').textContent(),/Add with Audit/);
    assert.deepEqual(await page.locator('[data-act="vault-ask"]').allTextContents(),['Save a login','Add an API key','Connect a service']);

    // The saved list: a login's two fields are one entry; API key and other are typed rows.
    assert.equal(await page.locator('.vault-item').count(),3);
    assert.deepEqual(await page.locator('.vault-item-type').allTextContents(),['Login','API key','Other']);
    await page.locator('.vault-item').first().locator('[data-act="reveal-credential"]').click();
    await page.locator('.vault-item-value').nth(1).waitFor();
    assert.equal(await page.locator('.vault-item-value').count(),2,'the eye reveals both login fields');
    assert.equal(await page.locator('.vault-item-value').last().textContent(),'hunter2 secret');
    await page.locator('.vault-item').first().locator('[data-act="reveal-credential"]').click();
    await page.locator('.vault-item-value').first().waitFor({state:'detached'});
    if(process.env.VAULT_SCREENSHOT){await page.waitForTimeout(1800);await page.screenshot({path:process.env.VAULT_SCREENSHOT,fullPage:true});}

    const stored=await page.evaluate(() => localStorage.getItem('lingon.v1'));
    for(const {value} of vault)assert.equal(stored.includes(value),false,`browser storage never holds ${value}`);
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('.vault-item').filter({hasText:'github.com'}).locator('[data-act="delete-credential"]').click();
    await page.locator('.vault-item').filter({hasText:'github.com'}).waitFor({state:'detached'});
    assert.deepEqual(deleted,['/api/secrets/sec_t1_x','/api/secrets/sec_t2_x'],'deleting a login removes both saved fields');

    // A chip opens a new chat with the request started in the composer; nothing is saved here.
    await page.locator('[data-act="vault-ask"]',{hasText:'Save a login'}).click();
    await page.locator('#cprompt').waitFor();
    assert.equal(await page.locator('#cprompt').inputValue(),'Save my login for ');
    assert.equal(await page.evaluate(() => document.activeElement?.id),'cprompt');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')).view),'chat');
    assert.deepEqual(posted,[],'Settings never posts a secret');
    assert.deepEqual(errors,[]);
    console.log('vault settings UI: no manual form, chips start a chat, saved refs reveal and delete in a list');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
