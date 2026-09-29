const assert = require('node:assert/strict');
const {createBelnaWallet} = require('../server/belna-wallet');

module.exports = async function cardConnection() {
  let row={user_id:'owner',account_id:'biz_owner',owner_provider_id:'user_owner',environment:'live',card_request_key:'old-rejected-key',daily_card_limit:50};
  let application=null, cardActive=false, calls=[], mode='replayed', keys=0;
  const store={supaConfigured:()=>true,getBelnaWallet:async()=>({...row}),saveBelnaWallet:async(id,p)=>{assert.equal(id,'owner');if(p.card_request_key)keys++;Object.assign(row,p);return {...row};},listBelnaWalletTransfers:async()=>[]};
  const fetchImpl=async(url,init)=>{
    const path=new URL(url).pathname.replace('/api/v1','');
    const key=init.headers['Idempotency-Key'];calls.push({path,key,method:init.method});
    let data;
    if(path==='/accounts/biz_owner')data={parent_account:{id:'biz_platform'},verification:{individual:{status:'approved'}},cards:application?{status:application}:null,capabilities:{card_issuing:cardActive?'active':'inactive'},balances:[]};
    else if(path==='/cards'&&init.method==='POST'){
      if(mode==='timeout')throw Error('lost response');
      if(mode==='unknown')return{ok:false,status:409,headers:{get:()=>null},json:async()=>({error:{message:'Idempotency key is still processing'}})};
      if(mode==='replayed'&&key==='old-rejected-key')return{ok:false,status:409,headers:{get:n=>n.toLowerCase()==='idempotent-replayed'?'true':null},json:async()=>({error:{message:'Rain account is not approved'}})};
      if(mode==='fresh-rejected')return{ok:false,status:409,headers:{get:()=>null},json:async()=>({error:{message:'Rain account is not approved'}})};
      if(mode==='issued'){
        data={object:'card',id:'icrd_issued',status:'active',type:'virtual',user_id:'user_owner',last4:'4242',name:'Belna card connection'};
        cardActive=true;
        return{ok:true,headers:{get:()=>null},json:async()=>data};
      }
      application=application||'needs_verification';
      data={object:'card_application',id:'ciac_owner',status:application,hosted_url:application.startsWith('needs_')?'https://verify.raincards.xyz/onboarding/owner':null};
    }else if(path==='/cards/icrd_issued'&&init.method==='PATCH')data={id:'icrd_issued',status:'canceled'};
    else if(path==='/cards'||path==='/financial_activity')data={data:[]};
    else throw Error('Unexpected '+path);
    return{ok:true,headers:{get:()=>null},json:async()=>data};
  };
  const wallet=createBelnaWallet({store,fetchImpl,env:{WHOP_COMPANY_API_KEY:'test',WHOP_PLATFORM_ACCOUNT_ID:'biz_platform',WHOP_SANDBOX:'false',WHOP_CARD_APPLICATIONS_ENABLED:'true'}});
  const connected=await wallet.connectCard('owner');
  assert.equal(connected.url,'https://verify.raincards.xyz/onboarding/owner','a replayed refusal must recover to the owner onboarding link');
  assert.equal(connected.wallet.cardApplicationStatus,'needs_verification');
  assert.equal(connected.wallet.status,'card_action_required');
  assert.equal(connected.wallet.cardReady,false);
  assert.deepEqual(calls.filter(x=>x.method==='POST').map(x=>x.key),['old-rejected-key',row.card_request_key]);
  assert.match(row.card_request_key,/^card-connect-[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(await wallet.snapshot('owner')).includes('onboarding/'),'private issuer URL is absent from snapshots and agent status');
  const before=keys;
  assert.equal((await wallet.connectCard('owner')).url,connected.url);
  assert.equal(keys,before,'an accepted application retains its safe retry key');
  for(const state of ['needs_information','pending','manual_review','denied','locked','canceled','approved']){
    application=state;
    const snapshot=await wallet.snapshot('owner');
    assert.equal(snapshot.wallet.cardApplicationStatus,state);
    assert.equal(snapshot.wallet.status,state.startsWith('needs_')?'card_action_required':['denied','locked','canceled'].includes(state)?'denied':'review');
  }
  application='pending';mode='accepted';const count=calls.filter(x=>x.method==='POST').length;
  await wallet.connectCard('owner');
  assert.equal(calls.filter(x=>x.method==='POST').length,count,'in-flight review refreshes status instead of resubmitting an application');
  application='approved';mode='issued';
  const applicationKey=row.card_request_key;
  const issued=await wallet.connectCard('owner');
  assert.equal(issued.wallet.status,'ready');
  assert.notEqual(row.card_request_key,applicationKey,'approved application gets a distinct issuance key');
  assert.ok(calls.some(x=>x.path==='/cards/icrd_issued'&&x.method==='PATCH'),'connection card is immediately canceled');
  assert.equal((await wallet.connectCard('owner')).wallet.status,'ready','active issuer does not create another card');
  cardActive=false;
  application=null;row.application_status=null;mode='timeout';const timeoutKey=row.card_request_key;
  await assert.rejects(wallet.connectCard('owner'),/could not be reached/);
  assert.equal(row.card_request_key,timeoutKey,'uncertain issuance never rotates its key');
  mode='unknown';await assert.rejects(wallet.connectCard('owner'),/could not be completed/);
  assert.equal(row.card_request_key,timeoutKey,'a processing idempotency conflict never rotates its key');
  mode='fresh-rejected';
  const refused=await wallet.connectCard('owner');
  assert.equal(refused.wallet.cardReady,false);
  assert.equal(refused.wallet.status,'card_unavailable','an unapproved account is not proof of a review');
  assert.notEqual(row.card_request_key,timeoutKey,'confirmed refusal can be retried with a fresh key on the next owner attempt');
  application=null;row.application_status=null;row.card_request_key='old-rejected-key';calls=[];mode='replayed';
  await Promise.all([wallet.connectCard('owner'),wallet.connectCard('owner')]);
  assert.equal(new Set(calls.filter(x=>x.method==='POST'&&x.key!=='old-rejected-key').map(x=>x.key)).size,1,'concurrent retries use one replacement key');
  cardActive=true;
  assert.equal((await wallet.snapshot('owner')).wallet.status,'ready','real issuer activation enables virtual cards');
  console.log('Card connection: cached refusals, private onboarding, issuer state distinctions, terminal states and uncertain retry safety passed');
};
if(require.main===module)module.exports().catch(e=>{console.error(e);process.exit(1);});
