// Run on a dedicated host. Never run this entry point on an agent VM.
const express=require('express'),crypto=require('node:crypto'),fs=require('node:fs'),puppeteer=require('puppeteer');
const {createPrivateCheckoutRuntime}=require('./runtime');
const token=String(process.env.PRIVATE_CHECKOUT_TOKEN||'');
if(token.length<32)throw Error('A private checkout server credential is required.');
const guard=fs.statSync('/run/belna-checkout/network-guard');
if(guard.uid!==0 || (guard.mode&0o022)!==0 || fs.readFileSync('/run/belna-checkout/network-guard','utf8').trim()!=='enabled')throw Error('The private checkout network guard is required.');
async function launchPrivateBrowser(){
  const profile=fs.mkdtempSync('/run/belna-checkout-browsers/profile-');
  try {
    const browser=await puppeteer.launch({headless:true,pipe:true,userDataDir:profile,
      env:{HOME:'/run/belna-checkout-browsers',PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},
      args:['--enable-automation','--disable-breakpad','--disable-crash-reporter'],
      ...(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{})});
    const close=browser.close.bind(browser);browser.close=async()=>{try{await close();}finally{fs.rmSync(profile,{recursive:true,force:true});}};
    return browser;
  }catch(error){fs.rmSync(profile,{recursive:true,force:true});throw error;}
}
const runtime=createPrivateCheckoutRuntime({launch:launchPrivateBrowser});
const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{const value=String(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(value),b=Buffer.from(token);
  res.setHeader('Cache-Control','no-store');if(req.method==='POST' && /^\/imports\/[a-f0-9-]{36}$/.test(req.path))return next();
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});next();});
app.use(express.json({limit:'2mb'}));
const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch{res.status(409).json({error:'Checkout needs a new review or owner assistance.'});}};
app.get('/health',run(()=>runtime.health()));app.post('/sessions',run(r=>runtime.create(r.body)));
app.post('/imports',run(r=>runtime.reserve(r.body)));app.post('/imports/:id',run(r=>runtime.importState(r.params.id,r.body)));
app.post('/sessions/:id/verify',run(r=>runtime.verify(r.params.id,r.body.approved)));
app.post('/sessions/:id/submit',run(r=>runtime.submit(r.params.id,r.body)));
app.delete('/sessions/:id',run(async r=>{await runtime.destroy(r.params.id);return {closed:true};}));
app.post('/sessions/:id/owner-state',run(r=>runtime.ownerState(r.params.id,r.body.userId)));
app.post('/sessions/:id/owner-input',run(r=>runtime.ownerInput(r.params.id,r.body.userId,r.body.event)));
app.post('/sessions/:id/owner-close',run(r=>runtime.ownerClose(r.params.id,r.body.userId)));
app.use((error,req,res,next)=>res.status(400).json({error:'Invalid checkout request.'}));
const server=app.listen(Number(process.env.PRIVATE_CHECKOUT_PORT||8020),'127.0.0.1');
const stop=async()=>{server.close();await runtime.closeAll();process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
