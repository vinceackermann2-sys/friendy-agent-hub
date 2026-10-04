const assert=require('node:assert/strict');
const express=require('express');
const {installAppleAuthRoutes}=require('../server/apple-auth');
(async()=>{
  const calls=[];let refuse=false,removeFails=false;
  const auth={signInWithIdToken:async input=>{calls.push(['apple',input]);return refuse?{error:new Error('private auth details')}:{data:{session:{access_token:'verified',refresh_token:'refresh'},user:{id:'owner'}}};},updateUser:async()=>({})};
  const app=express();app.use(express.json());
  installAppleAuthRoutes(app,{rateLimit:()=>((req,res,next)=>next()),requireAuth:handler=>async(req,res)=>{if(req.headers.authorization!=='Bearer owner')return res.status(401).json({error:'Sign in required.'});req.user={id:'owner'};return handler(req,res);},pubClient:()=>({auth}),
    identity:{exchange:async code=>{calls.push(['exchange',code]);return {identityToken:'exchanged.apple.jwt',refreshToken:'private-refresh'};},save:async id=>calls.push(['identity-save',id]),revoke:async user=>calls.push(['revoke',user.id])},
    adminClient:()=>({rpc:async(name,args)=>{calls.push(['purge',name,args]);return{};},auth:{admin:{deleteUser:async id=>{calls.push(['delete',id]);return removeFails?{error:new Error('private')}:{};}}}}),
    store:{getSubscription:async()=>({stripe_subscription_id:'sub_owner'})},stripe:{client:()=>({subscriptions:{retrieve:async()=>({id:'sub_owner',status:'active'}),cancel:async id=>calls.push(['cancel',id])}})},beforeDelete:async id=>calls.push(['cleanup',id])});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,token='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},body:JSON.stringify(body)});
  const input={identityToken:'signed.apple.jwt',authorizationCode:'single-use-code',nonce:'n'.repeat(64),terms_version:'2026-09-24',userId:'attacker'};
  try{
    assert.equal((await post('/api/auth/apple',{...input,terms_version:'old'})).status,400);
    assert.equal(calls.length,0,'terms gate runs before Apple credential exchange');
    const login=await post('/api/auth/apple',input);assert.equal(login.status,200);assert.equal((await login.json()).user.id,'owner');
    assert.deepEqual(calls[1][1],{provider:'apple',token:'exchanged.apple.jwt',nonce:input.nonce},'Supabase verifies the exchanged identity and nonce; userId is ignored');
    assert.deepEqual(calls[2],['identity-save','owner']);
    refuse=true;const denied=await post('/api/auth/apple',input);assert.equal(denied.status,401);assert.doesNotMatch(JSON.stringify(await denied.json()),/private/);
    assert.equal((await post('/api/auth/delete-account',{confirmation:'DELETE'})).status,401);
    assert.equal((await post('/api/auth/delete-account',{},'Bearer owner')).status,400);
    calls.length=0;
    const deletion=await post('/api/auth/delete-account',{confirmation:'DELETE',userId:'victim'},'Bearer owner');assert.equal(deletion.status,200);
    assert.deepEqual(calls,[['cleanup','owner'],['cancel','sub_owner'],['revoke','owner'],['purge','delete_belna_account_data',{owner_id:'owner'}],['delete','owner']]);
    removeFails=true;const partial=await post('/api/auth/delete-account',{confirmation:'DELETE'},'Bearer owner');assert.equal(partial.status,503);assert.match((await partial.json()).error,/retry/);
    console.log('Apple auth: legal consent, verified nonce, identity isolation, authenticated deletion, subscription cancellation and honest partial failure passed');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
