const assert=require('node:assert/strict');
const foundryPath=require.resolve('../server/foundry');
const storePath=require.resolve('../server/store');
let answer={facts:[]},writes=[],updates=[],modelCalls=0;
require.cache[foundryPath]={id:foundryPath,filename:foundryPath,loaded:true,exports:{MODEL_FALLBACK:'cheap',callFoundry:async()=>{modelCalls++;return {text:JSON.stringify(answer),usage:null,model:'cheap'};}}};
require.cache[storePath]={id:storePath,filename:storePath,loaded:true,exports:{
  addMemory:async(userId,text,src,meta)=>{writes.push({userId,text,src,meta});return {id:'new-'+writes.length,text,src,category:meta.category};},
  updateMemory:async(userId,id,input)=>{updates.push({userId,id,input});return {id:'corrected',text:input.text,category:input.category};},
}};
const {maybeExtract,rankMemories}=require('../server/agents/memory');

(async()=>{
  const old=Array.from({length:205},(_,i)=>({id:'m'+i,text:'Unrelated note '+i,category:'long_term',status:'active'}));
  const explicit=await maybeExtract({userId:'u',prompt:'Remember that I prefer short answers',answer:'Okay',existing:old});
  assert.equal(explicit.saved.length,1,'explicit memory still saves after 200 existing entries');
  assert.equal(writes[0].meta.category,'user');
  assert.equal(writes[0].meta.importance,2);
  answer={facts:[{text:'User now lives in Malmö',category:'user',importance:3,supersedesId:'home'}]};
  const correction=await maybeExtract({userId:'u',prompt:'Actually, I now live in Malmö',answer:'Got it',existing:[{id:'home',text:'User lives in Stockholm',category:'user'}]});
  assert.equal(correction.saved[0].text,'User now lives in Malmö');
  assert.equal(updates[0].id,'home','correction supersedes prior memory');
  assert.equal(updates[0].input.importance,3);
  answer={facts:[{text:'User prefers concise answers',category:'user',importance:2}]};
  const implicit=await maybeExtract({userId:'u',prompt:'Keep your answers concise from now on',answer:'Understood',existing:[]});
  assert.equal(implicit.saved[0].text,'User prefers concise answers','implicit preferences are reviewed and saved');
  const calls=modelCalls;
  await maybeExtract({userId:'u',prompt:'Hello!',answer:'Hi',existing:[]});
  assert.equal(modelCalls,calls,'trivial greetings skip the extraction model');
  const secret=await maybeExtract({userId:'u',prompt:'Remember that my password: abc123456',answer:'',existing:[]});
  assert.equal(secret.saved.length,0);
  const before=writes.length+updates.length;
  const forgotten=await maybeExtract({userId:'u',prompt:'Forget my old address',answer:'Forgotten',existing:old});
  assert.equal(forgotten.saved.length,0);
  assert.equal(writes.length+updates.length,before,'forget request must not re-save a fact');
  assert.equal(rankMemories([{text:'User lives in Stockholm',status:'superseded',category:'user'}],'Where do I live?').length,0);
  // Chat and task turns pass infer:false: an explicit "remember" still saves, but no
  // extraction model runs (the agent's memory tools and hourly upkeep cover the rest).
  const beforeInfer=modelCalls,writesBefore=writes.length;
  const noInfer=await maybeExtract({userId:'u',prompt:'I just moved to Göteborg last week',answer:'Nice',existing:[],infer:false});
  assert.equal(noInfer.saved.length,0);assert.equal(modelCalls,beforeInfer,'no extraction model call');
  const explicitNoInfer=await maybeExtract({userId:'u',prompt:'Remember that I take my coffee black',answer:'Noted',existing:[],infer:false});
  assert.equal(explicitNoInfer.saved.length,1);assert.equal(writes.length,writesBefore+1);assert.equal(modelCalls,beforeInfer);
  console.log('memory behavior: automatic correction, no 200 cap, secret and superseded guards: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
