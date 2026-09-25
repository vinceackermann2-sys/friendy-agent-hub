/* Microsoft Foundry provider (server-side only).
   - Agent turns use the resource-scoped OpenAI-compatible Responses API.
   - Audio and image operations use the resource-scoped OpenAI v1 API.
   - The API key never leaves the server. */
const MODEL_DEFAULT = process.env.AZURE_FOUNDRY_MODEL || 'gpt-6-luna';
const MODEL_FALLBACK = process.env.AZURE_FOUNDRY_FALLBACK_MODEL || MODEL_DEFAULT;
const REASONING_EFFORT = process.env.AZURE_FOUNDRY_REASONING_EFFORT || 'xhigh';
// Interactive chat turns and memory extraction are latency- and cost-sensitive;
// substantial work is delegated to tasks, which keep REASONING_EFFORT.
const CHAT_REASONING_EFFORT = process.env.AZURE_FOUNDRY_CHAT_REASONING_EFFORT || 'low';
const TRANSCRIPTION_MODEL = process.env.AZURE_FOUNDRY_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const IMAGE_MODEL = process.env.AZURE_FOUNDRY_IMAGE_MODEL || 'gpt-image-2';

const AZURE_HOST = /\.(?:services\.ai\.azure\.com|openai\.azure\.com|ai\.azure\.com)$/i;
const AUDIO_MIME = /^(audio\/(webm|wav|wave|mp3|mpeg|mp4|ogg|flac|aac|x-m4a|m4a|x-wav)|video\/webm)$/i;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Every turn streams. The timer resets whenever the stream delivers bytes, so a
// long answer is bounded by inactivity; STREAM_MAX_MS still caps the whole turn.
// High reasoning can think silently for minutes before its first byte.
const RESPONSE_TIMEOUT_MS = positiveInt(process.env.AZURE_FOUNDRY_TIMEOUT_MS, 180000);
const DEEP_TIMEOUT_MS = Math.max(RESPONSE_TIMEOUT_MS, positiveInt(process.env.AZURE_FOUNDRY_DEEP_TIMEOUT_MS, 600000));
const STREAM_MAX_MS = Math.max(DEEP_TIMEOUT_MS, positiveInt(process.env.AZURE_FOUNDRY_STREAM_MAX_MS, 1200000));
const MAX_RETRIES = 1;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Usage estimates must never bill base64 bytes as text tokens.
const IMAGE_TOKEN_ESTIMATE = 1500;
// Explicit prompt-cache breakpoints need GPT-5.6 or later. An older deployment
// rejects them with a 400, after which this process stops sending them.
const promptCache = { enabled: String(process.env.AZURE_FOUNDRY_PROMPT_CACHE || 'true').toLowerCase() !== 'false' };

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function key() {
  return String(process.env.AZURE_FOUNDRY_API_KEY || '').trim();
}

function endpoint(value, { project = false } = {}) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || !AZURE_HOST.test(url.hostname) || url.username || url.password) return '';
    const path = url.pathname.replace(/\/+$/, '');
    if (project && !/^\/api\/projects\/[^/]+$/i.test(path)) return '';
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

function projectEndpoint() {
  return endpoint(process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT, { project: true });
}

function openAIBaseUrl() {
  const configured = endpoint(process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT);
  if (configured) return /\/openai\/v1$/i.test(configured) ? configured : `${configured}/openai/v1`;
  const project = projectEndpoint();
  if (!project) return '';
  return `${new URL(project).origin}/openai/v1`;
}

function deploymentUrl(config, deployment, operation) {
  const origin = new URL(config.openai).origin;
  return `${origin}/openai/deployments/${encodeURIComponent(deployment)}/${operation}?api-version=2025-04-01-preview`;
}

function isConfigured() {
  return key().length > 20 && !!projectEndpoint();
}

function requireConfig() {
  const apiKey = key();
  const project = projectEndpoint();
  const openai = openAIBaseUrl();
  if (!apiKey || !project || !openai) {
    const error = new Error('Microsoft Foundry is not configured on the server.');
    error.code = 'NO_KEY';
    throw error;
  }
  return { apiKey, project, openai };
}

function timeoutSignal(signal, timeoutMs, maxMs = timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const deadline = Date.now() + maxMs;
  let timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    // Restart the inactivity timer without extending past the overall deadline.
    touch() {
      clearTimeout(timer);
      timer = setTimeout(abort, Math.max(0, Math.min(timeoutMs, deadline - Date.now())));
    },
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    },
  };
}

function transient(error, signal) {
  if (signal?.aborted || error?.streamed || error?.name === 'AbortError') return false;
  if (error?.code === 'FOUNDRY_HTTP') return RETRYABLE_STATUS.has(error.status);
  return error?.name === 'TypeError'; // fetch network failure before a response
}

function retryDelay(error, attempt) {
  if (Number.isFinite(error?.retryAfterMs)) return Math.min(8000, Math.max(0, error.retryAfterMs));
  return Math.min(8000, 400 * 2 ** attempt + Math.floor(Math.random() * 250));
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener?.('abort', stop); resolve(); };
    const timer = setTimeout(done, ms);
    function stop() {
      clearTimeout(timer);
      reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
    }
    if (signal?.aborted) stop();
    else signal?.addEventListener?.('abort', stop, { once: true });
  });
}

async function withRetry(run, signal, skip = () => false) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= MAX_RETRIES || skip(error) || !transient(error, signal)) throw error;
      await pause(retryDelay(error, attempt), signal);
    }
  }
}

function foundryError(data, status) {
  const message = data?.error?.message || data?.message || `Microsoft Foundry HTTP ${status}`;
  const deploymentHint = status === 404 && /deployment.*does not exist/i.test(String(message))
    ? ' Deploy that model in the Foundry resource, then set the matching AZURE_FOUNDRY_*_MODEL variable to its deployment name.'
    : '';
  const error = new Error(`${String(message).slice(0, 850)}${deploymentHint}`);
  error.code = 'FOUNDRY_HTTP';
  error.status = status;
  error.quota = status === 429 || /quota|rate limit/i.test(message);
  // The deployment itself cannot serve this request: another deployment may.
  error.unavailable = status >= 500 || (status === 404 && /deployment/i.test(message)) || (status === 400 && /not supported with this model/i.test(message));
  return error;
}

async function errorFromResponse(response) {
  const raw = await response.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  const error = foundryError(data, response.status);
  const retryMs = Number(response.headers?.get?.('retry-after-ms'));
  const retrySeconds = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryMs) && retryMs >= 0) error.retryAfterMs = retryMs;
  else if (Number.isFinite(retrySeconds) && retrySeconds >= 0) error.retryAfterMs = retrySeconds * 1000;
  return error;
}

function estimateInputTokens(body) {
  let images = 0;
  const text = JSON.stringify([body?.instructions || '', body?.input || [], body?.tools || []], (field, value) => {
    if (field === 'image_url' && typeof value === 'string' && value.startsWith('data:')) { images++; return ''; }
    return value;
  });
  return Math.max(1, Math.ceil(text.length / 3) + images * IMAGE_TOKEN_ESTIMATE);
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? input + output) || input + output;
  return {
    promptTokenCount: input,
    candidatesTokenCount: output,
    totalTokenCount: total,
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    input_tokens_details: usage.input_tokens_details || null,
    output_tokens_details: usage.output_tokens_details || null,
  };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

// Trim a growing list to its recent tail at a content-defined boundary. Unlike
// slice(-n), the start stays put while items are appended, so the cached
// prompt prefix survives several turns before the window moves.
function stableTail(list, min, max) {
  const items = Array.isArray(list) ? list : [];
  if (items.length <= max) return items.slice();
  for (let start = items.length - max; start < items.length - min; start++) {
    if (fnv1a(JSON.stringify(items[start] ?? null).slice(0, 400)) % 3 === 0) return items.slice(start);
  }
  return items.slice(-min);
}

const breakpoint = () => ({ mode: 'explicit' });

// Prompt layout for caching: tools, then the system message, then append-only
// history, then this turn's volatile content. The cache is only read at
// breakpoints present in the current request, so the system message and every
// saved user message keep one; the service writes just the newest four and
// reads up to fifty. The volatile tail gets none: writes cost more than input.
function inputItems(prompt, history, attachments, system = '', cache = false) {
  const input = [];
  if (cache && system) {
    input.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: system, prompt_cache_breakpoint: breakpoint() }] });
  }
  for (const item of stableTail(history, 14, 20)) {
    if (!item?.text) continue;
    const text = String(item.text).slice(0, 4000);
    if (item.role === 'agent') input.push({ type: 'message', role: 'assistant', content: text });
    // Breakpoints are only accepted on input_text blocks, i.e. user content.
    else if (cache) input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text, prompt_cache_breakpoint: breakpoint() }] });
    else input.push({ type: 'message', role: 'user', content: text });
  }
  // Room for the message plus per-turn memory, task state and supplied context.
  const content = [{ type: 'input_text', text: String(prompt || '').slice(0, 18000) }];
  for (const item of Array.isArray(attachments) ? attachments.slice(0, 4) : []) {
    const mime = String(item?.inlineData?.mimeType || '').toLowerCase();
    const data = String(item?.inlineData?.data || '');
    if (/^image\/(?:png|jpe?g|webp|gif)$/i.test(mime) && data) {
      content.push({ type: 'input_image', image_url: `data:${mime};base64,${data}`, detail: 'auto' });
    }
  }
  input.push({ type: 'message', role: 'user', content });
  return input;
}

function responseBody({ prompt, system, history, model, json, tools, attachments, stream, reasoningEffort, toolChoice, cacheKey, maxOutputTokens }) {
  const declarations = (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.name && tool?.parameters)
    .map((tool) => ({
      type: 'function',
      name: String(tool.name).slice(0, 64),
      description: String(tool.description || '').slice(0, 1000),
      parameters: tool.parameters,
      strict: false,
    }));
  // Builders budget their own prompts (e.g. buildSystem caps at 11,800); this
  // limit only stops runaway input and must stay clear of the task rules they append.
  const instructions = system ? String(system).slice(0, 24000) : '';
  const body = {
    model: model || MODEL_DEFAULT,
    input: inputItems(prompt, history, attachments, instructions, promptCache.enabled),
    reasoning: { effort: reasoningEffort || REASONING_EFFORT },
    // Callers that only need a short reply cap output so a runaway generation stays cheap and quick.
    max_output_tokens: Math.min(32768, Math.max(256, Number(maxOutputTokens) || 32768)),
    store: false,
    stream: !!stream,
  };
  if (promptCache.enabled) {
    body.prompt_cache_options = { mode: 'explicit' };
    // Routes one account's requests to the same cache; content still has to match.
    if (cacheKey) body.prompt_cache_key = `lingon:${fnv1a(String(cacheKey)).toString(36)}`;
  } else if (instructions) {
    body.instructions = instructions;
  }
  if (json) body.text = { format: { type: 'json_object' } };
  if (declarations.length) {
    body.tools = declarations;
    // 'none' keeps the tool list (and so the cached prefix) while forbidding calls.
    body.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
  }
  return body;
}

function functionCall(item) {
  let args = {};
  try { args = item?.arguments ? JSON.parse(item.arguments) : {}; }
  catch { args = { _raw: String(item?.arguments || '').slice(0, 8000) }; }
  return { name: String(item?.name || ''), args, callId: item?.call_id || item?.id || null };
}

function extractResponse(data, modelName, { allowEmptyText = false, body = null } = {}) {
  let text = '';
  const functionCalls = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type === 'message') {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === 'output_text' && part.text) text += part.text;
      }
    } else if (item?.type === 'function_call' && item.name) {
      functionCalls.push(functionCall(item));
    }
  }
  text = text.trim();
  if (!text && !(allowEmptyText && functionCalls.length)) {
    const detail = data?.incomplete_details?.reason || data?.error?.message || 'Empty response from Microsoft Foundry';
    throw Object.assign(new Error(detail), { code: 'EMPTY' });
  }
  const reported = data?.usage && Number(data.usage.total_tokens
    ?? (Number(data.usage.input_tokens || 0) + Number(data.usage.output_tokens || 0))) > 0;
  const estimatedInput = estimateInputTokens(body);
  const estimatedOutput = Math.max(1, Math.ceil((text.length + JSON.stringify(functionCalls).length) / 3));
  const usage = reported ? normalizeUsage(data.usage) : {
    promptTokenCount: estimatedInput, candidatesTokenCount: estimatedOutput,
    totalTokenCount: estimatedInput + estimatedOutput,
    input_tokens: estimatedInput, output_tokens: estimatedOutput,
    total_tokens: estimatedInput + estimatedOutput, estimated: true,
  };
  return {
    text,
    functionCalls,
    usage: { ...usage, model: data?.model || modelName },
    model: data?.model || modelName,
    raw: data,
  };
}

function estimatedUsage(body, outputText, modelName) {
  const input = estimateInputTokens(body);
  const output = Math.ceil(String(outputText || '').length / 3);
  return { promptTokenCount: input, candidatesTokenCount: output, totalTokenCount: input + output,
    input_tokens: input, output_tokens: output, total_tokens: input + output, estimated: true, model: modelName };
}

function addUsage(a, b) {
  if (!a) return b;
  if (!b) return a;
  const sum = (field) => (Number(a[field]) || 0) + (Number(b[field]) || 0);
  const cached = (Number(a.input_tokens_details?.cached_tokens) || 0) + (Number(b.input_tokens_details?.cached_tokens) || 0);
  return { ...b,
    promptTokenCount: sum('promptTokenCount'), candidatesTokenCount: sum('candidatesTokenCount'), totalTokenCount: sum('totalTokenCount'),
    input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), total_tokens: sum('total_tokens'),
    input_tokens_details: { ...(b.input_tokens_details || {}), cached_tokens: cached },
    estimated: !!(a.estimated || b.estimated) || undefined };
}

async function attemptResponse(options, modelName) {
  const config = requireConfig();
  const effort = options.reasoningEffort || REASONING_EFFORT;
  const timed = timeoutSignal(options.signal, ['high', 'xhigh'].includes(effort) ? DEEP_TIMEOUT_MS : RESPONSE_TIMEOUT_MS, STREAM_MAX_MS);
  const body = responseBody({ ...options, model: modelName, stream: true });
  let accepted = false;
  let completed = null;
  let streamedText = '';
  try {
    const response = await fetch(`${config.openai}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey, Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: timed.signal,
    });
    if (!response.ok || !response.body) throw await errorFromResponse(response);
    accepted = true;
    // A proxy that ignores stream=true returns the whole response as JSON.
    if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
      completed = await response.json().catch(() => ({}));
      const out = extractResponse(completed, modelName, { allowEmptyText: !!options.allowEmptyText, body });
      if (out.text) try { options.onDelta?.(out.text, out.text); } catch {}
      return out;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const doneItems = [];
    let buffer = '';
    // A function call whose arguments outgrow maxArgumentChars is looping; the stream
    // stops there and the call is returned with its partial arguments.
    const argumentLimit = Number(options.maxArgumentChars) || 0;
    const callArguments = new Map();
    let runawayCall = null;
    // A response that starts more function calls than the caller will run is flooding
    // (hundreds of parallel searches); it stops there and keeps the calls finished so far.
    const callLimit = Number(options.maxFunctionCalls) || 0;
    let callsStarted = 0, tooManyCalls = false;
    const stopped = () => runawayCall || tooManyCalls;
    const consume = (frame) => {
      const payload = String(frame).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!payload || payload === '[DONE]') return;
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (event.type === 'response.output_text.delta' && event.delta) {
        streamedText += event.delta;
        try { options.onDelta?.(event.delta, streamedText); } catch {}
      } else if (event.type === 'response.output_item.done' && event.item) {
        doneItems.push(event.item);
      } else if ((argumentLimit || callLimit) && event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        callsStarted++;
        if (callLimit && callsStarted > callLimit) { tooManyCalls = true; return; }
        if (argumentLimit) callArguments.set(event.item.id, { type: 'function_call', name: event.item.name, call_id: event.item.call_id, arguments: '' });
      } else if (argumentLimit && event.type === 'response.function_call_arguments.delta') {
        const call = callArguments.get(event.item_id);
        if (call) { call.arguments += event.delta || ''; if (call.arguments.length > argumentLimit) runawayCall = call; }
      } else if ((event.type === 'response.completed' || event.type === 'response.incomplete') && event.response) {
        // An incomplete response still carries its output and billable usage.
        completed = event.response;
      } else if (event.type === 'response.failed') {
        if (event.response?.usage) completed = event.response;
        throw foundryError(event.response || event, 502);
      } else if (event.type === 'error') {
        throw foundryError(event, Number(event.status) || 502);
      }
    };
    try {
      while (true) {
        const next = await reader.read();
        timed.touch();
        if (next.value) {
          buffer += decoder.decode(next.value, { stream: !next.done }).replace(/\r\n/g, '\n');
          let split;
          while (!stopped() && (split = buffer.indexOf('\n\n')) >= 0) {
            consume(buffer.slice(0, split));
            buffer = buffer.slice(split + 2);
          }
        }
        if (stopped()) { try { await reader.cancel(); } catch {} break; }
        if (next.done) break;
      }
      if (!stopped() && buffer.trim()) consume(buffer);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    const data = completed || { output: runawayCall ? [...doneItems, runawayCall] : doneItems, usage: null, model: modelName };
    const out = extractResponse(data, modelName, { allowEmptyText: !!options.allowEmptyText, body });
    if (!streamedText && out.text) {
      try { options.onDelta?.(out.text, out.text); } catch {}
    }
    return out;
  } catch (error) {
    if (error && typeof error === 'object') {
      // Text already reached the client; a retry would duplicate it.
      if (streamedText) { error.streamed = true; error.partialText = streamedText; }
      // Once the service accepted the request it has done billable work, even if
      // the turn then failed, timed out or was cancelled.
      if (accepted) {
        const reported = completed?.usage && Number(completed.usage.total_tokens) > 0;
        error.usage = reported ? { ...normalizeUsage(completed.usage), model: completed.model || modelName }
          : estimatedUsage(body, streamedText, modelName);
      }
    }
    throw error;
  } finally {
    timed.cleanup();
  }
}

async function runWithFallback(options, { tools = false } = {}) {
  requireConfig();
  const first = options.model || MODEL_DEFAULT;
  const run = attemptResponse;
  const pinned = options.model && options.model !== MODEL_DEFAULT;
  const canFallBack = !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== first;
  // Transient failures retry once; a quota error moves straight to a distinct fallback.
  const once = async (model) => {
    try {
      return await run({ ...options, allowEmptyText: tools }, model);
    } catch (error) {
      if (!promptCache.enabled || error.status !== 400 || !/prompt_cache/i.test(error.message)) throw error;
      promptCache.enabled = false;
      console.warn('[foundry] deployment rejected prompt cache options; continuing without them');
      return run({ ...options, allowEmptyText: tools }, model);
    }
  };
  let spent = null;
  const attempt = (model, skip) => withRetry(async () => {
    try {
      return await once(model);
    } catch (error) {
      spent = addUsage(spent, error.usage);
      if (spent) error.usage = spent;
      throw error;
    }
  }, options.signal, skip);
  const finish = (out) => (spent ? { ...out, usage: addUsage(spent, out.usage) } : out);
  try {
    return finish(await attempt(first, (error) => canFallBack && error.quota));
  } catch (error) {
    if ((error.quota || error.unavailable) && !error.streamed && canFallBack) return finish(await attempt(MODEL_FALLBACK));
    throw error;
  }
}

async function callFoundry(options) {
  return runWithFallback(options || {});
}

async function streamFoundry(options) {
  return callFoundry(options || {});
}

async function callFoundryWithTools(options) {
  return runWithFallback(options || {}, { tools: true });
}

function prepareAudio({ audio, mime }) {
  const raw = String(audio || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw) throw Object.assign(new Error('Recording was empty.'), { code: 'BAD_INPUT' });
  const bytes = Math.floor(raw.length * 3 / 4);
  if (bytes < 200) throw Object.assign(new Error('Recording was empty.'), { code: 'BAD_INPUT' });
  if (bytes > MAX_AUDIO_BYTES) throw Object.assign(new Error('Recording is too long. Keep it under a minute.'), { code: 'BAD_INPUT' });
  const mimeType = String(mime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!AUDIO_MIME.test(mimeType)) throw Object.assign(new Error('Unsupported audio format.'), { code: 'BAD_INPUT' });
  return { data: raw, mimeType: mimeType === 'video/webm' ? 'audio/webm' : mimeType };
}

function audioFilename(mimeType) {
  const ext = { 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac' }[mimeType] || 'webm';
  return `recording.${ext}`;
}

async function transcribeAudio({ audio, mime, signal, model } = {}) {
  const config = requireConfig();
  const deployment = model || TRANSCRIPTION_MODEL;
  const prepared = prepareAudio({ audio, mime });
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(prepared.data, 'base64')], { type: prepared.mimeType }), audioFilename(prepared.mimeType));
  form.append('model', deployment);
  form.append('response_format', 'json');
  const timed = timeoutSignal(signal, 60000);
  try {
    const response = await fetch(deploymentUrl(config, deployment, 'audio/transcriptions'), {
      method: 'POST', headers: { 'api-key': config.apiKey }, body: form, signal: timed.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    const data = await response.json().catch(() => ({}));
    const seconds = Number(data?.duration ?? data?.usage?.seconds ?? 0);
    const rawUsage = data?.usage;
    const providerUsage = rawUsage && Number(rawUsage.total_tokens
      ?? (Number(rawUsage.input_tokens || 0) + Number(rawUsage.output_tokens || 0))) > 0
      ? normalizeUsage(rawUsage) : null;
    // Some Azure transcription responses report duration instead of tokens.
    // Keep that case explicit so the billing layer can identify an estimate.
    const estimatedInput = Math.max(1, Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 50) : 0,
      Math.ceil(prepared.data.length * 0.75 / 32));
    const estimatedOutput = Math.ceil(String(data?.text || '').length / 4);
    const usage = providerUsage || {
      promptTokenCount: estimatedInput, candidatesTokenCount: estimatedOutput,
      totalTokenCount: estimatedInput + estimatedOutput, input_tokens: estimatedInput,
      output_tokens: estimatedOutput, total_tokens: estimatedInput + estimatedOutput,
    };
    return { text: String(data?.text || '').trim(), model: deployment,
      usage, usageEstimated: !providerUsage,
      costUsd: providerUsage
        ? (usage.promptTokenCount * 2.5 + usage.candidatesTokenCount * 10) / 1e6
        : Math.max(0.02, Number.isFinite(seconds) ? seconds / 60 * 0.006 : 0) };
  } finally {
    timed.cleanup();
  }
}

async function generateImage({ prompt, size = '1024x1024', quality = 'high', background = 'auto', signal, model } = {}) {
  const config = requireConfig();
  const text = String(prompt || '').trim();
  if (!text || text.length > 32000) throw Object.assign(new Error('Image prompt must be between 1 and 32000 characters.'), { code: 'BAD_INPUT' });
  const sizes = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
  const qualities = new Set(['auto', 'low', 'medium', 'high']);
  const backgrounds = new Set(['auto', 'opaque', 'transparent']);
  if (!sizes.has(size) || !qualities.has(quality) || !backgrounds.has(background)) throw Object.assign(new Error('Unsupported image options.'), { code: 'BAD_INPUT' });
  const timed = timeoutSignal(signal, 240000);
  try {
    const response = await fetch(`${config.openai}/images/generations?api-version=preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
      body: JSON.stringify({ model: model || IMAGE_MODEL, prompt: text, size, quality, background, n: 1, output_format: 'png' }),
      signal: timed.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    const data = await response.json().catch(() => ({}));
    const base64 = String(data?.data?.[0]?.b64_json || data?.data?.[0]?.base64 || '');
    if (!base64) throw Object.assign(new Error('Image generation returned no image.'), { code: 'EMPTY' });
    const bytes = Math.floor(base64.length * 3 / 4);
    if (bytes > MAX_IMAGE_BYTES) throw Object.assign(new Error('Generated image exceeded the 20 MB limit.'), { code: 'TOO_LARGE' });
    const providerUsage = data?.usage && Number(data.usage.total_tokens
      ?? (Number(data.usage.input_tokens || 0) + Number(data.usage.output_tokens || 0))) > 0
      ? normalizeUsage(data.usage) : null;
    const fallbackOutput = quality === 'low' ? 500 : quality === 'medium' ? 4000 : 15000;
    const usage = providerUsage || {
      promptTokenCount: Math.ceil(text.length / 3), candidatesTokenCount: fallbackOutput,
      totalTokenCount: Math.ceil(text.length / 3) + fallbackOutput,
    };
    const cached = Number(data?.usage?.input_tokens_details?.cached_tokens || 0);
    const costUsd = providerUsage
      ? (Math.max(0, usage.promptTokenCount - cached) * 4 + cached + usage.candidatesTokenCount * 15) / 1e6
      : Math.max(0.25, (usage.promptTokenCount * 4 + usage.candidatesTokenCount * 15) / 1e6);
    return {
      ok: true,
      name: `generated-${Date.now()}.png`,
      mimeType: 'image/png',
      size: bytes,
      prompt: text.slice(0, 1000),
      model: model || IMAGE_MODEL,
      usage, usageEstimated: !providerUsage, costUsd,
      dataUrl: `data:image/png;base64,${base64}`,
    };
  } finally {
    timed.cleanup();
  }
}

export {
  callFoundry, streamFoundry, callFoundryWithTools,
  transcribeAudio, generateImage, prepareAudio,
  isConfigured, projectEndpoint, openAIBaseUrl, stableTail,
  MODEL_DEFAULT, MODEL_FALLBACK, REASONING_EFFORT, CHAT_REASONING_EFFORT,
  TRANSCRIPTION_MODEL, IMAGE_MODEL,
};
