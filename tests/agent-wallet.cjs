const assert = require('node:assert/strict');
const { pickTools } = require('../server/agents/tools');
const privy = require('../server/privy');
const issuing = require('../server/issuing');

async function main() {
  assert.equal(privy.configured(), false);
  assert.equal(issuing.configured(), !!String(process.env.STRIPE_SECRET_KEY || '').trim());
  assert.match(privy.externalIdFor('user-123!'), /^b_[a-f0-9]{40}$/);
  assert.notEqual(privy.externalIdFor('user-a'), privy.externalIdFor('user-b'));
  assert.equal(privy.externalIdFor('user-a'), privy.externalIdFor('user-a'));
  assert.throws(() => privy.externalIdFor(''), /Signed-in/);
  assert.doesNotThrow(() => privy.assertAddress('0x' + '11'.repeat(20)));
  assert.throws(() => privy.assertAddress('not-an-address'), /0x/);
  assert.equal(privy.toRaw('1.5', 6).toString(), '1500000');
  assert.match(privy.encodeErc20Transfer('0x' + '22'.repeat(20), 1000000n), /^0xa9059cbb/);

  const pub = privy.publicWallet(null);
  assert.equal(pub.address, null);
  assert.equal(pub.card.status, 'none');
  assert.ok(!JSON.stringify(pub).includes('secret'));
  assert.ok(!JSON.stringify(pub).includes('private'));

  const names = pickTools('buy something with my card').map((t) => t.name);
  assert.ok(names.includes('wallet_status'));
  assert.ok(names.includes('wallet_transfer'));
  assert.ok(names.includes('wallet_purchase'));
  assert.equal(pickTools('buy something with my card').find((t) => t.name === 'wallet_purchase').approval, true);

  try {
    await privy.transfer('user_test', { to: '0x' + '11'.repeat(20), amount: 1, asset: 'usdc', confirm: false });
    assert.fail('expected confirm gate');
  } catch (e) {
    assert.equal(e.code, 'NEED_CONFIRM');
  }

  try {
    await privy.purchase('user_test', { amount: 12, merchant: 'Cafe', method: 'card', confirm: false });
    assert.fail('expected purchase confirm gate');
  } catch (e) {
    assert.equal(e.code, 'NEED_CONFIRM');
  }

  console.log('agent wallet: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
