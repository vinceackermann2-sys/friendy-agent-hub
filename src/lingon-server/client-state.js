// Account-scoped browser state. Memory, files, secrets and task records have
// their own stores; this keeps the chat UI and onboarding from living only in
// one browser's localStorage.
function createClientStateStore({ supa, loadLocal, saveLocal, ensureProfile, listChatMessages, durableOnly = false }) {
  const failure = (message, code = 'PERSISTENCE') => Object.assign(new Error(message), { code });
  const validKey = (key) => key === 'profile' || /^chat:[a-zA-Z0-9_-]{1,120}$/.test(key);
  const clean = (key, value) => {
    if (!validKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) throw failure('Invalid account state.', 'BAD_INPUT');
    if (key === 'profile') {
      const agent = value.agent && typeof value.agent === 'object' ? value.agent : null;
      return {
        onboarded: value.onboarded === true,
        agent: agent ? {
          name: String(agent.name || 'Your agent').slice(0, 40),
          color: String(agent.color || 'lingon').slice(0, 30),
          pers: String(agent.pers || 'Playful').slice(0, 30),
          provisional: agent.provisional === true,
          claimedAt: Number(agent.claimedAt) || null,
        } : null,
        theme: String(value.theme || 'grey').slice(0, 30),
        userProfile: value.userProfile ? { name: String(value.userProfile.name || '').slice(0, 40) } : null,
        activeChat: typeof value.activeChat === 'string' ? value.activeChat.slice(0, 120) : null,
        vaultMode: String(value.vaultMode || 'default').slice(0, 30),
        vaultApprovals: (Array.isArray(value.vaultApprovals) ? value.vaultApprovals : []).slice(-500).map(item => ({
          id:String(item?.id || '').slice(0, 120), key:String(item?.key || '').slice(0, 120),
          label:String(item?.label || '').slice(0, 160), at:Number(item?.at) || 0,
        })),
        updatedAt: Number(value.updatedAt) || Date.now(),
      };
    }
    const id = key.slice(5);
    if (value.id !== id || !Array.isArray(value.messages) || value.messages.length > 10000) throw failure('Invalid chat state.', 'BAD_INPUT');
    // Only chat data may be written to this store. In particular, the browser
    // vault and auth session can never be copied into it by a stale client.
    const allowed = ['id','title','messages','trace','artifact','createdAt','updatedAt','onboarding','onboardingAnswers',
      'onboardingWelcomed','managedTasks','managedStatus','managedProgress','activeTask','busy','source','subAgentId',
      'canvasSelectedMessageId','canvasSelectedFileIndex','replyingTo','taskReply','taskReplyScope','coordinatorRuns'];
    const chat = Object.fromEntries(allowed.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
    chat.id = id;
    chat.title = String(chat.title || 'New chat').slice(0, 120);
    chat.createdAt = Number(chat.createdAt) || Date.now();
    chat.updatedAt = Number(chat.updatedAt) || chat.createdAt;
    if (chat.source === 'automation') throw failure('Automation chats are saved separately.', 'BAD_INPUT');
    return chat;
  };
  const sizeLimit = key => key === 'profile' ? 256 * 1024 : Math.floor(11.5 * 1024 * 1024);

  async function list(userId) {
    const s = supa();
    if (!s && durableOnly) throw failure('Account storage is unavailable.');
    let rows = [];
    let durable = true;
    if (s) {
      for (let from = 0;; from += 500) {
        const { data, error } = await s.from('client_state').select('state_key,value,updated_at').eq('user_id', userId).range(from, from + 499);
        if (error) {
          if (/PGRST205|42P01/.test(String(error.code || '')) || /could not find the table|relation .* does not exist/i.test(String(error.message || ''))) {
            durable = false;
            rows = [];
            break;
          }
          throw failure('Could not load saved account state.');
        }
        rows.push(...(data || []));
        if (!data || data.length < 500) break;
      }
    } else rows = (loadLocal().clientState || []).filter(row => row.userId === userId);
    const profile = rows.find(row => row.state_key === 'profile')?.value || null;
    const chats = rows.filter(row => row.state_key?.startsWith('chat:')).map(row => row.value).filter(Boolean);

    // Chats from older versions have server transcripts but no UI snapshot.
    // Restore those too when someone signs in on a new device.
    let legacy = [];
    if (s) {
      for (let from = 0;; from += 500) {
        const { data, error } = await s.from('chats').select('id,title,created_at,updated_at').eq('user_id', userId).eq('source', 'user')
          .order('updated_at', { ascending: false }).range(from, from + 499);
        if (error) break;
        legacy.push(...(data || []));
        if (!data || data.length < 500) break;
      }
    } else legacy = (loadLocal().chats || []).filter(row => row.userId === userId && row.source !== 'automation');
    const known = new Set(chats.map(chat => chat.id));
    const missing = legacy.filter(row => !known.has(row.id));
    const turnsByChat = new Map(missing.map(row => [row.id, []]));
    if (s) {
      for (let start = 0; start < missing.length; start += 50) {
        const ids = missing.slice(start, start + 50).map(row => row.id);
        for (let from = 0;; from += 500) {
          const { data, error } = await s.from('messages').select('id,chat_id,role,text,metadata,created_at').eq('user_id', userId)
            .in('chat_id', ids).in('role', ['user','agent']).order('created_at', { ascending:true }).range(from, from + 499);
          if (error) {
            for (const id of ids) turnsByChat.set(id,(await listChatMessages(userId,id,200)).filter(turn => ['user','agent'].includes(turn.role)));
            break;
          }
          for (const turn of data || []) turnsByChat.get(turn.chat_id)?.push(turn);
          if (!data || data.length < 500) break;
        }
      }
    } else for (const row of missing) turnsByChat.set(row.id,(await listChatMessages(userId,row.id,10000)).filter(turn => ['user','agent'].includes(turn.role)));
    for (const row of missing) {
      const turns = turnsByChat.get(row.id) || [];
      if (!turns.length) continue;
      chats.push({ id:row.id, title:row.title || 'New chat', legacy:true, createdAt:Date.parse(row.created_at) || row.createdAt || Date.now(),
        updatedAt:Date.parse(row.updated_at) || row.updatedAt || Date.now(), messages:turns.map(turn => ({
          id:turn.id, role:turn.role, kind:'text', text:turn.text || '',
          ...(turn.metadata?.attachments ? { files:turn.metadata.attachments } : {}),
        })), trace:[], artifact:null });
    }
    return { profile, chats, durable };
  }

  async function save(userId, key, value) {
    const cleaned = clean(key, value);
    if (Buffer.byteLength(JSON.stringify(cleaned), 'utf8') > sizeLimit(key)) throw failure('This chat is too large to sync.', 'BAD_INPUT');
    const s = supa();
    if (!s && durableOnly) throw failure('Account storage is unavailable.');
    if (s) {
      await ensureProfile(userId);
      const { error } = await s.from('client_state').upsert({ user_id:userId, state_key:key, value:cleaned, updated_at:new Date().toISOString() }, { onConflict:'user_id,state_key' });
      if (error) throw failure('Could not save account state.');
    } else {
      const d = loadLocal(); d.clientState = d.clientState || [];
      const i = d.clientState.findIndex(row => row.userId === userId && row.state_key === key);
      const row = { userId, state_key:key, value:cleaned, updated_at:new Date().toISOString() };
      if (i < 0) d.clientState.push(row); else d.clientState[i] = row;
      saveLocal(d);
    }
    return cleaned;
  }

  async function removeChat(userId, chatId) {
    const key = 'chat:' + chatId;
    if (!validKey(key)) throw failure('Invalid chat.', 'BAD_INPUT');
    const s = supa();
    if (!s && durableOnly) throw failure('Account storage is unavailable.');
    if (s) {
      const { error } = await s.from('client_state').delete().eq('user_id', userId).eq('state_key', key);
      if (error) throw failure('Could not delete chat.');
      // Conversation turns and summaries should also disappear when the owner
      // deletes a chat. The foreign key removes its message rows.
      const { error: chatError } = await s.from('chats').delete().eq('user_id', userId).eq('id', chatId).eq('source', 'user');
      if (chatError) throw failure('Could not delete chat history.');
    } else {
      const d = loadLocal();
      d.clientState = (d.clientState || []).filter(row => !(row.userId === userId && row.state_key === key));
      d.chats = (d.chats || []).filter(row => !(row.userId === userId && row.id === chatId && row.source !== 'automation'));
      d.turns = (d.turns || []).filter(row => !((row.user_id === userId || row.userId === userId) && row.chat_id === chatId));
      saveLocal(d);
    }
  }
  return { list, save, removeChat };
}

export { createClientStateStore };
