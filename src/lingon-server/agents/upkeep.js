import crypto from 'node:crypto';

const UPKEEP_DEFINITIONS = Object.freeze([
  {
    kind:'memory', name:'Memory upkeep', intervalMinutes:60, scheduleLabel:'Hourly · when there is new signal',
    description:'Consolidates durable facts and corrections from recent conversations without reprocessing unchanged chats.', allowedTools:['memory_search','memory_get','memory_write','memory_update'],
    prompt:'Review the supplied recent user-authored conversation excerpts for durable facts, preferences, commitments, and corrections. Search memory before writing. Use memory_write for a genuinely new durable fact and memory_update when a supplied correction clearly supersedes an existing memory. Never store secrets, guesses, assistant claims, or passing chatter. If nothing should change, finish with exactly “No memory changes needed.” Keep the final result under 120 words.',
  },
  {
    kind:'relationships', name:'Relationship upkeep', intervalMinutes:60, scheduleLabel:'Hourly · when people are mentioned',
    description:'Keeps useful, evidence-based context about people and groups the user discusses.', allowedTools:['memory_search','memory_get','memory_write','memory_update'],
    prompt:'Review the supplied recent user-authored excerpts for explicit, durable facts about people or groups in the user’s life. Search memory before writing. Save only facts the user actually stated, including the relationship and useful standing context. Never infer closeness, motives, sensitive traits, or contact details. If nothing should change, finish with exactly “No relationship changes needed.” Keep the final result under 120 words.',
    signalPattern:/\b(friend|family|mother|father|mom|mum|dad|parent|brother|sister|partner|wife|husband|boyfriend|girlfriend|colleague|coworker|boss|client|customer|teacher|coach|team|group|relationship|met with|spoke with|talked to)\b/i,
  },
  {
    kind:'ideas', name:'Idea curation', intervalMinutes:1440, scheduleLabel:'Daily · once when context changed',
    description:'Produces a short set of feasible, personal, non-repetitive ideas from current goals and context.', allowedTools:[],
    prompt:'Use the supplied recent user-authored excerpts and relevant memory to propose at most three useful ideas. Rank them by personal fit, feasibility, and novelty. It is valid to return no ideas. Do not perform external actions or save speculative ideas as memories. Give each idea a one-line reason tied to supplied evidence. Keep the final result under 180 words.',
  },
  {
    kind:'study', name:'Goal studying', intervalMinutes:1440, scheduleLabel:'Daily · once for active goals',
    description:'Researches one concrete question that can unblock an active goal and records a concise briefing.', allowedTools:['goal_list','web_search'],
    prompt:'Call goal_list to see the owner active goals. Identify one concrete unanswered question in them or the supplied excerpts that would materially advance an active goal. If there is one, research it with web_search, prefer primary sources, and return a concise briefing with source URLs and a practical next step. Do not send, buy, book, or change connected apps. If no active goal or research question is supported, finish with exactly “No goal study needed.” Keep the final result under 250 words.',
    signalPattern:/\b(goal|plan|project|build|launch|deadline|working on|trying to|want to|need to|next step|milestone|business|study|learn|research)\b/i,
  },
  {
    kind:'reflection', name:'Nightly reflection', intervalMinutes:1440, scheduleLabel:'Nightly · once when context changed',
    description:'Reviews corrections, friction, and unresolved commitments so future replies improve.', allowedTools:[],
    prompt:'Review the supplied recent user-authored excerpts for corrections, friction, failed assumptions, collaboration preferences, and unresolved commitments. Separate explicit facts from tentative interpretation. Return a short reflection with “Keep”, “Change”, and “Open loop” only when supported. Do not edit identity documents or save inferred personality claims as facts. If there is no useful lesson, finish with exactly “No reflection update needed.” Keep the final result under 180 words.',
  },
  {
    kind:'skills', name:'Skill review', intervalMinutes:1440, scheduleLabel:'Daily · once when workflows changed',
    description:'Finds repeated workflows and tool failures that deserve a reusable, reviewable procedure.', allowedTools:[],
    prompt:'Review the supplied recent user-authored excerpts for a repeated workflow, a recurring tool failure, or a durable operating lesson. Recommend at most one skill or AGENTS.md lesson, with the trigger, procedure, and evidence. Do not edit files or permissions automatically. If there is no repeated pattern, finish with exactly “No skill change needed.” Keep the final result under 180 words.',
  },
  {
    kind:'quiet', name:'Quiet-moment review', intervalMinutes:30, scheduleLabel:'After substantial chats · at most 3/day',
    description:'Runs one bounded pass after a conversation settles to capture memories, decisions, and open loops.', allowedTools:['memory_search','memory_get','memory_write','memory_update'],
    prompt:'Perform one bounded quiet-moment review of the supplied recent user-authored excerpts. Capture only durable facts or corrections using memory tools, then summarize decisions and open loops. Do not create tasks, contact anyone, or invent commitments. If nothing warrants action, finish with exactly “No quiet-moment update needed.” Keep the final result under 140 words.',
    quietMinutes:20,
  },
]);

const byKind = new Map(UPKEEP_DEFINITIONS.map((item) => [item.kind,item]));

function upkeepId(userId, kind) {
  const owner = crypto.createHash('md5').update(String(userId)).digest('hex').slice(0,20);
  return `upkeep_${kind}_${owner}`;
}

function upkeepRows(userId, now = Date.now()) {
  return UPKEEP_DEFINITIONS.map((item, index) => ({
    id:upkeepId(userId,item.kind), userId, chatId:`upkeep_${item.kind}_${crypto.createHash('md5').update(String(userId)).digest('hex').slice(0,12)}`,
    name:item.name, prompt:item.prompt, description:item.description, systemKind:item.kind, enabled:true,
    trigger:{type:'schedule',intervalMinutes:item.intervalMinutes,label:item.scheduleLabel},
    nextRunAt:new Date(now + (index + 1) * 60_000).toISOString(),
  }));
}

function definitionFor(kind) { return byKind.get(String(kind || '')) || null; }

function messageTime(message) {
  return Date.parse(message?.created_at || message?.createdAt || message?.at || 0) || Number(message?.at || 0) || 0;
}

function prepareUpkeepSignal(subAgent, messages, options = {}) {
  const def = definitionFor(subAgent?.systemKind);
  if (!def) return {eligible:true,messages:[],latestAt:null,reason:null};
  const now = Number(options.now || Date.now());
  const manual = options.manual === true;
  const rows = (messages || []).filter((message) => message?.role === 'user' && String(message?.text || '').trim())
    .sort((a,b) => messageTime(a)-messageTime(b)).slice(-24);
  if (!rows.length) return {eligible:false,messages:[],latestAt:null,reason:'No new conversation signal'};
  const latestMs = messageTime(rows[rows.length-1]);
  const latestAt = latestMs ? new Date(latestMs).toISOString() : new Date(now).toISOString();
  if (!manual && def.quietMinutes && now-latestMs < def.quietMinutes*60_000) {
    return {eligible:false,messages:rows,latestAt:null,reason:'Waiting for the conversation to settle'};
  }
  const combined = rows.map((row) => String(row.text || '')).join('\n');
  if (!manual && def.signalPattern && !def.signalPattern.test(combined)) {
    return {eligible:false,messages:rows,latestAt,reason:'No relevant new signal'};
  }
  const excerpts = rows.map((row) => ({at:messageTime(row) ? new Date(messageTime(row)).toISOString() : null,text:String(row.text).slice(0,1200)}));
  return {eligible:true,messages:excerpts,latestAt,reason:null};
}

function nextUpkeepRun(subAgent, from = Date.now()) {
  const def = definitionFor(subAgent?.systemKind);
  const minutes = def?.intervalMinutes || Number(subAgent?.trigger?.intervalMinutes) || 60;
  return new Date(Number(from) + minutes*60_000).toISOString();
}

export {UPKEEP_DEFINITIONS,definitionFor,upkeepId,upkeepRows,prepareUpkeepSignal,nextUpkeepRun};
