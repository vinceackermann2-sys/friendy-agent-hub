/* Goals and Library items shared by the Node and edge stores. Both the owner
   (through the app) and their agent (through tools) read and write the same
   account-scoped rows, so the Goals page and Library always match what the
   agent sees. Local JSON is dev-only. */
function createPersonalStore({ supa, loadLocal, saveLocal, ensureProfile, uid }) {
  const nowIso = () => new Date().toISOString();
  const fail = (message, code) => Object.assign(new Error(message), { code });
  const clean = (value, max) => String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const local = () => { const d = loadLocal(); d.goals = d.goals || []; d.libraryItems = d.libraryItems || []; return d; };

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
      steps: cleanSteps(row.steps), chatId: row.source_chat_id || null,
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
    const next = { ...goal, steps: goal.steps.map((st) => ({ ...st })) };
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
    const row = { title: next.title, category: next.category, status: next.status, steps: next.steps, updated_at: nowIso() };
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
  // Text artifacts keep their body; media is stored as a data URL capped at 6 MB.
  const LIBRARY_KINDS = ['document', 'web', 'image', 'video', 'audio', 'file'];
  const MAX_LIBRARY_ITEMS = 1000, MAX_TEXT = 500000, MAX_MEDIA_BYTES = 6 * 1024 * 1024;
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
      source: row.source === 'upload' ? 'upload' : 'agent', chatId: row.source_chat_id || null, preview: row.preview || '',
      createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now() };
    if (withContent) view.content = row.content || '';
    return view;
  }
  const LIST_COLUMNS = 'id,user_id,title,kind,mime,size,source,source_chat_id,preview,created_at,updated_at';
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
  async function getLibraryItem(userId, id) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from('library_items').select('*').eq('user_id', userId).eq('id', String(id)).maybeSingle();
      if (error) throw fail('Library item could not be loaded. Try again.', 'PERSISTENCE');
      return data ? libraryView(data, true) : null;
    }
    const row = local().libraryItems.find((item) => item.user_id === userId && item.id === String(id));
    return row ? libraryView(row, true) : null;
  }
  async function saveLibraryItem(userId, input = {}) {
    const title = clean(input.title, 160) || 'Untitled';
    const content = String(input.content ?? '');
    const dataUrl = isDataUrl(content);
    const mime = clean(input.mime, 100) || (dataUrl ? content.slice(5, content.indexOf(';')) : '');
    const kind = libraryKind(title, mime, input.kind);
    let size;
    if (dataUrl) {
      size = Math.floor((content.length - content.indexOf(',') - 1) * 3 / 4);
      if (size > MAX_MEDIA_BYTES) throw fail('Files in the Library can be up to 6 MB.', 'BAD_INPUT');
    } else {
      if (['image', 'video', 'audio'].includes(kind) && !/svg/.test(mime) && !/\.svg$/i.test(title)) throw fail('Media must be uploaded as file data.', 'BAD_INPUT');
      if (!content.trim()) throw fail('The Library item needs content.', 'BAD_INPUT');
      if (content.length > MAX_TEXT) throw fail('Text artifacts can be up to 500,000 characters.', 'BAD_INPUT');
      size = content.length;
    }
    const now = nowIso();
    const row = { id: 'lib_' + uid(), user_id: userId, title, kind, mime: mime || null, size, content,
      preview: dataUrl ? '' : content.slice(0, 600), source: input.source === 'upload' ? 'upload' : 'agent',
      source_chat_id: clean(input.chatId, 80) || null, created_at: now, updated_at: now };
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      const { count, error: countError } = await s.from('library_items').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (countError) throw fail('Library item could not be saved. Try again.', 'PERSISTENCE');
      if (Number(count || 0) >= MAX_LIBRARY_ITEMS) throw fail('Your Library is full. Delete a few items first.', 'BAD_INPUT');
      const { error } = await s.from('library_items').insert(row);
      if (error) throw fail('Library item could not be saved. Try again.', 'PERSISTENCE');
      return libraryView(row);
    }
    const d = local();
    if (d.libraryItems.filter((item) => item.user_id === userId).length >= MAX_LIBRARY_ITEMS) throw fail('Your Library is full. Delete a few items first.', 'BAD_INPUT');
    d.libraryItems.unshift(row); saveLocal(d);
    return libraryView(row);
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
      return (data || []).length;
    }
    const d = local(), before = d.libraryItems.length;
    d.libraryItems = d.libraryItems.filter((item) => !(item.user_id === userId && item.id === String(id)));
    saveLocal(d);
    return before - d.libraryItems.length;
  }

  return {
    GOAL_CATEGORIES, listGoals, getGoal, createGoal, updateGoal, deleteGoal,
    LIBRARY_KINDS, listLibrary, getLibraryItem, saveLibraryItem, renameLibraryItem, deleteLibraryItem,
  };
}

export { createPersonalStore };
