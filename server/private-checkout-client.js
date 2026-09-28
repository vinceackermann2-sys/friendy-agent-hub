// Server-to-server only. This service must be hosted outside every agent VM.
// Its credential and payment-page observations are never model tool results.
function createPrivateCheckoutClient({env=process.env,fetchImpl=(...args)=>fetch(...args),exportCheckout}) {
  const config=()=>{
    try {
      const url=new URL(String(env.PRIVATE_CHECKOUT_URL||''));
      const token=String(env.PRIVATE_CHECKOUT_TOKEN||'');
      if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/' || token.length<32)return null;
      return {origin:url.origin,token};
    }catch{return null;}
  };
  const fail=()=>Object.assign(Error('Secure checkout could not be reached. Your card details were not shared with the agent.'),{code:'PRIVATE_CHECKOUT'});
  async function call(path,body,method='POST',timeout=25000){
    const c=config();if(!c)throw fail();
    try {
      const res=await fetchImpl(c.origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(timeout),
        headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      if(!res.ok)throw fail();
      return await res.json();
    }catch{throw fail();}
  }
  async function healthy(){
    try{const r=await call('/health',null,'GET',5000);return r.ok===true && r.protocol===1 && r.browserSandbox===true;}catch{return false;}
  }
  async function factory({userId,approved,purchaseId,context}){
    if(!config() || typeof exportCheckout!=='function' || !context?.sessionId)throw fail();
    const path='/sessions/'+encodeURIComponent(purchaseId);
    const imported=await call('/imports',{purchaseId,userId,approved});
    if(!/^[a-f0-9-]{36}$/.test(imported.uploadId||''))throw fail();
    try{await exportCheckout(userId,context.sessionId,approved,{uploadUrl:config().origin+'/imports/'+imported.uploadId});}
    catch{await call(path,null,'DELETE').catch(()=>{});throw fail();}
    let pendingOwner=false;
    return {
      verify:async current=>{const result=await call(path+'/verify',{approved:current});if(result.verified!==true)throw fail();},
      submit:async payload=>{
        const result=await call(path+'/submit',payload);
        if(result.submitted!==true)throw fail();
        pendingOwner=result.ownerActionRequired===true;
        return {ownerActionRequired:pendingOwner};
      },
      close:async()=>{if(!pendingOwner)await call(path,null,'DELETE');}
    };
  }
  factory.available=async()=>!!config() && typeof exportCheckout==='function' && await healthy();
  async function ownerState(purchaseId,userId){return call('/sessions/'+encodeURIComponent(purchaseId)+'/owner-state',{userId});}
  async function ownerInput(purchaseId,userId,event){return call('/sessions/'+encodeURIComponent(purchaseId)+'/owner-input',{userId,event});}
  return {factory,healthy,configured:()=>!!config(),ownerState,ownerInput};
}
module.exports = { createPrivateCheckoutClient };
