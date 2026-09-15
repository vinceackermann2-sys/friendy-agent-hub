/* ChatGPT-style memory: automatic, not keyword-gated.
   - RECALL: rankMemories() scores every stored memory against the current
     prompt (word overlap + recency) and injects the top hits as model context.
   - WRITE: maybeExtract() runs after an answer when the turn looks
     fact-worthy (cue heuristic saves quota), asks Gemini for durable facts as
     JSON, dedupes against existing memories, and persists new ones.
   Guards: never persist secret-looking values, cap 200/user, max 3 facts/turn.
*/
const { callGemini } = require('../gemini');

const MAX_MEMORIES = 200;
const STOP = new Set(('the,a,an,and,or,but,for,with,from,that,this,these,those,you,your,they,them,their,there,here,what,when,where,which,who,how,why,not,are,was,were,have,has,can,will,just,like,know,think,please,thanks,thank,hello,hi,hey,okay'.split(',')));

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-zåäö0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
}

function rankMemories(all, prompt, limit = 8) {
  const pw = new Set(words(prompt));
  const now = Date.now();
  return (all || [])
    .map((m) => {
      const mw = words(m.text);
      const overlap = mw.filter((w) => pw.has(w)).length;
      const ageDays = Math.max(0, (now - (m.at || now)) / 864e5);
      const score = overlap * 10 - Math.min(ageDays * 0.1, 3) + Math.min(String(m.text).length / 200, 1);
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

function looksFactWorthy(text) {
  return /(i (am|like|love|hate|prefer|work|live|study)|my |call me|remember|always|never|don't|don't like|birthday|dog|cat|wife|husband|kid|son|daughter|project|company|team|deadline|allergic|vegetarian|vegan|language|swedish|english)/i.test(String(text || ''));
}

function looksSecret(text) {
  return /(ghp_|github_pat_|sk-|bearer |password\s*[:=]|api[_-]?key\s*[:=][A-Za-z0-9_\-]{8,}|AQ\.[A-Za-z0-9_\-]+|sb_secret)/i.test(String(text || ''));
}

function sameFact(a, b) {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return false;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size) > 0.6;
}

async function maybeExtract({ userId, prompt, answer, existing }) {
  if (!looksFactWorthy(prompt) && !looksFactWorthy(answer)) return { saved: [], usage: null };
  if ((existing || []).length >= MAX_MEMORIES) return { saved: [], usage: null };
  let facts = [];
  let usage = null;
  try {
    const r = await callGemini({
      system: 'Extract durable user facts (preferences, identity, projects, relationships, standing instructions). Reply ONLY as JSON: {"facts":["..."]}. Max 3, each under 140 chars, first-person-neutral ("User prefers concise answers"). Omit transient chit-chat, secrets, credentials, one-off questions. Empty list if nothing durable.',
      prompt: `User: ${String(prompt).slice(0, 1500)}\nAssistant: ${String(answer).slice(0, 1500)}\n\nAlready known: ${(existing || []).slice(0, 20).map((m) => m.text).join(' | ').slice(0, 2000)}`,
      json: true,
    });
    usage = r.usage;
    const parsed = JSON.parse(r.text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());
    facts = (parsed.facts || []).filter((f) => typeof f === 'string').slice(0, 3);
  } catch {
    return { saved: [], usage };
  }
  const store = require('../store');
  const saved = [];
  for (const f of facts) {
    const t = f.trim().slice(0, 200);
    if (!t || looksSecret(t)) continue;
    if ((existing || []).concat(saved).some((m) => sameFact(typeof m === 'string' ? m : m.text, t))) continue;
    try {
      const m = await store.addMemory(userId, t, 'auto');
      saved.push({ id: m.id, text: m.text });
    } catch {}
  }
  return { saved, usage };
}

module.exports = { rankMemories, maybeExtract, looksFactWorthy, MAX_MEMORIES };
