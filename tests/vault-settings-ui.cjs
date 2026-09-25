const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Settings › Secrets: each kind saves named vault entries through the server
// vault only, and values never land in browser storage.
(async () => {
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(() => {
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'ui-audit@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'settings',settingsTab:'secrets',chats:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    const posted=[];
    const deleted=[];
    const cards=[];
    await context.route('**/api/**',async route => {
      const url=new URL(route.request().url());
      let body={};
      if(url.pathname==='/api/payment-methods' && route.request().method()==='POST'){
        const input=JSON.parse(route.request().postData() || '{}');
        const method={id:`pm_${cards.length+1}`,...input,at:Date.now()};
        cards.push(method);body={method};
      }else if(url.pathname==='/api/payment-methods')body={methods:cards};
      else if(url.pathname.startsWith('/api/payment-methods/') && route.request().method()==='DELETE'){
        const id=url.pathname.split('/').pop();
        const i=cards.findIndex(card=>card.id===id);if(i>=0)cards.splice(i,1);
        body={ok:true};
      }else if(url.pathname==='/api/secrets' && route.request().method()==='POST'){
        const {name,value}=JSON.parse(route.request().postData() || '{}');
        posted.push({name,value});
        const ref=`sec_t${posted.length}`;
        body={secret:{id:`${ref}_x`,ref,name,at:Date.now()}};
      }else if(url.pathname==='/api/secrets')body={secrets:[],encrypted:true};
      else if(url.pathname.endsWith('/reveal')){
        const id=url.pathname.split('/')[3];
        const index=Number(id.match(/^sec_t(\d+)_x$/)?.[1])-1;
        body={value:posted[index]?.value};
      }else if(route.request().method()==='DELETE'){deleted.push(url.pathname);body={ok:true};}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('.vault-add-form').waitFor();
    assert.equal(await page.locator('.vault-hero, .vault-steps').count(),0,'intro block is gone');
    assert.equal(await page.locator('.vault-kind').count(),3);
    assert.equal(await page.locator('[data-act="vault-kind"][data-k="card"]').count(),0);
    await page.locator('[data-pm="merchant"]').fill('shop.example');
    await page.locator('[data-pm="label"]').fill('Everyday card');
    await page.locator('[data-pm="brand"]').fill('Visa');
    await page.locator('[data-pm="last4"]').fill('4242');
    assert.match(await page.locator('.vault-payment-preview').textContent(),/4242/);
    await page.locator('[data-act="save-merchant-card"]').click();
    await page.locator('.vault-payment-saved').first().waitFor();
    assert.equal(cards[0].last4,'4242');
    assert.match(await page.locator('.vault-payment-saved').first().textContent(),/Visa •••• 4242/);

    // Login → "<site> username" + "<site> password"
    await page.locator('[data-vf="site"]').fill('https://www.github.com/login');
    await page.locator('[data-vf="username"]').fill('octo');
    await page.locator('[data-vf="password"]').fill('hunter2 secret');
    assert.equal(await page.locator('[data-vf="password"]').getAttribute('type'),'password');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').first().waitFor();
    assert.deepEqual(posted,[{name:'github.com username',value:'octo'},{name:'github.com password',value:'hunter2 secret'}]);
    assert.equal(await page.locator('[data-vf="password"]').inputValue(),'','fields clear after saving');
    assert.equal(await page.locator('.vault-item').count(),1,'login fields appear as one list entry');
    assert.equal(await page.locator('.vault-item-type').first().textContent(),'Login');
    await page.locator('.vault-item [data-act="reveal-credential"]').click();
    await page.locator('.vault-item-value').last().waitFor();
    assert.equal(await page.locator('.vault-item-value').count(),2,'the eye reveals both login fields');
    assert.equal(await page.locator('.vault-item-value').last().textContent(),'hunter2 secret');
    await page.locator('.vault-item [data-act="reveal-credential"]').click();
    await page.locator('.vault-item-value').first().waitFor({state:'detached'});

    // API key and other each appear as one typed row.
    await page.locator('[data-act="vault-kind"][data-k="apikey"]').click();
    await page.locator('[data-vf="name"]').fill('OpenAI API key');
    await page.locator('[data-vf="value"]').fill('sk-test-123');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').nth(1).waitFor();
    assert.deepEqual(posted.at(-1),{name:'OpenAI API key',value:'sk-test-123'});
    assert.equal(await page.locator('.vault-item-type').first().textContent(),'API key');
    await page.locator('[data-act="vault-kind"][data-k="other"]').click();
    await page.locator('[data-vf="name"]').fill('Wi-Fi credential');
    await page.locator('[data-vf="value"]').fill('private-value');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').nth(2).waitFor();
    assert.equal(await page.locator('.vault-item-type').first().textContent(),'Other');
    if(process.env.VAULT_SCREENSHOT){
      await page.locator('.vault-payment').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1800);
      await page.screenshot({path:process.env.VAULT_SCREENSHOT,fullPage:true});
    }

    const stored=await page.evaluate(() => localStorage.getItem('lingon.v1'));
    for(const {value} of posted)assert.equal(stored.includes(value),false,`browser storage never holds ${value}`);
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('.vault-item').filter({hasText:'github.com'}).locator('[data-act="delete-credential"]').click();
    await page.locator('.vault-item').filter({hasText:'github.com'}).waitFor({state:'detached'});
    assert.deepEqual(deleted,['/api/secrets/sec_t1_x','/api/secrets/sec_t2_x'],'deleting a login removes both saved fields');
    assert.deepEqual(errors,[]);
    console.log('vault settings UI: login, API key and other save as refs and reveal in a list');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
