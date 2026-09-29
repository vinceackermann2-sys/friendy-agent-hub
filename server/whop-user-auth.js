// Personal wallet credentials never leave the trusted server. PKCE callbacks
// must be completed by the same authenticated Belna owner who started them.
function createWhopUserAuth({store,env=process.env,fetchImpl=(...a)=>fetch(...a),now=()=>Date.now()}) {
  const fail=(message,code='PROVIDER')=>Object.assign(new Error(message),{code});
  const setting=n=>String(env[n]||'').trim();
  const scopes=()=>setting('WHOP_OAUTH_SCOPES').split(/\s+/).filter(Boolean);
  const environment=()=>setting('WHOP_SANDBOX')==='false'?'live':'sandbox';
  const encryptionKey=()=>setting('WHOP_WALLET_ENCRYPTION_KEY') || setting('ENCRYPTION_KEY');
  const base=()=>environment()==='live'?'https://api.whop.com':'https://sandbox-api.whop.com';
  function redirectUri(){
    try{const u=new URL(setting('WHOP_OAUTH_REDIRECT_URI'));if((u.protocol==='https:' || u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)) && !u.search && !u.hash && !u.username && !u.password && u.pathname==='/app')return u.href;}catch{}
    return null;
  }
  const configured=()=>/^app_[A-Za-z0-9]+$/.test(setting('WHOP_OAUTH_CLIENT_ID')) && !!redirectUri() && scopes().includes('openid') && scopes().length>1 && encryptionKey().length>=16 && store.supaConfigured();
  const bytes=n=>crypto.getRandomValues(new Uint8Array(n));
  const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const random=()=>hex(bytes(32));
  const aad=(owner,whopId)=>new TextEncoder().encode('belna:whop-personal:v1:'+environment()+':'+owner+':'+whopId);
  async function key(){
    const raw=encryptionKey();if(raw.length<16)throw fail('Personal wallet authorization is not configured.','NOT_SET_UP');
    return crypto.subtle.importKey('raw',/^[a-f0-9]{64}$/i.test(raw)?unhex(raw):await digest(raw),'AES-GCM',false,['encrypt','decrypt']);
  }
  async function seal(owner,whopId,value){const iv=bytes(12);return {v:1,iv:hex(iv),data:hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(owner,whopId)},await key(),new TextEncoder().encode(JSON.stringify(value)))))};}
  async function open(owner,whopId,value){
    try{if(value?.v!==1 || !/^[a-f0-9]{24}$/.test(value.iv) || !/^[a-f0-9]+$/.test(value.data))throw Error();return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(value.iv),additionalData:aad(owner,whopId)},await key(),unhex(value.data))));}
    catch{throw fail('Reconnect your personal Whop wallet.','RECONNECT');}
  }
  async function oauth(path,{body,token}={}){
    let res;try{res=await fetchImpl(base()+'/oauth/'+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw fail('Whop authorization could not be reached. Please try again.');}
    const data=await res.json().catch(()=>null);
    if(!res.ok || !data)throw fail(['invalid_grant','invalid_token'].includes(data?.error) || res.status===401?'Reconnect your personal Whop wallet.':'Whop authorization could not be completed. Check the app’s OAuth configuration.',res.status===401 || data?.error==='invalid_grant'?'RECONNECT':'PROVIDER');
    return data;
  }
  function tokens(data){
    if(typeof data.access_token!=='string' || data.access_token.length<20 || typeof data.refresh_token!=='string' || data.refresh_token.length<20 || String(data.token_type).toLowerCase()!=='bearer' || !Number.isFinite(data.expires_in) || data.expires_in<=0 || data.expires_in>10800)throw fail('Whop returned an incomplete authorization.');
    const granted=typeof data.scope==='string'?data.scope.split(/\s+/):null;
    if(granted && scopes().some(s=>!granted.includes(s)))throw fail('Whop did not grant the wallet permissions. Reconnect and approve the requested permissions.','RECONNECT');
    return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:new Date(now()+data.expires_in*1000).toISOString()};
  }
  async function start(user,{country}={}){
    if(!configured())throw fail('Personal wallets need Belna’s Whop OAuth app to be connected first.','NOT_SET_UP');
    if(!user?.id || !user.email_confirmed_at)throw fail('Confirm your Belna email before connecting your personal wallet.','BAD_INPUT');
    country=String(country || (await store.getBelnaWallet(user.id))?.country || '').toUpperCase();
    if(!/^[A-Z]{2}$/.test(country))throw fail('Choose your country before connecting your personal wallet.','BAD_INPUT');
    const state=random(),verifier=random();
    await store.saveWhopWalletOAuthState(user.id,{state_hash:hex(await digest(state)),encrypted_verifier:await seal(user.id,'oauth',{verifier,country}),expires_at:new Date(now()+10*60000).toISOString(),environment:environment()});
    const challenge=btoa(String.fromCharCode(...await digest(verifier))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const params=new URLSearchParams({client_id:setting('WHOP_OAUTH_CLIENT_ID'),redirect_uri:redirectUri(),response_type:'code',scope:scopes().join(' '),state,code_challenge:challenge,code_challenge_method:'S256'});
    // No company_id: authorizing a business would produce the wrong token.
    return {url:base()+'/oauth/authorize?'+params,state};
  }
  async function finish(user,{state,code}={}){
    if(!configured())throw fail('Personal wallet authorization is not configured.','NOT_SET_UP');
    if(!user?.id || !user.email_confirmed_at || !/^[a-f0-9]{64}$/.test(state||'') || typeof code!=='string' || !code || code.length>2048)throw fail('Your wallet connection expired. Start Connect personal wallet again.','BAD_INPUT');
    const pending=await store.consumeWhopWalletOAuthState(user.id,hex(await digest(state)),environment());
    if(!pending || Date.parse(pending.expires_at)<=now())throw fail('Your wallet connection expired. Start Connect personal wallet again.','BAD_INPUT');
    const pendingValue=await open(user.id,'oauth',pending.encrypted_verifier);
    const value=tokens(await oauth('token',{body:{grant_type:'authorization_code',client_id:setting('WHOP_OAUTH_CLIENT_ID'),redirect_uri:redirectUri(),code,code_verifier:pendingValue.verifier}}));
    const info=await oauth('userinfo',{token:value.access_token});
    if(!/^user_[A-Za-z0-9]+$/.test(info.sub||''))throw fail('Whop did not confirm your personal wallet owner.');
    // Atomic binding refuses a Whop identity already linked to another Belna
    // user, replacement of an existing personal identity, or unsettled orders.
    await store.connectPersonalWhopWallet(user.id,{whop_user_id:info.sub,country:pendingValue.country,environment:environment(),owner_email:user.email.toLowerCase(),encrypted_tokens:await seal(user.id,info.sub,value),expires_at:value.expires_at,setup_key:crypto.randomUUID(),card_request_key:crypto.randomUUID()});
    return {connected:true};
  }
  const refreshes=new Map();
  async function credentials(userId){
    if(!configured())throw fail('Personal wallet authorization is not configured.','NOT_SET_UP');
    let row=await store.getWhopWalletAuth(userId);
    if(!row || row.user_id!==userId || !/^user_[A-Za-z0-9]+$/.test(row.whop_user_id||'') || row.environment!==environment())throw fail('Connect your personal Whop wallet.','RECONNECT');
    let value=await open(userId,row.whop_user_id,row.encrypted_tokens);
    if(Date.parse(value.expires_at)>now()+60000)return {userId:row.whop_user_id,token:value.access_token};
    if(refreshes.has(userId))return refreshes.get(userId);
    const refresh=(async()=>{
      const lease=crypto.randomUUID();
      if(!await store.claimWhopWalletRefresh(userId,row.version,lease))throw fail('Your wallet authorization is refreshing. Try again shortly.');
      try{
        const next=tokens(await oauth('token',{body:{grant_type:'refresh_token',client_id:setting('WHOP_OAUTH_CLIENT_ID'),refresh_token:value.refresh_token}}));
        const info=await oauth('userinfo',{token:next.access_token});if(info.sub!==row.whop_user_id)throw fail('Reconnect your personal Whop wallet.','RECONNECT');
        await store.finishWhopWalletRefresh(userId,lease,{encrypted_tokens:await seal(userId,row.whop_user_id,next),expires_at:next.expires_at});
        return {userId:row.whop_user_id,token:next.access_token};
      }finally{await store.releaseWhopWalletRefresh(userId,lease).catch(()=>{});}
    })();
    refreshes.set(userId,refresh);try{return await refresh;}finally{refreshes.delete(userId);}
  }
  return {configured,start,finish,credentials,redirectUri};
}
module.exports={createWhopUserAuth};
