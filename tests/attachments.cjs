const assert = require('node:assert/strict');
const { prepareAttachments, dataUrl, cleanName } = require('../server/agents/attachments');

const text = Buffer.from('name,answer\nLingon,works\n', 'utf8').toString('base64');
const image = Buffer.from([0, 1, 2, 3]).toString('base64');
const out = prepareAttachments([
  { name: '../notes.csv', type: 'text/csv', size: 25, dataUrl: `data:text/csv;base64,${text}` },
  { name: 'photo.png', type: 'image/png', size: 4, dataUrl: `data:image/png;base64,${image}` },
]);
assert.equal(out.metadata[0].name, 'notes.csv');
assert.match(out.prompt, /Lingon,works/);
assert.equal(out.metadata[1].inline, true);
assert.equal(out.modelParts[0].inlineData.mimeType, 'image/png');
assert.equal(cleanName('..\\secret\\\u0000bad.txt'), 'bad.txt');
assert.equal(dataUrl('not-a-data-url'), null);
assert.equal(prepareAttachments([{ name: 'x.bin', type: 'application/octet-stream', size: 1 }]).metadata[0].name, 'x.bin');
assert.equal(prepareAttachments([{ name: 'too.bin', type: 'application/octet-stream', size: 11 * 1024 * 1024 }]).accepted, 0);
console.log('attachments: text and image context is bounded and sanitized: ok');
