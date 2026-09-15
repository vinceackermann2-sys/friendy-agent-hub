/* Lingon backend — Gemini wrapper (server-side only).
   The API key never leaves the server. Frontend calls /api/* only. */
const MODEL_DEFAULT = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
    for (const h of history.slice(-12)) {
      if (!h || !h.text) continue;
      contents.push({
        role: h.role === 'agent' ? 'model' : 'user',
        parts: [{ text: String(h.text).slice(0, 4000) }],
      });
    }
  }
  const fullPrompt = (system ? system + '\n\n' : '') + prompt;
  contents.push({ role: 'user', parts: [{ text: fullPrompt.slice(0, 12000) }] });

  const body = { contents };
  if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(url, {
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
      throw e;
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
    return { text, raw: data };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { callGemini, isConfigured, MODEL_DEFAULT };
