const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('lingon.session', JSON.stringify({ access_token:'wallet-setup-test', user:{ id:'wallet-setup-test', email:'owner@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId:'wallet-setup-test', onboarded:true, agent:{ name:'Audit', color:'lingon', pers:'Precise' }, view:'chat', activeChat:'setup', chats:[{ id:'setup', title:'Wallet setup', messages:[], at:Date.now() }], canvasTab:'payments', vault:{ secrets:[], apps:[], approvals:[], mode:'default' } }));
      });
      let attempts = 0, releaseFirst;
      const firstAttempt = new Promise(resolve => { releaseFirst = resolve; });
      const wallet = { configured:true, status:'not_created', cardProgramAvailable:true, balance:null };
      await context.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        let result = {};
        if (path === '/api/belna-wallet') result = { wallet };
        if (path === '/api/wallet-preferences') result = { activeMethod:null, selectionSaved:true, merchantEnabled:false };
        if (path === '/api/shop-pay') result = { shopPay:{ configured:true, connected:false }, orders:[] };
        if (path === '/api/belna-wallet/setup') {
          attempts++;
          assert.deepEqual(JSON.parse(request.postData()), { country:'SE' });
          if (attempts === 1) {
            await firstAttempt;
            return route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:'Wallet provider is temporarily unavailable. Try again.' }) });
          }
          Object.assign(wallet, { status:'verification_required', identityVerified:false, balance:{ available:0, pending:0 } });
          result = { wallet };
        }
        await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(result) });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.UI_BASE || 'http://127.0.0.1:8022/app');
      await page.locator('[data-act="togglecanvas"]').first().click();
      await page.locator('[data-act="ctab"][data-t="payments"]').click();
      const setup = page.getByRole('button', { name:'Set up', exact:true });
      const method = page.getByRole('radio', { name:/^Belna Wallet/ });
      await setup.click();
      await page.getByRole('button', { name:'Create wallet', exact:true }).waitFor();
      await method.click();
      await setup.click();
      await method.click();
      const create = page.getByRole('button', { name:'Create wallet', exact:true });
      assert.equal(await create.isVisible(), true, 'reselecting wallet or Set up must keep the form open');
      await create.click();
      const creating = page.getByRole('button', { name:'Creating wallet…', exact:true });
      await creating.waitFor();
      assert.equal(await creating.isDisabled(), true, 'setup cannot submit twice while pending');
      releaseFirst();
      await page.getByRole('alert').filter({ hasText:'Wallet provider is temporarily unavailable. Try again.' }).waitFor();
      assert.equal(await create.isEnabled(), true, 'failed setup remains available to retry');
      await create.click();
      await page.locator('.wpay-opt[data-option="belna_wallet"] .wpay-main[data-act="wallet-switch"]').waitFor();
      assert.equal(attempts, 2);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Wallet setup: repeated selection stays open, pending feedback, visible failure and retry pass on desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
