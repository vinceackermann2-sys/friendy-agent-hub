const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

// Exercise the real browser bridge and Belna form with a fixture SDK. No OTPs
// are sent, provider records created, signing keys exported, or money moved.
const fixture = `
import React, { useSyncExternalStore } from 'react';
let snapshot = { ready:true, authenticated:false, user:null };
const listeners = new Set();
const update = (next) => { snapshot={...snapshot,...next}; for(const fn of listeners)fn(); };
const subscribe = (fn) => { listeners.add(fn); return ()=>listeners.delete(fn); };
const get = ()=>snapshot;
const account = email => ({id:'did:privy:fixture', linkedAccounts:[{type:'email',address:email}]});
window.sdkFixture={calls:[], failSend:false, failIdentity:false, holdVerify:false, release:null, signIn(email){update({authenticated:true,user:account(email)});}};
const logout = async()=> {window.sdkFixture.calls.push({action:'logout'});update({authenticated:false,user:null});};
const sendCode = async ({email}) => {window.sdkFixture.calls.push({action:'send',email});window.sdkFixture.email=email;if(window.sdkFixture.failSend)throw Error('fixture');};
const loginWithCode = async ({code}) => {
  window.sdkFixture.calls.push({action:'verify'});
  if(window.sdkFixture.holdVerify)await new Promise(r=>{window.sdkFixture.release=r;});
  if(code!=='123456')throw Error('fixture invalid code');
  update({authenticated:true,user:account(window.sdkFixture.email)});
};
const createWallet = async()=> {window.sdkFixture.calls.push({action:'create'});const wallet={type:'wallet',walletClientType:'privy',chainType:'ethereum',id:'wallet-fixture',address:'0x'+'a'.repeat(40)};update({user:{...snapshot.user,linkedAccounts:[...snapshot.user.linkedAccounts,wallet]}});return wallet;};
// getIdentityToken refreshes this same provider endpoint. A separate refresh
// within setup is redundant and can trigger the production rate limit.
const refreshUser = async()=>{throw Error('Too many requests from duplicate identity refresh');};
const addFunds = async(options)=>{window.sdkFixture.funding=options;return {method:'fiat',status:'confirmed'};};
const exportWallet = async()=>{};
const generateAuthorizationSignature = async()=>{throw Error('Fixture cannot sign');};
export const PrivyProvider = ({children})=><>{children}<a id="protected-by-privy" href="https://privy.io">Vendor watermark fixture</a></>;
export const usePrivy = ()=>({...useSyncExternalStore(subscribe,get),logout});
export const useLoginWithEmail = ()=>({sendCode,loginWithCode});
export const useCreateWallet = ()=>({createWallet});
export const useUser = ()=>({refreshUser});
export const useAuthorizationSignature = ()=>({generateAuthorizationSignature});
export const useDepositFunds = ()=>({depositFunds:addFunds});
export const useExportWallet = ()=>({exportWallet});
export const getIdentityToken = async()=>{window.sdkFixture.calls.push({action:'identity'});if(window.sdkFixture.failIdentity)throw Error('Too many requests');return 'fixture-identity';};
export const useSyncJwtBasedAuthState = ()=>{};
`;

(async () => {
  const built = await build({
    entryPoints: ["app/wallet/privy-entry.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fixture-sdk",
        setup(b) {
          b.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({
            path: "sdk",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: fixture,
            loader: "jsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="background:#f4eeeb;font-family:sans-serif"><button id="start">Open wallet</button><script>
    let session={user:{id:'alice',email:'alice@example.test'}};
    window.LingonConfig={apiBase:''};window.setupCalls=[];window.result=null;
    window.LingonAuth={get:()=>session,api:async(url,opts)=>{if(!opts)return {wallet:{walletId:'wallet-fixture',address:'0x'+'a'.repeat(40)}};window.setupCalls.push({url,body:JSON.parse(opts.body)});return {status:'ready'};}};
    window.switchOwner=(id,email)=>{session={user:{id,email}};window.dispatchEvent(new Event('belna-auth-changed'));};
    document.getElementById('start').onclick=()=>{window.result='pending';window.BelnaPrivy.setup('SE').then(()=>{window.result='ready'},e=>{window.result=e.message});};
  </script><script src="/wallet.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/belna-wallet/config") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ appId: "fixture-app", authMode: "email", configured: true }));
    }
    if (req.url === "/wallet.js") {
      res.setHeader("content-type", "text/javascript");
      return res.end(built.outputFiles[0].contents);
    }
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const url = "http://127.0.0.1:" + server.address().port;
      await page.goto(url);
      await page.evaluate(()=>window.BelnaPrivy.warm());
      assert.equal(await page.getByRole('dialog').count(),0,'SDK warming does not open login');
      assert.equal(await page.evaluate(()=>sdkFixture.calls.length),0,'SDK warming does not send email, create wallets or sign');
      await page.click("#start");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.getByText("alice@example.test", { exact: true }).count(), 1);
      assert.equal(
        await dialog.locator("input[type=email]").count(),
        0,
        "Owner email cannot be edited",
      );
      assert.equal(
        await dialog.innerText().then((t) => /privy/i.test(t)),
        false,
        "No vendor login branding",
      );
      assert.equal(
        await page.locator("#protected-by-privy").isVisible(),
        false,
        "SDK watermark is whitelabeled",
      );
      assert.equal(
        await page.evaluate(() => sdkFixture.calls.length),
        0,
        "Opening the dialog does not send an email",
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => /cancelled/.test(window.result));
      assert.equal(await dialog.count(), 0);
      await page.click("#start");
      await dialog.waitFor();
      await page.evaluate(() => {
        sdkFixture.failSend = true;
      });
      await dialog.getByRole("button", { name: "Send verification code" }).click();
      await dialog.getByRole("alert").waitFor();
      await page.evaluate(() => {
        sdkFixture.failSend = false;
      });
      await dialog.getByRole("button", { name: "Send verification code" }).click();
      await dialog.getByLabel("Email code").fill("000000");
      await dialog.getByRole("button", { name: "Verify and continue" }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await page.evaluate(() => setupCalls.length),
        0,
        "Invalid code cannot create a wallet",
      );
      await page.evaluate(() => window.dispatchEvent(new Event('belna-auth-changed')));
      assert.equal(await dialog.count(), 1, 'Same-owner token refresh preserves verification');
      await dialog.getByRole("button", { name: "Send a new code" }).click();
      await page.waitForFunction(
        () => document.querySelector("#belna-wallet-email-code").value === "",
      );
      const rect = await dialog.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, "Dialog fits viewport");
      fs.mkdirSync(path.resolve("artifacts/privy-wallet"), { recursive: true });
      await page.screenshot({
        path: path.resolve("artifacts/privy-wallet/belna-email-" + width + ".png"),
      });
      await dialog.getByLabel("Email code").fill("123456");
      await dialog.getByRole("button", { name: "Verify and continue" }).click();
      await page.waitForFunction(() => window.result === "ready");
      assert.equal(await dialog.count(), 0);
      assert.deepEqual(await page.evaluate(() => setupCalls[0]), {
        url: "/api/belna-wallet/setup",
        body: { country: "SE", walletId: "wallet-fixture", identityToken: "fixture-identity" },
      });
      assert.equal(await page.evaluate(() => sdkFixture.calls.filter(c=>c.action==='identity').length), 1, 'New wallet needs only one identity refresh');
      await page.evaluate(()=>window.BelnaPrivy.fund());
      const funding=await page.evaluate(()=>sdkFixture.funding);
      assert.deepEqual(funding.fiat.source.assets,['eur','usd']);
      assert.equal(funding.fiat.environment,'production');
      assert.equal(funding.destination.wallet,'wallet-fixture');assert.equal(funding.destination.chain,'eip155:8453');
      assert.equal('crypto' in funding,false,'unsupported crypto and SEK funding options are not offered');
      assert.equal(await page.evaluate(()=>document.body.classList.contains('belna-wallet-funding')),false,'Funding cleanup restores the app');
      const wrongDestination=await page.evaluate(()=>window.BelnaPrivy.fund({walletId:'wallet-other',address:'0x'+'b'.repeat(40)}).then(()=>null,e=>e.message));
      assert.match(wrongDestination,/destination could not be verified/,'Funding cannot target another wallet');
      await page.evaluate(() => {sdkFixture.failIdentity=true;});
      await page.click("#start");
      await page.waitForFunction(() => /Too many requests/.test(window.result));
      assert.equal(await page.evaluate(() => setupCalls.length), 1, 'Failed identity refresh cannot register a wallet');
      await page.evaluate(() => {sdkFixture.failIdentity=false;});
      await page.click("#start");
      await page.waitForFunction(() => window.result === "ready");
      assert.equal(await page.evaluate(() => sdkFixture.calls.filter(c=>c.action==='create').length), 1, 'Retry reuses the wallet created before registration');
      assert.equal(await page.evaluate(() => sdkFixture.calls.filter(c=>c.action==='identity').length), 3, 'Existing wallet and retry each use one identity refresh');
      assert.equal(
        await page.evaluate(() => sdkFixture.calls.filter((c) => c.action === "send").length),
        3,
        "Connected owner does not reverify",
      );

      // A mismatched provider login is replaced; changing Belna owner while OTP
      // submission is in flight closes the form and cannot register a wallet.
      await page.goto(url);
      await page.click("#start");
      await dialog.waitFor();
      await page.evaluate(() => sdkFixture.signIn("other@example.test"));
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForFunction(() => /cancelled/.test(window.result));
      await page.click("#start");
      await dialog.waitFor();
      assert.equal(
        await page.evaluate(() => sdkFixture.calls.some((c) => c.action === "logout")),
        true,
      );
      await dialog.getByRole("button", { name: "Send verification code" }).click();
      await dialog.getByLabel("Email code").fill("123456");
      await page.evaluate(() => {
        sdkFixture.holdVerify = true;
      });
      await dialog.getByRole("button", { name: "Verify and continue" }).click();
      await page.waitForFunction(() => !!sdkFixture.release);
      await page.evaluate(() => {
        switchOwner("bob", "bob@example.test");
        sdkFixture.release();
      });
      await page.waitForFunction(() => /account changed/.test(window.result));
      assert.equal(await dialog.count(), 0);
      assert.equal(
        await page.evaluate(() => setupCalls.length),
        0,
        "Stale owner cannot create a wallet",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Belna email wallet UI passed: desktop/mobile, retries, cancellation, owner binding, account switching, and no Privy login modal.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
