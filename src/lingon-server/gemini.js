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

async function callGemini({ prompt, system, history, model, json, signal, onDelta }) {
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
    const abort = () => ctrl.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
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
      signal?.removeEventListener('abort', abort);
    }
  }

  async function attemptStream(modelName, onDeltaFn) {
    const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const abort = () => ctrl.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        const data = await r.json().catch(() => ({}));
        const msg = data?.error?.message || `Gemini HTTP ${r.status}`;
        const e = new Error(msg);
        e.code = 'GEMINI_HTTP';
        e.status = r.status;
        e.quota = r.status === 429 || /quota/i.test(msg);
        throw e;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      let usage = null;
      let done = false;
      const emitChunk = (raw) => {
        for (const line of String(raw).split('\n')) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            if (data.usageMetadata) usage = data.usageMetadata;
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const delta = parts.map((p) => p.text || '').join('');
            if (delta) {
              full += delta;
              try { onDeltaFn && onDeltaFn(delta, full); } catch {}
            }
          } catch {}
        }
      };
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buf += decoder.decode(value, { stream: !readerDone });
          const idx = buf.lastIndexOf('\n\n');
          if (idx >= 0) {
            emitChunk(buf.slice(0, idx + 2));
            buf = buf.slice(idx + 2);
          }
        }
      }
      if (buf.trim()) emitChunk(buf);
      if (!full.trim()) throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
      try { reader.releaseLock(); } catch {}
      return { text: full.trim(), usage, model: modelName };
    } finally {
      clearTimeout(t);
      signal?.removeEventListener('abort', abort);
    }
  }

  const first = model || m;
  try {
    if (typeof onDelta === 'function') {
      try {
        return await attemptStream(first, onDelta);
      } catch (e) {
        const pinned = model && model !== MODEL_DEFAULT;
        if (e.quota && !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== first) {
          return attemptStream(MODEL_FALLBACK, onDelta);
        }
        throw e;
      }
    }
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

async function streamGemini(args) {
  return callGemini({ ...args, onDelta: args.onDelta });
}

async function callGeminiWithTools({ prompt, system, history, model, tools, signal }) {
  const k = key();
  if (!k) {
    const e = new Error('GEMINI_API_KEY is not configured on the server (.env).');
    e.code = 'NO_KEY';
    throw e;
  }
  const declarations = (Array.isArray(tools) ? tools : [])
    .filter((t) => t && t.name && t.parameters)
    .map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 1000), parameters: t.parameters }));
  const m = model || MODEL_DEFAULT;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(k)}`;
  const contents = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      if (!h || !h.text) continue;
      contents.push({ role: h.role === 'agent' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 4000) }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: String(prompt).slice(0, 12000) }] });
  const body = { contents };
  if (system) body.system_instruction = { parts: [{ text: String(system).slice(0, 12000) }] };
  if (declarations.length) {
    body.tools = [{ functionDeclarations: declarations }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  const abort = () => ctrl.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    const attemptOnce = async (modelName) => {
      const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(k)}`;
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
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
      const functionCalls = parts.filter((p) => p.functionCall && p.functionCall.name).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      if (!text && !functionCalls.length) throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
      return { text, functionCalls, usage: data?.usageMetadata || null, model: modelName, raw: data };
    };
    try {
      return await attemptOnce(m);
    } catch (e) {
      const pinned = model && model !== MODEL_DEFAULT;
      if (e.quota && !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== m) return attemptOnce(MODEL_FALLBACK);
      throw e;
    }
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', abort);
  }
}

export { callGemini, streamGemini, callGeminiWithTools, isConfigured, MODEL_DEFAULT, MODEL_FALLBACK };
