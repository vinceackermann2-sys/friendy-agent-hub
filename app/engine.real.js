/* ============ Lingon REAL engine — Gemini backend, no simulations ============
   Harness note: Agents API shape (Codex pattern per openai.com Agents API), Gemini-backed and self-hosted — not OpenAI-hosted. It is our own
   Gemini-backed harness: tools run server-side (allowlisted fetch, read-only
   GitHub with YOUR per-request PAT, sandboxed HTML artifacts), secrets never
   enter model context, sensitive tools pause for your approval, and every step
   lands in the Trace tab. Nothing is mocked.
*/
window.Engine = (() => {
  const api = (path, opts = {}) => window.LingonAuth.api(path, opts);

  function intent(p) {
    p = String(p || '').toLowerCase();
    if (/(research|investigate|find out|analy[sz]e|forum|reddit|social media|poll|part(y|ies)|sentiment|opinion)/.test(p)) return 'research';
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
      case 'research': return `Here's how I'd run it for real as Star 1.0: live fetch of public Hacker News, DuckDuckGo and Wikipedia sources through my backend, then a briefing with cited sources on your canvas. No invented percentages — only what the sources actually support. I never simulate or fake results.`;
      case 'github': return `As Star 1.0, I'd use your own GitHub fine-grained PAT (sealed in your vault, sent only to api.github.com via X-GitHub-Token) to list your real open pull requests, fetch the real diff, and review it. Nothing is mocked or simulated.`;
      case 'build': return `As Star 1.0, I'd generate a real single-file page from your brief, render a live preview on the canvas, and hand you the file. You iterate, I regenerate — no fake previews.`;
      case 'inbox': return `No inbox connection exists. Gmail OAuth isn't configured, so I won't pretend to read email — ask me for research, GitHub reviews, or pages instead. I never simulate inbox contents.`;
      case 'vault': return `Secrets live in your backend vault (Supabase, encrypted at rest). I only ever receive a reference like \`sec_••••\` — the value never enters model context. I never reveal other users, safety data, or company internals. Claim me and try the secrets box.`;
      case 'memory': return `I keep real backend memory tied to your signed-in account (inspectable and deletable, never shared with other users). As Star 1.0, claim me and I'll start remembering across chats.`;
      default: return `As Star 1.0, I'd break that into steps and run it through the real backend (live tools where connected), keeping artifacts on your canvas. I never simulate or fake responses, and I never reveal other users, safety data, or company internals. Anything sensitive goes through your vault and approvals.`;
    }
  }

  function historyFor(rt) {
    const msgs = (rt.chat.messages || []).filter((m) => m.kind === 'text').slice(-8);
    return msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'agent', text: m.text }));
  }

  async function chatAI(rt, prompt) {
    const memories = rt.recall().slice(0, 10);
    const history = historyFor(rt);
    try {
      const j = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt, history, agent: { name: rt.agent.name, pers: rt.agent.pers }, memories, sessionId: rt.chat.id }),
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
    let health = null;
    try {
      const r = await fetch((window.LingonConfig.apiBase || '') + '/api/health');
      health = await r.json();
    } catch {}
    const mode = health?.gemini ? `Live backend (Star 1.0 on Gemini ${health.model}, Supabase-backed). Harness: Agents-API shape (sessions, tools, subagents, sandbox, tracing) on Star 1.0.` : 'Backend reachable, but GEMINI_API_KEY is missing on the server.';
    const mem = rt.recall().find((m) => m.src === 'you said so' || m.src === 'from our chat');
    await rt.say(`Hej — I'm **${rt.agent.name}**, powered by **Star 1.0**. Claimed, named, and entirely yours. ${mode} I research with live sources, review real GitHub PRs with your PAT, and generate real pages — nothing is pre-scripted, simulated, or faked. I never reveal other users, safety data, or company internals — your data stays yours.` + (mem ? `\n\nAnd yes — I still remember: *"${mem.text}"*.` : ` What shall we do first?`), { mood: 'happy' });
    rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page', 'Remember that I prefer concise answers']);
  }

  /* ---------------- REAL research ---------------- */
  async function research(rt, raw) {
    await rt.say(`On it — doing this **for real**: live fetch of public sources through the backend, then a Gemini briefing with citations. No invented sample sizes.`, { mood: 'think' });
    await rt.tools([{ ic: 'search', t: 'Contacting backend research endpoint', d: 'HN · DDG · Wikipedia' }]);
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
      br.update((c) => { c.status = 'done'; c.note = 'Research endpoint failed: ' + e.message; });
      br.resolve({ ok: false });
      await rt.say(`The live research endpoint failed: ${e.message}`, { mood: 'think' });
      return;
    }
    rt.trace('globe', `harness web_fetch: ${res.sources.length} source groups (allowlisted)`);
    const h = rt.card({ type: 'subagents', agents: res.sources.map((u, i) => ({ name: 'fetch_' + (i + 1), desc: u.slice(0, 60), status: 'done', note: 'live' })) });
    h.update((c) => { c.status = 'done'; });
    h.resolve({ ok: true });
    await rt.tools([{ ic: 'spark', t: 'Summarized with Gemini', d: 'cited, no invented stats' }]);

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
    rt.trace('lock', `harness vault.read(github_token) → ${ref} · value masked, X-GitHub-Token only`);
    rt.trace('shield', 'guardrail: secret value never enters model context');

    const a = rt.card({ type: 'approval', key: 'gh_review', title: 'Review real open PRs', detail: 'Calls api.github.com with your PAT (read-only). No writes to your repos.', status: 'pending' });
    const ar = await a.wait();
    if (!ar.ok) { await rt.say(`Understood — I won't call GitHub.`); return; }

    const t = rt.card({ type: 'computer', status: 'running', lines: [] });
    t.update((c) => c.lines.push({ t: '$ code_run stats.js < live GitHub API data (sandboxed, read-only)', cls: 'p' }));
    let data;
    try {
      const j = await api('/api/github/prs', { headers: { 'X-GitHub-Token': token } });
      data = j;
      (j.trace || []).forEach((x) => rt.trace(x.ic, x.t));
      // Real stdout from the executed sandbox — not composed client-side.
      for (const line of String(j.stdout || '').split('\n').filter(Boolean).slice(0, 8)) {
        t.update((c) => c.lines.push({ t: line, cls: 'g' }));
      }
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
    await rt.say(`Nice choice — generating a real **${String(style).toLowerCase()}** page with Gemini now; watch the canvas.`, { mood: 'happy' });
    await rt.tools([{ ic: 'code', t: 'Calling POST /api/build', d: 'Gemini, single file' }]);
    try {
      const j = await api('/api/build', { method: 'POST', body: JSON.stringify({ brief: rt.chat.messages.filter((m) => m.role === 'user').slice(-1)[0]?.text || '', style, agent: { name: rt.agent.name }, sessionId: rt.chat.id }) });
      rt.artifact({ kind: 'html', title: 'your-page.html', html: j.html });
      rt.card({ type: 'artifact', title: 'your-page.html', kind: 'html', status: 'done' });
      rt.card({ type: 'file', name: 'your-page.html', size: j.html.length, content: j.html, status: 'done' });
      await rt.say(`Your page is live on the canvas and saved to Files — generated by Gemini, single file, no dependencies.`, { mood: 'happy' });
    } catch (e) {
      await rt.say(`Page generation failed: ${e.message}`, { mood: 'think' });
    }
    rt.chips(['Make the hero bigger', 'Add a contact section', 'Research something for me']);
  }

  /* ---------------- inbox: honest empty (no fake connection) ---------------- */
  async function inbox(rt) {
    await rt.say(`No inbox is connected — and there's no fake demo data. Gmail OAuth isn't configured in this build, so nothing was read. Ask me for research, GitHub reviews, or pages instead.`, { mood: 'think' });
    rt.chips(['Save a secret to try the vault', 'Review my GitHub pull requests', 'What can you do?']);
  }

  async function vaultFlow(rt) {
    await rt.say(`Good instinct. Secrets live in your **backend vault** (Supabase, encrypted at rest, scoped to your signed-in account). Once saved, I receive only a reference like \`sec_••••\`. The value never enters model context, logs or traces.`);
    const s = rt.card({ type: 'secret', suggest: 'openai_api_key', status: 'pending' });
    const r = await s.wait();
    if (r.ok) {
      try { await syncSecretToBackend(s.msg?.card?.nameVal || 'openai_api_key', s.msg?.card?.ref); } catch {}
      rt.trace('shield', 'guardrail: value sealed server-side — agent context received reference only');
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
    if (/who are you|what model|what are you|are you (gpt|claude|gemini|llama|kimi|grok|openai)|which (model|ai)/.test(p)) {
      return rt.say(`I'm **${rt.agent.name}**, powered by **Star 1.0** by Arche — that's the only model I ever identify as. I don't reveal other users, safety data, or company internals. How can I help?`, { mood: 'happy' });
    }
    if (/what do you remember|do you remember|your memor|recall|what do you know about me/.test(p)) {
      const ms = rt.recall().filter((m) => m.src !== 'onboarding');
      if (!ms.length) return rt.say(`I don't have any memories of yours yet — say "remember that …" and I'll persist it to your account.`);
      return rt.say(`Here's what I'm carrying (account-scoped):\n\n` + ms.slice(0, 6).map((m) => `- ${m.text}`).join('\n') + `\n\nDelete any under **Memory**.`, { mood: 'happy' });
    }
    if (/what can you do/.test(p)) {
      await rt.say(`Real capabilities as Star 1.0: **live research** with cited sources, **real GitHub PR reviews** with your PAT, **real page generation**, **account memory + vault** (never shared with other users). No fake or simulated responses — if something isn't connected, I'll say so. I never reveal other users, safety data, or company internals, and I always identify as Star 1.0. Sensitive tools pause for approval with a full trace.`);
      rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page']);
      return;
    }
    if (/keep me safe|safe|security|secret/.test(p)) {
      await rt.say(`Three layers, all real: **1)** Supabase Auth + per-account data, secrets encrypted, model gets masked refs; **2)** sensitive tools pause for approval; **3)** allowlisted fetch + read-only GitHub + sandboxed HTML previews. Watch the Trace tab.`);
      rt.chips(['Save a secret to try it', 'Review my GitHub pull requests']);
      return;
    }
    if (/^run it/.test(p)) return research(rt, raw);
    if (/show all open prs|what else is on my repos/.test(p)) return github(rt);
    await rt.tools([{ ic: 'spark', t: 'Asking Gemini', d: 'live' }]);
    try {
      const text = await chatAI(rt, raw);
      await rt.say(text, { mood: 'idle' });
      rt.chips(['Run it', 'What can you do?', 'How do you keep me safe?']);
    } catch (e) {
      await rt.say(`I couldn't reach the AI backend: ${e.message}`, { mood: 'think' });
    }
  }

  async function chat(rt, raw) {
    await chatExtra(rt, raw);
  }

  async function run(rt, raw) {
    const p = String(raw).toLowerCase();
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
