/* Azure sandbox status + optional VM create.
   Status (default): prints whether AZURE_* is set.
   Create: node scripts/azure-provision.mjs --create --user <lingonUserId>
   Shared infra only: node scripts/azure-provision.mjs --create
   Does nothing until credentials exist. Never copies secrets into a VM.
*/
import 'dotenv/config';
import {
  azureConfig,
  isAzureConfigured,
  missingAzureFields,
  vmNameForUser,
  ensureInfrastructure,
  provisionUserVm,
} from '../server/agents/azure-vm.js';

const args = process.argv.slice(2);
const create = args.includes('--create');
const userIdx = args.indexOf('--user');
const userId = userIdx >= 0 ? String(args[userIdx + 1] || '').trim() : '';
const cfg = azureConfig();
const missing = missingAzureFields(cfg);

const report = {
  configured: isAzureConfigured(),
  missing,
  location: cfg.location,
  vmSize: cfg.vmSize,
  resourceGroup: cfg.resourceGroup || null,
  autoProvision: cfg.autoProvision,
  network: 'no-public-ip · no-public-ssh · egress-allowlist',
  exampleVmName: vmNameForUser(userId || 'example-user'),
};

if (!isAzureConfigured()) {
  report.next = 'Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP then re-run.';
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else if (!create) {
  report.next = 'Ready. Create shared NSG/VNet with --create, or a user VM with --create --user <id>.';
  console.log(JSON.stringify(report, null, 2));
} else {
  try {
    report.infrastructure = await ensureInfrastructure(cfg);
    if (userId) report.vm = await provisionUserVm(userId);
    else report.next = 'Shared NSG/VNet ready. Pass --user <lingonUserId> to create that user VM.';
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.error = e.message;
    report.code = e.code || null;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}
