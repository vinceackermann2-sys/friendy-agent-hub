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
    await context.route('**/api/**',async route => {
      const url=new URL(route.request().url());
      let body={};
      if(url.pathname==='/api/secrets' && route.request().method()==='POST'){
        const {name,value}=JSON.parse(route.request().postData() || '{}');
        posted.push({name,value});
        const ref=`sec_t${posted.length}`;
        body={secret:{id:`${ref}_x`,ref,name,at:Date.now()}};
      }else if(url.pathname==='/api/secrets')body={secrets:[],encrypted:true};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('.vault-add-form').waitFor();
    assert.equal(await page.locator('.vault-hero, .vault-steps').count(),0,'intro block is gone');
    assert.equal(await page.locator('.vault-kind').count(),4);

    // Login → "<site> username" + "<site> password"
    await page.locator('[data-vf="site"]').fill('https://www.github.com/login');
    await page.locator('[data-vf="username"]').fill('octo');
    await page.locator('[data-vf="password"]').fill('hunter2 secret');
    assert.equal(await page.locator('[data-vf="password"]').getAttribute('type'),'password');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').nth(1).waitFor();
    assert.deepEqual(posted,[{name:'github.com username',value:'octo'},{name:'github.com password',value:'hunter2 secret'}]);
    assert.equal(await page.locator('[data-vf="password"]').inputValue(),'','fields clear after saving');

    // Card → number, expiry, CVC
    await page.locator('[data-act="vault-kind"][data-k="card"]').click();
    await page.locator('[data-vf="name"]').fill('Personal Visa');
    await page.locator('[data-vf="number"]').fill('4111 1111-1111 1111');
    await page.locator('[data-vf="expiry"]').fill('12/29');
    await page.locator('[data-vf="cvc"]').fill('123');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').nth(4).waitFor();
    assert.deepEqual(posted.slice(2),[{name:'Personal Visa card number',value:'4111111111111111'},{name:'Personal Visa expiry',value:'12/29'},{name:'Personal Visa CVC',value:'123'}]);

    // API key
    await page.locator('[data-act="vault-kind"][data-k="apikey"]').click();
    await page.locator('[data-vf="name"]').fill('OpenAI API key');
    await page.locator('[data-vf="value"]').fill('sk-test-123');
    await page.locator('[data-act="addsecret"]').click();
    await page.locator('.vault-item').nth(5).waitFor();
    assert.deepEqual(posted.at(-1),{name:'OpenAI API key',value:'sk-test-123'});

    const stored=await page.evaluate(() => localStorage.getItem('lingon.v1'));
    for(const {value} of posted)assert.equal(stored.includes(value),false,`browser storage never holds ${value}`);
    assert.deepEqual(errors,[]);
    console.log('vault settings UI: login, card and API key save as refs only');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
