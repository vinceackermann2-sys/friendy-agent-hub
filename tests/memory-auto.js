/* Auto-memory test (ChatGPT-style): no "remember" keyword anywhere. Live: it signs up
   a real account against BASE, so run it only against a test deployment.
   1. signup → 2. chat a personal fact → assert the agent saved it to memory →
   3. ask about it in a new chat → assert the agent recalls it.
*/
(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:8000';
  const fail = (m) => { console.error('MEMORY-AUTO FAIL — ' + m); process.exit(1); };
  const em = `auto${Date.now()}@example.com`;
  const s = await (await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, password: 'AutoMem123!', terms_version: '2026-09-24' }) })).json();
  if (!s.access_token) fail('signup: ' + JSON.stringify(s).slice(0, 200));
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token };
  const marker = 'project-' + Date.now();

  // The chat endpoint streams server-sent events; the final_answer message is the reply.
  async function chat(chatId, prompt) {
    const res = await fetch(base + '/api/agent/conversation', { method: 'POST', headers: H,
      body: JSON.stringify({ chatId, requestId: `${chatId}-${Date.now()}`, prompt, history: [], context: { agent: { name: 'T' }, timeZone: 'Europe/Stockholm' } }) });
    if (!res.ok) fail(`${chatId}: HTTP ${res.status} ${await res.text()}`);
    const events = (await res.text()).split('\n\n').map((frame) => frame.replace(/^data: /, '')).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const error = events.find((e) => e.type === 'error');
    if (error) fail(`${chatId}: ${error.error}`);
    return String(events.filter((e) => e.type === 'message' && e.phase === 'final_answer').at(-1)?.text || '');
  }

  const first = await chat('memory-auto-1', `A quick fact about me: my exact project codename is ${marker}.`);
  console.log('reply 1:', first.slice(0, 200));
  const list = await (await fetch(base + '/api/memories', { headers: H })).json();
  if (!list.memories.some((m) => m.text.includes(marker))) fail('the fact was not saved to memory: ' + JSON.stringify(list.memories).slice(0, 300));
  console.log('persisted: ok (' + list.memories.length + ' memories)');

  const answer = await chat('memory-auto-2', 'What is my exact project codename? Include its numeric suffix.');
  console.log('answer:', answer.slice(0, 200));
  if (!answer.includes(marker)) fail('agent did not recall the fact');

  const hist = await (await fetch(base + '/api/history/search?q=' + encodeURIComponent(marker.slice(0, 13)), { headers: H })).json();
  if (!(hist.turns || []).length) fail('transcript search found nothing');
  console.log('transcript search: ok (' + hist.turns.length + ' turns)');
  console.log('MEMORY-AUTO PASS');
  process.exit(0);
})().catch((e) => { console.error('MEMORY-AUTO FAIL — ' + e.message); process.exit(1); });
