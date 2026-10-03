const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
      const context = await browser.newContext({viewport});
      await context.addInitScript(() => {
        localStorage.setItem('lingon.session',JSON.stringify({access_token:'usage-ui',user:{id:'usage-ui',email:'usage@example.invalid'}}));
        localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'usage-ui',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},
          view:'settings',settingsTab:'usage',chats:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
      });
      const source = fs.readFileSync(require.resolve('../app/app.js'),'utf8');
      const end = source.lastIndexOf('})();');
      const instrumented = source.slice(0,end)+'window.__usageTest = {makeRT,refreshBillingUsage,finishVoice,voiceIn};\n'+source.slice(end);
      await context.route(/\/(?:lingon\/)?app\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:instrumented}));
      let reads=0;
      const billing = {plan:'pro',status:'active',planTokens:100000000,planTokensUsed:25000000,
        packTokens:10000000,packTokensUsed:2000000,tokens:83000000,imagesToday:2,imagesPerDay:10,
        transcriptionsToday:1,transcriptionsPerDay:15,resetAt:'2026-10-24T12:00:00.000Z',plans:[],purchasedGifts:[],
        tokenPacks:[{tokens:10000000,millions:10,usd:15},{tokens:50000000,millions:50,usd:55}]};
      await context.route('**/api/**',route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/api/billing')reads++;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(
          path==='/api/billing'?billing:path==='/api/voice/transcribe'?{text:'Hello from voice'}:{})});
      });
      const page = await context.newPage(), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://127.0.0.1:8080/app');
      await page.locator('#giftcode').waitFor();
      assert.match(await page.locator('.billing-usage-top').innerText(),/25% used/);
      await page.locator('#giftcode').fill('UNFINISHED-GIFT');
      await page.locator('.billing-select-trigger').click();
      await page.locator('[data-act="select-pack"][data-pack="50000000"]').click();
      billing.planTokensUsed=40000000;billing.tokens=68000000;billing.imagesToday=3;
      const before=reads;
      await page.evaluate(()=>{
        const rt=window.__usageTest.makeRT({id:'background',messages:[]});
        rt.managedTask({id:'background-task',revision:1,version:1,sequence:0,events:[],status:'completed',title:'Done',metrics:{modelCalls:3}});
      });
      await page.waitForFunction(()=>document.querySelector('.billing-usage-top')?.textContent.includes('40% used'));
      assert.ok(reads>before,'a task in a different chat fetches the charged balance');
      assert.equal(await page.locator('#buypack').inputValue(),'50000000','refresh preserves the chosen token pack');
      assert.equal(await page.locator('#giftcode').inputValue(),'UNFINISHED-GIFT','refresh preserves gift input');
      assert.match(await page.locator('.billing-daily').innerText(),/Images today\s*3/);
      billing.planTokensUsed=41000000;billing.tokens=67000000;billing.transcriptionsToday=2;
      await page.evaluate(async()=>{
        const test=window.__usageTest;
        test.voiceIn.rec={mimeType:'audio/webm',state:'inactive'};
        test.voiceIn.chunks=[new Blob(['test recording'],{type:'audio/webm'})];
        await test.finishVoice();
      });
      await page.waitForFunction(()=>document.querySelector('.billing-usage-top')?.textContent.includes('41% used'));
      assert.match(await page.locator('.billing-daily').innerText(),/Transcriptions today\s*2/);
      // Work on another device is visible on returning to this app, after the cache expires.
      billing.planTokensUsed=42000000;billing.tokens=66000000;
      await page.evaluate(()=>{Date.now=()=>new Date().getTime()+20000;window.dispatchEvent(new Event('focus'));});
      await page.waitForFunction(()=>document.querySelector('.billing-usage-top')?.textContent.includes('42% used'));
      assert.equal(await page.locator('#giftcode').inputValue(),'UNFINISHED-GIFT');
      billing.planTokensUsed=1000;billing.tokens=107999000;
      await page.evaluate(()=>window.__usageTest.refreshBillingUsage());
      await page.waitForFunction(()=>document.querySelector('.billing-usage-top')?.textContent.includes('<1% used'));
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log('usage meter UI: background charges, transcription, returning to app, preserved drafts on desktop/mobile: ok');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
