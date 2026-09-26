const assert = require('node:assert/strict');
const { createPurchaseFlow } = require('../server/agents/purchase');
const { approvalCard } = require('../server/agents/cards');
const { forbiddenPaymentSecret } = require('../server/agents/payment-safety');

(async () => {
  assert.equal(forbiddenPaymentSecret('Visa card number','4111 1111 1111 1111'),true);
  assert.equal(forbiddenPaymentSecret('Visa CVC','123'),true);
  assert.equal(forbiddenPaymentSecret('Email password','hunter2'),false);

  const page = { url:'https://shop.example/checkout', text:'Basket: One lamp 2 × 100 SEK. Shipping: Ada, Main Street 1. Payment: Visa ending in 4242. Total 230 SEK. Place order',
    elements:['[6] radio "Shop Pay" @500,600','[7] button "Place order" @500,700'] };
  const live = { forTool:async()=>page, content:async()=>page };
  const flow = createPurchaseFlow({live});
  const args = {type:'click',ref:7,summary:'Place order',purchase:{website:'https://shop.example/checkout',items:[{title:'One lamp',quantity:2,price:100}],amount:230,currency:'SEK',shippingAddress:'Ada, Main Street 1, Stockholm',payment:{method:'saved_card',label:'Visa ending in 4242'}}};
  const detail = await flow.approvalDetail(args,{userId:'owner',sessionId:'task'});
  const shown = approvalCard('browser_submit',args,detail,{},'call');
  assert.equal(shown.view.kind,'purchase');
  assert.equal(shown.view.website,'https://shop.example/checkout');
  assert.equal(shown.view.delivery[0],'Ada, Main Street 1, Stockholm');
  assert.equal(shown.view.payment,'Visa ending in 4242');
  assert.equal(detail.includes('4242424242424242'),false);
  const withPayment = (payment) => ({...args,purchase:{...args.purchase,payment}});
  const shopPay = await flow.approvalDetail(withPayment({method:'shop_pay',label:'Shop Pay'}),{userId:'owner',sessionId:'task'});
  assert.equal(approvalCard('browser_submit',withPayment({method:'shop_pay',label:'Shop Pay'}),shopPay,{},'call').view.payment,'Shop Pay');
  await assert.rejects(flow.approvalDetail(withPayment(undefined),{userId:'owner',sessionId:'task'}),/Shop Pay or a card already saved/);
  await assert.rejects(flow.approvalDetail(withPayment({method:'new_card',label:'Visa ending in 4242'}),{userId:'owner',sessionId:'task'}),/Shop Pay or a card already saved/);
  await assert.rejects(flow.approvalDetail(withPayment({method:'saved_card',label:'Visa 4242 4242 4242 4242'}),{userId:'owner',sessionId:'task'}),/full card number/);
  await assert.rejects(flow.approvalDetail(withPayment({method:'saved_card',label:'Mastercard ending in 5555'}),{userId:'owner',sessionId:'task'}),/checkout page first/);
  assert.equal(shown.view.total,'SEK 230.00');
  await flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail});
  await assert.rejects(flow.beforeAction({type:'click',ref:7},{userId:'owner',sessionId:'task'}),/browser_submit/);
  await assert.rejects(flow.beforeAction({type:'click',x:500,y:700},{userId:'owner',sessionId:'task'}),/browser_submit/);
  await assert.rejects(flow.approvalDetail({type:'click',ref:7,summary:'Place order'},{userId:'owner',sessionId:'task'}),/purchase needs the items/);
  page.text = 'Total 250 SEK. Place order';
  await assert.rejects(flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail}),/Checkout changed/);
  page.text = 'Basket: One lamp 2 × 100 SEK. Shipping: Ada, Main Street 1. Payment: Visa ending in 4242. Total 230 SEK. Place order';
  page.url = 'https://evil.example/checkout';
  await assert.rejects(flow.beforeSubmit(args,{userId:'owner',sessionId:'task',approvedDetail:detail}),/Checkout changed/);
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
  console.log('browser purchase: Shop Pay or merchant-saved card only, exact approval, stale checkout and direct-click guards: ok');
})().catch((e)=>{console.error(e);process.exitCode=1;});
