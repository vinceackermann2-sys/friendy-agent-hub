const crypto=require('node:crypto');
const {browserKit}=require('../agents/azure-vm');
const {publicUrlProblem,hostResolvesPublic}=require('../agents/sandbox');

const canonical=x=>JSON.stringify(x);
const flat=x=>String(x||'').replace(/\s+/g,' ').trim().toLowerCase();
function checkoutHash(snapshot,target){
  return crypto.createHash('sha256').update(`${snapshot.url}\n${String(snapshot.text||'').slice(-3500)}\n${(snapshot.elements||[]).join('\n').slice(0,6500)}\n${target||''}`).digest('hex');
}
function createPrivateCheckoutRuntime({launch,requestAllowed=async url=>!publicUrlProblem(url) && await hostResolvesPublic(new URL(url).hostname),now=()=>Date.now(),maxSessions=5}){
  const sessions=new Map(),imports=new Map(),creating=new Set(),kit=browserKit();
  const fail=()=>Object.assign(Error('This checkout needs a new review or owner assistance.'),{code:'CHECKOUT_UNAVAILABLE'});
  function session(id,userId){const s=sessions.get(id);if(!s || s.closed || s.expiresAt<=now() || (userId && s.userId!==userId))throw fail();return s;}
  async function destroy(id){for(const [key,x] of imports)if(x.purchaseId===id)imports.delete(key);const s=sessions.get(id);if(!s)return;s.closed=true;clearTimeout(s.timer);sessions.delete(id);try{await s.browser.close();}catch{}s.approved=null;s.state=null;}
  async function reserve(input){
    for(const [id,x] of imports)if(x.expiresAt<=now())imports.delete(id);
    if(imports.size+sessions.size+creating.size>=maxSessions || !/^[a-f0-9-]{36}$/.test(input?.purchaseId||'') || sessions.has(input.purchaseId) || creating.has(input.purchaseId) || [...imports.values()].some(x=>x.purchaseId===input.purchaseId))throw fail();
    const id=crypto.randomUUID();imports.set(id,{...JSON.parse(canonical(input)),expiresAt:now()+120000});return {uploadId:id};
  }
  async function importState(id,state){const input=imports.get(id);imports.delete(id);if(!input || input.expiresAt<=now())throw fail();return create({...input,state});}
  async function verify(s,approved){
    if(s.submitted || canonical(approved)!==canonical(s.approved))throw fail();
    const snapshot=await kit.snapshot(s.page);
    const target=(snapshot.elements||[]).find(x=>x.startsWith('['+s.ref+']'))||'';
    if(snapshot.url!==approved.website || target!==approved.target || checkoutHash(snapshot,target)!==approved.checkoutKey)throw fail();
    const text=flat(snapshot.text),money=approved.amount.toFixed(2);
    // Unknown layouts are refused before issuing a card. Amount must appear
    // beside an unambiguous final total, and approved delivery/items must be
    // visible. This is deliberately conservative across merchant layouts.
    const totals=[...text.matchAll(/(?:^|\s)(?:order total|grand total|total)\s*[:]?\s*(?:usd\s*|\$\s*)?(\d[\d,]*\.\d{2})(?:\s*usd)?(?=\s|$)/g)].map(x=>Number(x[1].replace(/,/g,'')));
    if(totals.length!==1 || totals[0]!==Number(money) || approved.currency!=='USD' || !text.includes(flat(approved.shippingAddress)) ||
      !Array.isArray(approved.items) || !approved.items.length || approved.items.some(x=>!text.includes(flat(x.title))))throw fail();
    return snapshot;
  }
  async function create({purchaseId,userId,approved,state}){
    if(!/^[a-f0-9-]{36}$/.test(purchaseId||'') || typeof userId!=='string' || !userId || !approved ||
      approved.paymentMethod!=='belna_wallet' || !Number.isFinite(approved.amount) || approved.amount<1 || approved.amount>2000 || !/^[a-f0-9]{64}$/.test(approved.checkoutKey||'') || sessions.has(purchaseId) || creating.has(purchaseId) || sessions.size+creating.size>=maxSessions)throw fail();
    if(!await requestAllowed(approved.website) || new URL(approved.website).protocol!=='https:' || !state || state.url!==approved.website || state.sensitivePresent)throw fail();
    const ref=String(approved.target||'').match(/^\[(\d+)\]/)?.[1];if(!ref)throw fail();
    creating.add(purchaseId);let browser,s;
    try{
      browser=await launch();
      const cdp=await browser.target().createCDPSession();
      try{const flags=(await cdp.send('Browser.getBrowserCommandLine')).arguments;
        if(!Array.isArray(flags) || flags.some(x=>/^--(?:no-sandbox|disable-(?:setuid-sandbox|seccomp-filter-sandbox|namespace-sandbox|web-security))(?:=|$)/.test(x)))throw fail();
        await cdp.send('Browser.setDownloadBehavior',{behavior:'deny',eventsEnabled:true});
      }finally{await cdp.detach();}
      const page=await browser.newPage();await page.setViewport({width:1280,height:900});
      const origin=new URL(approved.website).origin,host=new URL(origin).hostname;
      const cookies=(state.cookies||[]).filter(c=>{const domain=String(c.domain||'').replace(/^\./,'');return domain===host || host.endsWith('.'+domain);});
      if(cookies.length>300)throw fail();if(cookies.length)await browser.setCookie(...cookies);
      await page.setRequestInterception(true);
      page.on('request',r=>{requestAllowed(r.url()).then(ok=>{if(!r.isInterceptResolutionHandled())return ok?r.continue():r.abort();}).catch(()=>{if(!r.isInterceptResolutionHandled())r.abort().catch(()=>{});});});
      page.on('dialog',d=>d.dismiss().catch(()=>{}));
      browser.on('targetcreated',async target=>{if(target.type()==='page'){const popup=await target.page();if(popup && popup!==page)await popup.close().catch(()=>{});}});
      await page.evaluateOnNewDocument((expected,local,sessionStorageValues)=>{
        if(location.origin!==expected)return;
        for(const [k,v] of Object.entries(local||{}))localStorage.setItem(k,String(v));
        for(const [k,v] of Object.entries(sessionStorageValues||{}))sessionStorage.setItem(k,String(v));
      },origin,state.localStorage,state.sessionStorage);
      await page.goto(approved.website,{waitUntil:'domcontentloaded',timeout:20000});await kit.settle(page,1500);
      await page.evaluate(y=>scrollTo(0,y),Number(state.scrollY)||0);
      // Restore only non-payment, non-password form values. They remain part
      // of the page hash. Secrets from the shopping VM are not imported.
      await page.evaluate(values=>{for(const v of values||[]){const nodes=[...document.querySelectorAll('input,select,textarea')];const e=nodes.find(x=>v.id?x.id===v.id:v.name&&x.name===v.name);
        if(!e || /password|cc-|card|cvc|cvv|iban|one-time-code/i.test([e.type,e.autocomplete,e.name,e.id].join(' ')))continue;
        const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(e,String(v.value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}},state.fields);
      await kit.settle(page,500);
      s={browser,page,userId,approved:JSON.parse(canonical(approved)),ref,expiresAt:now()+15*60000,submitted:false,ownerActionRequired:false,closed:false};
      sessions.set(purchaseId,s);s.timer=setTimeout(()=>destroy(purchaseId),15*60000);s.timer.unref?.();
      await verify(s,approved);return {created:true};
    }catch{if(s)await destroy(purchaseId);else await browser?.close().catch(()=>{});throw fail();}finally{creating.delete(purchaseId);}
  }
  async function paymentFields(s){
    const origin=new URL(s.approved.website).origin,result=[];
    for(const frame of s.page.frames()){
      const url=frame.url();if(!/^https:/.test(url))continue;
      const f=new URL(url);
      const trusted=f.origin===origin || ['js.stripe.com','checkout.stripe.com','assets.braintreegateway.com','pay.google.com'].includes(f.hostname) ||
        /^(?:[a-z0-9-]+\.)*(?:checkoutshopper-live\.adyen\.com|checkout\.com)$/.test(f.hostname);
      if(!trusted)continue;
      for(const handle of await frame.$$('input,select')){
        const info=await handle.evaluate(e=>{const r=e.getBoundingClientRect();if(e.disabled || r.width<2 || r.height<2)return null;
          const label=[e.autocomplete,e.name,e.id,e.getAttribute('aria-label'),e.getAttribute('placeholder')].join(' ').toLowerCase();
          const kind=/cc-number|card.?number|cardnumber/.test(label)?'number':/cc-csc|cvc|cvv|security.?code/.test(label)?'cvc':/cc-exp-month|expir.*month|exp.?month/.test(label)?'month':/cc-exp-year|expir.*year|exp.?year/.test(label)?'year':/cc-exp|expir|expiry/.test(label)?'expiry':/cc-name|card.?holder|name.?on.?card/.test(label)?'name':null;
          return kind?{kind,tag:e.tagName}:null;});
        if(info)result.push({handle,...info});else await handle.dispose();
      }
    }
    const one=k=>result.filter(x=>x.kind===k);
    if(one('number').length!==1 || one('cvc').length!==1 || (one('expiry').length!==1 && !(one('month').length===1 && one('year').length===1)) || one('name').length>1)throw fail();
    return result;
  }
  async function submit(id,{approved,purchaseId,card}){
    const s=session(id);if(purchaseId!==id || s.submitted)throw fail();await verify(s,approved);
    const fields=await paymentFields(s);
    if(!/^\d{13,19}$/.test(card?.secrets?.card_number||'') || !/^\d{3,4}$/.test(card.secrets.cvc||''))throw fail();
    s.submitted=true;
    try{
      const before=await s.page.evaluate(()=>document.body.innerText);
      for(const f of fields){const value={number:card.secrets.card_number,cvc:card.secrets.cvc,month:card.expiration_month,year:card.expiration_year,
        expiry:card.expiration_month+'/'+String(card.expiration_year).slice(-2),name:card.secrets.name_on_card||''}[f.kind];
        if(!value)throw fail();
        if(f.tag==='SELECT'){const selected=await f.handle.evaluate((e,v)=>{const o=[...e.options].find(x=>x.value===v || x.text===v || Number(x.value)===Number(v));return o?.value;},value);if(selected==null)throw fail();await f.handle.select(selected);}
        else{await f.handle.click({clickCount:3});await f.handle.type(value);}
      }
      // No order text may change during credential entry. Never return this
      // observation (or any payment page) to the caller/model.
      if(s.page.url()!==approved.website || flat(await s.page.evaluate(()=>document.body.innerText))!==flat(before))throw fail();
      const target=await s.page.$('[data-lingon-ref="'+s.ref+'"]');if(!target)throw fail();
      await target.click();await kit.settle(s.page,1500);
      // Owner-only challenge view stays outside the agent tools/screencast.
      const frames=s.page.frames();s.ownerActionRequired=frames.some(f=>/3ds|three.?d.?secure|challenge|authentication/i.test(f.url())) ||
        await s.page.evaluate(()=>/verify.*(?:payment|purchase)|authentication required|one.?time.*code/i.test(document.body.innerText));
      if(!s.ownerActionRequired)await destroy(id);
      return {submitted:true,ownerActionRequired:s.ownerActionRequired};
    }catch{await destroy(id);throw fail();}
    finally{card=null;for(const f of fields)await f.handle.dispose().catch(()=>{});}
  }
  async function ownerState(id,userId){const s=session(id,userId);if(!s.submitted || !s.ownerActionRequired)throw fail();return {image:(await s.page.screenshot({type:'jpeg',quality:70})).toString('base64'),expiresAt:new Date(s.expiresAt).toISOString()};}
  async function ownerInput(id,userId,event){const s=session(id,userId);if(!s.submitted || !s.ownerActionRequired)throw fail();
    if(event?.type==='click' && Number.isFinite(event.x) && Number.isFinite(event.y) && event.x>=0 && event.x<1280 && event.y>=0 && event.y<900)await s.page.mouse.click(event.x,event.y);
    else if(event?.type==='type' && typeof event.text==='string' && event.text.length<=200)await s.page.keyboard.type(event.text);
    else if(event?.type==='key' && ['Enter','Tab','Escape','Backspace','ArrowUp','ArrowDown'].includes(event.key))await s.page.keyboard.press(event.key);
    else throw fail();return {ok:true};
  }
  async function health(){const browser=await launch();try{const cdp=await browser.target().createCDPSession();try{const flags=(await cdp.send('Browser.getBrowserCommandLine')).arguments;
    if(!Array.isArray(flags)||flags.some(x=>/^--(?:no-sandbox|disable-(?:setuid-sandbox|seccomp-filter-sandbox|namespace-sandbox|web-security))(?:=|$)/.test(x)))throw fail();
  }finally{await cdp.detach();}return {ok:true,protocol:1,browserSandbox:true};}finally{await browser.close();}}
  return {create,reserve,importState,verify:async(id,a)=>{await verify(session(id),a);return {verified:true};},submit,destroy,ownerState,ownerInput,
    health,closeAll:async()=>{imports.clear();await Promise.all([...sessions.keys()].map(destroy));}};
}
module.exports={createPrivateCheckoutRuntime,checkoutHash};
