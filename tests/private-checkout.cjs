const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const puppeteer=require('puppeteer');
const {browserKit,buildCheckoutExportScript}=require('../server/agents/azure-vm');
const {createPrivateCheckoutRuntime,checkoutHash}=require('../server/private-checkout/runtime');
const {createPrivateCheckoutClient}=require('../server/private-checkout-client');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
const html=`<!doctype html><html><body><h1>Review your order</h1><p>Red mug</p><p>Ada, Main Street 1, Stockholm, SE</p><p>Order total: $12.34</p><label>Card number<input autocomplete="cc-number"></label><label>Expiry<input autocomplete="cc-exp"></label><label>Security code<input autocomplete="cc-csc"></label><button onclick="document.body.innerHTML='<h1>Authentication required</h1><input placeholder=Code><button>Verify payment</button>'">Pay $12.34</button></body></html>`;
let content=html;
async function launch(){
 const browser=await puppeteer.launch({headless:true,args:['--enable-automation'],...(chrome?{executablePath:chrome}:{})});
 const newPage=browser.newPage.bind(browser);
 browser.newPage=async()=>{const p=await newPage();await p.setRequestInterception(true);p.on('request',r=>{if(!r.isInterceptResolutionHandled())r.respond({status:200,contentType:'text/html',body:content});});return p;};
 return browser;
}
(async()=>{
 const url='https://merchant.example/checkout',userId='owner',id=crypto.randomUUID();
 const b=await launch(),p=await b.newPage();await p.setViewport({width:1280,height:900});await p.goto(url);
 const snapshot=await browserKit().snapshot(p),target=snapshot.elements.find(x=>/Pay \$12.34/.test(x));assert.ok(target);await b.close();
 const approved={website:url,paymentMethod:'belna_wallet',currency:'USD',amount:12.34,target,checkoutKey:checkoutHash(snapshot,target),shippingAddress:'Ada, Main Street 1, Stockholm, SE',items:[{title:'Red mug'}]};
 let clock=Date.now();const runtime=createPrivateCheckoutRuntime({launch,requestAllowed:async u=>new URL(u).hostname==='merchant.example',now:()=>clock,maxSessions:2});
 try{
  assert.equal((await runtime.health()).browserSandbox,true);
  const cap=await runtime.reserve({purchaseId:id,userId,approved});
  await assert.rejects(runtime.reserve({purchaseId:id,userId,approved}));
  await runtime.importState(cap.uploadId,{url,cookies:[],fields:[]});
  await assert.rejects(runtime.importState(cap.uploadId,{url}));
  assert.equal((await runtime.verify(id,approved)).verified,true);
  await assert.rejects(runtime.verify(id,{...approved,amount:13}));
  const card={expiration_month:'12',expiration_year:'2029',secrets:{card_number:'4242424242424242',cvc:'123'}};
  const result=await runtime.submit(id,{approved,purchaseId:id,card});assert.deepEqual(result,{submitted:true,ownerActionRequired:true});
  assert.ok(!JSON.stringify(result).includes('424242'));
  await assert.rejects(runtime.submit(id,{approved,purchaseId:id,card}));
  await assert.rejects(runtime.ownerState(id,'other-owner'));
  assert.ok((await runtime.ownerState(id,userId)).image.length>100);
  await assert.rejects(runtime.ownerInput(id,userId,{type:'evaluate',code:'alert(1)'}));
  await runtime.ownerInput(id,userId,{type:'click',x:30,y:70});
  clock+=16*60000;await assert.rejects(runtime.ownerState(id,userId));
  clock=Date.now();content=html.replace('$12.34','$20.00');
  await assert.rejects(runtime.create({purchaseId:crypto.randomUUID(),userId,approved,state:{url}}));
  content=html;
  await assert.rejects(runtime.create({purchaseId:crypto.randomUUID(),userId,approved:{...approved,website:'https://127.0.0.1/'},state:{url:'https://127.0.0.1/'}}));
  await assert.rejects(runtime.create({purchaseId:crypto.randomUUID(),userId,approved,state:{url,sensitivePresent:true}}));
 }finally{await runtime.closeAll();}
 const token='server-only-test-key'.repeat(3),calls=[];
 const client=createPrivateCheckoutClient({env:{PRIVATE_CHECKOUT_URL:'https://pay.example',PRIVATE_CHECKOUT_TOKEN:token},exportCheckout:async(...args)=>calls.push(args),fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'manual');return Response.json(url.endsWith('/imports')?{uploadId:crypto.randomUUID()}:url.endsWith('/health')?{ok:true,protocol:1,browserSandbox:true}:url.endsWith('/verify')?{verified:true}:url.endsWith('/submit')?{submitted:true,ownerActionRequired:true}:{closed:true});
 }});
 assert.equal(await client.factory.available(),true);const executor=await client.factory({userId,approved,purchaseId:id,context:{sessionId:'chat'}});assert.ok(!JSON.stringify(calls).includes(token));await executor.verify(approved);await executor.submit({approved,card:{}});await executor.close();
 const failed=createPrivateCheckoutClient({env:{PRIVATE_CHECKOUT_URL:'https://pay.example',PRIVATE_CHECKOUT_TOKEN:token},fetchImpl:async()=>{throw Error('PAN 4242424242424242 '+token);}});await assert.rejects(failed.ownerState(id,userId),e=>!e.message.includes(token)&&!e.message.includes('424242'));
 const script=buildCheckoutExportScript('tool_abcdef',url,'https://pay.example/imports/'+crypto.randomUUID());assert.ok(!script.includes(token));assert.ok(!script.includes('PRIVATE_CHECKOUT_TOKEN'));
 console.log('Private checkout: real Chromium, approved total/order binding, private card entry, duplicate refusal, owner challenge isolation, expiry, nonce replay and sanitized client errors passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
