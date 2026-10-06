const assert=require('node:assert/strict');
const express=require('express');
const {installAppleAuthRoutes}=require('../server/apple-auth');
(async()=>{
  const calls=[];let refuse=false,removeFails=false,cleanupFails=false;
  // A returning Apple user; an account first made with a password elsewhere is "linked" below.
  let appleUser={id:'owner',email_confirmed_at:'2026-01-01T00:00:00Z',identities:[{provider:'apple'}]};
  const auth={signInWithIdToken:async input=>{calls.push(['apple',input]);return refuse?{error:new Error('private auth details')}:{data:{session:{access_token:'verified',refresh_token:'refresh'},user:appleUser}};},updateUser:async()=>({}),verifyOtp:async input=>{calls.push(['fresh-session',input.email,input.type]);return{data:{session:{access_token:'fresh',refresh_token:'fresh-refresh'},user:appleUser}};}};
  const app=express();app.use(express.json());
  installAppleAuthRoutes(app,{rateLimit:()=>((req,res,next)=>next()),requireAuth:handler=>async(req,res)=>{if(req.headers.authorization!=='Bearer owner')return res.status(401).json({error:'Sign in required.'});req.user={id:'owner'};return handler(req,res);},pubClient:()=>({auth}),
    identity:{exchange:async code=>{calls.push(['exchange',code]);return {identityToken:'exchanged.apple.jwt',refreshToken:'private-refresh'};},save:async id=>calls.push(['identity-save',id]),revoke:async user=>calls.push(['revoke',user.id])},
    adminClient:()=>({rpc:async(name,args)=>{calls.push(['purge',name,args]);return{};},auth:{admin:{generateLink:async()=>({data:{properties:{email_otp:'12345678'}}}),updateUserById:async(id,attrs)=>{calls.push(['password-reset',id,attrs.password.length]);return{};},deleteUser:async id=>{calls.push(['delete',id]);return removeFails?{error:new Error('private')}:{};}}}}),
    store:{getSubscription:async()=>({stripe_subscription_id:'sub_owner'})},stripe:{client:()=>({subscriptions:{retrieve:async()=>({id:'sub_owner',status:'active'}),cancel:async id=>calls.push(['cancel',id])}})},beforeDelete:async id=>{calls.push(['cleanup',id]);if(cleanupFails)throw new Error('Private cloud archive is retained.');}});
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
    assert.equal(calls.some(c=>c[0]==='password-reset'),false,'a returning Apple-only account keeps its sign-in as is');
    // An email account someone else created with a password, confirmed now by Apple:
    // the password chosen before the address was proven must not keep working.
    calls.length=0;appleUser={id:'owner',email:'owner@example.com',email_confirmed_at:new Date().toISOString(),identities:[{provider:'email'},{provider:'apple'}]};
    const linked=await post('/api/auth/apple',input);assert.equal(linked.status,200);
    assert.equal((await linked.json()).access_token,'fresh','the reset signs out the Apple session, so a new one is returned');
    assert.deepEqual(calls.find(c=>c[0]==='fresh-session'),['fresh-session','owner@example.com','magiclink']);
    assert.deepEqual(calls.find(c=>c[0]==='password-reset'),['password-reset','owner',64]);
    appleUser={id:'owner',email_confirmed_at:'2026-01-01T00:00:00Z',identities:[{provider:'apple'}]};
    refuse=true;const denied=await post('/api/auth/apple',input);assert.equal(denied.status,401);assert.doesNotMatch(JSON.stringify(await denied.json()),/private/);
    assert.equal((await post('/api/auth/delete-account',{confirmation:'DELETE'})).status,401);
    assert.equal((await post('/api/auth/delete-account',{},'Bearer owner')).status,400);
    calls.length=0;cleanupFails=true;
    const retained=await post('/api/auth/delete-account',{confirmation:'DELETE'},'Bearer owner');assert.equal(retained.status,503);
    assert.deepEqual(calls,[['cancel','sub_owner'],['cleanup','owner']],'failed cloud cleanup prevents database/auth deletion while renewal is cancelled');cleanupFails=false;
    calls.length=0;
    const deletion=await post('/api/auth/delete-account',{confirmation:'DELETE',userId:'victim'},'Bearer owner');assert.equal(deletion.status,200);
    assert.deepEqual(calls,[['cancel','sub_owner'],['cleanup','owner'],['revoke','owner'],['purge','delete_belna_account_data',{owner_id:'owner'}],['delete','owner']]);
    removeFails=true;const partial=await post('/api/auth/delete-account',{confirmation:'DELETE'},'Bearer owner');assert.equal(partial.status,503);assert.match((await partial.json()).error,/retry/);
    console.log('Apple auth: legal consent, verified nonce, identity isolation, authenticated deletion, subscription cancellation and honest partial failure passed');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
