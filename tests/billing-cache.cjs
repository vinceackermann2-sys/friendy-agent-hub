const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const start = source.indexOf('let billingCache = null;');
const end = source.indexOf('function fmtC(n)', start);
assert.ok(start >= 0 && end > start);

let session = { access_token: 'token-a', user: { id: 'user-a' } };
const pending = [];
const timers = [];
const sidebar = {innerHTML:'',dataset:{}};
const window = {
  LingonAuth: {
    get: () => session,
    api: (path) => {
      assert.equal(path, '/api/billing');
      return new Promise((resolve) => pending.push(resolve));
    },
  },
};
const context = vm.createContext({ window, Date, setTimeout:fn=>{timers.push(fn);return timers.length;},
  $:selector=>selector==='#usagecard'?sidebar:null, usageCardHtml:b=>'balance '+b.credits });
vm.runInContext(source.slice(start, end) + '\nthis.billing = { getBilling, invalidateBilling, setBillingCache, refreshBillingUsage };', context);

(async () => {
  const first = context.billing.getBilling();
  const duplicate = context.billing.getBilling();
  assert.equal(pending.length, 1, 'concurrent sidebar and billing reads should share a request');
  pending.shift()({ credits: 20 });
  assert.equal((await first).credits, 20);
  assert.equal((await duplicate).credits, 20);
  assert.equal((await context.billing.getBilling()).credits, 20);
  assert.equal(pending.length, 0, 'fresh balance should be served from cache');

  context.billing.invalidateBilling();
  const refreshed = context.billing.getBilling();
  assert.equal(pending.length, 1);
  session = { access_token: 'token-b', user: { id: 'user-b' } };
  const otherUser = context.billing.getBilling();
  assert.equal(pending.length, 2);
  pending.shift()({ credits: 19 });
  pending.shift()({ credits: 50 });
  assert.equal(await refreshed, null, 'old account response must not reach the new account');
  assert.equal((await otherUser).credits, 50);
  assert.equal((await context.billing.getBilling()).credits, 50);

  context.billing.invalidateBilling();
  const stale = context.billing.getBilling();
  context.billing.refreshBillingUsage();
  context.billing.refreshBillingUsage();
  assert.equal(timers.length,1,'a burst of usage events schedules one refresh');
  timers.shift()();
  assert.equal(pending.length,2,'a refresh replaces a read started before the charge');
  const oldReply=pending.shift(), newReply=pending.shift();
  newReply({credits:45});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sidebar.innerHTML,'balance 45');
  oldReply({credits:50});
  assert.equal(await stale,null,'a pre-charge response cannot restore the old balance');
  assert.equal((await context.billing.getBilling()).credits,45);
  context.billing.refreshBillingUsage();
  session={access_token:'token-c',user:{id:'user-c'}};
  timers.shift()();
  assert.equal(pending.length,0,'a scheduled refresh cannot fetch for a different account');
  console.log('billing cache: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
