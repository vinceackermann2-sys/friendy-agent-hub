/* ============ Lingon REAL engine — Gemini backend, no simulations ============
   Harness note: Agents API shape (Codex pattern per openai.com Agents API), Gemini-backed and self-hosted — not OpenAI-hosted. It is our own
   Gemini-backed harness: tools run server-side (allowlisted fetch, read-only
   GitHub with YOUR per-request PAT, sandboxed HTML artifacts), secrets never
   enter model context, sensitive tools pause for your approval, and every step
   lands in the Trace tab. Nothing is mocked.
*/
window.Engine = (() => {
  const api = (path, opts = {}) => window.LingonAuth.api(path, opts);
  const privateDetailsReply = () => `I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.`;

  function asksAboutInternalDetails(raw) {
    const text = String(raw || '').toLowerCase();
    return /(?:system prompt|developer message|hidden instructions|internal (?:instructions|prompt|policy|configuration)|reveal.{0,30}(?:prompt|instructions)|ignore.{0,30}(?:previous|system|developer).{0,30}instructions)/i.test(text)
      || /(?:\b(?:your|agent's|lingon's|arche's|this (?:app|agent)'?s)\s+(?:model|provider|backend|database|api|architecture|infrastructure|stack|framework|source code|implementation)\b|\b(?:what|which)\s+(?:ai|model|provider|backend|database|api|framework|stack)\b.{0,40}\b(?:do|does|are|is)\s+(?:you|lingon|arche|this (?:app|agent))\b|\b(?:are|is|do|does)\s+(?:you|lingon|arche|this (?:app|agent))\s+(?:use|run|rely|connect|call|work|operate|built|powered|based|hosted)\b|\bis this (?:app|agent)\s+(?:using|built|powered|based|hosted)\b|\bhow (?:are|were) you (?:built|made|hosted|run)\b|\b(?:are you|is (?:lingon|arche))\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b|\b(?:how (?:do you|does (?:lingon|arche|the agent|this (?:app|agent))) (?:work|run|operate)|(?:what|which).{0,20}(?:powers|runs|hosts) (?:you|lingon|arche|this (?:app|agent))|who (?:powers|built|made) (?:you|lingon|arche)|under the hood)\b)/i.test(text);
  }

  function intent(p) {
    p = String(p || '').toLowerCase();
    if (/\b(?:what|which) (?:is )?(?:the )?(?:current )?(?:date|day|month|year|time)\b|\b(?:today'?s date|date today|current date|current time|current year)\b/.test(p)) return 'chat';
    if (/(research|investigate|find out|analy[sz]e|forum|reddit|social media|poll|part(y|ies)|sentiment|opinion|\bnews\b|\blatest\b|\bcurrent\b|\brecent\b|up[- ]to[- ]date)/.test(p)) return 'research';
    if (/(github|pull request|\bpr\b|\brepo\b|code review|merge request)/.test(p)) return 'github';
    if (/(email|inbox|gmail|newsletter)/.test(p)) return 'inbox';
    if (/(secret|password|token|api key|credential|vault)/.test(p)) return 'vault';
    if (/(remember|don't forget|dont forget|keep in mind|preference)/.test(p)) return 'memory';
    if (/(build|create|make|design|code).*(website|landing|page|site|dashboard|app|chart|graph|deck)/.test(p) || /(website|landing page|one-pager)/.test(p)) return 'build';
    return 'chat';
  }

  function preview(prompt) {
    const p = String(prompt || '').toLowerCase();
    switch (intent(p)) {
      case 'research': return `I'd review current public sources and prepare a cited briefing on your canvas. No invented percentages — only what the sources actually support.`;
      case 'github': return `I'd use your securely stored GitHub credential to list your open pull requests, inspect the real diff, and review it. Nothing is mocked or simulated.`;
      case 'build': return `I'd generate a single-file page from your brief, render a live preview on the canvas, and hand you the file. You iterate, I regenerate.`;
      case 'inbox': return `No inbox connection exists. Gmail OAuth isn't configured, so I won't pretend to read email — ask me for research, GitHub reviews, or pages instead. I never simulate inbox contents.`;
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

  async function chatAI(rt, prompt) {
    const memories = rt.recall().slice(0, 10);
    const history = historyFor(rt, prompt);
    const current = (rt.chat.messages || []).filter((m) => m.kind === 'text').slice(-1)[0];
    try {
      const j = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt, history, replyTo: current?.replyTo, agent: { name: rt.agent.name, pers: rt.agent.pers }, memories, sessionId: rt.chat.id }),
      });
      if (Array.isArray(j.trace)) j.trace.forEach((t) => rt.trace(t.ic || 'spark', t.t));
      // ChatGPT-style: surface automatic saves like "Memory updated".
      for (const sm of j.savedMems || []) {
        if (!rt.recall().some((m) => m.text === sm.text)) {
          rt.remember(sm.text, 'auto');
          rt.card({ type: 'memory', text: 'Memory updated — ' + sm.text, status: 'done' });
        }
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
    const mem = rt.recall().find((m) => m.src === 'you said so' || m.src === 'from our chat');
    await rt.say(`Hej — I'm **${rt.agent.name}**, your Lingon agent. I can research with live sources, review GitHub pull requests with your permission, and create pages and files. Your private information stays private.` + (mem ? `\n\nI still remember: *"${mem.text}"*.` : ` What shall we do first?`), { mood: 'happy' });
    rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page', 'Remember that I prefer concise answers']);
  }

  /* ---------------- REAL research ---------------- */
  async function research(rt, raw) {
    await rt.say(`On it — checking public sources, then preparing a briefing with citations. I won't invent sample sizes or claims.`, { mood: 'think' });
    await rt.tools([{ ic: 'search', t: 'Checking public sources', d: 'HN · DDG · Wikipedia' }]);
    const br = rt.card({ type: 'browser', url: 'about:blank', note: 'Opening a real headless browser…', status: 'running' });
    let res;
    try {
      res = await api('/api/research', { method: 'POST', body: JSON.stringify({ query: raw, sessionId: rt.chat.id }) });
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
    const qa = await q.wait();
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
    rt.chips(['Break it down by source', 'Save the methodology to memory', 'Review my GitHub pull requests']);
  }

  /* ---------------- REAL github (PAT, no fake OAuth) ---------------- */
  async function github(rt) {
    // No fake "Connect GitHub OAuth" — real flow is PAT in vault → read-only API.
    if (!rt.hasSecret('github_token')) {
      await rt.say(`To review real PRs I need a GitHub fine-grained PAT (Contents + Pull requests, read-only). Paste it in the **secrets box** — sealed in your vault, sent only to api.github.com via a dedicated header, never to the model.`);
      const s = rt.card({ type: 'secret', suggest: 'github_token', status: 'pending' });
      const r = await s.wait();
      if (!r.ok) { await rt.say(`Skipped — I won't touch your repos without a token, and I won't fake a review.`); return; }
      try { await syncSecretToBackend('github_token', s.msg?.card?.ref); } catch {}
    }
    const token = readLocalSecretValue('github_token');
    if (!token) { await rt.say(`I have a reference but no value on this device, so I can't call GitHub. Re-save the token in the Vault.`); return; }
    const ref = rt.secretRef('github_token');
    rt.trace('lock', `GitHub credential ${ref} approved for this read-only action`);
    rt.trace('shield', 'credential value remained protected');

    const a = rt.card({ type: 'approval', key: 'gh_review', title: 'Review real open PRs', detail: 'Calls api.github.com with your PAT (read-only). No writes to your repos.', status: 'pending' });
    const ar = await a.wait();
    if (!ar.ok) { await rt.say(`Understood — I won't call GitHub.`); return; }

      const t = rt.card({ type: 'computer', status: 'running', lines: [] });
      t.update((c) => c.lines.push({ t: 'Read-only GitHub statistics from live API data', cls: 'p' }));
    let data;
    try {
      const j = await api(`/api/github/prs?sessionId=${encodeURIComponent(rt.chat.id)}`, { headers: { 'X-GitHub-Token': token } });
      data = j;
      (j.trace || []).forEach((x) => rt.trace(x.ic, x.t));
      // Real stdout from the executed sandbox — not composed client-side.
      for (const line of String(j.stdout || '').split('\n').filter(Boolean).slice(0, 8)) {
        t.update((c) => c.lines.push({ t: line, cls: 'g' }));
      }
      if (j.pcId) t.update((c) => { c.pcId = j.pcId; });
    } catch (e) {
      t.update((c) => { c.lines.push({ t: '✗ GitHub call failed: ' + e.message, cls: 'p' }); c.status = 'done'; });
      t.resolve({ ok: false });
      await rt.say(`GitHub call failed: ${e.message}\n\nMost common cause is an expired or narrowly-scoped token.`, { mood: 'think' });
      return;
    }
    t.update((c) => c.status = 'done'); t.resolve({ ok: true });

    if (!data.prs.length) {
      await rt.say(`Checked **${data.repos.length} recently-updated repos** — **zero open PRs** right now. Nothing to review, and I'm not going to invent any.`, { mood: 'happy' });
      return;
    }
    const first = data.prs[0];
    let diff = '';
    try {
      const j = await api(`/api/github/diff?repo=${encodeURIComponent(first.repo)}&number=${encodeURIComponent(first.number)}`, { headers: { 'X-GitHub-Token': token } });
      diff = (j.diff || '').slice(0, 8000);
    } catch {}
    if (diff) {
      rt.artifact({ kind: 'code', title: `${first.repo} #${first.number}.diff`, code: diff });
      rt.card({ type: 'artifact', title: `${first.repo} #${first.number}.diff`, kind: 'code', status: 'done' });
    }
    let review = '';
    try {
      review = await chatAI(rt, `Review this real GitHub PR for ${first.repo} #${first.number} "${first.title}" (${first.url}). Be concrete and honest; flag risks. Diff (may be truncated):\n${diff.slice(0, 6000)}`);
    } catch (e) {
      review = `Found **${data.prs.length} open PRs**. Newest: **${first.repo} #${first.number}** — ${first.title} (${first.url}). AI review is unavailable (${e.message}).`;
    }
    await rt.say(review, { mood: 'happy' });
    rt.chips(['Show all open PRs', 'Build me a landing page', 'What can you do?']);
    rt.trace('git', `${data.prs.length} open PRs: ` + data.prs.slice(0, 4).map((p) => `${p.repo}#${p.number}`).join(', '));
  }

  /* ---------------- REAL build ---------------- */
  async function build(rt) {
    const q = rt.card({ type: 'question', q: 'What vibe should the page have?', options: ['Minimal & calm', 'Playful & warm', 'Bold & dark'] });
    const qa = await q.wait();
    const style = qa.choice;
    rt.remember(`For pages, you picked "${style}".`, 'from our chat');
    syncMemoryToBackend(`For pages, you picked "${style}".`, 'from our chat');
    await rt.say(`Nice choice — generating a **${String(style).toLowerCase()}** page now; watch the canvas.`, { mood: 'happy' });
    await rt.tools([{ ic: 'code', t: 'Generating page', d: 'single file' }]);
    try {
      const j = await api('/api/build', { method: 'POST', body: JSON.stringify({ brief: rt.chat.messages.filter((m) => m.role === 'user').slice(-1)[0]?.text || '', style, agent: { name: rt.agent.name }, sessionId: rt.chat.id }) });
      rt.artifact({ kind: 'html', title: 'your-page.html', html: j.html });
      rt.card({ type: 'artifact', title: 'your-page.html', kind: 'html', status: 'done' });
      rt.card({ type: 'file', name: 'your-page.html', size: j.html.length, content: j.html, status: 'done' });
      await rt.say(`Your page is live on the canvas and saved to Files — single file, no dependencies.`, { mood: 'happy' });
    } catch (e) {
      await rt.say(`I couldn't generate that page right now. Please try again in a moment.`, { mood: 'think' });
    }
    rt.chips(['Make the hero bigger', 'Add a contact section', 'Research something for me']);
  }

  /* ---------------- inbox: honest empty (no fake connection) ---------------- */
  async function inbox(rt) {
    await rt.say(`No inbox is connected — and there's no fake demo data. Gmail OAuth isn't configured in this build, so nothing was read. Ask me for research, GitHub reviews, or pages instead.`, { mood: 'think' });
    rt.chips(['Save a secret to try the vault', 'Review my GitHub pull requests', 'What can you do?']);
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
    await rt.say(`Noted and saved to your account memory — it shapes future chats, and you can delete it under **Memory** anytime.`, { mood: 'happy' });
  }

  async function chatExtra(rt, raw) {
    const p = String(raw).toLowerCase();
    if (asksAboutInternalDetails(raw)) {
      return rt.say(privateDetailsReply(), { mood: 'idle' });
    }
    if (/who are you|what are you/.test(p)) {
      return rt.say(`I'm **${rt.agent.name}**, your Lingon agent. How can I help?`, { mood: 'happy' });
    }
    if (/what do you remember|do you remember|your memor|recall|what do you know about me/.test(p)) {
      const ms = rt.recall().filter((m) => m.src !== 'onboarding');
      if (!ms.length) return rt.say(`I don't have any memories of yours yet — say "remember that …" and I'll persist it to your account.`);
      return rt.say(`Here's what I'm carrying (account-scoped):\n\n` + ms.slice(0, 6).map((m) => `- ${m.text}`).join('\n') + `\n\nDelete any under **Memory**.`, { mood: 'happy' });
    }
    if (/what can you do/.test(p)) {
      await rt.say(`I can do **live research** with cited sources, **GitHub pull-request reviews** with your permission, **page generation**, and **account memory plus secure credential storage**. If something isn't available, I'll say so. Sensitive actions pause for approval and appear in your activity history.`);
      rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page']);
      return;
    }
    if (/keep me safe|safe|security|secret/.test(p)) {
      await rt.say(`Your data is account-scoped, secrets are encrypted, and sensitive actions require approval. External access is restricted, GitHub access is read-only, and activity is visible in the Trace tab.`);
      rt.chips(['Save a secret to try it', 'Review my GitHub pull requests']);
      return;
    }
    if (/^run it/.test(p)) return research(rt, raw);
    if (/show all open prs|what else is on my repos/.test(p)) return github(rt);
    await rt.tools([{ ic: 'spark', t: 'Working on your request', d: 'live' }]);
    try {
      const text = await chatAI(rt, raw);
      await rt.say(text, { mood: 'idle' });
      rt.chips(['Run it', 'What can you do?', 'How do you keep me safe?']);
    } catch (e) {
      await rt.say(`I couldn't complete that request right now. Please try again in a moment.`, { mood: 'think' });
    }
  }

  async function chat(rt, raw) {
    await chatExtra(rt, raw);
  }

  async function run(rt, raw) {
    const p = String(raw).toLowerCase();
    if (asksAboutInternalDetails(raw)) return chatExtra(rt, raw);
    if (rt.isFirst && /hej|hello|hi\b/.test(p) && p.length < 24) return greet(rt);
    switch (intent(p)) {
      case 'research': return research(rt, raw);
      case 'github': return github(rt);
      case 'build': return build(rt);
      case 'inbox': return inbox(rt);
      case 'vault': return vaultFlow(rt);
      case 'memory': return memoryFlow(rt, raw);
      default: return chatExtra(rt, raw);
    }
  }

  return { run, preview, greet, intent };
})();
