const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeScreenshotDirectory } = require('../native/apple/scripts/sanitize-screenshots.cjs');

const temporaryRoot = path.resolve(os.tmpdir());
const directory = fs.mkdtempSync(path.join(temporaryRoot, 'belna-release-evidence-'));
try {
  fs.writeFileSync(path.join(directory, 'screen.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(directory, 'diagnostic-event'), 'test-secret');
  fs.writeFileSync(path.join(directory, 'hierarchy.txt'), 'test-secret');
  fs.writeFileSync(path.join(directory, 'recording.mp4'), 'test-secret');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify([{
    testIdentifier: 'reviewer screenshot',
    attachments: ['screen.png', 'diagnostic-event', 'hierarchy.txt', 'recording.mp4', '../unsafe.png']
      .map(exportedFileName => ({ exportedFileName })),
  }]));
  assert.equal(sanitizeScreenshotDirectory(directory, 'test-secret'), 1);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['manifest.json', 'screen.png']);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest[0].attachments, [{ exportedFileName: 'screen.png' }]);
  fs.writeFileSync(path.join(directory, 'screen.png'), 'test-secret');
  assert.throws(() => sanitizeScreenshotDirectory(directory, 'test-secret'), /Credential detected/);
  console.log('Apple screenshot evidence excludes diagnostic events and credentials');
} finally {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert.ok(path.basename(resolved).startsWith('belna-release-evidence-'));
  fs.rmSync(resolved, { recursive: true });
}
