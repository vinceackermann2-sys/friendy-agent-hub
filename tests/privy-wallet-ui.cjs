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
        joined = false,
        sequence = 0;
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
      });
      const snapshot = () => ({
        wallet: wallet(),
        earn: {
          available: true,
          name: 'Reviewed fixture vault',
          apy: 4.13,
          position: { available: 5 },
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
          created = true;
          result = snapshot();
        } else if (pathname === '/api/belna-wallet/quote') {
          result = {
            quoteId: 'intent-' + ++sequence,
            kind: body.kind,
            recipient: body.recipient || 'Reviewed fixture vault',
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
          result = { ...intents.get(body.quoteId), status: 'succeeded' };
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
      await panel.getByRole('button', { name: 'Create Belna Wallet', exact: true }).click();
      await page.getByText('Your user-owned USDC wallet is ready.', { exact: true }).waitFor();
      assert.deepEqual((await page.evaluate(() => window.privyCalls))[0], {
        action: 'setup',
        country: 'DK',
      });
      assert.equal(calls.find((c) => c.pathname === '/api/belna-wallet/setup').body.country, 'DK', 'selected country reaches wallet registration');
      await page.locator('[data-act="wallet-open-panel"]:visible').click();
      await panel.getByRole('button', { name: 'Add money', exact: true }).waitFor();
      await panel.locator('.wl-balance').getByText('$125.00', { exact: true }).waitFor();
      assert.equal(await panel.getByRole('radio').count(), 0);
      await panel.getByRole('button', { name: 'Add money', exact: true }).click();
      await page
        .getByText('Check your wallet balance after your funding arrives.', { exact: true })
        .waitFor();
      assert.ok((await page.evaluate(() => window.privyCalls)).some((c) => c.action === 'fund'));
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Send USDC', exact: true });
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      assert.equal(sequence, 0, 'invalid drafts do not reach the server');
      await dialog.locator('#belna-wallet-recipient').fill('friend@example.test');
      await dialog.locator('#belna-wallet-send-amount').fill('5');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Authorize $5.00 USDC', exact: true }).waitFor();
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
        await dialog.getByRole('button', { name: 'Authorize $5.00 USDC', exact: true }).count(),
        0,
        'editing invalidates the quote',
      );
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Authorize $6.00 USDC', exact: true }).click();
      await dialog.getByText(/USDC.*Completed/).waitFor();
      assert.equal(
        calls.filter((c) => c.pathname === '/api/belna-wallet/authorize').length,
        1,
        'only the owner authorization submits the request',
      );
      fs.mkdirSync(path.resolve('artifacts/privy-wallet'), { recursive: true });
      await dialog.screenshot({ path: path.resolve(`artifacts/privy-wallet/send-${width}.png`) });
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await dialog.waitFor({ state: 'detached' });
      await panel.locator('[data-action="withdraw"]').click();
      dialog = page.getByRole('dialog', { name: 'Withdraw USDC', exact: true });
      await dialog.getByText(/Direct bank withdrawals are not enabled/).waitFor();
      await dialog.locator('#belna-wallet-recipient').fill(destination);
      await dialog.locator('#belna-wallet-send-amount').fill('2');
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel request', exact: true }).click();
      await dialog.getByRole('button', { name: 'Review request', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await panel.locator('[data-action="earn_deposit"]').click();
      dialog = page.getByRole('dialog', { name: 'Deposit into Earn', exact: true });
      await dialog.locator('#belna-wallet-send-amount').fill('3');
      await dialog.locator('#wallet-earn-risk').check();
      await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
      await dialog.locator('#wallet-earn-risk').uncheck();
      await dialog.getByRole('button', { name: 'Authorize $3.00 USDC', exact: true }).click();
      await dialog
        .getByText('Review and accept the Earn risks before authorizing.', { exact: true })
        .waitFor();
      assert.equal(calls.filter((c) => c.pathname === '/api/belna-wallet/authorize').length, 1);
      await dialog.locator('#wallet-earn-risk').check();
      await dialog.getByRole('button', { name: 'Authorize $3.00 USDC', exact: true }).click();
      await dialog.getByText(/USDC.*Completed/).waitFor();
      assert.ok(
        calls.some(
          (c) => c.pathname === '/api/belna-wallet/authorize' && c.body.riskAccepted === true,
        ),
      );
      await dialog.getByRole('button', { name: 'Close wallet action' }).click();
      await panel.getByText(/4.13% variable APY/).waitFor();
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
        .getByRole('dialog', { name: 'Send USDC', exact: true })
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
      'Privy wallet UI: desktop/mobile setup, funding, exact transfer review, quote invalidation, Earn risks, cancel, card interest and signout passed',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
