const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createBelnaWallet}=require('../server/belna-wallet');
const {createPurchaseFlow}=require('../server/agents/purchase');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('u1'),('u2');");
  await db.exec(fs.readFileSync('supabase/migrations/20260927180000_wallet_preferences.sql','utf8'));
  const owned={account_id:'biz_one',balance:125};
  const store={getBelnaWallet:async u=>u==='u1'?owned:null,getShopPayAccount:async()=>null,
   getWalletPreferences:async u=>(await db.query('select * from belna_wallet_preferences where user_id=$1',[u])).rows[0],
   saveWalletPreferences:async(u,p)=>(await db.query('insert into belna_wallet_preferences(user_id,active_method,merchant_enabled) values($1,$2,$3) on conflict(user_id) do update set active_method=$2,merchant_enabled=$3 returning *',[u,p.active_method,p.merchant_enabled])).rows[0],
   recordExistingPurchase:async(u,p)=>db.query('insert into belna_existing_purchases(user_id,approval_key,merchant,amount,currency) values($1,$2,$3,$4,$5) on conflict do nothing',[u,p.checkoutKey,p.merchant,p.amount,p.currency]),
   listExistingPurchases:async u=>(await db.query('select * from belna_existing_purchases where user_id=$1',[u])).rows,
  };
  const wallet=createBelnaWallet({store,env:{}});
  await assert.rejects(wallet.savePreferences('u2',{activeMethod:'belna_wallet'}),/Connect your/);
  await assert.rejects(wallet.savePreferences('u1',{activeMethod:'existing_card'}),/Connect Shop Pay/);
  await wallet.savePreferences('u1',{merchantEnabled:true,activeMethod:'existing_card'});
  delete wallet.addresses; // Address lookup has its own integration test.
  const session={url:'https://shop.example/checkout',text:'Checkout Visa ending in 4242',elements:['[7] Place order']};
  const flow=createPurchaseFlow({wallet,live:{forTool:async()=>session,content:async()=>session}});
  const args={type:'click',ref:7,purchase:{items:[{title:'Lamp',quantity:1,price:10}],amount:10,currency:'USD',shippingAddress:'Ada, Main Street 1',payment:{method:'saved_card',label:'Visa ending in 4242'}}};
  const ctx={userId:'u1',sessionId:'test'},detail=await flow.approvalDetail(args,ctx),approved=JSON.parse(detail);
  await wallet.recordExistingPurchase('u1',approved);await wallet.recordExistingPurchase('u1',approved);
  assert.equal((await wallet.existingHistory('u1')).history.length,1);assert.equal((await wallet.existingHistory('u2')).history.length,0);
  await wallet.savePreferences('u1',{activeMethod:'belna_wallet'});await assert.rejects(flow.beforeSubmit(args,{...ctx,approvedDetail:detail}),/inactive/);
  assert.equal(owned.balance,125);assert.equal((await wallet.existingHistory('u1')).history.length,1);
  await wallet.savePreferences('u1',{activeMethod:'existing_card'});await flow.beforeSubmit(args,{...ctx,approvedDetail:detail});
  await wallet.savePreferences('u1',{activeMethod:null});await assert.rejects(flow.beforeSubmit(args,{...ctx,approvedDetail:detail}),/inactive/);
  // An owner who never chose keeps paying as before Belna Wallet: an existing card works,
  // Belna Wallet waits for their choice. A saved "none" (above) pauses purchases.
  assert.equal((await wallet.preferences('u2')).selectionSaved,false);
  assert.equal((await wallet.preferences('u2')).spendingMethod,'existing_card');
  assert.equal(JSON.parse(await flow.approvalDetail(args,{...ctx,userId:'u2'})).paymentMethod,'saved_card');
  await assert.rejects(flow.approvalDetail({...args,purchase:{...args.purchase,payment:{method:'belna_wallet',label:'Belna Wallet'}}},{...ctx,userId:'u2'}),/inactive/);
  // Without Supabase there is no saved selection or history, and purchases are checked as before.
  const local=createBelnaWallet({store:{...store,supaConfigured:()=>false},env:{}});
  assert.equal((await local.preferences('u1')).spendingMethod,'existing_card');
  assert.deepEqual(await local.addresses('u1'),{addresses:[]});
  assert.deepEqual(await local.existingHistory('u1'),{history:[]});
  const p=(await db.query("select has_table_privilege('authenticated','belna_wallet_preferences','SELECT') prefs,has_table_privilege('anon','belna_existing_purchases','SELECT') history")).rows[0];assert.equal(p.prefs,false);assert.equal(p.history,false);
  console.log('Wallet preferences: owner selection, switch/deactivation purchase guards, preserved balances/history, deduplication and service-only access passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
