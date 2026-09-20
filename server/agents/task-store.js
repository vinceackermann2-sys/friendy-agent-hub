const { createClient } = require('@supabase/supabase-js');
let client;
function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.LINGON_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.LINGON_SUPABASE_SECRET_KEY;
  if (!url || !key) throw Object.assign(new Error('Task storage is not configured.'), { status:503 });
  return (client = createClient(url, key, { auth:{ persistSession:false, autoRefreshToken:false } }));
}
async function query(result) {
  const { data, error } = await result;
  if (error) throw Object.assign(new Error(error.code==='P0001'?error.message:'Task storage is unavailable. Check the chat-task migrations.'), { status:error.code==='P0001'?409:503 });
  return data;
}
const first = async (request) => (await query(request))?.[0] || null;
const get = (userId, id) => first(db().from('agent_chat_tasks').select('*').eq('user_id', userId).eq('id', id));
const list = (userId, chatId, cursors={}, events=true) => query(db().rpc('list_chat_tasks', {p_user_id:userId,p_chat_id:chatId,p_cursors:cursors,p_events:events}));
const due = () => query(db().from('agent_chat_tasks').select('id,user_id,revision').in('state->>status', ['queued','running','stopping']).or(`lease_until.is.null,lease_until.lte.${new Date().toISOString()}`).order('updated_at').limit(12));
const create = (row) => first(db().rpc('create_chat_task', { p_id:row.id,p_user_id:row.user_id,p_chat_id:row.chat_id,p_request_key:row.request_key,p_state:row.state }));
const claim = (userId,id,token) => first(db().rpc('claim_chat_task', { p_id:id,p_user_id:userId,p_token:token }));
const write = (row,state,token=null) => first(db().rpc('write_chat_task', { p_id:row.id,p_user_id:row.user_id,p_revision:row.revision,p_token:token,p_state:state }));
const release = (userId,id,token) => query(db().rpc('release_chat_task', { p_id:id,p_user_id:userId,p_token:token }));
const team = (userId,id) => query(db().rpc('chat_task_team',{p_user_id:userId,p_id:id}));
const messagePeer = (userId,source,target,callId,version,message) => query(db().rpc('message_chat_task_peer',{p_user_id:userId,p_source:source,p_target:target,p_call_id:callId,p_version:version,p_message:message}));
const steerTeam = (userId,id,version,instruction,requestId) => query(db().rpc('steer_chat_task_team',{p_user_id:userId,p_id:id,p_version:version,p_instruction:instruction,p_request_id:requestId}));
module.exports = { get,list,due,create,claim,write,release,team,messagePeer,steerTeam };
