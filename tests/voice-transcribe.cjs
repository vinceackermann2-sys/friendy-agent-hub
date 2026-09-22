const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareAudio } = require('../server/foundry');

function fail(fn, code) {
  try { fn(); throw new Error('expected throw'); }
  catch (e) { assert.equal(e.code, code); }
}

fail(() => prepareAudio({ audio: '', mime: 'audio/webm' }), 'BAD_INPUT');
fail(() => prepareAudio({ audio: 'YQ==', mime: 'audio/webm' }), 'BAD_INPUT');
fail(() => prepareAudio({ audio: Buffer.alloc(300).toString('base64'), mime: 'image/png' }), 'BAD_INPUT');
fail(() => prepareAudio({ audio: 'A'.repeat(8 * 1024 * 1024), mime: 'audio/webm' }), 'BAD_INPUT');

const ok = prepareAudio({
  audio: 'data:audio/webm;base64,' + Buffer.alloc(300).toString('base64'),
  mime: 'audio/webm;codecs=opus',
});
assert.equal(ok.mimeType, 'audio/webm');
assert.ok(ok.data.length > 0);

const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
assert.match(app, /\/api\/voice\/transcribe/);
assert.match(app, /MediaRecorder/);
assert.doesNotMatch(app, /webkitSpeechRecognition/);

const server = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
assert.match(server, /app\.post\('\/api\/voice\/transcribe'/);
assert.doesNotMatch(server, /app\.post\('\/api\/voice\/speech'/);
const edge = fs.readFileSync(path.join(__dirname, '../src/lingon-server/index.js'), 'utf8');
assert.match(edge, /app\.post\('\/api\/voice\/transcribe'/);
assert.doesNotMatch(edge, /app\.post\('\/api\/voice\/speech'/);

console.log('voice transcribe: ok');
