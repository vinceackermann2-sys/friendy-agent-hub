const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const puppeteer=require('puppeteer');
const {browserKit,buildCheckoutExportScript}=require('../server/agents/azure-vm');
const {createPrivateCheckoutRuntime,checkoutHash,addressShown}=require('../server/private-checkout/runtime');
// A saved address shown the merchant's way (lines, spaced postal code, country by name) matches;
// a missing or different part does not.
const saved={shippingAddress:'Ada Lovelace, Main Street 1, 11122 Stockholm, SE',shippingAddressParts:{recipient:'Ada Lovelace',line1:'Main Street 1',line2:'',postalCode:'11122',city:'Stockholm'}};
assert.equal(addressShown('Deliver to\nAda Lovelace\nMain Street 1\n111 22 Stockholm\nSweden',saved),true);
assert.equal(addressShown('Deliver to Ada Lovelace, Main Street 1, Stockholm',saved),false,'postal code missing');
assert.equal(addressShown('Deliver to Ada Lovelace, Main Street 9, 111 22 Stockholm',saved),false,'another street');
assert.equal(addressShown('Ship to Ada Lovelace Main Street 1 Stockholm 111 22',{shippingAddress:saved.shippingAddress}),true,'a typed address matches part by part');
assert.equal(addressShown('Ship to Ada Lovelace Main Street 1 Stockholm',{shippingAddress:'Ada, Other Road 5, Stockholm, SE'}),false);
assert.equal(addressShown('Anything',{shippingAddress:''}),false,'no address is never a match');
const {createPrivateCheckoutClient}=require('../server/private-checkout-client');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
const html=`<!doctype html><html><body><h1>Review your order</h1><p>Red mug</p><p>Ada, Main Street 1, Stockholm, SE</p><p>Order total: $12.34</p><label>Card number<input autocomplete="cc-number"></label><label>Expiry<input autocomplete="cc-exp"></label><label>Security code<input autocomplete="cc-csc"></label><button onclick="document.body.innerHTML='<h1>Authentication required</h1><input placeholder=Code><button>Verify payment</button>'">Pay $12.34</button></body></html>`;
let content=html,latestPage;
async function launch(){
 const browser=await puppeteer.launch({headless:true,args:['--enable-automation'],...(chrome?{executablePath:chrome}:{})});
 const newPage=browser.newPage.bind(browser);
 browser.newPage=async()=>{const p=await newPage();latestPage=p;await p.setRequestInterception(true);p.on('request',r=>{if(!r.isInterceptResolutionHandled())r.respond({status:200,contentType:'text/html',body:content});});return p;};
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
  // Owner checkout imports the exact cart, supports SEK, and never lets the
  // agent submit or read private payment fields after the transfer.
  content=html.replaceAll('$12.34','230 SEK');
  const previewBrowser=await launch(),preview=await previewBrowser.newPage();await preview.setViewport({width:1280,height:900});await preview.goto(url);
  const handoffSnapshot=await browserKit().snapshot(preview);await previewBrowser.close();
  const ownerApproved={...approved,paymentMethod:'owner_checkout',currency:'SEK',amount:230,target:'',checkoutKey:checkoutHash(handoffSnapshot,'')};
  const ownerId=crypto.randomUUID();
  await runtime.create({purchaseId:ownerId,userId,approved:ownerApproved,state:{url}});
  assert.equal((await runtime.ownerState(ownerId,userId)).website,url);
  await assert.rejects(runtime.ownerState(ownerId,'another-owner'));await assert.rejects(runtime.ownerState(ownerId));
  await assert.rejects(runtime.ownerInput(ownerId,'another-owner',{type:'type',text:'secret'}));
  await assert.rejects(runtime.ownerClose(ownerId,'another-owner'));
  await assert.rejects(runtime.submit(ownerId,{purchaseId:ownerId,approved:ownerApproved,card}));
  await runtime.ownerInput(ownerId,userId,{type:'key',key:'Tab'});
  await runtime.ownerInput(ownerId,userId,{type:'type',text:'4242424242424242'});
  await runtime.ownerInput(ownerId,userId,{type:'scroll',dy:650});
  await latestPage.goto('http://merchant.example/checkout');
  await assert.rejects(runtime.ownerState(ownerId,userId),'private screens require HTTPS');
  await assert.rejects(runtime.ownerInput(ownerId,userId,{type:'type',text:'secret'}),'payment input is refused on HTTP');
  assert.deepEqual(await runtime.ownerClose(ownerId,userId),{closed:true});
  await assert.rejects(runtime.ownerState(ownerId,userId));
  await assert.rejects(runtime.create({purchaseId:crypto.randomUUID(),userId,approved:{...ownerApproved,amount:231},state:{url}}),'a mismatching total cannot enter owner checkout');
  await assert.rejects(runtime.create({purchaseId:crypto.randomUUID(),userId,approved:{...ownerApproved,currency:'USD'},state:{url}}),'a mismatching currency cannot enter owner checkout');
  const expiring=crypto.randomUUID();await runtime.create({purchaseId:expiring,userId,approved:ownerApproved,state:{url}});
  clock+=16*60000;await assert.rejects(runtime.ownerState(expiring,userId));clock=Date.now();
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
