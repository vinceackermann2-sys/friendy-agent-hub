/* Microsoft Foundry provider (server-side only).
   - Agent turns use the project-scoped OpenAI-compatible Responses API.
   - Audio and image operations use the resource-scoped OpenAI v1 API.
   - The API key never leaves the server. */
const MODEL_DEFAULT = process.env.AZURE_FOUNDRY_MODEL || 'gpt-6-luna';
const MODEL_FALLBACK = process.env.AZURE_FOUNDRY_FALLBACK_MODEL || MODEL_DEFAULT;
const REASONING_EFFORT = process.env.AZURE_FOUNDRY_REASONING_EFFORT || 'xhigh';
const TRANSCRIPTION_MODEL = process.env.AZURE_FOUNDRY_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const IMAGE_MODEL = process.env.AZURE_FOUNDRY_IMAGE_MODEL || 'gpt-image-2';

const AZURE_HOST = /\.(?:services\.ai\.azure\.com|openai\.azure\.com|ai\.azure\.com)$/i;
const AUDIO_MIME = /^(audio\/(webm|wav|wave|mp3|mpeg|mp4|ogg|flac|aac|x-m4a|m4a|x-wav)|video\/webm)$/i;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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

function timeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    },
  };
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
  return error;
}

async function errorFromResponse(response) {
  const raw = await response.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  return foundryError(data, response.status);
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

function inputItems(prompt, history, attachments) {
  const input = [];
  for (const item of Array.isArray(history) ? history.slice(-20) : []) {
    if (!item?.text) continue;
    input.push({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: String(item.text).slice(0, 4000),
    });
  }
  const content = [{ type: 'input_text', text: String(prompt || '').slice(0, 12000) }];
  for (const item of Array.isArray(attachments) ? attachments.slice(0, 4) : []) {
    const mime = String(item?.inlineData?.mimeType || '').toLowerCase();
    const data = String(item?.inlineData?.data || '');
    if (/^image\/(?:png|jpe?g|webp|gif)$/i.test(mime) && data) {
      content.push({ type: 'input_image', image_url: `data:${mime};base64,${data}`, detail: 'auto' });
    }
  }
  input.push({ role: 'user', content });
  return input;
}

function responseBody({ prompt, system, history, model, json, tools, attachments, stream }) {
  const declarations = (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.name && tool?.parameters)
    .map((tool) => ({
      type: 'function',
      name: String(tool.name).slice(0, 64),
      description: String(tool.description || '').slice(0, 1000),
      parameters: tool.parameters,
      strict: false,
    }));
  const body = {
    model: model || MODEL_DEFAULT,
    input: inputItems(prompt, history, attachments),
    reasoning: { effort: REASONING_EFFORT },
    store: false,
    stream: !!stream,
  };
  if (system) body.instructions = String(system).slice(0, 12000);
  if (json) body.text = { format: { type: 'json_object' } };
  if (declarations.length) {
    body.tools = declarations;
    body.tool_choice = 'auto';
  }
  return body;
}

function functionCall(item) {
  let args = {};
  try { args = item?.arguments ? JSON.parse(item.arguments) : {}; }
  catch { args = { _raw: String(item?.arguments || '').slice(0, 8000) }; }
  return { name: String(item?.name || ''), args, callId: item?.call_id || item?.id || null };
}

function extractResponse(data, modelName, { allowEmptyText = false } = {}) {
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
  return {
    text,
    functionCalls,
    usage: normalizeUsage(data?.usage),
    model: data?.model || modelName,
    raw: data,
  };
}

async function postResponse(body, signal) {
  const config = requireConfig();
  const timed = timeoutSignal(signal, 180000);
  try {
    const response = await fetch(`${config.project}/openai/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
      body: JSON.stringify(body),
      signal: timed.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    return response.json().catch(() => ({}));
  } finally {
    timed.cleanup();
  }
}

async function attemptResponse(options, modelName) {
  const data = await postResponse(responseBody({ ...options, model: modelName, stream: false }), options.signal);
  return extractResponse(data, modelName, { allowEmptyText: !!options.allowEmptyText });
}

async function attemptResponseStream(options, modelName) {
  const config = requireConfig();
  const timed = timeoutSignal(options.signal, 180000);
  let response;
  try {
    response = await fetch(`${config.project}/openai/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey, Accept: 'text/event-stream' },
      body: JSON.stringify(responseBody({ ...options, model: modelName, stream: true })),
      signal: timed.signal,
    });
    if (!response.ok || !response.body) throw await errorFromResponse(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const doneItems = [];
    let buffer = '';
    let streamedText = '';
    let completed = null;
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
      } else if (event.type === 'response.completed' && event.response) {
        completed = event.response;
      } else if (event.type === 'response.failed') {
        throw foundryError(event.response || event, 502);
      }
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.value) {
          buffer += decoder.decode(next.value, { stream: !next.done }).replace(/\r\n/g, '\n');
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            consume(buffer.slice(0, split));
            buffer = buffer.slice(split + 2);
          }
        }
        if (next.done) break;
      }
      if (buffer.trim()) consume(buffer);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    const data = completed || { output: doneItems, usage: null, model: modelName };
    const out = extractResponse(data, modelName, { allowEmptyText: !!options.allowEmptyText });
    if (!streamedText && out.text) {
      try { options.onDelta?.(out.text, out.text); } catch {}
    }
    return out;
  } finally {
    timed.cleanup();
  }
}

async function runWithFallback(options, { tools = false } = {}) {
  requireConfig();
  const first = options.model || MODEL_DEFAULT;
  const run = typeof options.onDelta === 'function' ? attemptResponseStream : attemptResponse;
  try {
    return await run({ ...options, allowEmptyText: tools }, first);
  } catch (error) {
    const pinned = options.model && options.model !== MODEL_DEFAULT;
    if (error.quota && !pinned && MODEL_FALLBACK && MODEL_FALLBACK !== first) {
      return run({ ...options, allowEmptyText: tools }, MODEL_FALLBACK);
    }
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
    return { text: String(data?.text || '').trim(), model: deployment };
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
    return {
      ok: true,
      name: `generated-${Date.now()}.png`,
      mimeType: 'image/png',
      size: bytes,
      prompt: text.slice(0, 1000),
      model: model || IMAGE_MODEL,
      dataUrl: `data:image/png;base64,${base64}`,
    };
  } finally {
    timed.cleanup();
  }
}

export {
  callFoundry, streamFoundry, callFoundryWithTools,
  transcribeAudio, generateImage, prepareAudio,
  isConfigured, projectEndpoint, openAIBaseUrl,
  MODEL_DEFAULT, MODEL_FALLBACK, REASONING_EFFORT,
  TRANSCRIPTION_MODEL, IMAGE_MODEL,
};
