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

function geminiHttpError(data, status) {
  const msg = data?.error?.message || `Gemini HTTP ${status}`;
  const e = new Error(msg);
  e.code = 'GEMINI_HTTP';
  e.status = status;
  e.quota = status === 429 || /quota/i.test(msg);
  return e;
}

function takeFunctionCalls(parts, into) {
  for (const p of parts) {
    if (p.functionCall && p.functionCall.name) {
      into.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
    }
  }
}

async function readGeminiSse(response, { onDelta, allowEmptyText = false } = {}) {
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw geminiHttpError(data, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = null;
  const functionCalls = [];
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
        takeFunctionCalls(parts, functionCalls);
        const delta = parts.map((p) => p.text || '').join('');
        if (delta) {
          full += delta;
          try { onDelta && onDelta(delta, full); } catch {}
        }
      } catch {}
    }
  };
  try {
    let done = false;
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
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (!full.trim() && !(allowEmptyText && functionCalls.length)) {
    throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
  }
  return { text: full.trim(), functionCalls, usage };
}

async function callGeminiWithTools({ prompt, system, history, model, tools, signal, onDelta }) {
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
      if (!r.ok) throw geminiHttpError(data, r.status);
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      const functionCalls = [];
      takeFunctionCalls(parts, functionCalls);
      if (!text && !functionCalls.length) throw Object.assign(new Error('Empty response from Gemini'), { code: 'EMPTY' });
      return { text, functionCalls, usage: data?.usageMetadata || null, model: modelName, raw: data };
    };
    const attemptStream = async (modelName) => {
      const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`;
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const out = await readGeminiSse(r, { onDelta, allowEmptyText: true });
      return { text: out.text, functionCalls: out.functionCalls, usage: out.usage, model: modelName };
    };
    const run = typeof onDelta === 'function' ? attemptStream : attemptOnce;
    try {
      return await run(m);
    } catch (e) {
      const pinned = model && model !== MODEL_DEFAULT;
      if (e.quota && !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== m) return run(MODEL_FALLBACK);
      throw e;
    }
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', abort);
  }
}

const AUDIO_MIME = /^(audio\/(webm|wav|wave|mp3|mpeg|mp4|ogg|flac|aac|x-m4a|m4a|x-wav)|video\/webm)$/i;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function prepareAudio({ audio, mime }) {
  const raw = String(audio || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw) {
    const e = new Error('Recording was empty.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const bytes = Math.floor(raw.length * 3 / 4);
  if (bytes < 200) {
    const e = new Error('Recording was empty.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (bytes > MAX_AUDIO_BYTES) {
    const e = new Error('Recording is too long. Keep it under a minute.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const mimeType = String(mime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!AUDIO_MIME.test(mimeType)) {
    const e = new Error('Unsupported audio format.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return { data: raw, mimeType: mimeType === 'video/webm' ? 'audio/webm' : mimeType };
}

async function transcribeAudio({ audio, mime, signal, model }) {
  const k = key();
  if (!k) {
    const e = new Error('Voice input is temporarily unavailable.');
    e.code = 'NO_KEY';
    throw e;
  }
  const prepared = prepareAudio({ audio, mime });
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: prepared.mimeType, data: prepared.data } },
        { text: 'Transcribe this recording verbatim. Return only the spoken words, with normal punctuation. If there is no speech, return an empty string.' },
      ],
    }],
    generationConfig: { temperature: 0 },
  };
  const attempt = async (modelName) => {
    const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(k)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
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
      if (!r.ok) throw geminiHttpError(data, r.status);
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      return { text, model: modelName };
    } finally {
      clearTimeout(t);
      signal?.removeEventListener('abort', abort);
    }
  };
  const m = model || MODEL_DEFAULT;
  try {
    return await attempt(m);
  } catch (e) {
    if (e.quota && MODEL_FALLBACK && MODEL_FALLBACK !== m) return attempt(MODEL_FALLBACK);
    throw e;
  }
}

export { callGemini, streamGemini, callGeminiWithTools, transcribeAudio, prepareAudio, isConfigured, MODEL_DEFAULT, MODEL_FALLBACK };
