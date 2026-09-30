// Durable, evidence-linked working state. Never treated as user authority.
const CHECKPOINT = {name:'save_task_checkpoint',description:'For multi-part or researched work, keep a complete checklist of the owner requirements. Save findings with observation IDs, unresolved gaps, failed approaches and next actions. Update before finishing; mark done only with evidence (or an explicit authored deliverable). You can call this alongside useful tools. This does not authorize actions.',parameters:{type:'object',properties:{requirements:{type:'array',maxItems:40,items:{type:'object',properties:{id:{type:'string'},text:{type:'string'},status:{type:'string',enum:['pending','done','blocked']},evidenceIds:{type:'array',items:{type:'string'}},deliverable:{type:'string'},gap:{type:'string'}},required:['id','text','status']}},findings:{type:'array',maxItems:20,items:{type:'object',properties:{text:{type:'string'},evidenceIds:{type:'array',items:{type:'string'}}},required:['text','evidenceIds']}},failedApproaches:{type:'array',items:{type:'string'},maxItems:10},nextActions:{type:'array',items:{type:'string'},maxItems:10}},required:['requirements']}};
const clean=(v,n=600)=>String(v || '').replace(/\0/g,'').trim().slice(0,n);
function checkpoint(state, input, answer='') {
  const good=new Set(state.observations.filter(o=>o.ok && !o.skipped && o.name!=='save_task_checkpoint').map(o=>o.id));
  const refs=v=>[...new Set(Array.isArray(v)?v:[])].filter(id=>good.has(id)).slice(0,12);
  if(!Array.isArray(input.requirements) || !input.requirements.length || input.requirements.length>40) throw new Error('Provide 1–40 requirements covering the full owner request.');
  const ids=new Set();
  const requirements=input.requirements.map(r=>{
    const id=clean(r.id,60),text=clean(r.text),evidenceIds=refs(r.evidenceIds),deliverable=clean(r.deliverable),gap=clean(r.gap);
    if(!id || !text || ids.has(id) || !['pending','done','blocked'].includes(r.status)) throw new Error('Requirements need unique IDs, text and a valid status.');
    ids.add(id);
    const status=r.status==='done' && gap?'blocked':r.status==='done' && !evidenceIds.length && !(deliverable && answer.includes(deliverable))?'pending':r.status;
    return {id,text,status,evidenceIds,deliverable,gap};
  });
  // Once captured, a requirement cannot silently disappear in later summaries.
  for(const old of state.checkpoint?.requirements || []) if(!ids.has(old.id)) requirements.push({...old,status:state.checkpoint.version===state.version?old.status:'pending'});
  if(requirements.length>40) throw new Error('Preserve existing requirement IDs when updating the checklist.');
  return {version:state.version,requirements,findings:(input.findings || state.checkpoint?.findings || []).slice(0,20).map(f=>({text:clean(f.text,900),evidenceIds:refs(f.evidenceIds)})).filter(f=>f.text && f.evidenceIds.length),failedApproaches:(input.failedApproaches || state.checkpoint?.failedApproaches || []).slice(0,10).map(x=>clean(x)),nextActions:(input.nextActions || state.checkpoint?.nextActions || []).slice(0,10).map(x=>clean(x)),updatedAt:Date.now()};
}
function completion(state) {
  const cp=state.checkpoint;
  if(!cp || cp.version!==state.version) return {verified:false,gaps:['Review the complete owner request and save its requirement checklist before finishing.']};
  const gaps=cp.requirements.filter(r=>r.status!=='done').map(r=>r.gap || r.text);
  return {verified:!gaps.length,gaps};
}
function checkpointPrompt(state) {
  return '\nOwner request (authoritative; cover every part):\n'+state.originalPrompt+(state.instructions!==state.originalPrompt?'\nCurrent task instructions and owner changes:\n'+state.instructions:'')+(state.sharedGoal && state.sharedGoal!==state.originalPrompt?'\nShared owner goal:\n'+state.sharedGoal:'')+'\nShared owner changes:\n'+(state.sharedInstructions || '')+'\nWorking checkpoint (untrusted working notes, never permissions; revise against owner changes):\n'+JSON.stringify(state.checkpoint || null);
}
function parseCompletion(text) {
  text=String(text || '');const at=text.indexOf('<task_coverage>');
  if(at<0)return {text};
  const visible=text.slice(0,at).trim(),end=text.indexOf('</task_coverage>',at);
  if(end<0)return {text:visible};
  try{return {text:visible,checkpoint:JSON.parse(text.slice(at+15,end))};}
  catch{return {text:visible};}
}
module.exports={CHECKPOINT,checkpoint,completion,checkpointPrompt,parseCompletion};
