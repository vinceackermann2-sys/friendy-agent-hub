const assert = require('node:assert/strict');
const Module = require('node:module');

async function withStore(client, run) {
  const oldLoad = Module._load;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  Module._load = function (name, parent, isMain) {
    if (name === '@supabase/supabase-js') return { createClient: () => client };
    return oldLoad.call(this, name, parent, isMain);
  };
  const file = require.resolve('../server/store.js');
  delete require.cache[file];
  try { await run(require(file)); }
  finally {
    Module._load = oldLoad;
    delete require.cache[file];
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
}

(async () => {
  let rpcCalls = 0;
  await withStore({
    rpc(name, args) {
      rpcCalls++;
      assert.equal(name, 'billing_totals');
      assert.deepEqual(args, { p_user_id: 'user-a' });
      return { data: [{ granted: 1210, used: 16, gift_granted: 10, gifts_usd: 5 }], error: null };
    },
    from() { throw new Error('Summary RPC should not transfer ledger rows'); },
  }, async (store) => {
    assert.deepEqual(await store.billingTotals('user-a'), { granted: 1210, used: 16, giftGranted: 10, giftsUsd: 5 });
    assert.equal(rpcCalls, 1);
  });

  const rows = {
    credit_grants: [
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `grant-${String(i).padStart(4, '0')}`, user_id: 'user-a', credits: 1, reason: 'monthly' })),
      { id: 'grant-1200', user_id: 'user-a', credits: 10, reason: 'gift_redeem' },
      { id: 'other-grant', user_id: 'user-b', credits: 999, reason: 'monthly' },
    ],
    api_usage: [
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `usage-${String(i).padStart(4, '0')}`, user_id: 'user-a', cost_usd: 0.002, credits_charged: 0.01 })),
      { id: 'usage-1200', user_id: 'user-a', cost_usd: 2, credits_charged: null },
      { id: 'other-usage', user_id: 'user-b', cost_usd: 999, credits_charged: 999 },
    ],
    gift_cards: [{ code: 'gift-a', redeemed_by: 'user-a', amount_usd: 5 }, { code: 'gift-b', redeemed_by: 'user-b', amount_usd: 999 }],
  };
  let pages = 0;
  await withStore({
    rpc() { return { data: null, error: { code: 'PGRST202' } }; },
    from(table) {
      return {
        select() { return this; },
        eq(key, value) {
          this.selected = rows[table].filter((row) => row[key] === value);
          return this;
        },
        order(key) { this.orderKey = key; return this; },
        limit(n) { this.pageSize = n; return this; },
        gt(key, value) { this.cursorKey = key; this.cursor = value; return this; },
        then(resolve, reject) {
          pages++;
          const selected = this.selected
            .filter((row) => this.cursor === undefined || row[this.cursorKey] > this.cursor)
            .sort((a, b) => a[this.orderKey].localeCompare(b[this.orderKey]));
          return Promise.resolve({ data: selected.slice(0, this.pageSize), error: null }).then(resolve, reject);
        },
      };
    },
  }, async (store) => {
    const totals = await store.billingTotals('user-a');
    assert.equal(totals.granted, 1210);
    assert.equal(totals.giftGranted, 10);
    assert.equal(totals.giftsUsd, 5);
    assert.ok(Math.abs(totals.used - 16) < 1e-8);
    assert.equal(pages, 5, 'Fallback must read past the first 1000 rows');
  });
  console.log('billing totals: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
