import assert from 'node:assert/strict';
import { TOOLS, pickTools } from '../src/lingon-server/agents/tools.js';
import { TOOL_SCHEMAS, selectToolSchemas, buildSystem } from '../src/lingon-server/agents/vm-harness.js';

for (const prompt of ['Calculate this CSV spreadsheet and export a report', 'Edit a file on the computer desktop']) {
  const names = selectToolSchemas(prompt).map((tool) => tool.name);
  for (const name of ['web_search', 'code_run', 'shell', 'library_save']) assert.ok(names.includes(name), `${prompt}: ${name}`);
}
// The owner's computer (its locked desktop container) is offered for desktop work only.
assert.ok(!pickTools('Calculate this CSV spreadsheet and export a report').some((tool) => tool.name === 'computer_action'));
assert.ok(pickTools('Edit a file on the computer desktop').some((tool) => tool.name === 'computer_action'), 'desktop requests get the computer');
for (const name of ['computer_action', 'computer_submit']) assert.ok(TOOL_SCHEMAS.some((tool) => tool.name === name), name);
// Saved logins are typed only in the protected browser, never on the computer.
assert.ok(!TOOL_SCHEMAS.some((tool) => tool.name === 'computer_fill_secret'));
assert.ok(!selectToolSchemas('computer_fill_secret', [], { name: 'computer_fill_secret' }).some((tool) => tool.name === 'computer_fill_secret'));
await assert.rejects(TOOLS.computer_submit.run({ action: 'click', x: 10, y: 10, summary: 'Pay the order' }, { userId: 'u', sessionId: 's', trace: () => {} }), /browser checkout/);
await assert.rejects(TOOLS.computer_action.run({ action: 'type', text: '4242 4242 4242 4242' }, { userId: 'u', sessionId: 's', trace: () => {} }), /payment card/);
await assert.rejects(TOOLS.computer_action.run({ action: 'open_app', app: 'browser', url: 'http://169.254.169.254/' }, { userId: 'u', sessionId: 's', trace: () => {} }), (error) => error.code === 'HOST_BLOCKED');
const discovery = await TOOLS.capability_search.run({ query: 'download a CSV report' }, { trace: () => {} });
assert.ok(discovery.tools.some((tool) => tool.name === 'library_save'));
const system = await buildSystem({
  agent: { agent: { name: 'Anna' }, documents: { identity: 'I'.repeat(6000), soul: 'S'.repeat(6000), user: 'U'.repeat(6000), agents: 'A'.repeat(6000) } },
  memories: Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, text: `MEMORY-MARKER-${i} ` + 'x'.repeat(1000) })),
  sandbox: { mode: 'azure' },
});
assert.ok(system.length <= 11800);
assert.match(system, /Follow the owner's request/);
assert.match(system, /MEMORY-MARKER-7/);
assert.doesNotMatch(system, /computer tools handle full desktop tasks/);
console.log('edge safe workflows: offline files/data, browser alternatives, Library exports and context budget passed');
