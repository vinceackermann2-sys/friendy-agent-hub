const assert = require('node:assert/strict');

process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT = 'https://unit-resource.services.ai.azure.com/api/projects/unit-project';
process.env.AZURE_FOUNDRY_API_KEY = 'unit-test-key-that-is-long-enough';
delete process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT;
delete process.env.AZURE_FOUNDRY_MODEL;
delete process.env.AZURE_FOUNDRY_REASONING_EFFORT;
delete process.env.AZURE_FOUNDRY_CHAT_REASONING_EFFORT;

const provider = require('../server/foundry');
const calls = [];
const imageBytes = Buffer.from('fake-png');
// One-shot responses for retry and streaming cases, consumed before the defaults.
const queued = [];
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
  { status: 200, headers: { 'content-type': 'text/event-stream' } });

global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (queued.length) return queued.shift()();
  if (String(url).endsWith('/api/projects/unit-project/openai/v1/responses')) {
    const body = JSON.parse(options.body);
    if (body.tools?.length) {
      return new Response(JSON.stringify({
        model: body.model,
        output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"azure"}' }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      model: body.model,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Foundry answer' }] }],
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/audio/transcriptions')) {
    assert.ok(options.body instanceof FormData);
    return new Response(JSON.stringify({ text: 'spoken words' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/images/generations')) {
    return new Response(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

(async () => {
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.MODEL_DEFAULT, 'gpt-6-luna');
  assert.equal(provider.REASONING_EFFORT, 'xhigh');
  assert.equal(provider.openAIBaseUrl(), 'https://unit-resource.services.ai.azure.com/openai/v1');

  const answer = await provider.callFoundry({ prompt: 'Hello', system: 'Be concise.' });
  assert.equal(answer.text, 'Foundry answer');
  assert.equal(answer.usage.promptTokenCount, 12);
  const answerBody = JSON.parse(calls[0].options.body);
  assert.equal(answerBody.model, 'gpt-6-luna');
  assert.equal(answerBody.reasoning.effort, 'xhigh');
  assert.equal(answerBody.store, false);

  const planned = await provider.callFoundryWithTools({
    prompt: 'Search',
    tools: [{ name: 'web_search', description: 'Search.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }],
  });
  assert.deepEqual(planned.functionCalls[0], { name: 'web_search', args: { query: 'azure' }, callId: 'call_1' });

  // Interactive chat turns opt into a lighter effort; delegated tasks keep the default.
  assert.equal(provider.CHAT_REASONING_EFFORT, 'low');
  await provider.callFoundry({ prompt: 'Hi', reasoningEffort: provider.CHAT_REASONING_EFFORT });
  assert.equal(JSON.parse(calls.at(-1).options.body).reasoning.effort, 'low');

  // A transient 503 retries once, honoring retry-after-ms.
  let before = calls.length;
  queued.push(() => new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'retry-after-ms': '5' } }));
  assert.equal((await provider.callFoundry({ prompt: 'Retry me' })).text, 'Foundry answer');
  assert.equal(calls.length - before, 2);

  // Client errors are not retried.
  before = calls.length;
  queued.push(() => new Response('{"error":{"message":"bad request"}}', { status: 400 }));
  await assert.rejects(provider.callFoundry({ prompt: 'Bad' }), /bad request/);
  assert.equal(calls.length - before, 1);

  // A stream that fails after text reached the client is never replayed.
  before = calls.length;
  const seen = [];
  queued.push(() => sse([
    { type: 'response.output_text.delta', delta: 'Partial' },
    { type: 'error', status: 503, message: 'upstream reset' },
  ]));
  const cutOff = await provider.callFoundry({ prompt: 'Stream', onDelta: (d) => seen.push(d) }).catch((error) => error);
  assert.match(cutOff.message, /upstream reset/);
  assert.equal(calls.length - before, 1);
  assert.deepEqual(seen, ['Partial']);
  // The failed turn still carries its text and billable usage for the caller.
  assert.equal(cutOff.partialText, 'Partial');
  assert.equal(cutOff.usage.estimated, true);
  assert.ok(cutOff.usage.input_tokens > 0 && cutOff.usage.output_tokens > 0);

  // An accepted attempt that fails before any text is retried, and both attempts are billed.
  before = calls.length;
  queued.push(() => sse([{ type: 'error', status: 503, message: 'reset during reasoning' }]));
  const recovered = await provider.callFoundry({ prompt: 'Retry after accept' });
  assert.equal(recovered.text, 'Foundry answer');
  assert.equal(calls.length - before, 2);
  assert.ok(recovered.usage.total_tokens > 15, 'failed attempt added to the bill');
  assert.equal(recovered.usage.estimated, true);

  // A request the service rejected outright is not billed.
  queued.push(() => new Response('{"error":{"message":"bad"}}', { status: 400 }));
  assert.equal((await provider.callFoundry({ prompt: 'Rejected' }).catch((error) => error)).usage, undefined);

  // response.incomplete keeps provider usage instead of falling back to an estimate.
  queued.push(() => sse([
    { type: 'response.output_text.delta', delta: 'Cut short' },
    { type: 'response.incomplete', response: { model: 'gpt-6-luna', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Cut short' }] }],
      usage: { input_tokens: 20, output_tokens: 32768, total_tokens: 32788 } } },
  ]));
  const cut = await provider.callFoundry({ prompt: 'Long', onDelta: () => {} });
  assert.equal(cut.text, 'Cut short');
  assert.equal(cut.usage.total_tokens, 32788);
  assert.equal(cut.usage.estimated, undefined);

  // Estimated usage bills an image as a bounded token count, not its base64 length.
  queued.push(() => new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'A photo.' }] }],
  }), { status: 200 }));
  const photo = { inlineData: { mimeType: 'image/png', data: 'A'.repeat(3_000_000) } };
  const described = await provider.callFoundry({ prompt: 'Describe', attachments: [photo] });
  assert.equal(described.usage.estimated, true);
  assert.ok(described.usage.input_tokens < 5000, `estimated ${described.usage.input_tokens} input tokens`);

  // Prompt caching: system and saved history form a prefix that the next turn repeats exactly.
  const turn = (history) => provider.callFoundry({ prompt: 'Now', system: 'Stable policy.', history, cacheKey: 'user-1' })
    .then(() => JSON.parse(calls.at(-1).options.body));
  const saved = [{ role: 'user', text: 'Q1' }, { role: 'agent', text: 'A1' }];
  const t1 = await turn(saved);
  const t2 = await turn([...saved, { role: 'user', text: 'Q2' }, { role: 'agent', text: 'A2' }]);
  assert.equal(t1.instructions, undefined);
  assert.deepEqual(t1.prompt_cache_options, { mode: 'explicit' });
  assert.match(t1.prompt_cache_key, /^lingon:[0-9a-z]+$/);
  assert.ok(!t1.prompt_cache_key.includes('user-1'), 'account ids are not sent in the cache key');
  assert.equal(t1.prompt_cache_key, t2.prompt_cache_key);
  assert.equal(t1.input[0].role, 'developer');
  assert.deepEqual(t1.input[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
  const marked = (body) => body.input.findLastIndex((item) => item.content?.[0]?.prompt_cache_breakpoint);
  assert.equal(t1.input[marked(t1)].content[0].text, 'Q1');
  assert.deepEqual(t2.input.slice(0, marked(t1) + 1), t1.input.slice(0, marked(t1) + 1), 'turn 2 repeats turn 1 cached prefix');
  assert.equal(t1.input.at(-1).content.length, 1);
  assert.equal(t1.input.at(-1).content[0].prompt_cache_breakpoint, undefined, 'volatile tail is not written to the cache');

  // The history window start holds while turns are appended, instead of sliding every turn.
  const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', text: `turn ${i}` }));
  const starts = [30, 32, 34, 36, 38, 40].map((n) => provider.stableTail(long.slice(0, n), 12, 18)[0].text);
  assert.ok(new Set(starts).size < starts.length, `window start moved every turn: ${starts}`);
  for (const n of [30, 40]) {
    const size = provider.stableTail(long.slice(0, n), 12, 18).length;
    assert.ok(size >= 12 && size <= 18, `window size ${size}`);
  }

  // A deployment without cache breakpoint support is detected once, then served without them.
  before = calls.length;
  queued.push(() => new Response('{"error":{"message":"Unsupported parameter: prompt_cache_options"}}', { status: 400 }));
  assert.equal((await provider.callFoundry({ prompt: 'Old model', system: 'Policy.' })).text, 'Foundry answer');
  const plain = JSON.parse(calls.at(-1).options.body);
  assert.equal(calls.length - before, 2);
  assert.equal(plain.instructions, 'Policy.');
  assert.equal(plain.prompt_cache_options, undefined);

  const audio = Buffer.alloc(300).toString('base64');
  const transcript = await provider.transcribeAudio({ audio, mime: 'audio/webm' });
  assert.equal(transcript.text, 'spoken words');
  assert.match(calls.at(-1).url, /services\.ai\.azure\.com\/openai\/deployments\/gpt-4o-transcribe\/audio\/transcriptions/);

  const image = await provider.generateImage({ prompt: 'A red lingonberry on white.' });
  assert.match(image.dataUrl, /^data:image\/png;base64,/);
  assert.equal(image.model, 'gpt-image-2');

  for (const call of calls) assert.equal(call.options.headers['api-key'], process.env.AZURE_FOUNDRY_API_KEY);
  console.log('foundry provider: responses, tools, transcription, and images ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
