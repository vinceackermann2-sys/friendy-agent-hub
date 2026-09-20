/* All normal chat requests use the Gemini + Azure VM harness.
   The legacy engine's greeting/landing preview is retained; its keyword
   router is not executed. The model decides tools. Sandbox is per-user Azure
   VM (or isolated local fallback). OpenAI is not used. */
(() => {
  const legacy = window.Engine;
  const active = new Map();
  const requests = new Map();
  const workers = new Map();
  const recovery = new Map();
  const api = (path, body) => window.LingonAuth.api(path, { method: 'POST', body: JSON.stringify(body) });
  const owner = () => window.LingonAuth.get?.()?.user?.id;
  const unfinished = task => ['queued','running','waiting_approval','stopping'].includes(task.status);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function acceptTask(rt, task) {
    rt.managedTask(task);
    void pumpTask(rt, task.id);
  }
  async function pumpTask(rt, taskId) {
    const userId=owner();
    if(!userId) return;
    const key=`${userId}:${taskId}`;
    if(workers.has(key)) return;
    workers.set(key,true);
    let failures=0;
    try {
      while(owner()===userId) {
        const task=rt.chat.managedTasks?.[taskId];
        if(!task || !unfinished(task) || task.status==='waiting_approval') break;
        try {
          const out=await api('/api/agent/tasks/advance',{chatId:rt.chat.id,taskId,after:task.sequence});
          if(owner()!==userId) break;
          rt.managedTask(out.task);failures=0;
          // Transport contention backoff only; never creates a progress card.
          if(out.task.revision<=task.revision+1) await sleep(3000);
        } catch(error) {
          if(owner()!==userId || error.code===401) break;
          if(++failures===3) rt.taskConnection?.(taskId,false);
          await sleep(Math.min(30000,1000*2**Math.min(failures,5)));
        }
      }
    } finally {workers.delete(key);}
  }
  async function recoverTasks(rt, force=false) {
    const userId=owner();if(!userId)return;
    const key=`${userId}:${rt.chat.id}`;
    const previous=recovery.get(key);
    if(previous?.busy || (!force && previous && Date.now()-previous.at<10000)) return;
    if(previous?.timer)clearTimeout(previous.timer);
    const entry={busy:true,at:Date.now()};recovery.set(key,entry);
    try {
      const cursors=Object.fromEntries(Object.values(rt.chat.managedTasks || {}).map(t=>[t.id,t.sequence]));
      const out=await window.LingonAuth.api(`/api/agent/tasks?chatId=${encodeURIComponent(rt.chat.id)}&cursors=${encodeURIComponent(JSON.stringify(cursors))}`);
      if(owner()!==userId) return;
      for(const task of out.tasks || []) acceptTask(rt,task);
    } catch(error) {rt.trace('alert',error.message);}
    finally {
      entry.busy=false;
      if(owner()===userId && Object.values(rt.chat.managedTasks || {}).some(unfinished)) {
        entry.timer=setTimeout(()=>{if(owner()===userId && recovery.get(key)===entry)void recoverTasks(rt,true);},5000);
      }
    }
  }
  async function controlTask(rt, taskId, action, extra={}) {
    const userId=owner();
    const task=rt.chat.managedTasks?.[taskId];if(!task)throw new Error('Task not found.');
    try {
      const out=await api('/api/agent/tasks/control',{...extra,chatId:rt.chat.id,taskId,action,
        version:extra.version ?? task.version,requestId:crypto.randomUUID(),after:task.sequence});
      if(owner()===userId)for(const updated of (out.tasks || [out.task]))acceptTask(rt,updated);
    } catch(error) {await recoverTasks(rt,true);throw error;}
  }

  async function stream(rt, path, body) {
    if (active.has(rt.chat.id)) throw new Error('A stream is already connected to this chat.');
    const controller = new AbortController();
    const runOwner=owner();
    const requestId = body.requestId || crypto.randomUUID();
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const runState = { controller, finished, requestId, answerReady: false };
    active.set(rt.chat.id, runState);
    rt.managedEvent({ type: 'session', status: 'running' });
    let indicator = rt.typing({mood:'think'});
    const clearIndicator = () => { indicator?.abort(); indicator=null; };
    let terminal = false;
    try {
      const response = await window.LingonAuth.apiStream(path, { method: 'POST', body: JSON.stringify({ ...body, requestId, chatId: rt.chat.id }), signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Agent request failed (${response.status}).`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      function consume(frame) {
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) return;
        const event = JSON.parse(data);
        if (controller.signal.aborted || owner()!==runOwner) return;
        if (['message','message_delta','done','paused','error'].includes(event.type)) clearIndicator();
        if (event.type === 'message' && event.phase === 'final_answer') runState.answerReady = true;
        if(event.type==='task') {acceptTask(rt,event.task);void recoverTasks(rt);}
        else rt.managedEvent(event);
        if (event.type === 'card' && event.card?.managedArtifactId && /\.(png|jpe?g|webp)$/i.test(event.card.name) && event.card.size <= 1000000) {
          void previewImage(rt, event.card).catch(error => rt.trace('alert', error.message));
        }
        if (['done', 'paused', 'error'].includes(event.type)) terminal = true;
      }
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            consume(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
          }
          if (done) { if (buffer.trim()) consume(buffer); break; }
        }
      } finally { reader.releaseLock(); }
      if (!terminal) throw new Error('Connection interrupted. Reconnect to recover the saved run.');
    } catch (error) {
      clearIndicator();
      if(owner()===runOwner) rt.managedEvent(controller.signal.aborted ? { type: 'stopped' } : { type: 'error', error: error.message });
    } finally {
      clearIndicator();
      if (active.get(rt.chat.id) === runState) active.delete(rt.chat.id);
      finish();
    }
  }

  async function run(rt, prompt) {
    const request = (requests.get(rt.chat.id) || 0) + 1;
    requests.set(rt.chat.id, request);
    if (active.has(rt.chat.id)) await cancelCurrent(rt, true);
    if (requests.get(rt.chat.id) !== request) return;
    const last = rt.chat.messages.filter(m => m.role === 'user').slice(-1)[0];
    const history = rt.chat.messages.filter(m => m.kind === 'text' && m !== last).slice(-24).map(m => ({ role: m.role, text: m.text }));
    const cards = rt.chat.messages.filter(m => m.kind === 'card' && m.card?.type !== 'progress').slice(-12).map(({card}) => ({
      type:card.type,title:card.title,name:card.name,status:card.status,text:card.text,
      url:card.url,note:card.note,content:String(card.content || '').slice(0,8000),
      lines:(card.lines || []).slice(-8),agents:card.agents,
    }));
    return stream(rt, '/api/agent/conversation', { prompt, requestId: crypto.randomUUID(), history,
      context: { agent: { name: rt.agent.name, pers: rt.agent.pers }, replyTo: last?.replyTo,
        artifact: rt.chat.artifact, cards, attachments: (last?.files || []).map(f => ({ name: f.name, dataUrl:f.dataUrl })) } });
  }
  async function cancelCurrent(rt, replacing = false) {
    const current = active.get(rt.chat.id);
    if (current) current.controller.abort();
    const cancellation = current ? api('/api/agent/conversation/cancel', { chatId: rt.chat.id, requestId: current.requestId }) : Promise.resolve();
    if (replacing) cancellation.catch(() => {});
    else {
      try { await cancellation; }
      catch (error) { if (!current) await rt.say(error.message); }
    }
    if (current) await current.finished;
    else rt.managedEvent({ type: 'stopped' });
  }
  async function stop(rt) {
    requests.set(rt.chat.id, (requests.get(rt.chat.id) || 0) + 1);
    await cancelCurrent(rt);
  }
  async function download(chatId, card) {
    const response = await window.LingonAuth.apiStream(`/api/agent/artifact?chatId=${encodeURIComponent(chatId)}&id=${encodeURIComponent(card.managedArtifactId)}`);
    if (!response.ok) throw new Error('Artifact download failed.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = card.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function previewImage(rt, card) {
    const response = await window.LingonAuth.apiStream(`/api/agent/artifact?chatId=${encodeURIComponent(rt.chat.id)}&id=${encodeURIComponent(card.managedArtifactId)}`);
    if (!response.ok) throw new Error('Could not load the generated image preview.');
    const bytes = await response.arrayBuffer();
    const type = /\.png$/i.test(card.name) ? 'image/png' : /\.webp$/i.test(card.name) ? 'image/webp' : 'image/jpeg';
    const dataUrl = await new Promise((resolve,reject) => {
      const reader = new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;
      reader.readAsDataURL(new Blob([bytes],{type}));
    });
    rt.managedEvent({type:'card',id:`image_${card.managedArtifactId}`,card:{type:'browser',url:'about:blank',
      note:`Hosted workspace image: ${card.name}`,screenshot:dataUrl,status:'done'}});
  }
  window.Engine = { ...legacy, managed: true, isRunning: (chatId) => !!(active.get(chatId) && !active.get(chatId).answerReady), run, runTask: run, respondWhileWorking: run,
    isTask: () => false, taskKind: () => null, routeMessage: () => 'respond',
    recoverTasks, controlTask,
    resume: (rt, decision) => stream(rt, '/api/agent/resume', { decision }), stop, download };
})();
