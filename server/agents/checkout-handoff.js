// The private checkout service owns payment input. Only this reviewed cart and
// an expiring opaque id enter chat; no private browser observation enters tools.
function createCheckoutHandoffTool({purchaseFlow,privateCheckout}) {
  return {
    name:'browser_checkout_handoff',type:'browser',approval:true,sideEffects:false,
    description:'Prepare a reviewed checkout for the owner to finish in an isolated private browser. The owner chooses Swish, Klarna, PayPal, Shop Pay or card if the merchant offers it. Never request payment credentials in chat.',
    approvalDetail:async(args,ctx)=>{
      const approved=await purchaseFlow.handoffDetail(args,ctx);
      const handoff=await privateCheckout.createOwnerHandoff({userId:ctx.userId,sessionId:ctx.sessionId,approved});
      return JSON.stringify({...approved,...handoff});
    },
    approvalCard:(_args,detail)=>{
      const p=JSON.parse(detail);
      return {type:'checkout_handoff',checkoutId:p.checkoutId,expiresAt:p.expiresAt,
        merchant:p.merchant,website:p.website,items:p.items,amount:p.amount,currency:p.currency,shippingAddress:p.shippingAddress};
    },
    run:async(_args,ctx)=>{
      const p=JSON.parse(ctx.approvedDetail || '{}');
      if(!/^[a-f0-9-]{36}$/.test(p.checkoutId || '') || p.paymentMethod!=='owner_checkout')throw Error('This checkout needs a new handoff.');
      await privateCheckout.closeOwnerHandoff(p.checkoutId,ctx.userId);
      return {checkoutId:p.checkoutId,status:'owner_finished',paymentConfirmed:false,
        message:'The owner finished the private checkout. Payment is not verified by Belna. Do not submit or retry this order; the owner must check the merchant receipt or payment provider.'};
    },
  };
}
module.exports={createCheckoutHandoffTool};
