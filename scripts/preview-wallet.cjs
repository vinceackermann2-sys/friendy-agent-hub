// Local app preview with real account authentication. Scheduled production jobs
// remain on their existing workers; user-requested chat/task actions still run.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.wallet.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.BELNA_BIND_ADDRESS = '127.0.0.1';
// Bind both the OAuth cookie and callback to this preview, even when .env
// contains the production site origin. Google must allow this exact callback.
process.env.SITE_URL = 'http://localhost:' + (process.env.PORT || '8000');
require('../server/agents/automations').startAutomationWorker = () => null;
require('../server/agents/conversation').startWorker = () => null;
require('../server/agents/azure-vm').startIdleWatcher = () => null;
require('../server/index.js');
