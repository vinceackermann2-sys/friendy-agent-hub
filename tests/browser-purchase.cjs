const assert = require('node:assert/strict');
const { createPurchaseFlow } = require('../server/agents/purchase');
const { approvalCard } = require('../server/agents/cards');
const { forbiddenPaymentSecret } = require('../server/agents/payment-safety');
const { createPaymentMethods } = require('../server/payment-methods');

(async () => {
  let local = {};
  const methods = createPaymentMethods({ supa:()=>null, loadLocal:()=>local, saveLocal:(v)=>{local=v;}, ensureProfile:async()=>{}, uid:()=> 'one' });
  const card = await methods.addPaymentMethod('owner', {merchant:'https://www.shop.example/checkout',brand:'Visa',last4:'4242',label:'Everyday card'});
  assert.deepEqual(await methods.listPaymentMethods('other'), [], 'card metadata is owner scoped');
  assert.equal((await methods.getPaymentMethod('owner',card.id)).last4,'4242');
  await assert.rejects(methods.addPaymentMethod('owner',{merchant:'shop.example',brand:'Visa',last4:'4242424242424242',label:'Bad'}),/last four/);
  assert.equal(forbiddenPaymentSecret('Visa card number','4111 1111 1111 1111'),true);
  assert.equal(forbiddenPaymentSecret('Visa CVC','123'),true);
  assert.equal(forbiddenPaymentSecret('Email password','hunter2'),false);

  const page = { url:'https://shop.example/checkout', text:'Basket: One lamp 2 × 100 SEK. Shipping: Ada, Main Street 1. Total 230 SEK. Place order',
    elements:['[7] button "Place order" @500,700'] };
  const live = { forTool:async()=>page, content:async()=>page };
  const flow = createPurchaseFlow({store:{getPaymentMethod:methods.getPaymentMethod},live});
  const args = {type:'click',ref:7,summary:'Place order',purchase:{website:'https://shop.example/checkout',items:[{title:'One lamp',quantity:2,price:100}],amount:230,currency:'SEK',shippingAddress:'Ada, Main Street 1, Stockholm',paymentMethodId:card.id}};
  const detail = await flow.approvalDetail(args,{userId:'owner',sessionId:'task'});
  const shown = approvalCard('browser_submit',args,detail,{},'call');
  assert.equal(shown.view.kind,'purchase');
  assert.equal(shown.view.website,'https://shop.example/checkout');
  assert.equal(shown.view.delivery[0],'Ada, Main Street 1, Stockholm');
  assert.equal(shown.view.payment,'Visa •••• 4242');
  assert.equal(shown.view.total,'SEK 230.00');
  await flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail});
  await assert.rejects(flow.beforeAction({type:'click',ref:7},{userId:'owner',sessionId:'task'}),/browser_submit/);
  await assert.rejects(flow.beforeAction({type:'click',x:500,y:700},{userId:'owner',sessionId:'task'}),/browser_submit/);
  await assert.rejects(flow.approvalDetail({type:'click',ref:7,summary:'Place order'},{userId:'owner',sessionId:'task'}),/purchase needs the items/);
  page.text = 'Total 250 SEK. Place order';
  await assert.rejects(flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail}),/Checkout changed/);
  page.text = 'Basket: One lamp 2 × 100 SEK. Shipping: Ada, Main Street 1. Total 230 SEK. Place order';
  page.url = 'https://evil.example/checkout';
  await assert.rejects(flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail}),/Checkout changed/);
  await methods.deletePaymentMethod('owner',card.id);
  assert.equal(await methods.getPaymentMethod('owner',card.id),null);
  const runtimeLive = require('../server/agents/live');
  const { TOOLS } = require('../server/agents/tools');
  const saved = {forTool:runtimeLive.forTool,takeOver:runtimeLive.takeOver,content:runtimeLive.content};
  const authPage={id:'live_bankid',url:'https://shop.example/login',title:'BankID login',userControl:false};
  runtimeLive.forTool=async()=>authPage;
  runtimeLive.takeOver=(session,on)=>{session.userControl=on;session.ownerSensitive ||= on;};
  runtimeLive.content=async()=>({url:authPage.url,title:authPage.title});
  try {
    const authDetail=await TOOLS.browser_auth_handoff.approvalDetail({method:'BankID'},{userId:'owner',sessionId:'task'});
    assert.equal(authPage.userControl,true,'owner gets control during BankID');
    const authCard=TOOLS.browser_auth_handoff.approvalCard({},authDetail);
    assert.equal(authCard.type,'auth_handoff');
    assert.equal(authCard.liveId,'live_bankid');
    await TOOLS.browser_auth_handoff.run({}, {userId:'owner',sessionId:'task',trace:()=>{}});
    assert.equal(authPage.userControl,false,'agent resumes after owner finishes');
  } finally {Object.assign(runtimeLive,saved);}
  console.log('browser purchase: owner scoped masked card, exact approval, stale checkout and direct-click guards: ok');
})().catch((e)=>{console.error(e);process.exitCode=1;});
