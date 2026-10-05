const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createBelnaWallet}=require('../server/belna-wallet');
const {createPurchaseFlow}=require('../server/agents/purchase');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('u1'),('u2');");
  await db.exec(fs.readFileSync('supabase/migrations/20260927202004_wallet_preferences.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261004090000_wallet_payment_methods.sql','utf8'));
  const owned={account_id:'biz_one',balance:125};
  const store={getBelnaWallet:async u=>u==='u1'?owned:null,getShopPayAccount:async()=>null,
   getWalletPreferences:async u=>(await db.query('select * from belna_wallet_preferences where user_id=$1',[u])).rows[0],
   saveWalletPreferences:async(u,p)=>(await db.query('insert into belna_wallet_preferences(user_id,active_method,merchant_enabled,enabled_methods) values($1,$2,$3,$4) on conflict(user_id) do update set active_method=$2,merchant_enabled=$3,enabled_methods=case when $5 then $4 else belna_wallet_preferences.enabled_methods end returning *',[u,p.active_method,p.merchant_enabled,p.enabled_methods ?? null,Object.hasOwn(p,'enabled_methods')])).rows[0],
   recordExistingPurchase:async(u,p)=>db.query('insert into belna_existing_purchases(user_id,approval_key,merchant,amount,currency) values($1,$2,$3,$4,$5) on conflict do nothing',[u,p.checkoutKey,p.merchant,p.amount,p.currency]),
   listExistingPurchases:async u=>(await db.query('select * from belna_existing_purchases where user_id=$1',[u])).rows,
  };
  const wallet=createBelnaWallet({store,env:{}});
  await assert.rejects(wallet.savePreferences('u2',{activeMethod:'belna_wallet'}),/Connect your/);
  await assert.rejects(wallet.savePreferences('u1',{activeMethod:'existing_card'}),/Connect Shop Pay/);
  // Every own method is off until the owner turns it on; Shop Pay needs its account first.
  await assert.rejects(wallet.savePreferences('u1',{methods:{shop_pay:true}}),/Connect Shop Pay/);
  await assert.rejects(wallet.savePreferences('u1',{methods:{paypal:true}}),/valid payment method/);
  await assert.rejects(wallet.savePreferences('u1',{methods:{payment_apps:'yes'}}),/valid payment method/);
  await assert.rejects(wallet.savePreferences('u1',{methods:{swish:true}}),/valid payment method/,'payment apps are one switch');
  assert.deepEqual((await wallet.preferences('u2')).methods,{payment_apps:false,shop_pay:false,saved_card:false,belna_wallet:false});
  assert.equal((await wallet.preferences('u2')).spendingMethod,null);
  delete wallet.addresses; // Address lookup has its own integration test.
  const session={url:'https://shop.example/checkout',text:'Checkout Visa ending in 4242',elements:['[7] Place order']};
  const flow=createPurchaseFlow({wallet,live:{forTool:async()=>session,content:async()=>session}});
  const args={type:'click',ref:7,purchase:{items:[{title:'Lamp',quantity:1,price:10}],amount:10,currency:'USD',shippingAddress:'Ada, Main Street 1',payment:{method:'saved_card',label:'Visa ending in 4242'}}};
  const ctx={userId:'u1',sessionId:'test'};
  await assert.rejects(flow.approvalDetail(args,{...ctx,userId:'u2'}),/turned off/,'an owner who never turned a method on cannot be charged');
  await wallet.savePreferences('u1',{methods:{saved_card:true}});
  assert.equal((await wallet.preferences('u1')).merchantEnabled,true);
  const detail=await flow.approvalDetail(args,ctx),approved=JSON.parse(detail);
  await wallet.recordExistingPurchase('u1',approved);await wallet.recordExistingPurchase('u1',approved);
  assert.equal((await wallet.existingHistory('u1')).history.length,1);assert.equal((await wallet.existingHistory('u2')).history.length,0);
  // Choosing Belna Wallet does not touch the owner's own methods, and they never spend the balance.
  await wallet.savePreferences('u1',{activeMethod:'belna_wallet'});await flow.beforeSubmit(args,{...ctx,approvedDetail:detail});
  assert.equal(owned.balance,125);
  await wallet.savePreferences('u1',{methods:{saved_card:false}});await assert.rejects(flow.beforeSubmit(args,{...ctx,approvedDetail:detail}),/turned off/);
  // Switches change one method at a time.
  await wallet.savePreferences('u1',{methods:{payment_apps:true}});await wallet.savePreferences('u1',{methods:{saved_card:true}});
  const m=(await wallet.preferences('u1')).methods;assert.equal(m.payment_apps,true);assert.equal(m.saved_card,true);assert.equal(m.belna_wallet,true);
  assert.deepEqual((await db.query("select enabled_methods from belna_wallet_preferences where user_id='u1'")).rows[0].enabled_methods,['payment_apps']);
  // An earlier "existing payments" choice keeps Shop Pay on until the owner sets the switches.
  await db.exec("insert into profiles values('u3');insert into belna_wallet_preferences(user_id,active_method) values('u3','existing_card')");
  assert.equal((await wallet.preferences('u3')).methods.shop_pay,true);
  await assert.rejects(db.exec("update belna_wallet_preferences set enabled_methods=array['card'] where user_id='u3'"),/check/i,'only known methods can be stored');
  // Without Supabase nothing can be turned on, so nothing can be charged.
  const local=createBelnaWallet({store:{...store,supaConfigured:()=>false},env:{}});
  assert.equal((await local.preferences('u1')).spendingMethod,null);
  assert.deepEqual(await local.addresses('u1'),{addresses:[]});
  assert.deepEqual(await local.existingHistory('u1'),{history:[]});
  const p=(await db.query("select has_table_privilege('authenticated','belna_wallet_preferences','SELECT') prefs,has_table_privilege('anon','belna_existing_purchases','SELECT') history")).rows[0];assert.equal(p.prefs,false);assert.equal(p.history,false);
  console.log('Wallet preferences: own methods off until turned on, per-method purchase guards, legacy Shop Pay choice, stored-method check, preserved balances/history, deduplication and service-only access passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
