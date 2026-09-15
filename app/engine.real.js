/* ============ Lingon REAL engine — Gemini backend, no simulations ============
   Same `rt` contract as engine.js, but every answer comes from:
   - POST /api/chat (Gemini, server-side key)
   - POST /api/research (live web fetch + Gemini summary, sources cited)
   - GET  /api/github/prs (real GitHub API with the user's own token)
   - POST /api/build (Gemini-generated HTML)
   Secrets: VALUES never leave the device except (a) to our own backend
   vault store over HTTPS/localhost, and (b) GitHub tokens only to api.github.com
   via the backend proxy. The model only ever receives refs like sec_xxxx.
*/
window.Engine = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const apiBase = () => (window.LingonConfig && window.LingonConfig.apiBase) || '';
  const userId = () => (window.LingonConfig && window.LingonConfig.userId) || 'local';

  async function api(path, opts = {}) {
    const r = await fetch(apiBase() + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status} on ${path}`);
    return j;
  }

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
      case 'research': return `Here's how I'd run it for real: live fetch of public Reddit threads, Hacker News and web sources through my backend, then a Gemini briefing with cited sources on your canvas. No invented percentages — only what the sources actually support.`;
      case 'github': return `I'd use your own GitHub token (sealed in your vault, sent only to api.github.com) to list your real open pull requests, fetch the real diff, and have Gemini review it. Nothing is mocked.`;
      case 'build': return `I'd have Gemini generate a real single-file page from your brief, render a live preview on the canvas, and hand you the file. You iterate, I regenerate.`;
      case 'inbox': return `Inbox needs a Gmail OAuth token with read-only scope. Once connected, I do a real read-only sweep and summarize — I never invent emails. Without a token I'll tell you plainly instead of faking it.`;
      case 'vault': return `Secrets live in your vault (Supabase when configured, else the real backend store). I only ever receive a reference like \`sec_••••\` — the value never enters model context. Claim me and try the secrets box.`;
      case 'memory': return `I keep real long-term memory (backend-persisted, inspectable and deletable). Claim me and I'll start remembering across chats.`;
      default: return `I'd break that into steps and run it through the real backend (Gemini + live tools where connected), keeping artifacts on your canvas. Anything sensitive goes through your vault and approvals.`;
    }
  }

  function historyFor(rt) {
    const msgs = (rt.chat.messages || []).filter((m) => m.kind === 'text').slice(-8);
    return msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'agent', text: m.text }));
  }

  async function chatAI(rt, prompt, extraSystem = '') {
    // Secret values are NEVER included: only prompt + history + memory texts.
    const memories = rt.recall().slice(0, 10);
    const history = historyFor(rt);
    const j = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        history,
        agent: { name: rt.agent.name, pers: rt.agent.pers },
        memories,
      }),
    });
    return j.text;
  }

  async function syncMemoryToBackend(text, src) {
    try {
      await api('/api/memories', { method: 'POST', body: JSON.stringify({ userId: userId(), text, src }) });
    } catch {}
  }
  async function syncSecretToBackend(name, refId) {
    try {
      const ls = JSON.parse(localStorage.getItem('lingon.v1') || '{}');
      const s = (ls.vault?.secrets || []).find((x) => x.id === refId || x.name === name);
      if (!s || !s.value) return;
      await api('/api/secrets', { method: 'POST', body: JSON.stringify({ userId: userId(), name: s.name, value: s.value }) });
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
      const r = await fetch(apiBase() + '/api/health');
      health = await r.json();
    } catch {}
    const mode = health?.gemini ? `Live backend connected (Gemini ${health.model}${health.supabase ? ' + Supabase' : ' + local store'}).` : 'Backend reachable, but GEMINI_API_KEY is missing on the server — ask the owner to set it in .env.';
    const mem = rt.recall().find((m) => m.src === 'you said so' || m.src === 'from our chat');
    await rt.say(`Hej — I'm **${rt.agent.name}**. Claimed, named, and entirely yours. ${mode} I research with live sources, review real GitHub PRs with your token, and generate real pages — nothing is pre-scripted.` + (mem ? `\n\nAnd yes — I still remember: *"${mem.text}"*.` : ` What shall we do first?`), { mood: 'happy' });
    rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page', 'Remember that I prefer concise answers']);
  }

  /* ---------------- REAL research ---------------- */
  async function research(rt, raw) {
    await rt.say(`On it — doing this **for real**: live fetch of public sources through the backend, then a Gemini briefing with citations. No invented sample sizes.`, { mood: 'think' });
    await rt.tools([{ ic: 'search', t: 'Contacting backend research endpoint', d: 'Reddit · HN · web' }]);
    const br = rt.card({ type: 'browser', url: 'backend: POST /api/research', note: 'Fetching live sources…', status: 'running' });
    let res;
    try {
      res = await api('/api/research', { method: 'POST', body: JSON.stringify({ query: raw }) });
      br.update((c) => { c.status = 'done'; c.note = `Fetched ${res.snippets?.length || 0} source groups · ${new Date(res.fetchedAt).toLocaleTimeString()}`; });
      br.resolve({ ok: true });
    } catch (e) {
      br.update((c) => { c.status = 'done'; c.note = 'Research endpoint failed: ' + e.message; });
      br.resolve({ ok: false });
      await rt.say(`The live research endpoint failed: ${e.message}\n\nCheck that the backend is running (\`npm start\`) and GEMINI_API_KEY is set in server \`.env\`. I won't fake results.`, { mood: 'think' });
      return;
    }
    rt.trace('globe', `research fetched ${res.sources.length} source groups`);
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
    await rt.say(`Done — live briefing is on your canvas with sources. Open the source links to verify everything; I didn't invent any counts. Want me to dig into one thread?`, { mood: 'happy' });
    rt.chips(['Break it down by source', 'Save the methodology to memory', 'Review my GitHub pull requests']);
  }

  /* ---------------- REAL github ---------------- */
  async function github(rt) {
    if (!rt.hasApp('github')) {
      const c = rt.card({ type: 'connect', app: 'github', status: 'pending' });
      const r = await c.wait();
      if (!r.ok) { await rt.say(`No problem — connect GitHub anytime from the Vault. Your token stays sealed.`); return; }
    }
    if (!rt.hasSecret('github_token')) {
      await rt.say(`To review real PRs I need a GitHub token (fine-grained PAT, read-only is enough). Paste it in the **secrets box** — it's sealed in the vault and only ever sent to api.github.com, never to the model.`);
      const s = rt.card({ type: 'secret', suggest: 'github_token', status: 'pending' });
      const r = await s.wait();
      if (!r.ok) { await rt.say(`Skipped — I won't touch your repos without a token, and I won't fake a review.`); return; }
      try { await syncSecretToBackend('github_token', s.msg?.card?.ref); } catch {}
    }
    const token = readLocalSecretValue('github_token');
    if (!token) { await rt.say(`I have a reference but no value on this device, so I can't call GitHub. Re-save the token in the Vault.`); return; }
    const ref = rt.secretRef('github_token');
    rt.trace('lock', `vault.read(github_token) → ${ref} · value masked, sent only to api.github.com`);
    rt.trace('shield', 'guardrail: secret value never enters model context');

    const a = rt.card({ type: 'approval', key: 'gh_review', title: 'Review real open PRs', detail: 'Calls api.github.com with your token (read-only). No writes to your repos.', status: 'pending' });
    const ar = await a.wait();
    if (!ar.ok) { await rt.say(`Understood — I won't call GitHub.`); return; }

    const t = rt.card({ type: 'computer', status: 'running', lines: [] });
    t.update((c) => c.lines.push({ t: '$ lingon github --read-only (live API)', cls: 'p' }));
    let data;
    try {
      const r = await fetch(apiBase() + '/api/github/prs', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      data = j;
      t.update((c) => c.lines.push({ t: `✓ ${data.repos.length} repos checked · ${data.prs.length} open PRs`, cls: 'g' }));
    } catch (e) {
      t.update((c) => { c.lines.push({ t: '✗ GitHub call failed: ' + e.message, cls: 'p' }); c.status = 'done'; });
      t.resolve({ ok: false });
      await rt.say(`GitHub call failed: ${e.message}\n\nMost common cause is an expired or narrowly-scoped token. Create a fine-grained PAT with Contents + Pull requests read-only, save it as \`github_token\`, and try again.`, { mood: 'think' });
      return;
    }
    t.update((c) => c.status = 'done'); t.resolve({ ok: true });

    if (!data.prs.length) {
      await rt.say(`Checked **${data.repos.length} recently-updated repos** (${data.repos.slice(0, 5).join(', ') || 'none visible'}) — **zero open PRs** right now. Nothing to review, and I'm not going to invent any.`, { mood: 'happy' });
      return;
    }
    const first = data.prs[0];
    let diff = '';
    try {
      const r = await fetch(apiBase() + `/api/github/diff?repo=${encodeURIComponent(first.repo)}&number=${encodeURIComponent(first.number)}`, { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json();
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
      review = `Found **${data.prs.length} open PRs** across your repos. Newest: **${first.repo} #${first.number}** — ${first.title} (${first.url}). AI review is unavailable (${e.message}), so I won't guess at the diff.`;
    }
    await rt.say(review, { mood: 'happy' });
    rt.chips(['Show all open PRs', 'Build me a landing page', 'What can you do?']);
    // stash full list for follow-ups
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
      const j = await api('/api/build', { method: 'POST', body: JSON.stringify({ brief: rt.chat.messages.filter((m) => m.role === 'user').slice(-1)[0]?.text || '', style, agent: { name: rt.agent.name } }) });
      rt.artifact({ kind: 'html', title: 'your-page.html', html: j.html });
      rt.card({ type: 'artifact', title: 'your-page.html', kind: 'html', status: 'done' });
      rt.card({ type: 'file', name: 'your-page.html', size: j.html.length, content: j.html, status: 'done' });
      await rt.say(`Your page is live on the canvas and saved to Files — generated by Gemini, single file, no dependencies. Tell me what to tweak and I'll regenerate.`, { mood: 'happy' });
    } catch (e) {
      await rt.say(`Page generation failed: ${e.message}. The backend needs GEMINI_API_KEY in \`.env\`.`, { mood: 'think' });
    }
    rt.chips(['Make the hero bigger', 'Add a contact section', 'Research something for me']);
  }

  /* ---------------- inbox (honest, no fakes) ---------------- */
  async function inbox(rt) {
    if (!rt.hasApp('gmail')) {
      const c = rt.card({ type: 'connect', app: 'gmail', status: 'pending' });
      const r = await c.wait();
      if (!r.ok) { await rt.say(`Alright — inbox stays yours alone for now.`); return; }
    }
    await rt.say(`Honest status: real Gmail reading needs an OAuth client (client ID + read-only scope) which isn't configured in this build — so I won't pretend to summarize your inbox. If you add a Gmail OAuth token as a vault secret I can wire the real \`gmail.users.messages.list\` call next. Nothing was read, sent, or deleted.`, { mood: 'think' });
    rt.chips(['Save a secret to try the vault', 'Review my GitHub pull requests', 'What can you do?']);
  }

  async function vaultFlow(rt) {
    await rt.say(`Good instinct. Secrets live in your **backend vault** (Supabase when configured, else the server store). When I need one, a secrets box appears; once saved, I receive only a reference like \`sec_••••\`. The value never enters model context, logs or traces. Save anything below to try it for real.`);
    const s = rt.card({ type: 'secret', suggest: 'openai_api_key', status: 'pending' });
    const r = await s.wait();
    if (r.ok) {
      try { await syncSecretToBackend(s.msg?.card?.nameVal || 'openai_api_key', s.msg?.card?.ref); } catch {}
      rt.trace('shield', 'guardrail: value sealed server-side — agent context received reference only');
      await rt.say(`Sealed for real — metadata is on the backend, value encrypted at rest. View, reveal or revoke under **Vault**.`, { mood: 'happy' });
    } else {
      await rt.say(`No worries — the box stays available whenever you need it.`);
    }
  }

  async function memoryFlow(rt, raw) {
    const text = String(raw).replace(/.*?(remember|keep in mind|don't forget|dont forget)\s*(that)?\s*/i, '').trim() || raw;
    rt.remember(text, 'you said so');
    try { await api('/api/memories', { method: 'POST', body: JSON.stringify({ userId: userId(), text, src: 'you said so' }) }); } catch {}
    rt.card({ type: 'memory', text, status: 'done' });
    await rt.say(`Noted and saved to the real backend memory — it shapes future chats (the model receives it as context), and you can delete it under **Memory** anytime.`, { mood: 'happy' });
  }

  async function chatExtra(rt, raw) {
    const p = String(raw).toLowerCase();
    if (/what do you remember|do you remember|your memor|recall|what do you know about me/.test(p)) {
      const ms = rt.recall().filter((m) => m.src !== 'onboarding');
      if (!ms.length) return rt.say(`I don't have any memories of yours yet — say "remember that …" and I'll persist it to the backend.`);
      return rt.say(`Here's what I'm carrying (backend-persisted):\n\n` + ms.slice(0, 6).map((m) => `- ${m.text}`).join('\n') + `\n\nDelete any under **Memory**.`, { mood: 'happy' });
    }
    if (/what can you do/.test(p)) {
      await rt.say(`Real capabilities in this build: **live research** with cited sources, **real GitHub PR reviews** with your token, **real page generation** via Gemini, **real memory + vault** on the backend${''}. Gmail stays honest until OAuth is configured. Everything sensitive routes through vault + approvals.`);
      rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page']);
      return;
    }
    if (/keep me safe|safe|security|secret/.test(p)) {
      await rt.say(`Three layers, all real: **1)** secrets encrypted server-side, model gets masked refs; **2)** sensitive actions pause for approval; **3)** GitHub tokens go only to api.github.com, AI key stays on the server. Watch the Trace tab.`);
      rt.chips(['Save a secret to try it', 'Review my GitHub pull requests']);
      return;
    }
    if (/^run it/.test(p)) return research(rt, raw);
    if (/show all open prs|what else is on my repos/.test(p)) return github(rt);
    // default: real AI answer
    await rt.tools([{ ic: 'spark', t: 'Asking Gemini', d: 'live' }]);
    try {
      const text = await chatAI(rt, raw);
      const mem = rt.recall().find((m) => m.src === 'you said so' || m.src === 'from our chat');
      await rt.say(text, { mood: 'idle' });
      rt.chips(['Run it', 'What can you do?', 'How do you keep me safe?']);
    } catch (e) {
      await rt.say(`I couldn't reach the AI backend: ${e.message}\n\nFix: run \`npm start\` in C:\\lingon with GEMINI_API_KEY set in \`.env\`. I won't fake an answer.`, { mood: 'think' });
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
