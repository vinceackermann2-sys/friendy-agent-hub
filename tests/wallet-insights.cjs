const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createBelnaWalletStore}=require('../server/belna-wallet-store');
const {createBusinessWallet}=require('../server/belna-wallet');

(async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);create table belna_wallets(user_id text primary key references profiles(id) on delete cascade,account_id text,environment text);insert into profiles values('alice'),('bob');insert into belna_wallets values('alice','biz_alice','live'),('bob','biz_bob','live');");
    const migration=fs.readFileSync('supabase/migrations/20261002103000_wallet_history_and_card_waitlist.sql','utf8');
    await db.exec(migration);await db.exec(migration);
    const supa={
      from:table=>{
        assert.equal(table,'belna_card_waitlist');
        return {
          select:columns=>{assert.equal(columns,'created_at');return {eq:(column,id)=>{assert.equal(column,'user_id');return {maybeSingle:async()=>({data:(await db.query('select created_at from belna_card_waitlist where user_id=$1',[id])).rows[0] || null})};}};},
          upsert:async(row,options)=>{assert.deepEqual(options,{onConflict:'user_id',ignoreDuplicates:true});await db.query('insert into belna_card_waitlist(user_id) values($1) on conflict do nothing',[row.user_id]);return {data:null};}
        };
      },
      rpc:async(name,input)=>{assert.equal(name,'record_belna_wallet_balance');return {data:(await db.query('select record_belna_wallet_balance($1,$2,$3,$4,$5) as points',[input.p_user_id,input.p_account_id,input.p_environment,input.p_available,input.p_pending])).rows[0].points};}
    };
    const insights=createBelnaWalletStore({supa:()=>supa,ensureProfile:async id=>{await db.query('insert into profiles(id) values($1) on conflict do nothing',[id]);}});
    let available=20,providerCalls=0,historyFails=false;
    const wallet=createBusinessWallet({store:{...insights,getConnectedWalletConfiguration:async()=>null,supaConfigured:()=>true,getBelnaWallet:async id=>({user_id:id,account_id:'biz_'+id,owner_provider_id:'user_'+id,environment:'live'}),listWalletPurchases:async()=>[],listBelnaWalletTransfers:async()=>[],recordWalletBalance:async(...args)=>{if(historyFails)throw Error('unavailable');return insights.recordWalletBalance(...args);}},env:{WHOP_COMPANY_API_KEY:'fixture',WHOP_PLATFORM_ACCOUNT_ID:'biz_platform',WHOP_SANDBOX:'false'},fetchImpl:async url=>{
      providerCalls++;const pathname=new URL(url).pathname.replace('/api/v1','');
      if(pathname.startsWith('/accounts/'))return Response.json({parent_account:{id:'biz_platform'},balances:[{symbol:'USD',breakdown:{available,pending:5}}],verification:{individual:{status:'approved'}}});
      if(pathname==='/financial_activity')return Response.json({data:[]});
      throw Error('Unexpected provider request '+pathname);
    }});
    assert.deepEqual(await wallet.cardWaitlist('alice'),{cardWaitlist:{joined:false,joinedAt:null}});
    const first=await wallet.joinCardWaitlist('alice');
    assert.equal(first.cardWaitlist.joined,true);
    assert.deepEqual(await wallet.joinCardWaitlist('alice'),first,'repeat interest keeps the same registration');
    assert.equal((await wallet.cardWaitlist('bob')).cardWaitlist.joined,false,'another owner has their own waitlist status');
    assert.equal(providerCalls,0,'waitlist registration does not issue or apply for a card');
    assert.equal((await db.query('select count(*)::int as count from belna_card_waitlist')).rows[0].count,1);
    const initial=await wallet.snapshot('alice');assert.equal(initial.balanceHistory.length,1);assert.equal(initial.balanceHistory[0].total,25);
    assert.equal((await wallet.snapshot('alice')).balanceHistory.length,1,'unchanged polling adds no duplicate balance samples');
    available=35;const changed=await wallet.snapshot('alice');assert.deepEqual(changed.balanceHistory.map(point=>point.total),[25,40]);
    assert.deepEqual((await wallet.snapshot('bob')).balanceHistory.map(point=>point.total),[40],'history is isolated between owners');
    await db.query("update belna_wallets set account_id='biz_alice_new' where user_id='alice'");
    assert.deepEqual(await insights.recordWalletBalance('alice',{accountId:'biz_alice',environment:'live',available:99,pending:0}),[],'a delayed snapshot cannot be assigned to a different wallet');
    assert.deepEqual(await insights.recordWalletBalance('alice',{accountId:'biz_alice_new',environment:'sandbox',available:99,pending:0}),[],'sandbox and live histories never mix');
    const fresh=await insights.recordWalletBalance('alice',{accountId:'biz_alice_new',environment:'live',available:0,pending:0});
    assert.deepEqual(fresh.map(point=>point.total),[0],'a replacement wallet starts a separate history');
    await assert.rejects(db.query("select record_belna_wallet_balance('alice','biz_alice_new','live','NaN',0)"),/INVALID_BALANCE/);
    historyFails=true;const fallback=await wallet.snapshot('bob');assert.equal(fallback.wallet.balance.available,35);assert.deepEqual(fallback.balanceHistory,[]);assert.match(fallback.balanceHistoryError,/temporarily unavailable/);
    const privileges=(await db.query("select has_table_privilege('authenticated','belna_card_waitlist','SELECT') interest,has_table_privilege('anon','belna_wallet_balance_history','SELECT') history,has_function_privilege('authenticated','record_belna_wallet_balance(text,text,text,numeric,numeric)','EXECUTE') record")).rows[0];assert.deepEqual(privileges,{interest:false,history:false,record:false});
    await db.query("delete from profiles where id='alice'");assert.equal((await db.query("select count(*)::int as count from belna_card_waitlist where user_id='alice'")).rows[0].count,0);
    console.log('Wallet insights: durable waitlist, duplicate registration, observed balances, unchanged polling, owner/account/environment isolation, provider fallback and service-only SQL access passed');
  }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
