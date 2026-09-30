// Execute the actual HTML returned by live Luna, with network access disabled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const args=process.argv.slice(2),files=[];
for(let i=0;i<args.length;i++)if(args[i]==='--file')files.push({variant:'release',file:args[++i]});
if(!files.length)for(const variant of ['final-before','verified-after'])for(let i=1;i<=3;i++)files.push({variant,file:`artifacts/devday-2026/${variant}-build-${i}.json`});
const output=args.includes('--out')?args[args.indexOf('--out')+1]:'artifacts/devday-release/generated-games-quality.json';
(async()=>{
  const browser=await chromium.launch(),results=[];
  try{for(const {variant,file} of files){
    const sample=JSON.parse(fs.readFileSync(file))[0],html=sample.callArgs.filter(c=>c.name==='build_page').at(-1)?.args.html;
    assert.ok(html,'saved generated HTML required: '+file);
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
    const result={variant,file};
    try{
      let selector;for(const candidate of ['.cell','#board button','.board button','[data-cell]','.square'])if(await page.locator(candidate).count()===9){selector=candidate;break;}
      assert.ok(selector,'nine game cells');const cells=page.locator(selector);
      page.setDefaultTimeout(4000);
      const reset=page.getByRole('button',{name:/new (round|game)|restart|play again|reset game/i}).first();assert.ok(await reset.count(),'new game control');
      const twoPlayers=page.getByRole('button',{name:/two players|2 players|vs friend|vs human|multiplayer/i}).first();if(await twoPlayers.count())await twoPlayers.click();
      await cells.first().click();assert.match(await cells.first().textContent(),/X|O|×|✕/i,'click makes a move');await page.waitForTimeout(1000);
      const solo=(await cells.allTextContents()).filter(t=>t.trim()).length===2;
      const firstMark=await cells.first().textContent();if(await cells.first().isEnabled())await cells.first().click();assert.equal(await cells.first().textContent(),firstMark,'occupied cell cannot be overwritten');
      await reset.click();assert.ok((await cells.allTextContents()).every(t=>!t.trim()),'new game clears board');
      const status=page.locator('#status,#message,.status,[aria-live]').first();
      const statusText=async()=>await (await status.count()?status:page.locator('body')).textContent();
      if(solo){
        result.computerModeChecked=true;
        await cells.first().click();await reset.click();await page.waitForTimeout(1000);
        assert.ok((await cells.allTextContents()).every(t=>!t.trim()),'reset cancels pending computer reply');
        for(let turn=0;turn<5;turn++){
          let next=-1;for(let i=0;i<9;i++)if(await cells.nth(i).isEnabled() && !(await cells.nth(i).textContent()).trim()){next=i;break;}
          if(next<0)break;await cells.nth(next).click();await page.waitForTimeout(1000);
        }
        assert.match(await statusText(),/wins?|winner|victory|draw|tie/i,'computer game reaches an end state');
        const ended=await cells.allTextContents();for(let i=0;i<9;i++)if(await cells.nth(i).isEnabled())await cells.nth(i).click();assert.deepEqual(await cells.allTextContents(),ended,'no moves after computer game ends');
      }else{
        for(const i of [0,3,1,4,2])await cells.nth(i).click();
        assert.match(await statusText(),/wins?|winner|victory/i,'winning line recognized');
        const won=await cells.allTextContents();if(await cells.nth(5).isEnabled())await cells.nth(5).click();assert.deepEqual(await cells.allTextContents(),won,'no moves after win');
        await reset.click();for(const i of [0,1,2,4,3,5,7,6,8])await cells.nth(i).click();
        assert.match(await statusText(),/draw|tie/i,'draw recognized');
      }
      await reset.click();
      const computer=page.getByRole('button',{name:/vs[.\s]*(computer|ai)|computer mode|single player|play.*computer/i}).first();
      if(await computer.count()){
        await computer.click();await cells.first().click();await page.waitForTimeout(1000);
        assert.equal((await cells.allTextContents()).filter(t=>t.trim()).length,2,'advertised computer mode makes its reply');
        await reset.click();assert.ok((await cells.allTextContents()).every(t=>!t.trim()),'computer reset clears board');
        result.computerModeChecked=true;
      }
      assert.deepEqual(errors,[],'no runtime JavaScript errors');result.pass=true;
    }catch(e){result.pass=false;result.error=e.message;result.browserErrors=errors;}
    await page.close();results.push(result);console.log(result);
  }}finally{await browser.close();}
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2));
  if(results.some(r=>r.variant!=='final-before' && !r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
