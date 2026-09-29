const assert=require('node:assert/strict');
const {createWalletPurchases}=require('../server/wallet-purchases');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
(async()=>{
  let timestamp=Date.now(), submitted=0, failCancel=false, tx=[], cards=[];
  const rows=new Map(),calls=[];
  const store={
    claimWalletPurchase:async(owner,data)=>{const old=[...rows.values()].find(x=>x.user_id===owner && x.approval_key===data.approval_key);if(old)return{claimed:false,purchase:old};const p={...data,user_id:owner,status:'issuing'};rows.set(p.id,p);return{claimed:true,purchase:p};},
    saveWalletPurchase:async(owner,id,patch)=>{const p=rows.get(id);assert.equal(p.user_id,owner);Object.assign(p,patch);return p;},
    listPendingWalletPurchases:async()=>[...rows.values()].filter(p=>!p.canceled_at || p.status!=='paid'),
    getWalletPurchaseByCard:async(accountId,cardId)=>[...rows.values()].find(p=>p.account_id===accountId && p.card_id===cardId) || null,
  };
  const request=async(path,opts={})=>{
    calls.push({path,...opts});
    if(path.startsWith('/accounts/'))return{capabilities:{card_issuing:'active'},balance:100};
    if(path==='/cards') {const c={object:'card',id:'icrd_'+cards.length,status:'active',type:'virtual',user_id:'user_a',last4:'4242',expiration_month:'12',expiration_year:'2099',name:opts.body.name,limit:{amount:opts.body.spend_limit,frequency:opts.body.spend_limit_frequency},secrets:{card_number:'4242424242424242',cvc:'123',pin:'9999'}};cards.push(c);return c;}
    if(path.startsWith('/cards?'))return{data:cards};
    if(path.startsWith('/card_transactions?'))return{data:tx};
    if(path.startsWith('/cards/')) {if(failCancel)throw Error('timeout');return{id:path.split('/').at(-1),status:'canceled'};}
    throw Error('unexpected');
  };
  const deps={store,request,owned:async()=>({account_id:'biz_a',owner_provider_id:'user_a'}),balanceView:a=>({available:a.balance}),environment:()=> 'sandbox',now:()=>timestamp};
  const approved={paymentMethod:'belna_wallet',checkoutKey:'a'.repeat(64),website:'https://shop.example/checkout',merchant:'shop.example',amount:12.34,currency:'USD'};
  await assert.rejects(createWalletPurchases(deps).execute('u1',approved),/not enabled/);
  const engine=createWalletPurchases({...deps,secureCheckout:async({purchaseId})=>({verify:async a=>assert.equal(a.amount,approved.amount),submit:async({card,purchaseId:actualId})=>{submitted++;assert.equal(actualId,purchaseId);assert.equal(card.secrets.cvc,'123');assert.equal(card.expiration_year,'2099');assert.equal(card.secrets.pin,undefined,'ATM PIN never enters checkout');},close:async()=>{}})});
  const result=await engine.execute('u1',approved);
  assert.equal(result.status,'submitted');assert.equal(result.cardCanceled,false);
  assert.ok(!JSON.stringify(result).includes('4242424242424242'));
  assert.ok(!JSON.stringify([...rows.values()]).includes('secrets'));
  const body=calls.find(x=>x.path==='/cards').body;
  assert.equal(body.spend_limit,12.34);assert.equal(body.transaction_limit,undefined);assert.equal(body.spend_limit_frequency,'one_time');
  await engine.execute('u1',approved);assert.equal(submitted,1,'same approval never submits twice');
  failCancel=true;tx=[{card_id:rows.get(result.purchaseId).card_id,status:'pending',transaction_type:'spend'}];assert.equal((await engine.reconcile()).unresolved,1);
  assert.equal(rows.get(result.purchaseId).canceled_at,undefined,'failed cancellation must not claim expiry');
  failCancel=false;await engine.reconcile();assert.ok(rows.get(result.purchaseId).canceled_at);
  tx=[{card_id:rows.get(result.purchaseId).card_id,status:'completed',transaction_type:'spend'}];await engine.reconcile();assert.equal(rows.get(result.purchaseId).status,'paid');
  tx=[];
  const pending=await engine.execute('u1',{...approved,checkoutKey:'b'.repeat(64)});
  timestamp+=16*60000;await engine.reconcile();assert.ok(rows.get(pending.purchaseId).canceled_at,'unused card canceled after timeout');
  tx=[{card_id:rows.get(pending.purchaseId).card_id,status:'completed',transaction_type:'refund'}];
  assert.equal((await engine.reconcileCard('biz_a',rows.get(pending.purchaseId).card_id)).settled,false,'refund is not a completed purchase');
  tx=[{card_id:'icrd_unrelated',status:'completed',transaction_type:'spend'}];
  assert.equal((await engine.reconcileCard('biz_a',rows.get(pending.purchaseId).card_id)).settled,false,'another card cannot confirm this purchase');
  tx=[{card_id:rows.get(pending.purchaseId).card_id,status:'completed',transaction_type:'spend'}];
  const targeted=await engine.reconcileCard('biz_a',rows.get(pending.purchaseId).card_id);
  assert.deepEqual(targeted,{matched:true,settled:true,cardCanceled:true});
  assert.equal(rows.get(pending.purchaseId).status,'paid');
  assert.equal((await engine.reconcileCard('biz_a','icrd_missing')).matched,false);
  tx=[];
  const broken=createWalletPurchases({...deps,secureCheckout:async()=>({verify:async()=>{},submit:async()=>{throw Error('PAN must not leak');},close:async()=>{}})});
  await assert.rejects(broken.execute('u1',{...approved,checkoutKey:'c'.repeat(64)}),/could not be confirmed/);
  assert.ok([...rows.values()].at(-1).canceled_at,'uncertain checkout closes card');
  let closed=0;
  const cardCount=cards.length,rowCount=rows.size;
  const changed=createWalletPurchases({...deps,secureCheckout:async()=>({verify:async()=>{throw Error('Changed total with secret detail');},submit:async()=>assert.fail('must not submit'),close:async()=>{closed++;}})});
  await assert.rejects(changed.execute('u1',{...approved,checkoutKey:'d'.repeat(64)}),/could not be confirmed/);
  assert.equal(cards.length,cardCount,'changed checkout must not issue any card');
  assert.equal(rows.size,rowCount,'changed checkout must not reserve an allowance');
  assert.equal(closed,1,'private environment closes on failed verification');
  let checks=0;
  const changing=createWalletPurchases({...deps,secureCheckout:async()=>({verify:async()=>{if(++checks===2)throw Error('Order changed during issuance');},submit:async()=>assert.fail('must not submit'),close:async()=>{closed++;}})});
  await assert.rejects(changing.execute('u1',{...approved,checkoutKey:'e'.repeat(64)}),/could not be confirmed/);
  assert.ok([...rows.values()].at(-1).canceled_at,'changed order after issuance closes unused card');
  const expired=createWalletPurchases({...deps,secureCheckout:async()=>({verify:async()=>{if(++checks===4)timestamp+=16*60000;},submit:async()=>assert.fail('must not submit expired card'),close:async()=>{closed++;}})});
  await assert.rejects(expired.execute('u1',{...approved,checkoutKey:'f'.repeat(64)}),/could not be confirmed/);
  assert.ok([...rows.values()].at(-1).canceled_at,'expired private session closes unused card');
  // A card that was never issued: a refusal closes the purchase at once, an unknown outcome
  // closes once it expires, and neither leaves recovery unhealthy.
  tx=[];let issue=null;
  const plain=createWalletPurchases({...deps,request:async(path,opts={})=>{if(path==='/cards' && issue)throw issue;return request(path,opts);},
    secureCheckout:async()=>({verify:async()=>{},submit:async()=>assert.fail('must not submit without a card'),close:async()=>{}})});
  issue=Object.assign(Error('refused'),{code:'PROVIDER',providerStatus:400});
  await assert.rejects(plain.execute('u1',{...approved,checkoutKey:'1'.repeat(64)}),/could not be confirmed/);
  const refused=[...rows.values()].at(-1);
  assert.ok(refused.canceled_at,'a refused card closes its purchase');assert.equal(refused.card_id,undefined);
  issue=Object.assign(Error('timeout'),{code:'PROVIDER'});
  await assert.rejects(plain.execute('u1',{...approved,checkoutKey:'2'.repeat(64)}),/could not be confirmed/);
  const unknown=[...rows.values()].at(-1);
  assert.equal(unknown.canceled_at,undefined,'an unknown outcome stays open for recovery');
  issue=null;
  assert.equal((await plain.reconcile()).unresolved,0,'a card still being issued is not a recovery failure');
  assert.equal(unknown.canceled_at,undefined);
  timestamp+=16*60000;
  assert.equal((await plain.reconcile()).unresolved,0);
  assert.ok(unknown.canceled_at,'a purchase that expired without a card closes');
  cards.push({object:'card',id:'icrd_late',status:'active',name:'Belna purchase '+unknown.id,last4:'1111'});
  assert.equal((await plain.reconcile()).unresolved,0);
  assert.equal(unknown.card_id,'icrd_late');
  assert.ok(calls.some(x=>x.path==='/cards/icrd_late' && x.body?.canceled===true),'a card issued late is canceled');
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('u1'),('u2');");
    await db.exec(fs.readFileSync('supabase/migrations/20260927150000_belna_wallets.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20260927160000_wallet_purchase_cards.sql','utf8'));
    await db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id,daily_card_limit)values('u1','a@b.c','setup','card','US','sandbox','biz_a',20);");
    const input={id:'p1',approval_key:'key',account_id:'biz_a',environment:'sandbox',merchant:'shop.example',amount:12.34,approved_detail:'{}',expires_at:new Date(Date.now()+900000).toISOString()};
    const claim=(owner,p)=>db.query('select claim_wallet_purchase($1,$2::jsonb) as result',[owner,JSON.stringify(p)]);
    await assert.rejects(claim('u2',input),/WALLET_NOT_FOUND/);
    assert.equal((await claim('u1',input)).rows[0].result.claimed,true);
    assert.equal((await claim('u1',input)).rows[0].result.claimed,false);
    await assert.rejects(claim('u1',{...input,id:'p2',approval_key:'key2'}),/PURCHASE_LIMIT/);
    await db.exec("update belna_wallet_purchases set created_at=now()-interval '2 days';");
    await assert.rejects(claim('u1',{...input,id:'p2',approval_key:'key2'}),/PURCHASE_LIMIT/,'unknown reservations survive midnight');
    await db.exec(fs.readFileSync('supabase/migrations/20260928150000_wallet_unissued_purchases.sql','utf8'));
    await assert.rejects(claim('u1',{...input,id:'p2',approval_key:'key2'}),/PURCHASE_LIMIT/,'an open purchase keeps its hold');
    await db.exec("update belna_wallet_purchases set canceled_at=now() where id='p1';");
    assert.equal((await claim('u1',{...input,id:'p2',approval_key:'key2'})).rows[0].result.claimed,true,'a purchase closed before any card was issued frees its allowance');
    await db.exec("update belna_wallet_purchases set card_id='icrd_x',canceled_at=now() where id='p2';");
    await assert.rejects(claim('u1',{...input,id:'p3',approval_key:'key3'}),/PURCHASE_LIMIT/,'a closed card still holds its amount for 24 hours');
    const access=(await db.query("select has_table_privilege('authenticated','belna_wallet_purchases','SELECT') as readable,has_function_privilege('anon','claim_wallet_purchase(text,jsonb)','EXECUTE') as executable")).rows[0];
    assert.equal(access.readable,false);assert.equal(access.executable,false);
    await db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id,daily_card_limit)values('u2','b@b.c','setup2','card2','SE','sandbox','biz_b',20);");
    await assert.rejects(claim('u2',{...input,id:'owner2'}),/WALLET_NOT_FOUND/,'another owner’s provider account cannot fund a purchase');
    await assert.rejects(claim('u2',{...input,id:'owner2',account_id:'biz_b',environment:'live'}),/WALLET_NOT_FOUND/,'live and sandbox approvals cannot cross');
    const other=(await claim('u2',{...input,id:'owner2',account_id:'biz_b'})).rows[0].result;
    assert.equal(other.claimed,true,'another owner has a separate allowance and approval key');
    assert.equal(other.purchase.user_id,'u2');
    assert.equal(other.purchase.account_id,'biz_b','SQL takes the account from the authenticated owner');
    assert.equal(other.purchase.environment,'sandbox');
  }finally{await db.close();}
  console.log('Wallet purchase cards: exact budget, private credentials, duplicate prevention, cancellation recovery, expiry, SQL owner/limit/access checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
