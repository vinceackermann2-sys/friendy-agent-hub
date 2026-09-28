function createWalletTools(wallet) {
  return {
    shipping_addresses: {
      name:'shipping_addresses',type:'function',approval:false,
      description:'Read the owner’s saved delivery addresses and default. Use the default unless the owner requests another. Copy formatted and id into purchase shippingAddress and shippingAddressId. Never guess an address or change saved addresses.',
      run:(_,ctx)=>wallet.addresses(ctx.userId),
    },
    wallet_set_limit: {
      name:'wallet_set_limit',type:'function',approval:true,
      description:'Change the Belna Wallet daily spending allowance when the owner requests it. Requires approval of the exact new dollar allowance. Never raise limits silently. Each purchase still needs its own approval.',
      approvalDetail:async({dailyLimitUsd})=>{
        if(typeof dailyLimitUsd!=='number' || !Number.isFinite(dailyLimitUsd) || dailyLimitUsd<1 || dailyLimitUsd>2000 || Math.abs(dailyLimitUsd*100-Math.round(dailyLimitUsd*100))>1e-8)throw new Error('Choose a daily allowance from $1 to $2,000.');
        return JSON.stringify({action:'Change daily spending allowance',dailyLimitUsd,currency:'USD'});
      },
      run:(args,ctx)=>{
        let approved;try{approved=JSON.parse(ctx.approvedDetail);}catch{}
        if(approved?.action!=='Change daily spending allowance' || approved.currency!=='USD' || approved.dailyLimitUsd!==args.dailyLimitUsd)throw new Error('Approve this exact spending allowance first.');
        return wallet.updateCard(ctx.userId,{dailyLimitUsd:approved.dailyLimitUsd});
      },
    },
    // Pausing only lowers risk, so it runs at once; resuming spending needs the owner's approval.
    wallet_pause: {
      name:'wallet_pause',type:'function',approval:true,
      description:'Pause (paused=true) or resume (paused=false) Belna Wallet card spending when the owner asks to freeze, pause, lock or unfreeze their card. Pausing runs at once and cancels purchase cards still waiting. Resuming needs the owner’s approval.',
      needsApproval:async({paused})=>paused!==true,
      approvalDetail:async({paused})=>{
        if(typeof paused!=='boolean')throw new Error('Say whether to pause (true) or resume (false) card spending.');
        return JSON.stringify({action:paused?'Pause card spending':'Resume card spending',paused});
      },
      run:(args,ctx)=>{
        if(typeof args.paused!=='boolean')throw new Error('Say whether to pause (true) or resume (false) card spending.');
        if(!args.paused){
          let approved;try{approved=JSON.parse(ctx.approvedDetail);}catch{}
          if(approved?.action!=='Resume card spending' || approved.paused!==false)throw new Error('The owner must approve resuming card spending first.');
        }
        return wallet.updateCard(ctx.userId,{frozen:args.paused});
      },
    },
    wallet_status: {
      name:'wallet_status', type:'function', approval:false,
      description:'Read the owner’s Belna Wallet balance, card status and activity. Never invent availability. Card checkout is unavailable until a secure bridge is enabled. Existing cards are spending only.',
      run: async (_, ctx) => ({...await wallet.snapshot(ctx.userId),paymentSelection:await wallet.preferences(ctx.userId)}),
    },
    wallet_receive: {
      name:'wallet_receive', type:'function', approval:true,
      description:'Create a Belna Wallet payment link for work the owner wants to be paid for. Requires approval of amount and description. Returns a link, not paid earnings. Label the URL Payment link. Fees and settlement times apply.',
      approvalDetail: async ({ amount, title }) => JSON.stringify({ amount, title, currency:'USD', requestKey:crypto.randomUUID() }),
      run: (args, ctx) => {
        let approved;
        try { approved=JSON.parse(ctx.approvedDetail); } catch {}
        if (!approved || approved.amount !== args.amount || approved.title !== args.title) throw new Error('Approve this exact payment link first.');
        return wallet.receive(ctx.userId, approved);
      },
    },
    wallet_send: {
      name:'wallet_send', type:'function', approval:true,
      description:'Send dollars to another Belna Wallet by the recipient’s Belna email. Requires one-time owner approval. $50 transfer allowance per 24 hours, separate from card limits. Partner fees may apply. Never use for existing cards.',
      approvalDetail: async (args, ctx) => JSON.stringify(await wallet.transferQuote(ctx.userId, args)),
      run: (args, ctx) => {
        let approved;
        try { approved=JSON.parse(ctx.approvedDetail); } catch {}
        if (!approved || approved.amount !== args.amount || approved.recipient !== String(args.recipient || '').trim().toLowerCase()) throw new Error('Approve this exact transfer first.');
        return wallet.send(ctx.userId, { quoteId:approved.quoteId, approvedDetail:ctx.approvedDetail });
      },
    },
  };
}
module.exports = { createWalletTools };
