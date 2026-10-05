const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
function functionSource(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source exists`);
  return source.slice(start, end);
}
const context = vm.createContext({
  window: {},
  fmtTokens: n => Number(n).toLocaleString('en-US'),
  fmtPlanTokens: n => Number(n).toLocaleString('en-US'),
  currentUser: () => ({ name: 'Guest' }),
  esc: value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  icon: () => '',
  fmtC: n => String(n),
  Mascot: { svg: () => '' },
});
vm.runInContext([
  functionSource('inAppleApp', 'invalidateBilling'),
  functionSource('creditView', 'pctOff'),
  functionSource('pctOff', 'billSummary'),
  functionSource('billSummary', 'billingLoadingHtml'),
  functionSource('billingLoadingHtml', 'paintBilling'),
  functionSource('usageCardHtml', 'paintGoals'),
  'this.view = { creditView, billSummary, billingBodyHtml, usageCardHtml, billingRequestBody };',
].join('\n'), context);

const billing = {
  plan: 'pro', status: 'active', planTokens: 100, planTokensUsed: 25,
  packTokens: 50, packTokensUsed: 10, tokens: 115,
  tokenPacks: [{ tokens: 10000000, millions: 10, usd: 10 }],
};
const view = context.view.creditView(billing);
context.billingOwner = 'owner';
context.billingIdentity = () => 'owner';
context.billingCache = { ...billing, plans: [], tokenPacks: [] };
assert.equal(view.percent, 25, 'extra grants do not change the monthly percentage');
assert.equal(view.remaining, 75);
assert.equal(view.extraRemaining, 40);

const tinyUsage={...billing,planTokens:50000000,planTokensUsed:1000,packTokens:0,packTokensUsed:0,tokens:49999000};
assert.match(context.view.usageCardHtml(tinyUsage),/&lt;1%<\/strong>/,'small real charges are visible instead of rounded to 0%');
assert.match(context.view.billSummary(tinyUsage),/&lt;1% used/);
assert.match(context.view.usageCardHtml({...billing,planTokensUsed:99.9,tokens:40.1}),/99%<\/strong>/,
  'a positive remaining balance is not shown as 100% exhausted');

const sidebar = context.view.usageCardHtml(billing);
assert.match(sidebar, /25%<\/strong>/);
assert.doesNotMatch(sidebar, /usage-caption|usage-meter-scale/, 'sidebar shows only the percentage');
assert.match(sidebar, /25 of 100 monthly tokens used/);
assert.match(sidebar, /width:25%/);
assert.doesNotMatch(sidebar, /of 150|extra tokens added/);

const summary = context.view.billSummary(billing);
const [monthly, extras] = summary.split('<section class="billing-extra-balance"');
assert.match(monthly, /aria-valuenow="25"/);
assert.match(monthly, /<strong>75<\/strong><span>of 100 left this month/);
assert.doesNotMatch(summary, /billing-token-breakdown|Monthly tokens used<\/dt>|Monthly tokens left|Monthly plan allowance|Extra tokens added|Extra tokens used/);
assert.match(extras, /billing-extra-total[^>]*><strong>40<\/strong>/);
assert.match(extras, /Add token pack/);
assert.match(extras, /id="buypack"/);
assert.match(extras, /data-act="buycredits"/);
assert.equal((extras.match(/<\/section>/g) || []).length, 1, 'extra balance and pack picker share one card');
assert.doesNotMatch(summary, /billing-add-tokens/);

const billingPage = context.view.billingBodyHtml('billing');
const usagePage = context.view.billingBodyHtml('usage');
assert.match(billingPage, /billing-plans|Plans/);
assert.match(billingPage, /Open billing portal/);
assert.doesNotMatch(billingPage, /billing-extra-balance|giftcode|buypack/);
assert.match(usagePage, /billing-extra-balance|Extra tokens/);
assert.match(usagePage, /giftcode/);
assert.doesNotMatch(usagePage, /billing-plans|Open billing portal/);

const depleted = context.view.creditView({ ...billing, planTokensUsed: 100, packTokensUsed: 10 });
assert.equal(depleted.percent, 100);
assert.equal(depleted.remaining, 0);
assert.equal(depleted.extraRemaining, 40);
assert.match(context.view.billSummary({ ...billing, planTokensUsed: 100 }), /Your extra tokens are still available/);

const withDebt = context.view.creditView({ ...billing, tokens: 25 });
assert.equal(withDebt.percent, 100, 'outstanding usage consumes the next available plan tokens');
assert.equal(withDebt.extraUsed, 25);
assert.equal(withDebt.extraRemaining, 25, 'extra tokens left reflects spendable balance after debt');

// Apple app: no purchase buttons until the App Store storefront allows paying in the browser.
const buying = /data-act="(?:buycredits|checkout|portal|upgrade)"/;
context.billingCache = { ...billing, plans: [], tokenPacks: [{ tokens: 10000000, millions: 10, usd: 10 }] };
context.window.BelnaApple = { available: true, platform: 'ios', browserPurchases: () => false };
for (const tab of ['billing', 'usage']) {
  const page = context.view.billingBodyHtml(tab);
  assert.match(page, /does not sell digital subscriptions or token packs/);
  assert.doesNotMatch(page, buying, 'storefronts without link-out show no purchase buttons');
  assert.doesNotMatch(page, /billing-plans|buypack/);
}
context.window.BelnaApple = { available: true, platform: 'ios', browserPurchases: () => true };
const appBilling = context.view.billingBodyHtml('billing'), appUsage = context.view.billingBodyHtml('usage');
assert.match(appBilling, /Checkout opens in Safari/);
assert.match(appBilling, /Manage in Safari/);
assert.match(appUsage, /data-act="buycredits"[^>]*>[^<]*Pay in Safari/);
assert.match(appUsage, /secure checkout in Safari/);
assert.equal(JSON.parse(context.view.billingRequestBody({ plan: 'pro' })).returnTo, 'app', 'checkouts return to the app');
context.window.BelnaApple = { available: true, platform: 'mac', browserPurchases: () => true };
assert.match(context.view.billingBodyHtml('usage'), /Pay in browser/);
delete context.window.BelnaApple;
assert.equal(JSON.parse(context.view.billingRequestBody({ plan: 'pro' })).returnTo, undefined);

console.log('billing presentation: monthly meter and extra balance stay separate, Apple app pays only in the browser where allowed: ok');
