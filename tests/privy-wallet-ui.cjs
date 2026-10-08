const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const appRoot = path.resolve('app');
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (file === '/app' || file === '/') file = '/index.html';
    file = file.replace(/^\/lingon\//, '/');
    const target = path.resolve(appRoot, '.' + file);
    if (
      !target.startsWith(appRoot + path.sep) ||
      !fs.existsSync(target) ||
      !fs.statSync(target).isFile()
    ) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      'content-type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[path.extname(target)] || 'application/octet-stream',
    );
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.UI_BASE || 'http://127.0.0.1:' + server.address().port,
    browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1050 },
        reducedMotion: 'reduce',
      });
      await context.addInitScript(() => {
        localStorage.setItem(
          'lingon.session',
          JSON.stringify({
            access_token: 'fixture',
            user: { id: 'alice', email: 'alice@example.test' },
          }),
        );
        localStorage.setItem(
          'lingon.v1',
          JSON.stringify({
            ownerId: 'alice',
            onboarded: true,
            agent: { name: 'Audit', color: 'lingon', pers: 'Precise' },
            view: 'chat',
            activeChat: 'wallet-chat',
            chats: [{ id: 'wallet-chat', title: 'Wallet', messages: [], at: Date.now() }],
            canvasOpen: true,
            canvasTab: 'wallet',
            vault: { secrets: [], apps: [], approvals: [], mode: 'default' },
          }),
        );
        window.privyCalls = [];
        window.BelnaPrivy = {
          setup: async (country) => {
            window.privyCalls.push({ action: 'setup', country });
            return window.LingonAuth.api('/api/belna-wallet/setup', {
              method: 'POST',
              body: JSON.stringify({ country }),
            });
          },
          fund: async () => {
            window.privyCalls.push({ action: 'fund' });
          },
          authorize: async (quoteId, riskAccepted) => {
            window.privyCalls.push({ action: 'authorize', quoteId, riskAccepted });
            return window.LingonAuth.api('/api/belna-wallet/authorize', {
              method: 'POST',
              body: JSON.stringify({ quoteId, riskAccepted }),
            });
          },
          bank: async (action,input) => {
            window.privyCalls.push({action:'bank-'+action});
            return window.LingonAuth.api('/api/belna-wallet/bank/'+action,{method:'POST',body:JSON.stringify(input)});
          },
          export: async () => {
            window.privyCalls.push({ action: 'export' });
          },
        };
      });
      const address = '0x' + 'a'.repeat(40),
        destination = '0x' + 'b'.repeat(40),
        calls = [],
        intents = new Map();
      let created = false,
        setupRateLimited = true,
        joined = false,
        sequence = 0, bankEnabled=false, bankReady=false, bankLinked=false, bankSubmitted=false;
      const bank = () => ({available:true,verification:{ready:bankReady,status:bankReady?'approved':'not_started',termsAccepted:false},accounts:bankLinked?[{id:'bank_alice',label:'Fixture bank ····3000 · EUR',last4:'3000',currency:'EUR'}]:[]});
      const wallet = () => ({
        configured: true,
        provider: 'privy',
        kind: 'privy',
        status: created ? 'ready' : 'not_created',
        cardProgramAvailable: false,
        address,
        balance: created ? { available: 125, pending: 0, asset: 'USDC', currency: 'USD' } : null,
        dailyTransferLimitUsd: 50,
        paused: false,
        withdrawalsAvailable: true,
        bankWithdrawalsAvailable: bankEnabled,
      });
      const snapshot = () => ({
        wallet: wallet(),
        earn: {
          available: true,
          name: 'Aave USDC Vault',
          apy: 4.13,
          position: { available: 5, earned: 1 }, yieldFeePercent:10,
        },
        intents: [...intents.values()].filter((i) =>
          ['quoted', 'awaiting_owner', 'processing'].includes(i.status),
        ),
        balanceHistory: [],
        activity: [
          {
            title: 'Received money',
            amount: 125,
            at: new Date().toISOString(),
            status: 'succeeded',
            direction: 'incoming',
          },
        ],
      });
      await context.route('**/api/**', async (route) => {
        const req = route.request(),
          pathname = new URL(req.url()).pathname,
          body = req.postData() ? JSON.parse(req.postData()) : {};
        calls.push({ pathname, method: req.method(), body });
        let result = {};
        if (pathname === '/api/belna-wallet') result = snapshot();
        else if(pathname==='/api/belna-wallet/bank')result=bank();
        else if(pathname==='/api/belna-wallet/bank/verify'){assert.equal(body.consent,true);result={step:'terms',url:'https://bridge.xyz/terms/fixture'};}
        else if(pathname==='/api/belna-wallet/bank/register'){assert.equal(body.consent,true);assert.equal(body.iban,'DE89370400440532013000');bankLinked=true;result=bank();}
        else if (pathname === '/api/wallet-preferences')
          result = {
            activeMethod: null,
            selectionSaved: true,
            methods: { saved_card: true, shop_pay: false, belna_wallet: false },
          };
        else if (pathname === '/api/belna-wallet/card-waitlist') {
          if (req.method() === 'POST') joined = true;
          result = { cardWaitlist: { joined } };
        } else if (pathname === '/api/shipping-addresses') result = { addresses: [] };
        else if (pathname === '/api/shop-pay')
          result = { shopPay: { configured: true, connected: false } };
        else if (pathname === '/api/belna-wallet/setup') {
          if(setupRateLimited)return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Too many requests'})});
          created = true;
          result = snapshot();
        } else if (pathname === '/api/belna-wallet/quote') {
          result = {
            quoteId: 'intent-' + ++sequence,
            kind: body.kind,
            recipient: body.kind==='bank_withdraw'?'Fixture bank ····3000 · EUR':body.recipient || 'Reviewed fixture vault',
            fiatAccountId:body.fiatAccountId||null,
            address: body.kind.startsWith('earn_') ? null : destination,
            amount: body.amount,
            status: 'quoted',
            asset: 'USDC',
            chainId: 8453,
            vaultId: body.kind.startsWith('earn_') ? 'fixture-vault' : null,
            fees: 'Network and provider fees may apply.',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          };
          intents.set(result.quoteId, result);
        } else if (pathname === '/api/belna-wallet/authorize') {
          result = { ...intents.get(body.quoteId), status: intents.get(body.quoteId)?.kind==='bank_withdraw'&&!bankSubmitted?'processing':'succeeded' };
          if(result.kind==='bank_withdraw')bankSubmitted=true;
          intents.set(result.quoteId, result);
        } else if (pathname === '/api/belna-wallet/cancel') {
          result = { ...intents.get(body.quoteId), status: 'canceled' };
          intents.set(result.quoteId, result);
        } else if (pathname === '/api/auth/me')
          result = { user: { id: 'alice', email: 'alice@example.test' } };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
      });
      const page = await context.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.setDefaultTimeout(7000);
      await context.route('https://bridge.xyz/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Fixture bank terms</h1>'}));
      const panel = page.locator('.wallet-panel'),
        ensurePanel = async () => {
          if (!(await panel.isVisible()))
            await page.locator('[data-act="togglecanvas"]:visible').first().click();
          await page.locator('[data-act="ctab"][data-t="wallet"]:visible').click();
        };
      await page.goto(base + '/app');
      await ensurePanel();
      await panel.getByRole('button', { name: 'Create Belna Wallet', exact: true }).waitFor();
      assert.ok(!/Whop/i.test(await panel.innerText()));
      await panel.getByRole('button', { name: 'Create Belna Wallet', exact: true }).click();
      assert.equal((await page.evaluate(() => window.privyCalls)).length, 0, 'country is required before connecting the wallet');
      await panel.getByLabel('Country you live in').selectOption('DK');
      await panel.getByRole('button', { name: 'Apply interest', exact: true }).click();
      await panel.getByText('Registered', { exact: true }).waitFor();
      assert.equal(joined, true, 'card interest works before wallet creation');
      assert.equal(await panel.getByLabel('Country you live in').inputValue(), 'DK', 'background wallet updates preserve the country');
      fs.mkdirSync(path.resolve('artifacts/privy-wallet'), { recursive: true });
      await panel.screenshot({ path: path.resolve(`artifacts/privy-wallet/country-${width}.png`) });
      const readsBeforeSetup=calls.filter(c=>c.pathname==='/api/belna-wallet').length;
      await panel.getByRole('button', { name: 'Create Belna Wallet', exact: true }).click();
      await panel.getByText('Your wallet connection is temporarily busy. Wait a minute, then try again.',{exact:true}).waitFor();
      assert.equal(calls.filter(c=>c.pathname==='/api/belna-wallet').length,readsBeforeSetup,'Failed setup does not trigger a read that clears the error');
      assert.equal(await panel.getByLabel('Country you live in').inputValue(),'DK','Failed setup preserves the selected country');
      setupRateLimited=false;
      await panel.getByRole('button', { name: 'Create Belna Wallet', exact: true }).click();
      await page.getByText('Your Belna Wallet is ready.', { exact: true }).waitFor();
      assert.deepEqual((await page.evaluate(() => window.privyCalls))[0], {
        action: 'setup',
        country: 'DK',
      });
      assert.equal(calls.find((c) => c.pathname === '/api/belna-wallet/setup').body.country, 'DK', 'selected country reaches wallet registration');
      await page.getByText('USD balance',{exact:true}).waitFor();
      assert.equal(await page.getByText('Receive USDC on Base',{exact:true}).count(),0);
      await page.getByRole('switch',{name:'Pause wallet transfers',exact:true}).waitFor();
      await page.getByText('24-hour transfer limit',{exact:true}).waitFor();
      assert.ok((await page.locator('#wallet-settings-content').innerText()).includes('deposit into Earn in any 24 hours'));
      await page.locator('#wallet-settings-content').screenshot({path:path.resolve('artifacts/privy-wallet/settings-'+width+'.png')});
      await page.locator('[data-act="wallet-open-panel"]:visible').click();
      await panel.getByRole('button', { name: 'Add money', exact: true }).waitFor();
      await panel.locator('.wl-balance').getByText('$125.00', { exact: true }).waitFor();
      assert.equal(await panel.getByRole('radio').count(), 0);
      const actionButtons = panel.locator('.wl-acts button');
      assert.deepEqual(await actionButtons.allTextContents(), ['Add money', 'Send', 'Withdraw', 'Earn']);
      const actionBounds = await actionButtons.evaluateAll((buttons) => buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width };
      }));
      assert.ok(actionBounds.every((bounds) => Math.abs(bounds.y - actionBounds[0].y) < 1), 'all four circles share one horizontal row');
      assert.ok(actionBounds.every((bounds) => bounds.x >= 0 && bounds.x + bounds.width <= width + 1), 'action row fits desktop and phone');
      assert.equal(await panel.getByRole('region', { name: 'Earn balance and options' }).count(), 0, 'Earn details live in its own view');
      await panel.getByRole('button', { name: 'Add money', exact: true }).click();
      await page
        .getByText('Check your wallet balance after your funding arrives.', { exact: true })
        .waitFor();
      assert.ok((await page.evaluate(() => window.privyCalls)).some((c) => c.action === 'fund'));
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Send USD', exact: true });
      assert.equal(await dialog.locator('.wallet-dialog-brand .belna-mark').count(),1);
      assert.equal(await dialog.evaluate(el=>getComputedStyle(el).borderRadius),'24px','Money dialogs match the funding card on desktop and mobile');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      assert.equal(sequence, 0, 'invalid drafts do not reach the server');
      assert.equal(await dialog.getByLabel('Belna email', { exact: true }).getAttribute('type'), 'email');
      assert.equal(await dialog.getByLabel('Belna email', { exact: true }).getAttribute('placeholder'), 'name@example.com');
      await dialog.getByLabel('Belna email', { exact: true }).fill(destination);
      await dialog.locator('#belna-wallet-send-amount').fill('5');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      assert.equal(sequence, 0, 'Send rejects direct wallet addresses');
      await dialog.locator('#belna-wallet-recipient').fill('friend@example.test');
      await dialog.locator('#belna-wallet-send-amount').fill('5');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Authorize $5.00 USD', exact: true }).waitFor();
      assert.equal(
        (await page.evaluate(() => window.privyCalls)).filter((c) => c.action === 'authorize')
          .length,
        0,
        'review cannot sign',
      );
      assert.ok((await dialog.innerText()).includes(destination));
      await dialog.locator('#belna-wallet-send-amount').fill('6');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).waitFor();
      assert.equal(
        await dialog.getByRole('button', { name: 'Authorize $5.00 USD', exact: true }).count(),
        0,
        'editing invalidates the quote',
      );
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Authorize $6.00 USD', exact: true }).click();
      await dialog.getByText(/USD.*Completed/).waitFor();
      assert.equal(
        calls.filter((c) => c.pathname === '/api/belna-wallet/authorize').length,
        1,
        'only the owner authorization submits the request',
      );
      fs.mkdirSync(path.resolve('artifacts/privy-wallet'), { recursive: true });
      await dialog.screenshot({ path: path.resolve(`artifacts/privy-wallet/send-${width}.png`) });
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await dialog.waitFor({ state: 'detached' });
      await panel.locator('[data-action="bank_withdraw"]').click();
      dialog = page.getByRole('dialog', { name: 'Withdraw to bank', exact: true });
      await dialog.getByText('Bank withdrawals are not enabled yet.', { exact: true }).waitFor();
      assert.equal(await dialog.locator('input').count(), 0, 'bank cash-out does not ask for a crypto address or bank details without a payout connection');
      assert.equal(await dialog.getByRole('button', { name: 'Review request', exact: true }).count(), 0);
      await dialog.screenshot({ path: path.resolve(`artifacts/privy-wallet/bank-${width}.png`) });
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Send USD', exact: true });
      await dialog.getByLabel('Belna email', { exact: true }).fill('friend@example.test');
      await dialog.locator('#belna-wallet-send-amount').fill('2');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Review request', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await panel.getByRole('button', { name: 'Earn', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Earn', exact: true });
      await dialog.getByText(/4.13% variable APY/).waitFor();
      assert.ok(!/USDC|Aave|Reviewed fixture vault/i.test(await dialog.innerText()));
      await dialog.screenshot({ path: path.resolve(`artifacts/privy-wallet/earn-${width}.png`) });
      await dialog.getByRole('button', { name: 'Deposit', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Deposit into Earn', exact: true });
      await dialog.locator('#belna-wallet-send-amount').fill('3');
      await dialog.locator('#wallet-earn-risk').check();
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.locator('#wallet-earn-risk').uncheck();
      await dialog.getByRole('button', { name: 'Authorize $3.00 USD', exact: true }).click();
      await dialog
        .getByText('Review and accept the Earn risks before authorizing.', { exact: true })
        .waitFor();
      assert.equal(calls.filter((c) => c.pathname === '/api/belna-wallet/authorize').length, 1);
      await dialog.locator('#wallet-earn-risk').check();
      await dialog.getByRole('button', { name: 'Authorize $3.00 USD', exact: true }).click();
      await dialog.getByText(/USD.*Completed/).waitFor();
      assert.ok(
        calls.some(
          (c) => c.pathname === '/api/belna-wallet/authorize' && c.body.riskAccepted === true,
        ),
      );
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await panel.getByRole('button', { name: 'Earn', exact: true }).waitFor();
      bankEnabled=true;
      await panel.getByRole('button',{name:'Wallet settings',exact:true}).click();
      await page.locator('[data-act="wallet-open-panel"]:visible').click();
      await panel.locator('[data-action="bank_withdraw"]').click();
      dialog=page.getByRole('dialog',{name:'Withdraw to bank',exact:true});
      await dialog.getByText('Verify your identity',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Start verification',exact:true}).click();
      await dialog.getByText('Approve sharing your wallet identity and email with Bridge first.',{exact:true}).waitFor();
      assert.equal(calls.filter(c=>c.pathname==='/api/belna-wallet/bank/verify').length,0);
      await dialog.locator('#wallet-bank-verify-consent').check();
      const popupPromise=page.waitForEvent('popup');
      await dialog.getByRole('button',{name:'Start verification',exact:true}).click();
      const verificationPopup=await popupPromise;
      await verificationPopup.waitForURL('https://bridge.xyz/terms/fixture');
      await dialog.getByRole('link',{name:'Review bank terms',exact:true}).waitFor();
      await dialog.getByText('Step 1 of 2 · Review bank terms',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Check status',exact:true}).click();
      await dialog.getByRole('button',{name:'Check status',exact:true}).waitFor({state:'visible'});
      await dialog.getByRole('link',{name:'Review bank terms',exact:true}).waitFor();
      await verificationPopup.close();
      bankReady=true;
      await dialog.getByRole('button',{name:'Check status',exact:true}).click();
      await dialog.getByLabel('Account holder name',{exact:true}).fill('Fixture Alice');
      await dialog.getByLabel('IBAN',{exact:true}).fill('DE89370400440532013000');
      await dialog.getByLabel('BIC / SWIFT code',{exact:true}).fill('COBADEFFXXX');
      await dialog.locator('#wallet-bank-consent').check();
      await dialog.getByRole('button',{name:'Link bank account',exact:true}).click();
      await dialog.getByLabel('Your bank account',{exact:true}).waitFor();
      assert.equal(await dialog.locator('#wallet-bank-iban').count(),0,'full bank details clear after linking');
      await dialog.locator('#belna-wallet-send-amount').fill('2');
      const authorizations=calls.filter(c=>c.pathname==='/api/belna-wallet/authorize').length;
      await dialog.getByRole('button',{name:'Review request',exact:true}).click();
      await dialog.getByRole('button',{name:'Authorize $2.00 USD',exact:true}).waitFor();
      assert.equal(calls.filter(c=>c.pathname==='/api/belna-wallet/authorize').length,authorizations);
      assert.ok((await dialog.innerText()).includes('EUR'));
      await dialog.getByRole('button',{name:'Authorize $2.00 USD',exact:true}).click();
      await dialog.getByRole('button',{name:'Check this request',exact:true}).waitFor();
      await dialog.screenshot({path:path.resolve(`artifacts/privy-wallet/bank-linked-${width}.png`)});
      await dialog.getByRole('button',{name:'Check this request',exact:true}).click();
      await dialog.getByText(/USD.*Completed/).waitFor();
      await dialog.getByRole('button',{name:'Close wallet action',exact:true}).click();
      await page
        .locator('#canvas')
        .screenshot({ path: path.resolve(`artifacts/privy-wallet/panel-${width}.png`) });
      const bounds = await panel.boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
        'wallet fits desktop and phone',
      );
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      await page.evaluate(() => {
        window.LingonAuth.set(null);
      });
      await page
        .getByRole('dialog', { name: 'Send USD', exact: true })
        .waitFor({ state: 'detached' });
      assert.equal(
        await page.locator('#belna-wallet-recipient').count(),
        0,
        'signout closes private owner dialogs',
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      'Privy wallet UI: desktop/mobile horizontal actions, email-only Send, bank availability, Earn view and risks, setup, funding, quote invalidation, cancel, card interest and signout passed',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
