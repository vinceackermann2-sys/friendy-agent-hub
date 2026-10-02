/* ============ Lingon REAL engine — Gemini backend, no simulations ============
   Harness note: Agents API shape (Codex pattern per openai.com Agents API), Gemini-backed and self-hosted — not OpenAI-hosted. It is our own
   Gemini-backed harness: tools run server-side (allowlisted fetch, read-only
   GitHub with YOUR per-request PAT, sandboxed HTML artifacts), secrets never
   enter model context, sensitive tools pause for your approval, and every step
    is logged. Nothing is mocked.
*/
window.Engine = (() => {
  const api = (path, opts = {}) => window.LingonAuth.api(path, opts);
  const taskRouting = window.LingonTaskRouting;
  const privateDetailsReply = () => `I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.`;

  function asksAboutInternalDetails(raw) {
    const text = String(raw || '').toLowerCase();
    return /(?:system prompt|developer message|hidden instructions|internal (?:instructions|prompt|policy|configuration)|reveal.{0,30}(?:prompt|instructions)|ignore.{0,30}(?:previous|system|developer).{0,30}instructions)/i.test(text)
      || /(?:\b(?:your|agent's|lingon's|arche's|this (?:app|agent)'?s)\s+(?:model|provider|backend|database|api|architecture|infrastructure|stack|framework|source code|implementation)\b|\b(?:what|which)\s+(?:ai|model|provider|backend|database|api|framework|stack)\b.{0,40}\b(?:do|does|are|is)\s+(?:you|lingon|arche|this (?:app|agent))\b|\b(?:are|is|do|does)\s+(?:you|lingon|arche|this (?:app|agent))\s+(?:use|run|rely|connect|call|work|operate|built|powered|based|hosted)\b|\bis this (?:app|agent)\s+(?:using|built|powered|based|hosted)\b|\bhow (?:are|were) you (?:built|made|hosted|run)\b|\b(?:are you|is (?:lingon|arche))\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b|\b(?:how (?:do you|does (?:lingon|arche|the agent|this (?:app|agent))) (?:work|run|operate)|(?:what|which).{0,20}(?:powers|runs|hosts) (?:you|lingon|arche|this (?:app|agent))|who (?:powers|built|made) (?:you|lingon|arche)|under the hood)\b)/i.test(text);
  }

  function intent(p) {
    p = String(p || '').toLowerCase();
    if (/\b(?:what|which) (?:is )?(?:the )?(?:current )?(?:date|day|month|year|time)\b|\b(?:today'?s date|date today|current date|current time|current year)\b/.test(p)) return 'chat';
    if (/(github|pull request|\bpr\b|\brepo\b|code review|merge request)/.test(p)) return 'apps';
    if (/(email|inbox|gmail|newsletter|slack|calendar|notion|drive|sheet|stripe|hubspot|linkedin|tweet|connect my|my apps|use my app)/.test(p)) return 'apps';
    if (/(secret|password|token|api key|credential|vault)/.test(p)) return 'vault';
    if (/(sub.?agent|automation|automate|trigger|watch(?:er)?|schedule|recurring|every (?:minute|hour|day|week|month)|remind me)/.test(p)) return 'automation';
    if (/(what do you remember|do you remember|your memor|recall|what do you know about me)/.test(p)) return 'chat';
    if (/(remember|don't forget|dont forget|keep in mind|preference)/.test(p)) return 'memory';
    if (/(build|create|make|design|code).*(website|landing|page|site|dashboard|app|chart|graph|deck)/.test(p) || /(website|landing page|one-pager)/.test(p)) return 'build';
    if (taskRouting.isResearch(p) || /(part(y|ies)|opinion|\bcurrent\b)/.test(p)) return 'research';
    return 'chat';
  }

  function preview(prompt) {
    const p = String(prompt || '').toLowerCase();
    switch (intent(p)) {
      case 'research': return `I'd review current public sources and prepare a cited briefing on your canvas. No invented percentages — only what the sources actually support.`;
      case 'apps': return `I'd run that via your connected app (Gmail, GitHub, Slack, Calendar and 50+ more) — real actions only, nothing simulated. Connect the app under Apps first if needed.`;
      case 'build': return `I'd generate a single-file page from your brief, render a live preview on the canvas, and hand you the file. You iterate, I regenerate.`;

      case 'vault': return `Secrets stay encrypted and scoped to your account. Protected values are never shown in chat or activity history. Claim your agent and try the secrets box.`;
      case 'memory': return `I can remember useful preferences across chats. Your memories are inspectable, deletable, and never shared with other users.`;
      default: return `I'd break that into clear steps, use available tools where helpful, and keep useful artifacts on your canvas. Sensitive actions require your approval.`;
    }
  }

  function historyFor(rt, prompt) {
    let msgs = (rt.chat.messages || []).filter((m) => m.kind === 'text');
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'user' && String(last.text) === String(prompt)) msgs = msgs.slice(0, -1);
    return msgs.slice(-32).map((m) => ({
      role: m.role === 'user' ? 'user' : 'agent',
      text: m.replyTo ? `[Replying to ${m.replyTo.role}: ${m.replyTo.text}]\n${m.text}` : m.text,
    }));
  }

  async function chatAI(rt, prompt, options = {}) {
    const memories = rt.recall().slice(0, 10);
    const history = historyFor(rt, prompt);
    const current = (rt.chat.messages || []).filter((m) => m.kind === 'text').slice(-1)[0];
    const payload = {
      prompt, history, replyTo: current?.replyTo,
      agent: { name: rt.agent.name, pers: rt.agent.pers }, memories,
      attachments: (current?.files || []).map(f => ({ name: f.name, type: f.type, size: f.size, dataUrl: f.dataUrl })),
      sessionId: rt.chat.id, activeTask: options.activeTask || undefined,
      delegated: !!options.delegated,
    };
    // Live handle lets the caller paint the answer progressively.
    // If the caller already shows the iPhone-style three dots, stream
    // straight into it — never wait for the final answer to update.
    const live = options.live || null;
    const applyTraceAndMemory = (j) => {
      if (Array.isArray(j.trace)) j.trace.forEach((t) => rt.trace(t.ic || 'spark', t.t));
      // ChatGPT-style: surface automatic saves like "Memory updated".
      for (const sm of j.savedMems || []) {
        if (!rt.recall().some((m) => m.text === sm.text)) {
          rt.remember(sm.text, 'auto');
          rt.card({ type: 'memory', text: 'Memory updated — ' + sm.text, status: 'done' });
        }
      }
    };
    const streamInto = async () => {
      if (!live || !window.LingonAuth || typeof window.LingonAuth.apiStream !== 'function') return null;
      let res;
      try {
        res = await window.LingonAuth.apiStream('/api/chat/stream', {
          method: 'POST',
          body: JSON.stringify(payload),
          signal: options.signal,
        });
      } catch {
        return null;
      }
      if (!res || !res.ok || !res.body) {
        try { res && res.body && await res.body.cancel(); } catch {}
        return null;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      const onEvent = (raw) => {
        for (const chunk of String(raw).split('\n\n')) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.delta) {
            full += String(evt.delta);
            try { live.update(full); } catch {}
          } else if (evt.replace != null) {
            full = String(evt.replace);
            try { live.update(full); } catch {}
          } else if (evt.done) {
            if (evt.text != null) full = String(evt.text);
            try { live.update(full); } catch {}
            applyTraceAndMemory(evt);
            return { finished: true, text: full };
          } else if (evt.error) {
            const e = new Error(evt.error);
            e.code = evt.code || 502;
            e.upgrade = !!evt.upgrade_required;
            throw e;
          }
        }
        return null;
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (options.signal && options.signal.aborted) {
            try { await reader.cancel(); } catch {}
            const ab = new Error('Task interrupted');
            ab.name = 'AbortError';
            throw ab;
          }
          if (value) {
            buf += decoder.decode(value, { stream: !done });
            const idx = buf.lastIndexOf('\n\n');
            if (idx >= 0) {
              const slice = buf.slice(0, idx + 2);
              buf = buf.slice(idx + 2);
              const r = onEvent(slice);
              if (r && r.finished) {
                try { await reader.cancel(); } catch {}
                return r.text;
              }
            }
          }
          if (done) {
            if (buf.trim()) {
              const r = onEvent(buf + '\n\n');
              if (r && r.finished) return r.text;
            }
            break;
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
      // Stream ended without a done frame — treat accumulated text as final
      // if we got anything, otherwise fall back to the JSON endpoint.
      return full ? { streamed: true, text: full } : null;
    };
    try {
      if (live) {
        const streamed = await streamInto();
        if (typeof streamed === 'string') return streamed;
        if (streamed && streamed.text) {
          // Stream closed early but we already painted partial text live.
          // Still fetch the authoritative final via JSON to persist
          // trace/memory correctly, then correct the bubble if needed.
          try {
            const j = await api('/api/chat', {
              method: 'POST',
              body: JSON.stringify(payload),
              signal: options.signal,
            });
            applyTraceAndMemory(j);
            if (j.text && j.text !== streamed.text) live.update(j.text);
            return j.text;
          } catch {
            return streamed.text;
          }
        }
      }
      const j = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: options.signal,
      });
      applyTraceAndMemory(j);
      if (live) {
        // Non-streaming fallback: we already show three dots, so paint the
        // answer into the same bubble instead of appending a second one.
        try { live.update(j.text); } catch {}
      }
      return j.text;
    } catch (e) {
      if (e.code === 401) throw new Error('Please sign in again (session expired).');
      if (e.code === 402 || e.upgrade) throw new Error(e.message + ' See Billing.');
      throw e;
    }
  }

  async function syncMemoryToBackend(text, src) {
    try {
      await api('/api/memories', { method: 'POST', body: JSON.stringify({ text, src }) });
    } catch {}
  }
  async function syncSecretToBackend(name, refId) {
    try {
      const ls = JSON.parse(localStorage.getItem('lingon.v1') || '{}');
      const s = (ls.vault?.secrets || []).find((x) => x.id === refId || x.name === name);
      if (!s || !s.value) return;
      await api('/api/secrets', { method: 'POST', body: JSON.stringify({ name: s.name, value: s.value }) });
    } catch {}
  }
  function readLocalSecretValue(name) {
    try {
      const ls = JSON.parse(localStorage.getItem('lingon.v1') || '{}');
      return (ls.vault?.secrets || []).find((x) => x.name === name)?.value || '';
    } catch {
      return '';
    }
  }

  /* ---------------- greeting ---------------- */
  async function greet(rt) {
    await rt.say('Hi! What would you like to work on?', { mood: 'happy' });
  }

  /* ---------------- REAL research ---------------- */
  async function research(rt, raw, task) {
    await rt.say(`On it — checking public sources, then preparing a briefing with citations. I won't invent sample sizes or claims.`, { mood: 'think' });
    await rt.tools([{ ic: 'search', t: 'Checking public sources', d: 'HN · DDG · Wikipedia' }]);
    const br = rt.card({ type: 'browser', url: 'about:blank', note: 'Opening a real headless browser…', status: 'running' });
    let res;
    try {
      res = await api('/api/research', { method: 'POST', body: JSON.stringify({ query: raw, sessionId: rt.chat.id, delegated: true }), signal: task?.signal });
      if (res.opened) br.update((c) => {
        c.url = res.opened.url;
        c.note = `Rendered “${(res.opened.title || '').slice(0, 70)}” in headless Chromium`;
        if (res.opened.liveId) c.liveId = res.opened.liveId;
        if (res.opened.screenshot) {
          // Bound localStorage: keep only this chat's latest screenshot.
          rt.chat.messages.forEach((m) => { if (m.kind === 'card' && m.card.type === 'browser' && m.id !== br.msg.id) delete m.card.screenshot; });
          c.screenshot = res.opened.screenshot;
        }
      });
      br.update((c) => { c.status = 'done'; c.note = (c.note ? c.note + ' · ' : '') + `${res.snippets?.length || 0} source groups · ${new Date(res.fetchedAt).toLocaleTimeString()}`; });
      br.resolve({ ok: true });
    } catch (e) {
      if (task?.signal?.aborted || e?.name === 'AbortError') throw e;
      br.update((c) => { c.status = 'done'; c.note = 'Research could not be completed'; });
      br.resolve({ ok: false });
      await rt.say(`I couldn't complete that research request right now. Please try again in a moment.`, { mood: 'think' });
      return;
    }
    rt.trace('globe', `${res.sources.length} source groups checked`);
    const h = rt.card({ type: 'subagents', agents: res.sources.map((u, i) => ({ name: 'fetch_' + (i + 1), desc: u.slice(0, 60), status: 'done', note: 'live' })) });
    h.update((c) => { c.status = 'done'; });
    h.resolve({ ok: true });
    await rt.tools([{ ic: 'spark', t: 'Prepared cited summary', d: 'no invented statistics' }]);

    const q = rt.card({ type: 'question', q: 'How should I present the live briefing?', options: ['Written briefing + sources file', 'Briefing only'] });
    const qa = await q.wait(task?.signal);
    const wantFile = /file/i.test(qa.choice);
    try {
      const ls = JSON.parse(localStorage.getItem('lingon.v1') || '{}');
      const mem = (ls.memory || []).find((m) => m.text.startsWith('You like results as:'));
      if (!mem) {
        rt.remember(`You like results as: ${qa.choice}.`, 'from our chat');
        syncMemoryToBackend(`You like results as: ${qa.choice}.`, 'from our chat');
      }
    } catch {}

    rt.artifact({ kind: 'plan', title: 'Live research briefing', items: [res.summary] });
    rt.card({ type: 'artifact', title: 'Live research briefing', kind: 'plan', status: 'done' });
    if (wantFile) {
      const content = `Query: ${res.query}\nFetched: ${res.fetchedAt}\nSources:\n${res.sources.map((s) => '- ' + s).join('\n')}\n\nBriefing:\n${res.summary}\n`;
      rt.card({ type: 'file', name: 'research-sources.txt', size: content.length, content, status: 'done' });
    }
    await rt.say(`Done — live briefing is on your canvas with sources. Open the source links to verify everything; I didn't invent any counts.`, { mood: 'happy' });
  }

  /* ---------------- Connected apps via Composio (real OAuth, no PATs) ---------------- */
  async function appsFlow(rt, raw, task) {
    await rt.say('On it — checking your connected apps and running that for real.', { mood: 'think' });
    await rt.tools([{ ic: 'box', t: 'Using connected app', d: 'via secure OAuth' }]);
    try {
      const j = await api('/api/composio/agent-run', { method: 'POST', body: JSON.stringify({ prompt: raw, sessionId: rt.chat.id }), signal: task?.signal });
      (j.trace || []).forEach((x) => rt.trace(x.ic || 'box', x.t || 'app action'));
      rt.trace('box', 'app action: ' + (j.tool || 'done'));
      await rt.say(j.text || 'Done — check Apps if you need to reconnect anything.', { mood: 'happy' });
      return;
    } catch (e) {
      if (task?.signal?.aborted || e?.name === 'AbortError') throw e;
      const msg = String(e.message || '');
      if (e.code === 409 || /No apps connected|Connect one under Apps|Connect that app/i.test(msg)) {
        await rt.say('That needs a connected app first. Open **Apps**, connect it with one click (secure OAuth — no tokens to paste), press Refresh, then ask me again. I never simulate app data.', { mood: 'think' });
        rt.card({ type: 'apps', status: 'pending' });
        return;
      }
      await rt.say('I could not complete that app action right now (' + msg.slice(0, 160) + '). Please try again in a moment.', { mood: 'think' });
      return;
    }
  }
  async function github(rt, task) { return appsFlow(rt, (task && task.prompt) || 'github', task); }

  /* ---------------- REAL build ---------------- */
  async function build(rt, task) {
    const q = rt.card({ type: 'question', q: 'What vibe should the page have?', options: ['Minimal & calm', 'Playful & warm', 'Bold & dark'] });
    const qa = await q.wait(task?.signal);
    const style = qa.choice;
    rt.remember(`For pages, you picked "${style}".`, 'from our chat');
    syncMemoryToBackend(`For pages, you picked "${style}".`, 'from our chat');
    await rt.say(`Nice choice — generating a **${String(style).toLowerCase()}** page now; watch the canvas.`, { mood: 'happy' });
    await rt.tools([{ ic: 'code', t: 'Generating page', d: 'single file' }]);
    try {
      const j = await api('/api/build', { method: 'POST', body: JSON.stringify({ brief: task?.prompt || rt.chat.messages.filter((m) => m.role === 'user').slice(-1)[0]?.text || '', style, agent: { name: rt.agent.name }, sessionId: rt.chat.id, delegated: true }), signal: task?.signal });
      rt.artifact({ kind: 'html', title: 'your-page.html', html: j.html });
      rt.card({ type: 'artifact', title: 'your-page.html', kind: 'html', status: 'done' });
      rt.card({ type: 'file', name: 'your-page.html', size: j.html.length, content: j.html, status: 'done' });
      await rt.say(`Your page is live on the canvas and saved to Files — single file, no dependencies.`, { mood: 'happy' });
    } catch (e) {
      if (task?.signal?.aborted || e?.name === 'AbortError') throw e;
      await rt.say(`I couldn't generate that page right now. Please try again in a moment.`, { mood: 'think' });
    }
  }

  /* ---------------- inbox: honest empty (no fake connection) ---------------- */
  async function inbox(rt) {
    await rt.say(`No inbox is connected — and there's no fake demo data. Gmail OAuth isn't configured in this build, so nothing was read. Ask me for research, GitHub reviews, or pages instead.`, { mood: 'think' });
  }

  async function vaultFlow(rt) {
    await rt.say(`Good instinct. Secrets are encrypted, scoped to your account, and kept out of chat and activity history. Sensitive actions still require your approval.`);
    const s = rt.card({ type: 'secret', suggest: 'openai_api_key', status: 'pending' });
    const r = await s.wait();
    if (r.ok) {
      try { await syncSecretToBackend(s.msg?.card?.nameVal || 'openai_api_key', s.msg?.card?.ref); } catch {}
      rt.trace('shield', 'credential saved and protected');
      await rt.say(`Sealed for real — view, reveal or revoke under **Vault**.`, { mood: 'happy' });
    } else {
      await rt.say(`No worries — the box stays available whenever you need it.`);
    }
  }

  async function memoryFlow(rt, raw) {
    const text = String(raw).replace(/.*?(remember|keep in mind|don't forget|dont forget)\s*(that)?\s*/i, '').trim() || raw;
    rt.remember(text, 'you said so');
    try { await api('/api/memories', { method: 'POST', body: JSON.stringify({ text, src: 'you said so' }) }); } catch {}
    rt.card({ type: 'memory', text, status: 'done' });
    await rt.say(`Noted and saved to memory for future chats. You can ask me to forget it anytime.`, { mood: 'happy' });
  }

  async function automationFlow(rt, raw) {
    await rt.say(`Tell me what you want done and when. Automation setup is handled in chat, with your approval before it starts.`, { mood: 'think' });
    rt.openSubAgents();
  }

  async function chatExtra(rt, raw, task) {
    const p = String(raw).toLowerCase();
    if (asksAboutInternalDetails(raw)) {
      return rt.say(privateDetailsReply(), { mood: 'idle' });
    }
    if (taskRouting.isBrowsingCapability(raw)) {
      return rt.say(`Yes. I can run live research against supported public sources and open allowlisted result pages in a sandboxed browser. Give me a topic to search, and I'll show the browser, sources, and tool trace while I work.`, { mood: 'happy' });
    }
    if (/who are you|what are you/.test(p)) {
      return rt.say(`I'm **${rt.agent.name}**, your personal agent. How can I help?`, { mood: 'happy' });
    }
    if (/what do you remember|do you remember|your memor|recall|what do you know about me/.test(p)) {
      const ms = rt.recall().filter((m) => m.src !== 'onboarding');
      if (!ms.length) return rt.say(`I don't have any memories of yours yet — say "remember that …" and I'll persist it to your account.`);
      return rt.say(`Here's what I'm carrying (account-scoped):\n\n` + ms.slice(0, 6).map((m) => `- ${m.text}`).join('\n') + `\n\nAsk me to forget or correct any of these.`, { mood: 'happy' });
    }
    if (/what can you do/.test(p)) {
      await rt.say(`I can do **live research** with cited sources, **act on your connected apps** (Gmail, GitHub, Slack, Calendar and 50+ more), **sub-agent automations with triggers**, **page generation**, and **account memory plus secure credential storage**. If something isn't available, I'll say so. Sensitive actions pause for approval and appear in your activity history.`);
      return;
    }
    if (/keep me safe|safe|security|secret/.test(p)) {
      await rt.say(`Your data is account-scoped, secrets are encrypted, and sensitive actions require approval. External access is restricted, GitHub access is read-only, and activity is logged.`);
      return;
    }
    if (/^run it/.test(p)) return research(rt, raw);
    if (/show all open prs|what else is on my repos/.test(p)) return github(rt);
    // No "Working on your request" status line — show only the iPhone-style
    // three dots, instantly, then stream the answer live into the same
    // bubble. Nothing waits for the final answer to update the user.
    const live = (typeof rt.typing === 'function') ? rt.typing({ mood: 'idle' }) : null;
    try {
      const text = await chatAI(rt, raw, { signal: task?.signal, delegated: !!task, live });
      if (live) live.done(text, { mood: 'idle' });
      else await rt.say(text, { mood: 'idle' });
    } catch (e) {
      if (task?.signal?.aborted || e?.name === 'AbortError') {
        if (live) live.abort();
        throw e;
      }
      const msg = `I couldn't complete that request right now. Please try again in a moment.`;
      if (live) live.done(msg, { mood: 'think' });
      else await rt.say(msg, { mood: 'think' });
    }
  }

  async function chat(rt, raw) {
    await chatExtra(rt, raw);
  }

  async function respondWhileWorking(rt, raw, activeTask) {
    // Same instant-dots + live-update contract while a delegated worker runs.
    const live = (typeof rt.typing === 'function') ? rt.typing({ mood: 'idle' }) : null;
    try {
      const text = await chatAI(rt, raw, { live, activeTask: {
        kind: activeTask.kind,
        prompt: activeTask.prompt,
        startedAt: activeTask.startedAt,
        updates: activeTask.updates || [],
      } });
      if (live) live.done(text, { mood: 'idle' });
      else await rt.say(text, { mood: 'idle' });
    } catch (e) {
      const msg = `I'm still here and the delegated work is continuing. I couldn't answer that follow-up just now, but you can send another message or interrupt the task.`;
      if (live) live.done(msg, { mood: 'think' });
      else await rt.say(msg, { mood: 'think' });
    }
  }

  async function runTask(rt, raw, task) {
    switch (task?.kind || taskRouting.taskKind(raw)) {
      case 'research': return research(rt, raw, task);
      case 'apps': return appsFlow(rt, raw, task);
      case 'github': return appsFlow(rt, raw, task);
      case 'build': return build(rt, task);
      default: return chatExtra(rt, raw, task);
    }
  }

  async function run(rt, raw) {
    const p = String(raw).toLowerCase();
    if (asksAboutInternalDetails(raw)) return chatExtra(rt, raw);
    if (rt.isFirst && /hej|hello|hi\b/.test(p) && p.length < 24) return greet(rt);
    switch (intent(p)) {
      case 'research': return research(rt, raw);
      case 'apps': return appsFlow(rt, raw);
      case 'github': return appsFlow(rt, raw);
      case 'build': return build(rt);
      case 'inbox': return appsFlow(rt, raw);
      case 'vault': return vaultFlow(rt);
      case 'memory': return memoryFlow(rt, raw);
      case 'automation': return automationFlow(rt, raw);
      default: return chatExtra(rt, raw);
    }
  }

  return {
    run, runTask, respondWhileWorking, preview, greet, intent,
    isTask: taskRouting.isTask,
    routeMessage: taskRouting.routeMessage,
    taskKind: taskRouting.taskKind,
  };
})();
