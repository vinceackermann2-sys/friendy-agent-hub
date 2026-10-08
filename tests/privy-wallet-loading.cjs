const assert = require('node:assert/strict');
const { createPrivyWallet, BASE_USDC } = require('../server/privy-wallet');

(async () => {
  const started = new Set();
  let releaseBalance, reads = 0;
  const balanceGate = new Promise(resolve => { releaseBalance = resolve; });
  const row = {user_id:'alice',wallet_id:'wallet_alice',privy_user_id:'did:privy:alice',address:'0x'+'a'.repeat(40),country:'SE',daily_limit_usd:50,paused:false};
  const store = {
    supaConfigured:()=>true,
    getPrivyWallet:async()=>{reads++;return row;},
    getBelnaWallet:async()=>({wallet_kind:'personal',account_id:'legacy'}),
    listPrivyIntents:async()=>{started.add('requests');return [];},
    recordPrivyBalance:async(_,amount)=>{assert.equal(amount,12);return [];},
  };
  const wallet = createPrivyWallet({store,
    env:{PRIVY_APP_ID:'fixture',PRIVY_APP_SECRET:'fixture',PRIVY_EARN_ENABLED:'true',PRIVY_EARN_VAULT_ID:'vault_fixture'},
    readBalance:async()=>{started.add('balance');return balanceGate;},
    fetchImpl:async url=>{
      let data;
      if(url.includes('/transactions?')) {started.add('activity');data={transactions:[]};}
      else if(url.endsWith('/v1/earn/ethereum/vaults/vault_fixture')) {
        started.add('earn');data={id:'vault_fixture',caip2:'eip155:8453',asset:{address:BASE_USDC,decimals:6},user_apy:400};
      } else if(url.includes('/earn/ethereum/vaults?vault_id=')) data={asset:{address:BASE_USDC,decimals:6},assets_in_vault:'0',total_deposited:'0',total_withdrawn:'0'};
      else throw Error('Unexpected read');
      return {ok:true,json:async()=>data};
    },
  });
  const pending = wallet.snapshot('alice');
  // A deliberately blocked balance must not block independent wallet reads.
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...started].sort(),['activity','balance','earn','requests']);
  assert.equal(reads,1,'The owner row is loaded once per snapshot');
  releaseBalance(12);
  const result = await pending;
  assert.equal(result.wallet.balance.available,12);
  assert.equal(result.wallet.legacyWallet,true);
  assert.equal(result.earn.available,true);

  const unavailable = createPrivyWallet({store:{...store,getPrivyWallet:async()=>({...row,user_id:'bob'})},
    env:{PRIVY_APP_ID:'fixture',PRIVY_APP_SECRET:'fixture'},
    readBalance:async()=>{throw Error('Must not read a different owner');},
  });
  await assert.rejects(unavailable.snapshot('alice'),/Create your Belna Wallet/);
  console.log('Wallet loading: independent reads overlap, owner lookup is reused, balances stay live and owner isolation holds');
})().catch(error=>{console.error(error);process.exitCode=1;});
