const assert=require('node:assert/strict');
const {chromium}=require('playwright');
// The chat panel's Mail tab uses the Wallet panel's layout: heading with the address, round
// folder buttons, then the folder, message or new message.
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>{
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'audit@example.invalid'}}));
   if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'mail-chat',chats:[{id:'mail-chat',title:'Mail',messages:[],at:Date.now()}],canvasTab:'mail',mailTab:'inbox',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  });
  const now=Date.now(),requests=[];let unread=1,sentRows=[];
  const inbox=[{id:'m1',folder:'inbox',direction:'inbound',from:'anna@example.com',fromName:'Anna',to:['audit@mail.belna.se'],subject:'Viewing on Thursday',preview:'The viewing is at 17:00.',isRead:false,at:now-20*60000}];
  const drafts=[{id:'d1',to:['anna@example.com'],subject:'Signed form',bodyText:'Attached.'}];
  let releaseSent;const sentGate=new Promise(r=>{releaseSent=r;});
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,body=req.postData()?JSON.parse(req.postData()):{};
   if(req.method()==='POST')requests.push({path,body});
   const box=folder=>({configured:true,address:'audit@mail.belna.se',unread,drafts,receivingHint:'',folder,messages:folder==='sent'?sentRows:folder==='inbox'?inbox.map(m=>({...m,isRead:!unread})):[]});
   let result={};
   if(path==='/api/mail'){const folder=url.searchParams.get('folder')||'inbox';if(folder==='sent')await sentGate;result=box(folder);}
   else if(path==='/api/mail/ensure')result=box('inbox');
   else if(path==='/api/mail/messages/m1'){unread=0;result={message:{...inbox[0],isRead:true,bodyText:'The viewing is at 17:00.\nBring the form.',messageId:'<m1@example.com>'}};}
   else if(path==='/api/mail/send'){sentRows=[{id:'s1',folder:'sent',direction:'outbound',from:'audit@mail.belna.se',fromName:'Audit',to:[body.to],subject:body.subject,preview:body.body,isRead:true,at:Date.now()}];result={ok:true,mailbox:box('sent')};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
  await page.goto(process.env.UI_BASE||'http://127.0.0.1:8000/app');
  await page.waitForTimeout(500);
  if(!(await page.locator('#cbody').isVisible().catch(()=>false)))await page.locator('[data-act="togglecanvas"]').first().click();
  const panel=page.locator('.mail-panel');
  await panel.getByText('Viewing on Thursday').waitFor();
  // The Wallet layout: heading with the address, four round buttons, then a titled list.
  assert.equal(await panel.locator('.wl-head h3').innerText(),'Mail');
  assert.match(await panel.locator('.mail-address').innerText(),/audit@mail\.belna\.se\s*Copy/);
  assert.deepEqual((await panel.locator('.wl-act').allInnerTexts()).map(t=>t.replace(/\d+/g,'').trim()),['Write','Inbox','Sent','Drafts']);
  assert.equal(await panel.locator('.wl-act.on').innerText().then(t=>t.replace(/\d+/g,'').trim()),'Inbox');
  assert.equal(await panel.locator('.wl-act[data-t="inbox"] .mail-badge').innerText(),'1');
  assert.equal(await panel.locator('.wl-sec-head').innerText().then(t=>t.replace(/\s+/g,' ')),'Inbox 1 unread');
  assert.equal(await panel.locator('.mail-row.unread').count(),1);
  assert.equal(await panel.locator('.appr-filter,.warnband').count(),0,'no pill filters or warning band from the old layout');
  // Reading marks it read, and the Mail tab badge follows.
  await panel.locator('.mail-row').first().click();await panel.locator('.mail-read-subject').waitFor();
  assert.equal(await panel.locator('.mail-read-subject').innerText(),'Viewing on Thursday');
  assert.match(await panel.locator('.mail-from').innerText(),/Anna[\s\S]*anna@example\.com · to audit@mail\.belna\.se/);
  assert.equal(await page.locator('.canvas-tab[data-t="mail"] .cnt').count(),0);
  assert.equal(await panel.locator('.mail-badge').count(),0);
  // Reply opens the form prefilled; Write becomes Close.
  await panel.getByRole('button',{name:'Reply',exact:true}).click();await panel.locator('.mail-compose').waitFor();
  assert.equal(await panel.locator('#m-to').inputValue(),'anna@example.com');
  assert.equal(await panel.locator('#m-subject').inputValue(),'Re: Viewing on Thursday');
  assert.equal(await panel.locator('.wl-act.on').innerText(),'Close');
  assert.equal(await panel.locator('.mail-compose-head').innerText().then(t=>t.replace(/\s+/g,' ')),'Reply from audit@mail.belna.se');
  assert.ok(await panel.locator('#m-body').evaluate(el=>el.offsetHeight<160),'the message box starts small');
  await panel.locator('#m-body').fill('I will bring it.');
  // Files: attach two, remove one. Typing and files survive a repaint.
  await page.locator('#m-file-input').setInputFiles([{name:'form.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 form')},{name:'photo.png',mimeType:'image/png',buffer:Buffer.from('png bytes')}]);
  await panel.locator('.mail-file:not(.loading)').nth(1).waitFor();
  assert.match(await panel.locator('.mail-files').innerText(),/form\.pdf[\s\S]*photo\.png/);
  await panel.getByRole('button',{name:'Remove photo.png',exact:true}).click();
  assert.equal(await panel.locator('.mail-file').count(),1);
  await panel.getByRole('button',{name:'Refresh mail',exact:true}).click();await page.waitForTimeout(300);
  assert.equal(await panel.locator('#m-body').inputValue(),'I will bring it.');
  assert.equal(await panel.locator('.mail-file').innerText().then(t=>t.includes('form.pdf')),true);
  await panel.getByRole('button',{name:'Send',exact:true}).click();
  await panel.locator('.wl-sec-head h4').getByText('Sent',{exact:true}).waitFor();
  const sendBody=requests.find(x=>x.path==='/api/mail/send').body;
  assert.equal(sendBody.inReplyTo,'<m1@example.com>');
  assert.deepEqual(sendBody.attachments,[{filename:'form.pdf',content:Buffer.from('%PDF-1.4 form').toString('base64'),contentType:'application/pdf'}]);
  assert.equal(dialogs.at(-1),'Send this email with 1 file as Audit?');
  assert.match(await panel.locator('.mail-row').innerText(),/To anna@example\.com[\s\S]*Re: Viewing on Thursday/);
  // Switching folder shows loading until that folder arrives, never the last folder's mail.
  await panel.locator('.wl-act[data-t="inbox"]').click();await panel.getByText('Viewing on Thursday').waitFor();
  await panel.locator('.wl-act[data-t="sent"]').click();
  assert.equal(await panel.locator('.wl-empty').innerText(),'Loading mail…');
  assert.equal(await panel.getByText('Viewing on Thursday').count(),0);
  releaseSent();await panel.getByText('Re: Viewing on Thursday').waitFor();
  // Drafts open in the form.
  await panel.locator('.wl-act[data-t="drafts"]').click();await panel.getByText('Signed form').click();
  assert.equal(await panel.locator('.mail-compose-head b').innerText(),'Edit draft');assert.equal(await panel.locator('.mail-file').count(),0,'a new form starts without files');
  assert.equal(await panel.locator('#m-draft').inputValue(),'d1');
  assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('#cbody').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.deepEqual(errors,[]);
  await context.close();
 }}finally{await browser.close();}
 console.log('mail UI: ok');
})().catch(e=>{console.error(e);process.exit(1);});
