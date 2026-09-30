/* Goals and Library items shared by the Node and edge stores. Both the owner
   (through the app) and their agent (through tools) read and write the same
   account-scoped rows, so the Goals page and Library always match what the
   agent sees. Local JSON is dev-only. */
function createPersonalStore({ supa, loadLocal, saveLocal, ensureProfile, uid }) {
  const nowIso = () => new Date().toISOString();
  const fail = (message, code) => Object.assign(new Error(message), { code });
  const clean = (value, max) => String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const local = () => { const d = loadLocal(); d.goals = d.goals || []; d.libraryItems = d.libraryItems || []; d.libraryVersions = d.libraryVersions || []; return d; };

  // ---------------- goals ----------------
  const GOAL_CATEGORIES = ['health', 'family', 'finance', 'career', 'interests', 'productivity', 'other'];
  const GOAL_STATUSES = ['active', 'paused', 'done'];
  const MAX_GOALS = 100, MAX_STEPS = 30;
  function goalCategory(value) {
    const v = String(value || '').toLowerCase().trim();
    if (['relationships', 'relationship', 'people', 'social'].includes(v)) return 'family';
    return GOAL_CATEGORIES.includes(v) ? v : 'other';
  }
  function cleanSteps(steps) {
    return (Array.isArray(steps) ? steps : []).slice(0, MAX_STEPS).map((step) => {
      const title = clean(typeof step === 'string' ? step : step?.title, 120);
      return title ? { id: clean(step?.id, 40) || 'st_' + uid(), title, done: !!step?.done } : null;
    }).filter(Boolean);
  }
  function goalView(row) {
    return {
      id: row.id, title: row.title, category: goalCategory(row.category),
      status: GOAL_STATUSES.includes(row.status) ? row.status : 'active',
      work:row.work || {},activity:(row.activity || []).slice(-30),steps: cleanSteps(row.steps), chatId: row.source_chat_id || null,
      createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now(),
    };
  }
  async function listGoals(userId, options = {}) {
    const status = GOAL_STATUSES.includes(options.status) ? options.status : null;
    const s = supa();
    if (s) {
      let query = s.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(MAX_GOALS);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw fail('Goals could not be loaded. Try again.', 'PERSISTENCE');
      return (data || []).map(goalView);
    }
    return local().goals.filter((g) => g.user_id === userId && (!status || g.status === status))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(goalView);
  }
  async function getGoal(userId, id) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from('goals').select('*').eq('user_id', userId).eq('id', String(id)).maybeSingle();
      if (error) throw fail('Goal could not be loaded. Try again.', 'PERSISTENCE');
      return data ? goalView(data) : null;
    }
    const row = local().goals.find((g) => g.user_id === userId && g.id === String(id));
    return row ? goalView(row) : null;
  }
  async function createGoal(userId, input = {}) {
    const title = clean(input.title, 120);
    if (!title) throw fail('Give the goal a short title.', 'BAD_INPUT');
    const steps = cleanSteps(input.steps);
    const status = GOAL_STATUSES.includes(input.status) ? input.status : 'active';
    const now = nowIso();
    // Goals moved over from the device keep their original date.
    const created = Number(input.createdAt);
    const row = { id: 'goal_' + uid(), user_id: userId, title, category: goalCategory(input.category),
      status, steps: status === 'done' ? steps.map((st) => ({ ...st, done: true })) : steps,
      source_chat_id: clean(input.chatId, 80) || null,
      created_at: created > 0 && created <= Date.now() ? new Date(created).toISOString() : now, updated_at: now };
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      const { count, error: countError } = await s.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (countError) throw fail('Goal could not be saved. Try again.', 'PERSISTENCE');
      if (Number(count || 0) >= MAX_GOALS) throw fail(`You can keep up to ${MAX_GOALS} goals. Delete a finished one first.`, 'BAD_INPUT');
      const { error } = await s.from('goals').insert(row);
      if (error) throw fail('Goal could not be saved. Try again.', 'PERSISTENCE');
      return goalView(row);
    }
    const d = local();
    if (d.goals.filter((g) => g.user_id === userId).length >= MAX_GOALS) throw fail(`You can keep up to ${MAX_GOALS} goals. Delete a finished one first.`, 'BAD_INPUT');
    d.goals.unshift(row); saveLocal(d);
    return goalView(row);
  }
  // Applies a partial change. Step edits address steps by id or exact title so
  // the agent can say "complete 'Run 3x per week'" without looking ids up first.
  function applyGoalPatch(goal, patch) {
    const next = { ...goal, work:patch.work!==undefined?structuredClone(patch.work):goal.work,activity:patch.activity!==undefined?patch.activity.slice(-30):goal.activity, steps: goal.steps.map((st) => ({ ...st })) };
    if (patch.title !== undefined) { const title = clean(patch.title, 120); if (!title) throw fail('Goal title cannot be empty.', 'BAD_INPUT'); next.title = title; }
    if (patch.category !== undefined) next.category = goalCategory(patch.category);
    if (Array.isArray(patch.steps)) next.steps = cleanSteps(patch.steps);
    const match = (ref) => { const r = String(ref || '').trim().toLowerCase(); return next.steps.find((st) => st.id === ref || st.title.toLowerCase() === r); };
    for (const title of Array.isArray(patch.addSteps) ? patch.addSteps : []) {
      const t = clean(typeof title === 'string' ? title : title?.title, 120);
      if (t && next.steps.length < MAX_STEPS && !match(t)) next.steps.push({ id: 'st_' + uid(), title: t, done: false });
    }
    for (const ref of Array.isArray(patch.completeSteps) ? patch.completeSteps : []) { const st = match(ref); if (st) st.done = true; }
    for (const ref of Array.isArray(patch.reopenSteps) ? patch.reopenSteps : []) { const st = match(ref); if (st) st.done = false; }
    if (Array.isArray(patch.removeSteps)) { const drop = new Set(patch.removeSteps.map((ref) => match(ref)?.id).filter(Boolean)); next.steps = next.steps.filter((st) => !drop.has(st.id)); }
    if (patch.status !== undefined) {
      if (!GOAL_STATUSES.includes(patch.status)) throw fail('Status must be active, paused or done.', 'BAD_INPUT');
      next.status = patch.status;
      if (patch.status === 'done') next.steps = next.steps.map((st) => ({ ...st, done: true }));
    } else if (next.steps.length && next.steps.every((st) => st.done)) next.status = 'done';
    else if (goal.status === 'done' && next.steps.some((st) => !st.done)) next.status = 'active';
    return next;
  }
  async function updateGoal(userId, id, patch = {}) {
    const goal = await getGoal(userId, id);
    if (!goal) throw fail('Goal not found.', 'NOT_FOUND');
    const next = applyGoalPatch(goal, patch);
    const row = { title: next.title, category: next.category, status: next.status, steps: next.steps, work:next.work,activity:next.activity,updated_at: nowIso() };
    const s = supa();
    if (s) {
      const { error } = await s.from('goals').update(row).eq('user_id', userId).eq('id', goal.id);
      if (error) throw fail('Goal could not be updated. Try again.', 'PERSISTENCE');
    } else {
      const d = local(), stored = d.goals.find((g) => g.user_id === userId && g.id === goal.id);
      if (!stored) throw fail('Goal not found.', 'NOT_FOUND');
      Object.assign(stored, row); saveLocal(d);
    }
    return { ...next, updatedAt: Date.now() };
  }
  async function deleteGoal(userId, id) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from('goals').delete().eq('user_id', userId).eq('id', String(id)).select('id');
      if (error) throw fail('Goal could not be deleted. Try again.', 'PERSISTENCE');
      return (data || []).length;
    }
    const d = local(), before = d.goals.length;
    d.goals = d.goals.filter((g) => !(g.user_id === userId && g.id === String(id)));
    saveLocal(d);
    return before - d.goals.length;
  }

  // ---------------- library ----------------
  // Production artifacts use private object storage; local development keeps the body.
  const LIBRARY_KINDS = ['document', 'web', 'image', 'video', 'audio', 'file'];
  const MAX_LIBRARY_ITEMS = 1000, MAX_TEXT = 500000, MAX_MEDIA_BYTES = 10 * 1024 * 1024;
  const EXT_KIND = { png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image', svg:'image', avif:'image',
    mp4:'video', mov:'video', webm:'video', m4v:'video', mp3:'audio', wav:'audio', ogg:'audio', m4a:'audio', flac:'audio',
    html:'web', htm:'web', md:'document', txt:'document', csv:'document', json:'document', pdf:'document', doc:'document', docx:'document', xlsx:'document', pptx:'document' };
  function libraryKind(title, mime, requested) {
    if (LIBRARY_KINDS.includes(requested)) return requested;
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (m === 'text/html') return 'web';
    const ext = (String(title || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1];
    if (EXT_KIND[ext]) return EXT_KIND[ext];
    return m.startsWith('text/') || m.includes('json') ? 'document' : 'file';
  }
  const isDataUrl = (value) => /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=]+$/i.test(value);
  function libraryView(row, withContent = false) {
    const view = { id: row.id, title: row.title, kind: row.kind, mime: row.mime || '', size: Number(row.size || 0),
      revision:Number(row.revision || 1), extractedText:withContent ? row.extracted_text || '' : undefined, extractionWarnings:row.extraction_warnings || [],
      source: row.source === 'upload' ? 'upload' : 'agent', chatId: row.source_chat_id || null, preview: row.preview || '',
      createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now() };
    if (withContent) view.content = row.content || '';
    return view;
  }
  const LIST_COLUMNS = 'id,user_id,title,kind,mime,size,source,source_chat_id,preview,created_at,updated_at,revision';
  async function listLibrary(userId, options = {}) {
    const kind = LIBRARY_KINDS.includes(options.kind) ? options.kind : null;
    const q = clean(options.query, 120).toLowerCase();
    const limit = Math.min(Math.max(Number(options.limit) || 200, 1), MAX_LIBRARY_ITEMS);
    const s = supa();
    let rows;
    if (s) {
      let query = s.from('library_items').select(LIST_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
      if (kind) query = query.eq('kind', kind);
      if (q) query = query.ilike('title', `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
      const { data, error } = await query;
      if (error) throw fail('Library could not be loaded. Try again.', 'PERSISTENCE');
      rows = data || [];
    } else {
      rows = local().libraryItems.filter((item) => item.user_id === userId && (!kind || item.kind === kind) && (!q || item.title.toLowerCase().includes(q)))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
    }
    return rows.map((row) => libraryView(row));
  }
  async function getLibraryItem(userId, id, revision) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from(revision?'library_item_versions':'library_items').select('*').eq('user_id', userId).eq(revision?'item_id':'id', String(id)).match(revision?{revision:Number(revision)}:{}).maybeSingle();
      if (error) throw fail('Library item could not be loaded. Try again.', 'PERSISTENCE');
      return data ? hydrateLibrary(data) : null;
    }
    const row = (revision?local().libraryVersions:local().libraryItems).find(item=>item.user_id===userId && (item.item_id || item.id)===String(id) && (!revision || item.revision===Number(revision)));
    return row ? hydrateLibrary(row) : null;
  }
  async function saveLibraryItem(userId, input = {}) {
    const title = clean(input.title, 160) || 'Untitled';
    const content = String(input.content ?? '');
    const dataUrl = isDataUrl(content);
    const mime = clean(input.mime, 100) || (dataUrl ? content.slice(5, content.indexOf(';')) : '');
    const kind = libraryKind(title, mime, input.kind);
    let size;
    if (dataUrl) {
      size = Buffer.from(content.slice(content.indexOf(',')+1),'base64').length;
      if (size > MAX_MEDIA_BYTES) throw fail('Files in the Library can be up to 10 MB.', 'BAD_INPUT');
    } else {
      if (['image', 'video', 'audio'].includes(kind) && !/svg/.test(mime) && !/\.svg$/i.test(title)) throw fail('Media must be uploaded as file data.', 'BAD_INPUT');
      if (!content.trim()) throw fail('The Library item needs content.', 'BAD_INPUT');
      if (content.length > MAX_TEXT) throw fail('Text artifacts can be up to 500,000 characters.', 'BAD_INPUT');
      size = content.length;
    }
    if(dataUrl && input.extractedText===undefined && (/\.(pdf|docx|xlsx)$/i.test(title) || /pdf|wordprocessingml|spreadsheetml/.test(mime))){
      try{const {extractDocument}=await import('./agents/documents.js');const doc=await extractDocument(Buffer.from(content.slice(content.indexOf(',')+1),'base64'),{name:title,mime});if(doc)input={...input,extractedText:doc.text,extractionWarnings:doc.warnings};}
      catch{input={...input,extractedText:'',extractionWarnings:['Extraction failed. This file has not been read.']};}
    }
    const now = nowIso();
    const old=input.id?await getLibraryItem(userId,input.id):null;
    if(input.id && !old)throw fail('Library item not found.','NOT_FOUND');
    if(old && Number(input.revision)!==old.revision)throw fail('File changed. Read the latest revision before editing.','CONFLICT');
    const row = { id: old?.id || 'lib_' + uid(), user_id: userId, title, kind, mime: mime || null, size, content,
      preview: dataUrl ? String(input.extractedText || '').slice(0,600) : content.slice(0,600),source:old?.source || (input.source==='upload'?'upload':'agent'),
      source_chat_id: old?.chatId || clean(input.chatId, 80) || null, created_at: old?new Date(old.createdAt).toISOString():now, updated_at: now,revision:(old?.revision || 0)+1,extracted_text:String(input.extractedText || '').slice(0,240000),extraction_warnings:(input.extractionWarnings || []).slice(0,10) };
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      const { count, error: countError } = await s.from('library_items').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (countError) throw fail('Library item could not be saved. Try again.', 'PERSISTENCE');
      if (!old && Number(count || 0) >= MAX_LIBRARY_ITEMS) throw fail('Your Library is full. Delete a few items first.', 'BAD_INPUT');
      await storeBlob(row);
      const { data:saved,error } = old ? await s.from('library_items').update(row).eq('user_id',userId).eq('id',old.id).eq('revision',old.revision).select('id') : await s.from('library_items').insert(row).select('id');
      if (error || (old && !saved?.length)) {if(row.storage_path)await s.storage.from('library-private').remove([row.storage_path]);throw fail(old && !error?'File changed. Read its latest revision.':'Library item could not be saved. Try again.',old && !error?'CONFLICT':'PERSISTENCE');}
      return libraryView(row);
    }
    const d = local();
    if (!old && d.libraryItems.filter((item) => item.user_id === userId).length >= MAX_LIBRARY_ITEMS) throw fail('Your Library is full. Delete a few items first.', 'BAD_INPUT');
    if(old){const current=d.libraryItems.find(x=>x.id===old.id && x.user_id===userId);if(Number(current?.revision || 1)!==old.revision)throw fail('File changed.','CONFLICT');Object.assign(current,row);}else d.libraryItems.unshift(row);
    d.libraryVersions.push({...row,item_id:row.id});saveLocal(d);
    return libraryView(row);
  }
  async function storeBlob(row) {
    const s=supa();if(!s)return;
    const binary=isDataUrl(row.content),raw=binary?Buffer.from(row.content.slice(row.content.indexOf(',')+1),'base64'):Buffer.from(row.content,'utf8');
    row.storage_path=encodeURIComponent(row.user_id)+'/'+row.id+'/'+row.revision+'-'+uid();row.content_encoding=binary?'base64':'utf8';
    const {error}=await s.storage.from('library-private').upload(row.storage_path,raw,{contentType:row.mime || 'application/octet-stream',upsert:false});
    if(error)throw fail('File storage is unavailable. The file was not saved.','PERSISTENCE');
    row.content='';
  }
  async function hydrateLibrary(row) {
    const copy={...row,id:row.item_id || row.id};
    if(row.storage_path){const {data,error}=await supa().storage.from('library-private').download(row.storage_path);if(error)throw fail('File could not be downloaded.','PERSISTENCE');const bytes=Buffer.from(await data.arrayBuffer());copy.content=row.content_encoding==='base64'?'data:'+(row.mime || 'application/octet-stream')+';base64,'+bytes.toString('base64'):bytes.toString('utf8');}
    return libraryView(copy,true);
  }
  async function listLibraryVersions(userId,id){
    if(!await getLibraryItem(userId,id))throw fail('Library item not found.','NOT_FOUND');
    const s=supa();let rows;
    if(s){const {data,error}=await s.from('library_item_versions').select('revision,title,size,created_at,updated_at').eq('user_id',userId).eq('item_id',id).order('revision',{ascending:false}).limit(100);if(error)throw fail('Versions could not be loaded.','PERSISTENCE');rows=data;}
    else rows=local().libraryVersions.filter(x=>x.user_id===userId && x.item_id===id).sort((a,b)=>b.revision-a.revision);
    return (rows || []).map(x=>({revision:x.revision,title:x.title,size:x.size,updatedAt:Date.parse(x.updated_at)}));
  }
  async function renameLibraryItem(userId, id, title) {
    const nextTitle = clean(title, 160);
    if (!nextTitle) throw fail('Give the item a name.', 'BAD_INPUT');
    const s = supa(), updated_at = nowIso();
    if (s) {
      const { data, error } = await s.from('library_items').update({ title: nextTitle, updated_at }).eq('user_id', userId).eq('id', String(id)).select(LIST_COLUMNS).maybeSingle();
      if (error) throw fail('Library item could not be renamed. Try again.', 'PERSISTENCE');
      if (!data) throw fail('Library item not found.', 'NOT_FOUND');
      return libraryView(data);
    }
    const d = local(), row = d.libraryItems.find((item) => item.user_id === userId && item.id === String(id));
    if (!row) throw fail('Library item not found.', 'NOT_FOUND');
    Object.assign(row, { title: nextTitle, updated_at }); saveLocal(d);
    return libraryView(row);
  }
  async function deleteLibraryItem(userId, id) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from('library_items').delete().eq('user_id', userId).eq('id', String(id)).select('id');
      if (error) throw fail('Library item could not be deleted. Try again.', 'PERSISTENCE');
      await sweepLibraryStorage(userId).catch(()=>{});
      return (data || []).length;
    }
    const d = local(), before = d.libraryItems.length;
    d.libraryItems = d.libraryItems.filter((item) => !(item.user_id === userId && item.id === String(id)));
    d.libraryVersions=d.libraryVersions.filter(item=>!(item.user_id===userId && item.item_id===String(id)));
    saveLocal(d);
    return before - d.libraryItems.length;
  }

  async function sweepLibraryStorage(userId){
    const s=supa();if(!s)return {removed:0};let query=s.from('library_storage_gc').select('storage_path').limit(50);if(userId)query=query.eq('user_id',userId);
    const {data,error}=await query;if(error)throw fail('Storage cleanup unavailable.','PERSISTENCE');const paths=(data || []).map(r=>r.storage_path);if(!paths.length)return {removed:0};
    const removed=await s.storage.from('library-private').remove(paths);if(removed.error)return {removed:0,pending:paths.length};
    const cleaned=await s.from('library_storage_gc').delete().in('storage_path',paths);if(cleaned.error)throw fail('Storage cleanup will retry.','PERSISTENCE');return {removed:paths.length};
  }
  async function recordGoalActivity(userId,id,entry,configurationId,nextAction,nextWake){
    const s=supa();if(s){const {error}=await s.rpc('record_goal_activity',{p_user:userId,p_goal:id,p_entry:entry,p_configuration:configurationId || '',p_next_action:nextAction || '',p_next_wake:nextWake || null});if(error)throw fail('Goal activity could not be saved.','PERSISTENCE');return;}
    const d=local(),g=d.goals.find(g=>g.user_id===userId && g.id===id);if(!g || (g.activity || []).some(a=>a.runId===entry.runId))return;
    g.activity=[...(g.activity || []),entry].slice(-30);if(g.work?.configurationId===configurationId && g.status==='active' && g.work?.enabled)g.work={...g.work,nextAction:nextAction || g.work.nextAction,nextWakeAt:nextWake || null};g.updated_at=nowIso();saveLocal(d);
  }
  async function countGoalRuns(userId,agentId){const s=supa();if(s){const {count,error}=await s.from('automation_runs').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('sub_agent_id',agentId);if(error)throw fail('Run budget could not be checked.','PERSISTENCE');return count || 0;}return (loadLocal().automationRuns || []).filter(r=>r.user_id===userId && r.sub_agent_id===agentId).length;}
  return {
    recordGoalActivity,sweepLibraryStorage,countGoalRuns, GOAL_CATEGORIES, listGoals, getGoal, createGoal, updateGoal, deleteGoal,
    LIBRARY_KINDS, listLibrary, getLibraryItem, saveLibraryItem, renameLibraryItem, deleteLibraryItem, listLibraryVersions,
  };
}

module.exports = { createPersonalStore };
