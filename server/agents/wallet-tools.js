function createWalletTools(wallet) {
  return {
    shipping_addresses: {
      name:'shipping_addresses',type:'function',approval:false,
      description:'Read the owner’s saved delivery addresses and default. Use the default unless the owner requests another. Copy formatted and id into purchase shippingAddress and shippingAddressId. Never guess an address or change saved addresses.',
      run:(_,ctx)=>wallet.addresses(ctx.userId),
    },
    wallet_set_limit: {
      name:'wallet_set_limit',type:'function',approval:true,
      description:'Change the daily allowance for user-owned USDC wallet requests through Belna. Maximum $50 per 24 hours. Requires approval of the exact allowance. Every money movement also requires the owner to authorize it in their wallet.',
      approvalDetail:async({dailyLimitUsd})=>{
        if(typeof dailyLimitUsd!=='number' || !Number.isFinite(dailyLimitUsd) || dailyLimitUsd<0.01 || dailyLimitUsd>50 || Math.abs(dailyLimitUsd*100-Math.round(dailyLimitUsd*100))>1e-8)throw new Error('Choose a daily allowance from $0.01 to $50.');
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
      description:'Pause (paused=true) or resume (paused=false) new wallet requests through Belna. Pausing runs at once. Resuming requires owner approval. This does not freeze the user-owned wallet or cancel transactions already submitted.',
      needsApproval:async({paused})=>paused!==true,
      approvalDetail:async({paused})=>{
        if(typeof paused!=='boolean')throw new Error('Say whether to pause (true) or resume (false) wallet requests.');
        return JSON.stringify({action:paused?'Pause wallet requests':'Resume wallet requests',paused});
      },
      run:(args,ctx)=>{
        if(typeof args.paused!=='boolean')throw new Error('Say whether to pause (true) or resume (false) wallet requests.');
        if(!args.paused){
          let approved;try{approved=JSON.parse(ctx.approvedDetail);}catch{}
          if(approved?.action!=='Resume wallet requests' || approved.paused!==false)throw new Error('The owner must approve resuming wallet requests first.');
        }
        return wallet.updateCard(ctx.userId,{frozen:args.paused});
      },
    },
    wallet_status: {
      name:'wallet_status', type:'function', approval:false,
      description:'Read the owner’s USDC balance on Base, wallet activity, pending owner requests and Earn availability. Every money movement needs owner wallet authorization. Cards are an interest waitlist in Sweden. Never claim a bank balance, guaranteed yield or completion from a pending status.',
      run: async (_, ctx) => ({...await wallet.snapshot(ctx.userId),paymentSelection:await wallet.preferences(ctx.userId)}),
    },
    wallet_send: {
      name:'wallet_send', type:'function', approval:true,
      description:'Prepare an exact USDC transfer on Base to a confirmed Belna email or Base wallet address. This tool never moves money: after approval it leaves an owner request in Wallet. Tell the owner to review and authorize it there. Belna enforces a $50 daily allowance, and network/provider fees may apply. Never say money was sent from an awaiting_owner result.',
      approvalDetail: async (args, ctx) => JSON.stringify(await wallet.transferQuote(ctx.userId, {...args,kind:'send'})),
      run: (args, ctx) => {
        let approved;
        try { approved=JSON.parse(ctx.approvedDetail); } catch {}
        if (!approved || approved.amount !== args.amount || approved.recipient !== String(args.recipient || '').trim().toLowerCase()) throw new Error('Approve this exact transfer first.');
        return wallet.send(ctx.userId, { quoteId:approved.quoteId, approvedDetail:ctx.approvedDetail });
      },
    },
    wallet_earn: {
      name:'wallet_earn',type:'function',approval:true,
      description:'Prepare an owner-requested Earn deposit or withdrawal in the configured USDC vault on Base. action must be deposit or withdraw; amount is USDC. Never choose investments or allocate funds autonomously. Yield is variable and losses/withdrawal delays are possible. Approval creates a request; the owner must separately accept the risks and authorize it in Wallet.',
      approvalDetail:async(args,ctx)=>{if(!['deposit','withdraw'].includes(args.action))throw new Error('Choose deposit or withdraw.');return JSON.stringify(await wallet.transferQuote(ctx.userId,{kind:'earn_'+args.action,amount:args.amount}));},
      run:(args,ctx)=>{let approved;try{approved=JSON.parse(ctx.approvedDetail);}catch{}if(!['deposit','withdraw'].includes(args.action)||approved?.kind!=='earn_'+args.action||approved.amount!==args.amount)throw new Error('Approve this exact Earn request first.');return wallet.send(ctx.userId,{quoteId:approved.quoteId,approvedDetail:ctx.approvedDetail});},
    },
  };
}
module.exports = { createWalletTools };
