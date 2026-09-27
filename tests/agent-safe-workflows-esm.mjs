import assert from 'node:assert/strict';
import { TOOLS, pickTools } from '../src/lingon-server/agents/tools.js';
import { TOOL_SCHEMAS, selectToolSchemas, buildSystem } from '../src/lingon-server/agents/vm-harness.js';

for (const prompt of ['Calculate this CSV spreadsheet and export a report', 'Edit a file on the computer desktop']) {
  const names = selectToolSchemas(prompt).map((tool) => tool.name);
  for (const name of ['web_search', 'code_run', 'shell', 'library_save']) assert.ok(names.includes(name), `${prompt}: ${name}`);
  assert.ok(!pickTools(prompt).some((tool) => tool.name === 'computer_action'));
}
for (const name of ['computer_action', 'computer_submit', 'computer_fill_secret']) {
  assert.ok(!TOOL_SCHEMAS.some((tool) => tool.name === name));
  assert.ok(!selectToolSchemas(name, [], { name }).some((tool) => tool.name === name));
}
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
