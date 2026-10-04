const { appleDevices, APPLE_ACTIONS } = require('../apple-devices');

const APPLE_TOOL_SCHEMAS = [
  { name: 'apple_result', description: 'Retrieve the result of an earlier apple_execute by its requestId. A pending result is not success: keep the same requestId and check again, or tell the owner to keep the native app open. Never repeat a write as a progress check. Once retrieved, the private device result is erased from transient storage.', parameters: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] } },
  { name: 'apple_devices', description: 'List the owner’s connected iPhone, iPad and Mac Apple apps, permissions and current availability. Apple access requires the device to have Belna open. Calendar, Reminders and Contacts use the store on that device (including synced accounts). Health summaries are read-only fitness/wellness, when HealthKit is available. Apple Notes, Mail and Messages do not have general third-party access here.', parameters: { type: 'object', properties: {} } },
  { name: 'apple_execute', description: 'Perform one action in the owner’s Apple app on the selected device. Discover availability with apple_devices first. Dates must be ISO 8601 with a time zone. Use exact ids from reads for changes. No bulk contact export, health writes, silent health uploads, or background device access. Calendar reads cover at most 31 days. Health requires purpose=wellness and explicit on-device consent for each result sent to AI. Writes ask for approval. Never retry a write after an uncertain outcome.', parameters: { type: 'object', properties: {
    deviceId: { type: 'string', description: 'Exact id from apple_devices; required when several devices are available.' },
    action: { type: 'string', enum: Object.keys(APPLE_ACTIONS) },
    args: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, due: { type: 'string' }, notes: { type: 'string' }, location: { type: 'string' }, calendarId: { type: 'string' }, query: { type: 'string' }, givenName: { type: 'string' }, familyName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, completed: { type: 'boolean' }, days: { type: 'integer', minimum: 1, maximum: 7 }, purpose: { type: 'string', enum: ['wellness'] }, limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0, maximum: 1000 },
    } },
  }, required: ['action','args'] } },
];
const APPLE_TOOLS = {
  apple_devices: { name: 'apple_devices', type: 'function', approval: false, run: async (_,ctx) => ({ devices: await appleDevices.devices(ctx.userId), note: 'Open the native Belna app, tap Apple apps and connect the needed scope. Devices must remain open for agent actions.' }) },
  apple_execute: { name: 'apple_execute', type: 'function', approval: true, approvalDetail: async args => `Apple ${args.action}: ${JSON.stringify(args.args || {}).slice(0,1200)}`, run: (args,ctx) => appleDevices.submit(ctx.userId,args,{taskId:ctx.taskId}) },
  apple_result: { name: 'apple_result', type: 'function', approval: false, run: async (args,ctx) => {
    const end = Date.now() + 8000;
    do {
      if (ctx.signal?.aborted) throw new Error('Apple result retrieval cancelled. Never repeat a write without inspecting its outcome.');
      const out = await appleDevices.result(ctx.userId,args.requestId);
      if (!out.pending) return out;
      await new Promise(resolve=>setTimeout(resolve,700));
    } while (Date.now() < end);
    return { requestId: args.requestId, pending: true, note: 'Awaiting the device. Call apple_result again with this requestId. Never report completion or repeat apple_execute yet.' };
  } },
};
module.exports = { APPLE_TOOLS, APPLE_TOOL_SCHEMAS };
