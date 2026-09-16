/* ============ Lingon engine — simulated OpenAI Agents API runtime ============
   In production this module is replaced by a backend that drives the real
   Agents API (Codex harness, sandbox, handoffs, guardrails). The UI contract
   (the `rt` runtime) stays identical. Secrets are never printed here. */
window.Engine = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = n => Math.floor(Math.random() * n);

  /* ---------------- intent detection ---------------- */
  function intent(p){
    if (/(research|investigate|find out|analy[sz]e|forum|reddit|social media|poll|part(y|ies)|sentiment|opinion)/.test(p)) return 'research';
    if (/(github|pull request|\bpr\b|\brepo\b|code review|merge request)/.test(p)) return 'github';
    if (/(email|inbox|gmail|newsletter)/.test(p)) return 'inbox';
    if (/(secret|password|token|api key|credential|vault)/.test(p)) return 'vault';
    if (/(remember|don't forget|dont forget|keep in mind|preference)/.test(p)) return 'memory';
    if (/(build|create|make|design|code).*(website|landing|page|site|dashboard|app|chart|graph|deck)/.test(p) || /(website|landing page|one-pager)/.test(p)) return 'build';
    return 'chat';
  }

  /* ---------------- landing preview (pre-claim) ---------------- */
  function preview(prompt){
    const p = prompt.toLowerCase();
    switch (intent(p)){
      case 'research': return `Here's how I'd approach it: a parallel sweep across forums, social platforms and news comments with a strict 30-day window — counting only explicit first-person statements, deduplicating, and charting **share of voice per party** with sample sizes and honest caveats. I'd spin up sub-agents per platform and compile everything on your canvas.`;
      case 'github': return `I'd connect your GitHub through a **sealed vault token** (I never see the value), then run a sandboxed review over your open pull requests — tests, diffs, risks — and tell you what's merge-ready.`;
      case 'build': return `I'd scaffold a clean one-pager in your style, render a **live preview on the canvas**, iterate with you, and hand over the file. Approvals gate anything that leaves the sandbox.`;
      case 'inbox': return `I'd connect your mail (OAuth, tokens sealed in your vault), skim the last 50 messages in a sandbox, and hand you a prioritized summary with drafts for anything that needs a reply.`;
      case 'vault': return `Secrets live in **your vault**, encrypted and masked. I only ever receive a reference like \`sec_••••\` — the value never enters my context. Claim me and you can try the secrets box yourself.`;
      case 'memory': return `I keep **long-term memory** across chats — your preferences, projects and standing instructions — and you can inspect or delete any of it. Claim me and I'll start remembering.`;
      default: return `I'd break that into concrete steps, use my sandboxed harness (browser, code, files) where it helps, spawn sub-agents for parallel work, and keep every artifact on your canvas. Anything sensitive goes through your vault and your approvals.`;
    }
  }

  /* ---------------- memory helpers (real, agent-accessible) ---------------- */
  const rememberOnce = (rt, text, src) => { if (!rt.recall().some(m => m.text === text)) rt.remember(text, src || 'from our chat'); };
  function recallRelevant(rt, raw){
    const words = raw.toLowerCase().split(/[^a-zåäöøæé]+/).filter(w => w.length > 3);
    return rt.recall().find(m => {
      const t = m.text.toLowerCase();
      return words.some(w => t.includes(w));
    });
  }

  /* ---------------- greeting ---------------- */
  async function greet(rt){
    const n = rt.agent.name;
    const mem = rt.recall().find(m => m.src === 'you said so' || m.src === 'from our chat');
    await rt.say(`Hej — I'm **${n}**. Claimed, named, and entirely yours. I can research, browse, write code, manage files and keep your life organized, all inside a sandboxed harness. Your secrets stay sealed in the vault; I only ever get references.` + (mem ? `\n\nAnd yes — I still remember: *"${mem.text}"*. Memory works across chats.` : ` What shall we do first?`), { mood:'happy' });
    rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page', 'Remember that I prefer concise answers']);
  }

  /* ---------------- scenarios ---------------- */
  async function research(rt, raw){
    await rt.say(`On it. I'll treat this as an **observational snapshot** of public comments — not a representative poll. I'm using a strict 30-day window, counting only explicit first-person statements ("I'm voting for…", "my vote goes to…"), excluding jokes, quotes and anything private. Spinning up parallel sub-agents now.`, { mood:'think' });
    await rt.tools([
      { ic:'search', t:'Searched the web', d:'6 queries' },
      { ic:'globe',  t:'Opened 14 public pages', d:'forums · social · news' },
    ]);
    const br = rt.card({ type:'browser', url:'old.reddit.com/r/sweden/search?q=vote+2026', note:'Opening search results…', status:'running' });
    await sleep(900);
    br.update(c => { c.url = 'old.reddit.com/r/sweden/comments/…'; c.note = 'Reading thread · extracting first-person statements'; });
    await sleep(1100);
    br.update(c => { c.status = 'done'; c.note = 'Captured 38 qualifying comments from this source'; });
    br.resolve({ ok:true });
    const h = rt.card({ type:'subagents', agents:[
      { name:'forums_vote', desc:'Reddit & Swedish forums', status:'queued' },
      { name:'social_vote', desc:'X · Threads · Instagram', status:'queued' },
      { name:'news_vote',   desc:'News comments & blogs',   status:'queued' },
    ]});
    const counts = [412, 687, 293];
    for (let i = 0; i < 3; i++){
      h.update(c => { c.agents[i].status = 'running'; });
      await sleep(900 + rnd(700));
      h.update(c => { c.agents[i].status = 'done'; c.agents[i].note = counts[i] + ' qualifying comments'; });
      rt.trace('box', 'sub-agent ' + h.msg.card.agents[i].name + ' returned ' + counts[i] + ' items');
    }
    h.update(c => { c.status = 'done'; });
    h.resolve({ ok:true });
    await sleep(300);

    const q = rt.card({ type:'question', q:'How should I present the results?', options:['Percentage graph + dataset', 'Written report', 'Both'] });
    const qa = await q.wait();
    rememberOnce(rt, `You like results as: ${qa.choice}.`);
    const wantChart = /graph|Both/i.test(qa.choice);

    await rt.tools([
      { ic:'chart', t:'Aggregating shares of voice', d:'1,392 comments' },
      { ic:'file',  t:'Wrote dataset.csv', d:'anonymized' },
    ]);

    const data = [
      { l:'S',  v:24, c:'#E15A46' }, { l:'M', v:19, c:'#4A77B8' },
      { l:'SD', v:17, c:'#E8B33C' }, { l:'MP', v:12, c:'#6FBF73' },
      { l:'V',  v:10, c:'#B84A6E' }, { l:'C',  v:8,  c:'#7BA05B' },
      { l:'L',  v:6,  c:'#5B6EE1' }, { l:'KD', v:4,  c:'#8D5FC6' },
    ];
    if (wantChart){
      rt.artifact({ kind:'chart', title:'Share of voice — Swedish parties', data,
        foot:'Observed share of explicit voting statements in public comments, last 30 days. An observational snapshot — not a poll. n = 1,392.' });
      rt.card({ type:'artifact', title:'Share of voice — Swedish parties', kind:'chart', status:'done' });
    } else {
      rt.artifact({ kind:'plan', title:'Observational report', items: data.map(d => `**${d.l}** — ${d.v}% of qualifying statements`) });
      rt.card({ type:'artifact', title:'Observational report', kind:'plan', status:'done' });
    }

    const csv = 'party,share_pct,qualifying_comments\n' + data.map(d => `${d.l},${d.v},${Math.round(1392 * d.v / 100)}`).join('\n');
    rt.card({ type:'file', name:'dataset.csv', size:csv.length, content:csv, status:'done' });

    await rt.say(`Done. Across **1,392 qualifying comments**, the Social Democrats lead observed share of voice (24%), ahead of the Moderates (19%) and Sweden Democrats (17%) — with the Greens notably over-represented on social platforms versus forums. Everything is anonymized and source-linked in \`dataset.csv\`, and the chart is on your canvas. Remember: this measures what people *say publicly online*, not what Sweden will vote.`, { mood:'happy' });
    rt.chips(['Break it down by platform', 'Write a report from this', 'Save the methodology to memory']);
  }

  async function github(rt){
    if (!rt.hasApp('github')){
      const c = rt.card({ type:'connect', app:'github', status:'pending' });
      const r = await c.wait();
      if (!r.ok){ await rt.say(`No problem — we can do this whenever you're ready. Your token would stay sealed in the vault either way.`); return; }
    }
    if (!rt.hasSecret('github_token')){
      await rt.say(`To review your PRs I need a GitHub token. Drop it in the **secrets box** below — it's encrypted into your vault and I only receive a masked reference.`);
      const s = rt.card({ type:'secret', suggest:'github_token', status:'pending' });
      const r = await s.wait();
      if (!r.ok){ await rt.say(`Skipped — I can still show you how this would work once a token is in the vault.`); return; }
    }
    const ref = rt.secretRef('github_token');
    rt.trace('lock', `vault.read(github_token) → ${ref} · value masked`);
    rt.trace('shield', 'guardrail: secret reference only — value never enters model context');

    const a = rt.card({ type:'approval', key:'gh_review', title:'Run sandboxed PR review',
      detail:'Clone your open PRs, run tests and analyze diffs inside the sandbox. No writes to your repos.', status:'pending' });
    const ar = await a.wait();
    if (!ar.ok){ await rt.say(`Understood — I won't touch your repos. Ask me anything else, or approve it later from the Vault.`); return; }

    const t = rt.card({ type:'computer', status:'running', lines:[] });
    const lines = [
      { t:'$ lingon sandbox up --net=allowlist', cls:'p' },
      { t:'✓ cloned 2 repositories (ref token)', cls:'g' },
      { t:'✓ pytest — 41 passed, 2 failed', cls:'g' },
      { t:'✓ diff analyzed (3 files, +182 −96)', cls:'g' },
    ];
    for (const L of lines){ t.update(c => c.lines.push(L)); await sleep(700); }
    t.update(c => c.status = 'done'); t.resolve({ ok:true });

    const diff = `# PR #48 — fix: retry scheduler on transient 429\n-  const backoff = 1000;\n+  const backoff = jitter(1200);\n+  if (attempt > 3) await cooldown(queue);\n \n# PR #51 — feat: canvas export\n-  exportChart(svg);\n+  exportChart(svg, { format: user.prefersFormat });\n+  // TODO: handle wide charts on mobile`;
    rt.artifact({ kind:'code', title:'pr-review.diff', code:diff });
    rt.card({ type:'artifact', title:'pr-review.diff', kind:'code', status:'done' });

    await rt.say(`Review complete. **PR #48** is merge-ready — the jitter fix is sound and tests pass. **PR #51** has two failing tests around \`user.prefersFormat\` (undefined in the test harness) and a mobile-export TODO; I'd request changes. Full diff is on the canvas.`, { mood:'happy' });
    rt.chips(['Draft a review comment for PR #51', 'What else is on my repos?', 'Build me a landing page']);
  }

  async function build(rt){
    const q = rt.card({ type:'question', q:'What vibe should the page have?', options:['Minimal & calm', 'Playful & warm', 'Bold & dark'] });
    const qa = await q.wait();
    const style = qa.choice;
    rememberOnce(rt, `For pages, you picked "${style}".`);
    await rt.say(`Nice choice — going **${style.toLowerCase()}**. Scaffolding now; watch the canvas.`, { mood:'happy' });
    await rt.tools([
      { ic:'code', t:'Wrote index.html', d:'single file, no deps' },
      { ic:'eye',  t:'Self-reviewed layout', d:'contrast · spacing' },
    ]);
    const html = siteHTML(style, rt.agent);
    rt.artifact({ kind:'html', title:'your-page.html', html });
    rt.card({ type:'artifact', title:'your-page.html', kind:'html', status:'done' });
    rt.card({ type:'file', name:'your-page.html', size:html.length, content:html, status:'done' });
    await rt.say(`Your page is live on the canvas and saved to Files. It's a single dependency-free HTML file — tell me what to tweak and I'll iterate in place.`, { mood:'happy' });
    rt.chips(['Make the hero bigger', 'Add a contact section', 'Research something for me']);
  }

  async function inbox(rt){
    if (!rt.hasApp('gmail')){
      const c = rt.card({ type:'connect', app:'gmail', status:'pending' });
      const r = await c.wait();
      if (!r.ok){ await rt.say(`Alright — inbox stays yours alone for now.`); return; }
    }
    const a = rt.card({ type:'approval', key:'mail_read', title:'Read your last 50 emails',
      detail:'Read-only sweep in the sandbox. Nothing is sent, deleted or archived without asking.', status:'pending' });
    const ar = await a.wait();
    if (!ar.ok){ await rt.say(`Got it — I won't open your inbox.`); return; }
    const bw = rt.card({ type:'browser', url:'mail.google.com/mail/u/0/#inbox', note:'Opening inbox (read-only)…', status:'running' });
    await sleep(1000);
    bw.update(c => { c.status = 'done'; c.note = 'Skimmed 50 messages · nothing sent or deleted'; });
    bw.resolve({ ok:true });
    await rt.tools([
      { ic:'mail', t:'Fetched 50 messages', d:'read-only' },
      { ic:'spark', t:'Prioritized by urgency', d:'4 need replies' },
    ]);
    await rt.say(`Quick summary: **4 emails need a reply** (two invoices from Klarna, a dentist reminder, and a contract from your landlord). **12 receipts** filed themselves under Finance in my suggested structure, and **9 promo threads** are candidates for unsubscribe. Nothing looked phishing-ish, but one "delivery" mail had a sketchy short link — I've left it untouched and flagged it for you.`, { mood:'think' });
    const q = rt.card({ type:'question', q:'Unsubscribe from the 9 promo senders?', options:['Yes, unsubscribe all', 'Show me the list first', 'No, keep them'] });
    const qa = await q.wait();
    if (/^Yes/.test(qa.choice)){
      await rt.tools([{ ic:'mail', t:'Unsubscribed 9 senders', d:'via list headers' }]);
      await rt.say(`Done — 9 senders unsubscribed using their official list headers. Your inbox should breathe easier by tomorrow.`, { mood:'happy' });
    } else if (/list/i.test(qa.choice)){
      await rt.say(`Fair caution. The nine are: three clothing stores, two food-delivery apps, two airline deal digests, a daily-deals site, and a browser-games newsletter. Say the word and I'll unsubscribe any subset.`);
    } else {
      await rt.say(`Kept them all — sometimes the promos are the fun part.`);
    }
  }

  async function vaultFlow(rt){
    await rt.say(`Good instinct. Here's the model: secrets live in **your vault**, encrypted at rest. When I need one, a secrets box appears in chat; once saved, I receive only a reference like \`sec_••••\`. The value never enters my context, logs or traces. Try it — save anything below and inspect it later in the Vault.`);
    const s = rt.card({ type:'secret', suggest:'openai_api_key', status:'pending' });
    const r = await s.wait();
    if (r.ok){
      rt.trace('shield', 'guardrail: value sealed — agent context received reference only');
      await rt.say(`Sealed. You can view, reveal or revoke it any time under **Vault** — and I'll only ever see the reference. That's the whole trick to letting an agent act in the real world without ever holding your keys.`, { mood:'happy' });
    } else {
      await rt.say(`No worries — the box stays available whenever you need it.`);
    }
  }

  async function memoryFlow(rt, raw){
    const text = raw.replace(/.*?(remember|keep in mind|don't forget|dont forget)\s*(that)?\s*/i, '').trim() || raw;
    rt.remember(text, 'you said so');
    rt.card({ type:'memory', text, status:'done' });
    await rt.say(`Noted and saved to my memory — it now shapes every future chat, and you can review or delete it under **Memory** any time.`, { mood:'happy' });
  }

  async function chat(rt, raw){
    const mem = recallRelevant(rt, raw);
    await rt.say((mem ? `From my memory: *"${mem.text}"* — kept in mind while I work. ` : '') + preview(raw) + ` Want me to run it for real? I have the sandbox warmed up.`, { mood:'idle' });
    rt.chips(['Run it', 'What can you do?', 'How do you keep me safe?']);
  }

  async function chatExtra(rt, raw){
    const p = raw.toLowerCase();
    if (/what do you remember|do you remember|your memor|recall|what do you know about me/.test(p)){
      const ms = rt.recall().filter(m => m.src !== 'onboarding');
      if (!ms.length) return rt.say(`I don't have any memories of yours yet — say "remember that …" and I'll keep it across chats.`);
      return rt.say(`Here's what I'm carrying across chats:\n\n` + ms.slice(0, 6).map(m => `- ${m.text}`).join('\n') + `\n\nYou can review or delete any of these under **Memory**.`, { mood:'happy' });
    }
    if (/what can you do/.test(p)){
      await rt.say(`Quite a lot: **deep research** with parallel sub-agents, **browser & computer use** in a sandbox, **code & files** (you'll see artifacts on the canvas), **email triage**, **scheduled routines** later on — plus a memory that persists across chats. Everything sensitive routes through your vault and your approvals.`);
      rt.chips(['Research Swedish party sentiment on social media', 'Review my GitHub pull requests', 'Build me a landing page']);
      return;
    }
    if (/keep me safe|safe|security|secret/.test(p)){
      await rt.say(`Three layers: **1)** your secrets are encrypted in the vault and I only ever receive masked references; **2)** new actions require your approval unless you've explicitly always-allowed them; **3)** everything I run lives in a sandboxed harness with an allowlisted network. You can watch every step in the Trace tab.`);
      rt.chips(['Save a secret to try it', 'Review my GitHub pull requests']);
      return;
    }
    if (/^run it/.test(p)){
      return research(rt, raw);
    }
    return chat(rt, raw);
  }

  /* ---------------- generated site artifact ---------------- */
  function siteHTML(style, agent){
    const S = {
      'Minimal & calm': { bg:'#F7F7F5', ink:'#191A1C', acc:'#3E8E5A', font:'system-ui', rad:'14px' },
      'Playful & warm': { bg:'#FFF7EF', ink:'#33241C', acc:'#E15A46', font:'system-ui', rad:'22px' },
      'Bold & dark':    { bg:'#141416', ink:'#F5F5F6', acc:'#E8B33C', font:'system-ui', rad:'10px' },
    }[style] || { bg:'#F7F7F5', ink:'#191A1C', acc:'#E15A46', font:'system-ui', rad:'16px' };
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:${S.font};background:${S.bg};color:${S.ink};display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:560px;padding:40px;text-align:center}h1{font-size:44px;line-height:1.05;margin:0 0 14px;letter-spacing:-.02em}
p{opacity:.72;font-size:17px;line-height:1.6}a{display:inline-block;margin-top:22px;background:${S.acc};color:#fff;text-decoration:none;padding:13px 26px;border-radius:${S.rad};font-weight:700}
.tag{display:inline-block;border:1.5px solid ${S.acc};color:${S.acc};border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700;margin-bottom:18px}</style></head>
<body><main><span class="tag">made by ${agent.name}</span><h1>Do less. Live more.</h1>
<p>A personal agent that researches, builds and remembers — while your secrets stay yours.</p>
<a href="#">Meet your agent</a></main></body></html>`;
  }

  /* ---------------- router ---------------- */
  async function run(rt, raw){
    const p = raw.toLowerCase();
    if (rt.isFirst && /hej|hello|hi\b/.test(p)) return greet(rt);
    switch (intent(p)){
      case 'research': return research(rt, raw);
      case 'github':   return github(rt);
      case 'build':    return build(rt);
      case 'inbox':    return inbox(rt);
      case 'vault':    return vaultFlow(rt);
      case 'memory':   return memoryFlow(rt, raw);
      default:         return chatExtra(rt, raw);
    }
  }

  return { run, preview, greet, intent };
})();
