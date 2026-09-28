// Local inspection fixture only. Never imports the backend or sends payments.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../app');
const init=`<script>
localStorage.setItem('lingon.session',JSON.stringify({access_token:'preview-only',user:{id:'wallet-preview',email:'preview@example.invalid'}}));
localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'wallet-preview',onboarded:true,agent:{name:'Belna',color:'lingon',pers:'Precise'},view:new URLSearchParams(location.search).get('wallet')==='settings'?'settings':'chat',settingsTab:'wallet',activeChat:'wallet-preview',chats:[{id:'wallet-preview',title:'Wallet preview',messages:[],at:Date.now()}],canvasTab:'payments',paymentOpenId:'belna-wallet',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
const cardNeedsConnection=new URLSearchParams(location.search).get('card')==='connect';
const wallet={configured:true,status:cardNeedsConnection?'verification_required':'ready',cardReady:!cardNeedsConnection,cardProgramAvailable:true,sandbox:true,card:null,balance:{available:125,pending:25},agentCardPayments:false};
let addresses=[{id:'preview-address-home',label:'Home',recipient:'Alex',line1:'Example Street 12',line2:'',city:'Stockholm',region:'',postalCode:'11122',country:'SE',isDefault:true,formatted:'Alex, Example Street 12, 11122 Stockholm, SE'}];
let preferences=JSON.parse(localStorage.getItem('wallet.preview.preferences')||'{"activeMethod":"belna_wallet","merchantEnabled":true}');
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,opts={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)throw Error('External services are disabled in this preview.');
 if(!url.pathname.startsWith('/api/'))return originalFetch(input,opts);
 const body=opts.body?JSON.parse(opts.body):{},p=url.pathname;let result={};
 if(p==='/api/wallet-preferences'){if(opts.method==='POST'){preferences={...preferences,...body};localStorage.setItem('wallet.preview.preferences',JSON.stringify(preferences));}result=preferences;}else if(p==='/api/wallet-history'){result={history:[{title:'Example Amazon purchase',amount:29,currency:'USD',status:'completed'}]};}else if(p.startsWith('/api/shipping-addresses')){
   if(p.endsWith('/save')){const value={...body,id:body.id||crypto.randomUUID(),isDefault:body.isDefault||addresses.length===0};value.formatted=[value.recipient,value.line1,value.line2,[value.postalCode,value.city].join(' '),value.region,value.country].filter(Boolean).join(', ');if(value.isDefault)addresses=addresses.map(a=>({...a,isDefault:false}));addresses=[...addresses.filter(a=>a.id!==value.id),value];}
   if(p.endsWith('/delete')){addresses=addresses.filter(a=>a.id!==body.id);if(addresses.length&&!addresses.some(a=>a.isDefault))addresses[0].isDefault=true;}
   result={addresses};
 }else if(p.startsWith('/api/belna-wallet')){
   if(p.endsWith('/controls')){if(typeof body.frozen==='boolean')wallet.card.status=body.frozen?'frozen':'active';if(body.dailyLimitUsd)wallet.dailyCardLimitUsd=body.dailyLimitUsd;}
   result={wallet,activity:[{title:'Example deposit',amount:125,status:'completed'},{title:'Example purchase · one-time card closed',amount:12.34,status:'completed'},{title:'Example payment received',amount:25,status:'pending'}],transactions:[],transfers:[]};
   if(p.endsWith('/quote'))result={quoteId:'preview-quote',recipient:body.recipient,amount:body.amount,currency:'USD',fees:'Preview only. No money is sent.'};
   if(p.endsWith('/send'))result={quoteId:'preview-quote',recipient:'Preview recipient',amount:10,currency:'USD',status:'succeeded',fees:'Preview only. No money was sent.'};
   if(p.endsWith('/deposit')||p.endsWith('/verify')||p.endsWith('/receive'))result={url:location.origin+'/?preview=true',amount:body.amount||25};
 }else if(p==='/api/shop-pay')result={shopPay:{configured:true,connected:false},orders:[]};
 return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
};
document.addEventListener('DOMContentLoaded',()=>{
 const notice=document.createElement('div');notice.textContent='Wallet preview · example balances · no real payments';notice.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff3ce;color:#624b16;border-radius:8px;padding:8px 14px;font:12px system-ui;pointer-events:none';document.body.append(notice);
 if(new URLSearchParams(location.search).get('wallet')!=='settings'){let attempts=0;const timer=setInterval(()=>{const toggle=document.querySelector('[data-act="togglecanvas"]');if(toggle){toggle.click();document.querySelector('[data-act="ctab"][data-t="payments"]')?.click();clearInterval(timer);}if(++attempts>100)clearInterval(timer);},100);}
});
</script>`;
http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/lingon\//,'/');
 const file=path.resolve(root,'.'+(pathname==='/'||pathname==='/app'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try {let data=fs.readFileSync(file);if(file.endsWith('index.html'))data=Buffer.from(data.toString().replace('<head>','<head>'+init));
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(8012,'127.0.0.1',()=>console.log('Wallet inspection preview: http://127.0.0.1:8012'));
