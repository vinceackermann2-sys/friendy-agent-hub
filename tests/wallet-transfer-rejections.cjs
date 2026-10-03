const assert = require('node:assert/strict');
const {createBelnaWalletStore} = require('../server/belna-wallet-store');

(async () => {
  const edge = await import('../src/lingon-server/belna-wallet-store.js');
  for (const createStore of [createBelnaWalletStore, edge.createBelnaWalletStore]) {
    let rpcResult;
    const store = createStore({supa:() => ({rpc:async (name, args) => {
      assert.equal(name, 'begin_belna_wallet_transfer');
      assert.deepEqual(args, {p_user_id:'owner', p_id:'original-quote'});
      return rpcResult;
    }}), ensureProfile:async () => {}});
    for (const message of ['QUOTE_NOT_FOUND', 'QUOTE_EXPIRED', 'TRANSFER_LIMIT']) {
      rpcResult = {error:{code:'P0001', message}};
      await assert.rejects(store.beginBelnaWalletTransfer('owner', 'original-quote'), error =>
        error.code === 'BAD_INPUT' && error.transferNotStarted === true);
    }
    for (const error of [{code:'P0001', message:'unexpected database failure'},
      {code:'57014', message:'QUOTE_EXPIRED'}, {message:'Failed to fetch'},
      {code:'P0001', message:'TRANSFER_LIMIT extra text'}]) {
      rpcResult = {error};
      await assert.rejects(store.beginBelnaWalletTransfer('owner', 'original-quote'), error =>
        error.code === 'WALLET_STORE' && error.transferNotStarted !== true);
    }
    rpcResult = {data:{status:'processing'}};
    assert.deepEqual(await store.beginBelnaWalletTransfer('owner', 'original-quote'), {status:'processing'});
  }
  console.log('Wallet transfer rejection: exact SQL refusals release the draft; unexpected failures retain the original quote in both runtimes');
})().catch(error => {console.error(error); process.exitCode = 1;});
