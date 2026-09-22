const assert = require('node:assert/strict');

process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT = 'https://unit-resource.services.ai.azure.com/api/projects/unit-project';
process.env.AZURE_FOUNDRY_API_KEY = 'unit-test-key-that-is-long-enough';
delete process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT;
delete process.env.AZURE_FOUNDRY_MODEL;
delete process.env.AZURE_FOUNDRY_REASONING_EFFORT;

const provider = require('../server/foundry');
const calls = [];
const imageBytes = Buffer.from('fake-png');

global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
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
