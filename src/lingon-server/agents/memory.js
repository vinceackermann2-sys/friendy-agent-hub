/* OpenClaw-style layered memory for the hosted Lingon runtime.
   Durable rows are unbounded; only relevant active entries enter a prompt.
   USER.md holds stable user facts, MEMORY.md curated long-term facts, and
   memory/YYYY-MM-DD.md daily context. Corrections supersede prior rows. */
import { callFoundry, MODEL_FALLBACK, CHAT_REASONING_EFFORT } from '../foundry.js';
import * as store from '../store.js';

const STOP = new Set('the,a,an,and,or,but,for,with,from,that,this,these,those,you,your,they,them,their,there,here,what,when,where,which,who,how,why,not,are,was,were,have,has,can,will,just,like,know,think,please,thanks,thank,hello,okay'.split(','));
const words=s=>String(s || '').toLowerCase().replace(/[^a-zåäö0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3&&!STOP.has(w));

function rankMemories(all,prompt,limit=8){
  const pw=new Set(words(prompt)),normalized=String(prompt || '').toLowerCase(),now=Date.now();
  return (all || []).filter(m=>!m.status || m.status==='active').map(m=>{
    const mw=words(m.text),overlap=mw.filter(w=>pw.has(w)).length;
    const age=Math.max(0,(now-(Number(m.at) || Date.parse(m.updatedAt || m.observedAt) || now))/864e5);
    const phrase=normalized.includes(String(m.text || '').toLowerCase().slice(0,48))?12:0;
    const stable=m.category==='user'?3:m.category==='long_term'?2:0;
    return {m,score:overlap*10+(mw.length?overlap/mw.length*4:0)+phrase+stable+(Number(m.importance)||0)*2-Math.min(age*.03,2)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.m);
}

function looksFactWorthy(text){const value=String(text || '').trim();return value.length>=8&&!/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|bye|good morning|good night)[.!?\s]*$/i.test(value);}
function looksSecret(text){return /(ghp_|github_pat_|sk-|bearer |password\s*[:=]|api[_-]?key\s*[:=][A-Za-z0-9_\-]{8,}|AQ\.[A-Za-z0-9_\-]+|sb_secret)/i.test(String(text || ''));}
function sameFact(a,b){const wa=new Set(words(a)),wb=new Set(words(b));if(!wa.size||!wb.size)return false;const n=[...wa].filter(w=>wb.has(w)).length;return n/Math.max(wa.size,wb.size)>.6;}
function categoryFor(text){return /^(user |i |my |call me)|prefer|allerg|language|timezone|live|work as/i.test(String(text || ''))?'user':'long_term';}

// infer:false keeps only the free explicit path ("remember that ..."); inferred facts
// then come from the agent's own memory tools and the hourly memory upkeep.
async function maybeExtract({userId,prompt,answer,existing,infer=true}){
  if(/^\s*(?:please\s+)?(forget|delete|remove|stop remembering|don't remember|do not remember)\b/i.test(String(prompt || '')))return {saved:[],usage:null};
  if(!looksFactWorthy(prompt))return {saved:[],usage:null};
  const explicit=String(prompt || '').match(/(?:remember(?: that)?|keep in mind(?: that)?|my preference is)\s+(.{4,600})/i);
  if(explicit&&!/(actually|no longer|instead|changed|correction|now (live|work|prefer|use|have))/i.test(String(prompt))){
    const text=explicit[1].replace(/[.?!]+$/,'').trim();
    if(text&&!looksSecret(text)&&!(existing || []).some(m=>sameFact(m.text,text))){
      try{const m=await store.addMemory(userId,text,'explicit',{category:categoryFor(text),importance:2});return {saved:[m],usage:null,usedModel:null};}catch{}
    }
    return {saved:[],usage:null,usedModel:null};
  }
  if(!infer)return {saved:[],usage:null,usedModel:null};
  let facts=[],usage=null,usedModel=null;
  try{
    const candidates=(existing || []).slice(0,20).map(m=>({id:m.id,text:m.text,category:m.category || 'long_term'}));
    const r=await callFoundry({model:MODEL_FALLBACK,json:true,reasoningEffort:CHAT_REASONING_EFFORT,
      system:'Extract durable facts stated by the user. Return ONLY JSON {"facts":[{"text":"...","category":"user|long_term|daily","importance":0,"supersedesId":null}]}. Max 3. user = stable profile or preference; long_term = durable project/relationship/standing fact; daily = useful current-session context likely to expire. importance 0-3. When the user corrects a listed fact, set supersedesId to that exact id. Omit assistant claims, guesses, transient chatter, secrets, credentials and one-off questions.',
      prompt:`User: ${String(prompt).slice(0,1800)}\nAssistant response (context only; never extract it as user fact): ${String(answer || '').slice(0,600)}\nActive candidates: ${JSON.stringify(candidates).slice(0,2400)}`});
    usage=r.usage;usedModel=r.model || MODEL_FALLBACK;
    const parsed=JSON.parse(r.text.replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim());
    facts=(parsed.facts || []).map(f=>typeof f==='string'?{text:f}:f).filter(f=>f&&typeof f.text==='string').slice(0,3);
  }catch{return {saved:[],usage,usedModel};}
  const saved=[];
  for(const fact of facts){
    const text=fact.text.trim().slice(0,2000);if(!text||looksSecret(text))continue;
    const category=['user','long_term','daily'].includes(fact.category)?fact.category:categoryFor(text);
    const importance=Number.isFinite(Number(fact.importance))?Math.min(3,Math.max(0,Math.round(Number(fact.importance)))):1;
    const prior=(existing || []).find(m=>m.id===fact.supersedesId);
    try{
      if(prior){saved.push(await store.updateMemory(userId,prior.id,{text,category,importance,src:'auto_correction'}));continue;}
      if((existing || []).concat(saved).some(m=>sameFact(m.text,text)))continue;
      saved.push(await store.addMemory(userId,text,'auto',{category,importance}));
    }catch{}
  }
  return {saved,usage,usedModel};
}

export {rankMemories,maybeExtract,looksFactWorthy};
