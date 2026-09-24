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
  fmtTokens: n => Number(n).toLocaleString('en-US'),
  currentUser: () => ({ name: 'Guest' }),
  esc: value => String(value),
  icon: () => '',
  Mascot: { svg: () => '' },
});
vm.runInContext([
  functionSource('creditView', 'pctOff'),
  functionSource('billSummary', 'billingLoadingHtml'),
  functionSource('usageCardHtml', 'paintGoals'),
  'this.view = { creditView, billSummary, usageCardHtml };',
].join('\n'), context);

const billing = {
  plan: 'pro', status: 'active', planTokens: 100, planTokensUsed: 25,
  packTokens: 50, packTokensUsed: 10, tokens: 115,
};
const view = context.view.creditView(billing);
assert.equal(view.percent, 25, 'extra grants do not change the monthly percentage');
assert.equal(view.remaining, 75);
assert.equal(view.extraRemaining, 40);

const sidebar = context.view.usageCardHtml(billing);
assert.match(sidebar, /25%<\/strong><span>monthly plan used/);
assert.match(sidebar, /25 of 100 monthly tokens used/);
assert.match(sidebar, /width:25%/);
assert.doesNotMatch(sidebar, /of 150|extra tokens added/);

const summary = context.view.billSummary(billing);
const [monthly, extras] = summary.split('<section class="billing-extra-balance"');
assert.match(monthly, /Monthly tokens used<\/dt><dd>25/);
assert.match(monthly, /Monthly tokens left<\/dt><dd>75/);
assert.match(monthly, /Monthly plan allowance<\/dt><dd>100/);
assert.doesNotMatch(monthly, /Extra tokens added/);
assert.match(extras, /Extra tokens added<\/dt><dd>50/);
assert.match(extras, /Extra tokens used<\/dt><dd>10/);
assert.match(extras, /Extra tokens left<\/dt><dd>40/);

const depleted = context.view.creditView({ ...billing, planTokensUsed: 100, packTokensUsed: 10 });
assert.equal(depleted.percent, 100);
assert.equal(depleted.remaining, 0);
assert.equal(depleted.extraRemaining, 40);
assert.match(context.view.billSummary({ ...billing, planTokensUsed: 100 }), /Your extra tokens are still available/);

const withDebt = context.view.creditView({ ...billing, tokens: 25 });
assert.equal(withDebt.percent, 100, 'outstanding usage consumes the next available plan tokens');
assert.equal(withDebt.extraUsed, 25);
assert.equal(withDebt.extraRemaining, 25, 'extra tokens left reflects spendable balance after debt');

console.log('billing presentation: monthly meter and extra balance stay separate: ok');
