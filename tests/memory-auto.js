/* Auto-memory test (ChatGPT-style): no "remember" keyword anywhere.
   1. signup → 2. chat a personal fact → assert backend auto-saved it →
   3. ask about it with empty client memories → assert the agent recalls it.
*/
(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:8000';
  const fail = (m) => { console.error('MEMORY-AUTO FAIL — ' + m); process.exit(1); };
  const em = `auto${Date.now()}@example.com`;
  const s = await (await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, password: 'AutoMem123!' }) })).json();
  if (!s.access_token) fail('signup: ' + JSON.stringify(s).slice(0, 200));
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token };
  const marker = 'quinoa-' + Date.now();

  const c1 = await (await fetch(base + '/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ prompt: `A quick fact about me: my favorite grain is ${marker}. I eat it every Tuesday.`, history: [], agent: { name: 'T' }, memories: [] }) })).json();
  if (c1.error) fail('chat1: ' + c1.error);
  console.log('chat1 savedMems:', JSON.stringify(c1.savedMems || []));
  if (!(c1.savedMems || []).length) fail('nothing auto-saved (savedMems empty)');

  const list = await (await fetch(base + '/api/memories', { headers: H })).json();
  if (!list.memories.some((m) => m.text.includes(marker))) fail('saved memory not listed: ' + JSON.stringify(list.memories).slice(0, 300));
  console.log('persisted: ok (' + list.memories.length + ' memories)');

  const c2 = await (await fetch(base + '/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ prompt: 'What is my favorite grain?', history: [], agent: { name: 'T' }, memories: [], sessionId: 'test-chat-1' }) })).json();
  if (c2.error) fail('chat2: ' + c2.error);
  console.log('answer:', String(c2.text).slice(0, 200));
  if (!String(c2.text).includes(marker)) fail('agent did not recall the fact');

  const hist = await (await fetch(base + '/api/history/search?q=' + encodeURIComponent(marker.slice(0, 13)), { headers: H })).json();
  if (!(hist.turns || []).length) fail('transcript search found nothing');
  console.log('transcript search: ok (' + hist.turns.length + ' turns)');
  console.log('MEMORY-AUTO PASS');
  process.exit(0);
})().catch((e) => { console.error('MEMORY-AUTO FAIL — ' + e.message); process.exit(1); });
