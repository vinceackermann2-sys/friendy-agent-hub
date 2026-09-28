const {chromium}=require('playwright'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const root='C:/Users/vince/.codex/visualizations/2026/09/27/01a0e3f5-8096-7e51-bf15-8afdd06ff36a';
 try{
  await page.goto('http://127.0.0.1:8012/?wallet=settings');await page.locator('#wallet-settings-content .wallet-address').waitFor();
  await page.screenshot({path:path.join(root,'wallet-settings.png')});
  await page.goto('http://127.0.0.1:8012/?wallet=clean');await page.getByText('Available balance',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#canvas')?.getAnimations().some(a=>a.playState==='running'));
  await page.locator('#canvas').screenshot({path:path.join(root,'wallet-panel.png')});
  console.log(JSON.stringify({errors,screenshots:['wallet-settings.png','wallet-panel.png']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
