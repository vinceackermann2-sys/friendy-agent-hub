// Grants are owner settings, never agent-authored memory or tool output.
const SCOPED_TOOLS=new Set(['composio_execute','connector_call','web_search','browser_open']);
function normalizeGrant(input) {
  const tool=String(input.tool || ''),effect=input.effect;
  if(!SCOPED_TOOLS.has(tool) || !['allow','deny'].includes(effect))throw new Error('Choose a supported tool and allow or deny.');
  const match=input.match;
  if(!match || Array.isArray(match) || typeof match!=='object' || !Object.keys(match).length || JSON.stringify(match).length>2000)throw new Error('A grant must name an exact action and scope.');
  const valid=v=>v===null || ['string','number','boolean'].includes(typeof v) || (Array.isArray(v)?v.length<=100 && v.every(valid):typeof v==='object' && Object.keys(v).every(k=>!['__proto__','constructor','prototype'].includes(k) && valid(v[k])));
  if(!valid(match))throw new Error('Scope values must be exact scalar values or objects.');
  if(tool==='composio_execute' && (!match.tool || !match.connectedAccountId))throw new Error('Name the exact connected account and tool.');
  if(tool==='connector_call' && (!match.connector || !(match.tool || (match.method && match.path))))throw new Error('Name the exact connector and tool.');
  if(['web_search','browser_open'].includes(tool) && !match.url)throw new Error('Name an exact HTTPS URL.');
  if(match.url && !/^https:\/\/[^/\s]+/i.test(match.url))throw new Error('Use an HTTPS URL.');
  const expiresAt=Date.parse(input.expiresAt);
  if(!Number.isFinite(expiresAt) || expiresAt<=Date.now() || expiresAt>Date.now()+90*86400000)throw new Error('Choose an expiry within 90 days.');
  return {tool,effect,scopeMode:input.scopeMode==='subset'?'subset':'exact',match:structuredClone(match),expiresAt:new Date(expiresAt).toISOString(),label:String(input.label || tool).slice(0,120)};
}
function exactMatch(a,b){return a===b || (!!a && !!b && typeof a==='object' && typeof b==='object' && Array.isArray(a)===Array.isArray(b) && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>Object.hasOwn(b,k) && exactMatch(a[k],b[k])));}
function scopeMatches(match,args) {
  return Object.entries(match).every(([k,v])=>Object.hasOwn(args || {},k) && (Array.isArray(v)?exactMatch(v,args[k]):v && typeof v==='object'?scopeMatches(v,args[k]):v===args[k]));
}
function grantDecision(grants,name,args,now=Date.now()) {
  const {activity,...meaningful}=args || {};
  const {urls,...webArgs}=meaningful;
  const actual=name==='web_search'?{...webArgs,url:Array.isArray(urls) && urls.length===1?urls[0]:undefined}:meaningful;
  const matches=(grants || []).filter(g=>g.tool===name && !g.revokedAt && Date.parse(g.expiresAt)>now && (g.scopeMode==='subset'?scopeMatches(g.match,actual):exactMatch(g.match,actual)));
  if(matches.some(g=>g.effect==='deny'))return {denied:true,required:true};
  const allow=matches.find(g=>g.effect==='allow');return allow?{required:false,grantId:allow.id}:null;
}
function createScopedPermissionStore({supa,loadLocal,saveLocal,ensureProfile,uid}){
  const view=r=>({id:r.id,tool:r.tool,effect:r.effect,match:r.scope,scopeMode:r.scope_mode || 'exact',label:r.label,expiresAt:r.expires_at,revokedAt:r.revoked_at});
  async function listPermissionGrants(userId){const s=supa();if(s){const {data,error}=await s.from('agent_permission_grants').select('*').eq('user_id',userId).is('revoked_at',null).order('created_at',{ascending:false}).limit(100);if(error)throw error;return (data || []).map(view);}return (loadLocal().permissionGrants || []).filter(r=>r.user_id===userId && !r.revoked_at).map(view);}
  async function createPermissionGrant(userId,input,options={}){const g=normalizeGrant(input);if((await listPermissionGrants(userId)).length>=100)throw new Error('Revoke an existing grant first.');const key=/^[a-f0-9-]{36}$/.test(String(options.idempotencyKey || ''))?options.idempotencyKey:uid();const row={id:'grant_'+key,user_id:userId,tool:g.tool,effect:g.effect,scope:g.match,scope_mode:g.scopeMode,label:g.label,expires_at:g.expiresAt,revoked_at:null};const s=supa();if(s){await ensureProfile(userId);const {error}=await s.from('agent_permission_grants').insert(row);if(error?.code==='23505'){const prior=await s.from('agent_permission_grants').select('*').eq('user_id',userId).eq('id',row.id).maybeSingle();if(prior.data)return view(prior.data);}if(error)throw error;}else{const d=loadLocal();const prior=(d.permissionGrants || []).find(r=>r.id===row.id && r.user_id===userId);if(prior)return view(prior);d.permissionGrants=[row,...(d.permissionGrants || [])];saveLocal(d);}return view(row);}
  async function revokePermissionGrant(userId,id){const at=new Date().toISOString(),s=supa();if(s){const {error}=await s.from('agent_permission_grants').update({revoked_at:at}).eq('user_id',userId).eq('id',id);if(error)throw error;}else{const d=loadLocal();for(const r of d.permissionGrants || [])if(r.user_id===userId && r.id===id)r.revoked_at=at;saveLocal(d);}return {ok:true};}
  return {listPermissionGrants,createPermissionGrant,revokePermissionGrant};
}
export {normalizeGrant,scopeMatches,grantDecision,createScopedPermissionStore};
