const assert = require('node:assert/strict');
const { TOOLS, pickTools } = require('../server/agents/tools');
const { TOOL_SCHEMAS, selectToolSchemas, buildSystem } = require('../server/agents/vm-harness');
const { permissionDecision } = require('../server/agents/permission-policy');
const azure = require('../server/agents/azure-vm');
const store = require('../server/store');
const pc = require('../server/agents/pc');

async function main() {
  const unavailable = ['computer_action', 'computer_submit', 'computer_fill_secret'];
  for (const name of unavailable) {
    assert.equal(TOOLS[name].available, false);
    assert.ok(!TOOL_SCHEMAS.some((tool) => tool.name === name));
    assert.ok(!selectToolSchemas(name, [], { name }).some((tool) => tool.name === name), 'mentioning or approving a disabled tool cannot advertise it');
  }

  const cases = [
    ['Fill in this website form', ['web_search', 'browser_open', 'browser_action', 'browser_submit']],
    ['Sign in to my account', ['vault_list', 'vault_request', 'browser_fill_secret']],
    ['Calculate totals from this CSV and export a report', ['web_search', 'shell', 'code_run', 'canvas_show', 'library_save']],
    ['Edit a file using the computer text editor', ['shell', 'code_run', 'canvas_show', 'library_read', 'library_save']],
    ['Download this JSON data and make a document', ['web_search', 'code_run', 'library_save']],
  ];
  for (const [prompt, expected] of cases) {
    const names = selectToolSchemas(prompt).map((tool) => tool.name);
    for (const name of expected) assert.ok(names.includes(name), `${prompt}: ${name} remains available`);
    assert.ok(!pickTools(prompt).some((tool) => unavailable.includes(tool.name)));
  }
  const discovery = await TOOLS.capability_search.run({ query: 'download a CSV report on my computer' }, { trace: () => {} });
  assert.ok(discovery.tools.some((tool) => tool.name === 'library_save'));
  assert.ok(!discovery.tools.some((tool) => unavailable.includes(tool.name)));

  const original = { exec: azure.execInSandbox, permissions: store.getAgentPermissions, save: store.saveLibraryItem, pcSession: pc.getOrCreate, pcReport: pc.report };
  const dispatched = [];
  const ctx = { userId: 'safe-user', sessionId: 'safe-session', taskId: 'safe-task', vmReady: true, trace: () => {} };
  try {
    pc.getOrCreate = () => ({ pcId: 'safe-terminal' });
    pc.report = () => {};
    azure.execInSandbox = async (...args) => {
      dispatched.push(args);
      return { mode: 'azure', vmName: 'test-vm', stdout: '6', stderr: '', exitCode: 0, language: 'python' };
    };
    const code = 'import json\nprint(sum(json.loads("[1,2,3]")))';
    await TOOLS.code_run.run({ language: 'python', code }, ctx);
    await TOOLS.shell.run({ command: 'mkdir -p reports && printf "name,total\\nAda,6\\n" > reports/totals.csv' }, ctx);
    assert.equal(dispatched[0][1], 'code_run');
    assert.equal(dispatched[0][2].code, code, 'safe user code is forwarded unchanged');
    assert.equal(dispatched[1][1], 'shell');
    assert.equal(dispatched[1][3].taskId, 'safe-task', 'file edits retain task isolation');

    let saved;
    store.saveLibraryItem = async (userId, item) => {
      saved = { userId, ...item };
      return { ...item, id: 'safe-artifact', size: item.content.length, createdAt: Date.now() };
    };
    const result = await TOOLS.library_save.run({ title: 'Totals', format: 'csv', content: 'name,total\nAda,6\n' }, ctx);
    assert.equal(result.action, 'saved');
    assert.equal(saved.userId, 'safe-user');
    assert.equal(saved.title, 'Totals.csv');
    assert.equal(saved.content, 'name,total\nAda,6\n', 'safe exports still produce real Library content');

    store.getAgentPermissions = async () => ({ web: 'ask_for_some', connectors: 'ask_for_some' });
    for (const [name, args] of [['shell', {}], ['code_run', {}], ['library_save', {}], ['web_search', {}], ['browser_open', { url: 'https://example.com' }], ['browser_action', { type: 'type', text: 'Ada' }]]) {
      assert.equal((await permissionDecision(ctx.userId, name, args, TOOLS[name])).required, false, `${name}: hardening adds no approval for routine work`);
    }
    assert.equal((await permissionDecision(ctx.userId, 'browser_submit', {}, TOOLS.browser_submit)).required, true);
    store.getAgentPermissions = async () => ({ web: 'always_ask' });
    assert.equal((await permissionDecision(ctx.userId, 'browser_action', {}, TOOLS.browser_action)).required, true, 'owner permission preferences remain authoritative');
  } finally {
    azure.execInSandbox = original.exec;
    store.getAgentPermissions = original.permissions;
    store.saveLibraryItem = original.save;
    pc.getOrCreate = original.pcSession;
    pc.report = original.pcReport;
  }

  const system = await buildSystem({ agent: { agent: { name: 'Anna' } }, sandbox: { mode: 'azure' } });
  assert.match(system, /Follow the owner's request/);
  assert.match(system, /choose a supported route/);
  assert.doesNotMatch(system, /computer tools handle full desktop tasks/);
  console.log('safe agent workflows: discovery, browser/forms/logins, offline code/files, Library exports and owner permissions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
