/* All normal chat requests use the Gemini + Azure VM harness.
   The legacy engine's greeting/landing preview is retained; its keyword
   router is not executed. The model decides tools. Sandbox is per-user Azure
   VM (or isolated local fallback). OpenAI is not used. */
(() => {
  const legacy = window.Engine;
  const active = new Set();
  const api = (path, body) => window.LingonAuth.api(path, { method: 'POST', body: JSON.stringify(body) });

  async function stream(rt, path, body) {
    if (active.has(rt.chat.id)) throw new Error('A stream is already connected to this chat.');
    active.add(rt.chat.id);
    rt.managedEvent({ type: 'session', status: 'running' });
    let indicator = rt.typing({mood:'think'});
    const clearIndicator = () => { indicator?.abort(); indicator=null; };
    let terminal = false;
    try {
      const response = await window.LingonAuth.apiStream(path, { method: 'POST', body: JSON.stringify({ ...body, chatId: rt.chat.id }) });
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
        if (['message','message_delta','done','paused','error'].includes(event.type)) clearIndicator();
        rt.managedEvent(event);
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
      rt.managedEvent({ type: 'error', error: error.message });
    } finally { clearIndicator(); active.delete(rt.chat.id); }
  }

  async function run(rt, prompt) {
    if (active.has(rt.chat.id)) {
      try {
        await api('/api/agent/steer', { chatId: rt.chat.id, prompt });
        rt.trace('spark', 'Steering message sent to the active agent turn');
      } catch (error) { await rt.say(error.message); }
      return;
    }
    const last = rt.chat.messages.filter(m => m.role === 'user').slice(-1)[0];
    const history = rt.chat.messages.filter(m => m.kind === 'text' && m !== last).slice(-24).map(m => ({ role: m.role, text: m.text }));
    const cards = rt.chat.messages.filter(m => m.kind === 'card').slice(-12).map(({card}) => ({
      type:card.type,title:card.title,name:card.name,status:card.status,text:card.text,
      url:card.url,note:card.note,content:String(card.content || '').slice(0,8000),
      lines:(card.lines || []).slice(-8),agents:card.agents,
    }));
    return stream(rt, '/api/agent/run', { prompt, requestId: crypto.randomUUID(), history,
      context: { agent: { name: rt.agent.name, personality: rt.agent.pers }, replyTo: last?.replyTo,
        artifact: rt.chat.artifact, cards, attachments: (last?.files || []).map(f => ({ name: f.name, dataUrl:f.dataUrl })) } });
  }
  async function stop(rt) {
    try { await api('/api/agent/cancel', { chatId: rt.chat.id }); rt.trace('box', 'Cancellation requested'); }
    catch (error) { await rt.say(error.message); }
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
  window.Engine = { ...legacy, managed: true, run, runTask: run, respondWhileWorking: run,
    isTask: () => false, taskKind: () => null, routeMessage: () => 'respond',
    resume: (rt, decision) => stream(rt, '/api/agent/resume', { decision }), stop, download };
})();
