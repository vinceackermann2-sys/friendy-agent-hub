const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {createPurchaseFlow}=require('../server/agents/purchase');
const {createCheckoutHandoffTool}=require('../server/agents/checkout-handoff');
const {createPrivateCheckoutClient}=require('../server/private-checkout-client');
const {checkoutTotals}=require('../server/private-checkout/runtime');

(async()=>{
  const page={url:'https://merchant.example/checkout',text:'Checkout Red mug. Deliver to Ada, Main Street 1, Stockholm. Total 230 SEK',elements:[]};
  const flow=createPurchaseFlow({live:{forTool:async()=>page,content:async()=>page},wallet:{preferences:async()=>({spendingMethod:null,selectionSaved:true})}});
  const args={purchase:{website:page.url,items:[{title:'Red mug',quantity:1,price:230}],amount:230,currency:'SEK',shippingAddress:'Ada, Main Street 1, Stockholm'}};
  const ctx={userId:'owner',sessionId:'task'},approved=await flow.handoffDetail(args,ctx);
  assert.equal(approved.paymentMethod,'owner_checkout','manual checkout is possible with automatic spending off');
  assert.equal(approved.target,'');
  assert.deepEqual(checkoutTotals('Order total: SEK 1 234,56'),[1234.56]);
  assert.deepEqual(checkoutTotals('Total: $1,234.56'),[1234.56]);
  assert.deepEqual(checkoutTotals(page.text),[230]);
  assert.deepEqual(checkoutTotals('Subtotal: 200 SEK. Shipping: 30 SEK. Total: 230 SEK'),[230]);
  await assert.rejects(flow.handoffDetail({...args,purchase:{...args.purchase,website:'https://other.example/checkout'}},ctx));
  page.sensitivePresent=true;await assert.rejects(flow.handoffDetail(args,ctx));delete page.sensitivePresent;
  const paths=[],id=crypto.randomUUID(),expiresAt=new Date(Date.now()+600000).toISOString();
  const client=createPrivateCheckoutClient({env:{PRIVATE_CHECKOUT_URL:'https://private.example',PRIVATE_CHECKOUT_TOKEN:'server-token'.repeat(5)},
    exportCheckout:async(owner,task,cart,cap)=>{assert.equal(owner,'owner');assert.equal(task,'task');assert.deepEqual(cart,approved);assert.ok(cap.uploadUrl.startsWith('https://private.example/imports/'));assert.ok(!JSON.stringify(cap).includes('server-token'));},
    fetchImpl:async(url,opts)=>{paths.push({url,body:opts.body?JSON.parse(opts.body):null});return Response.json(url.endsWith('/health')?{ok:true,protocol:1,browserSandbox:true}:url.endsWith('/imports')?{uploadId:crypto.randomUUID()}:url.endsWith('/owner-state')?{image:'private-screenshot',website:'https://provider.example/?private=secret',expiresAt}:{closed:true});}});
  const tool=createCheckoutHandoffTool({purchaseFlow:flow,privateCheckout:client});
  const detail=await tool.approvalDetail(args,ctx),p=JSON.parse(detail),card=tool.approvalCard(args,detail);
  assert.equal(tool.approval,true);assert.equal(card.type,'checkout_handoff');
  assert.ok(!detail.includes('private-screenshot') && !detail.includes('private=secret') && !detail.includes('server-token'));
  const result=await tool.run(args,{...ctx,approvedDetail:detail});
  assert.equal(result.paymentConfirmed,false);assert.equal(result.status,'owner_finished');
  assert.equal(paths.at(-1).body.userId,'owner');assert.ok(paths.at(-1).url.endsWith('/owner-close'));
  assert.ok(!paths.some(x=>x.url.endsWith('/submit')),'handoff never submits an order');
  await assert.rejects(tool.run(args,{...ctx,approvedDetail:'{}'}));
  await assert.rejects(createPrivateCheckoutClient({env:{},exportCheckout:async()=>{}}).createOwnerHandoff({...ctx,approved}));
  // Both public API runtimes ignore a userId supplied in the request body.
  for(const file of ['server/index.js','src/lingon-server/index.js']){
    const source=fs.readFileSync(file,'utf8'),routes=source.slice(source.indexOf("for (const action of ['owner-state','owner-input','owner-close'])"),source.indexOf("for (const action of ['owner-state','owner-input']) app.post('/api/belna-wallet"));
    const handlers=new Map(),calls=[];
    vm.runInNewContext(routes,{app:{post:(path,...fns)=>handlers.set(path,fns.at(-1))},rateLimit:()=>()=>{},requireAuth:fn=>fn,
      privateCheckout:{ownerState:async(...a)=>{calls.push(a);return {};},ownerInput:async(...a)=>{calls.push(a);return {};},closeOwnerHandoff:async(...a)=>{calls.push(a);return {};}}});
    const res={setHeader:()=>{},json:()=>{},status:()=>res};
    for(const action of ['owner-state','owner-input','owner-close'])await handlers.get('/api/payments/checkouts/:id/'+action)({user:{id:'real-owner'},params:{id},body:{userId:'attacker',event:{type:'key',key:'Tab'}}},res);
    assert.ok(calls.every(a=>a[1]==='real-owner'),file+' uses authenticated ownership');
    const before=calls.length;await handlers.get('/api/payments/checkouts/:id/owner-state')({user:{id:'owner'},params:{id:'bad-id'}},res);assert.equal(calls.length,before);
    assert.ok(p.checkoutId);
  }
  console.log('Checkout handoff: reviewed cart, private boundary, manual payment with automation off, no submission/false confirmation, currency totals and owner-scoped Node/edge routes passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
