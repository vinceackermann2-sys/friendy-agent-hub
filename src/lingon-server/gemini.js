/* Lingon backend — Gemini wrapper (server-side only).
   The API key never leaves the server. Frontend calls /api/* only.
   Quota failover: if the primary model returns 429/quota errors, we retry
   once on GEMINI_FALLBACK_MODEL and report which model answered. */
const MODEL_DEFAULT = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const MODEL_FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';

function key() {
  return (process.env.GEMINI_API_KEY || '').trim();
}
function isConfigured() {
  return key().length > 10;
}

async function callGemini({ prompt, system, history, model, json }) {
  const k = key();
  if (!k) {
    const e = new Error('GEMINI_API_KEY is not configured on the server (.env).');
    e.code = 'NO_KEY';
    throw e;
  }
  const m = model || MODEL_DEFAULT;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(k)}`;
  const contents = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      if (!h || !h.text) continue;
      contents.push({
        role: h.role === 'agent' ? 'model' : 'user',
        parts: [{ text: String(h.text).slice(0, 4000) }],
      });
    }
  }
  contents.push({ role: 'user', parts: [{ text: String(prompt).slice(0, 12000) }] });

  const body = { contents };
  if (system) {
    body.system_instruction = { parts: [{ text: String(system).slice(0, 12000) }] };
  }
  if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  async function attempt(modelName) {
    const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(k)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data?.error?.message || `Gemini HTTP ${r.status}`;
        const e = new Error(msg);
        e.code = 'GEMINI_HTTP';
        e.status = r.status;
        e.quota = r.status === 429 || /quota/i.test(msg);
        throw e;
      }
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
      return { text, raw: data, usage: data?.usageMetadata || null, model: modelName };
    } finally {
      clearTimeout(t);
    }
  }

  const first = model || m;
  try {
    return await attempt(first);
  } catch (e) {
    // Failover on quota errors unless caller pinned a non-default model.
    const pinned = model && model !== MODEL_DEFAULT;
    if (e.quota && !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== first) {
      return attempt(MODEL_FALLBACK); // throws honestly if fallback also fails
    }
    throw e;
  }
}

export { callGemini, isConfigured, MODEL_DEFAULT, MODEL_FALLBACK };
