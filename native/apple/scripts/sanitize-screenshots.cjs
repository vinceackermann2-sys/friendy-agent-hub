const fs = require('node:fs');
const path = require('node:path');

function sanitizeScreenshotDirectory(directory, password = '') {
  if (!fs.existsSync(directory)) return 0;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile())) throw new Error('Unexpected screenshot export entry');
  const manifestPath = path.join(directory, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const test of manifest) {
      test.attachments = test.attachments.filter(attachment => {
        const name = attachment.exportedFileName;
        return typeof name === 'string' && path.basename(name) === name && name.endsWith('.png');
      });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  let screenshots = 0;
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (!entry.name.endsWith('.png') && entry.name !== 'manifest.json') {
      fs.unlinkSync(file);
      continue;
    }
    if (password && fs.readFileSync(file).includes(Buffer.from(password))) {
      throw new Error('Credential detected in screenshot evidence');
    }
    if (entry.name.endsWith('.png')) screenshots++;
  }
  return screenshots;
}

if (require.main === module) {
  const credentials = process.env.BELNA_REVIEW_CREDENTIALS
    ? JSON.parse(process.env.BELNA_REVIEW_CREDENTIALS) : {};
  const build = path.resolve(__dirname, '..', 'build');
  let screenshots = 0;
  for (const name of ['test-attachments', 'app-store-iphone', 'app-store-ipad']) {
    screenshots += sanitizeScreenshotDirectory(path.join(build, name), credentials.password);
  }
  console.log(`Prepared ${screenshots} PNG screenshots without diagnostic attachments`);
}

module.exports = { sanitizeScreenshotDirectory };
