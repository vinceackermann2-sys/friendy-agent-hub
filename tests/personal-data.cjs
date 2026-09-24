const assert = require('node:assert/strict');
const { createPersonalStore } = require('../server/personal-store');

// In-memory local store; supa() returns null so the JSON branch runs.
let disk = {}, seq = 0;
const personal = createPersonalStore({
  supa: () => null, ensureProfile: async () => {}, uid: () => 'id' + (++seq),
  loadLocal: () => JSON.parse(JSON.stringify(disk)), saveLocal: (d) => { disk = JSON.parse(JSON.stringify(d)); },
});
const storePath = require.resolve('../server/store');
const agentContexts = new Map();
const defaultDocs = {identity:'# Identity\n\nName: Your agent\nStyle: Playful',soul:'# Soul',user:'# User',agents:'# Working agreement'};
const agentStore = {
  getAgentContext:async(userId)=>agentContexts.get(userId)||{agent:{name:'Your agent',pers:'Playful'},documents:{...defaultDocs},revision:0},
  saveAgentContext:async(userId,{agent,documents,revision})=>{
    const current=await agentStore.getAgentContext(userId);
    if(revision!==current.revision) throw Object.assign(new Error('Revision conflict'),{code:'CONFLICT'});
    const saved={agent:{...current.agent,...agent},documents:{...current.documents,...documents},revision:revision+1};
    agentContexts.set(userId,saved);return saved;
  },
};
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: {...personal,...agentStore} };
const { PERSONAL_TOOLS, PERSONAL_TOOL_SCHEMAS, QUICK_PERSONAL_TOOLS, pickPersonalTools, withLibraryAutosave, personalResultCard } = require('../server/agents/personal-tools');
const ctx = (userId) => ({ userId, sessionId: 'task1', chatId: 'chat1', trace: () => {} });

(async () => {
  // Agent edits use the same versioned documents as the System files editor.
  const userFile=await PERSONAL_TOOLS.system_file_read.run({key:'user'},ctx('u1'));
  assert.equal(userFile.revision,0);
  assert.equal((await PERSONAL_TOOLS.system_file_update.run({key:'user',content:'# User\n\nPrefers concise answers.',revision:userFile.revision},ctx('u1'))).action,'updated');
  assert.match((await PERSONAL_TOOLS.system_file_read.run({key:'user'},ctx('u1'))).content,/concise answers/);
  await assert.rejects(PERSONAL_TOOLS.system_file_update.run({key:'user',content:'# User\n\nOld edit',revision:0},ctx('u1')),{code:'CONFLICT'});
  assert.equal((await PERSONAL_TOOLS.system_file_read.run({key:'user'},ctx('u2'))).content,'# User','files stay account scoped');
  const identity=await PERSONAL_TOOLS.system_file_read.run({key:'identity'},ctx('u1'));
  await PERSONAL_TOOLS.system_file_update.run({key:'identity',content:'# Identity\n\nName: Nova\nStyle: Calm',revision:identity.revision},ctx('u1'));
  assert.equal((await agentStore.getAgentContext('u1')).agent.name,'Nova','identity edits update the runtime name');
  assert.equal(personalResultCard('system_file_update',{key:'identity',title:'IDENTITY.md',action:'updated'}).type,'system_file');
  await assert.rejects(PERSONAL_TOOLS.system_file_update.run({key:'memory',content:'No',revision:0},ctx('u1')),{code:'BAD_INPUT'});

  // Goals: created by the agent, visible and editable by the owner.
  const created = await PERSONAL_TOOLS.goal_create.run({ title: '  Run a 10k  ', category: 'relationships', steps: ['Run 3x per week', 'Book a race'] }, ctx('u1'));
  assert.equal(created.title, 'Run a 10k');
  assert.equal(created.category, 'relationships', 'the agent sees Relationships');
  assert.equal((await personal.listGoals('u1'))[0].category, 'family', 'stored under the original family id');
  assert.equal(created.steps.length, 2);
  const [stored] = await personal.listGoals('u1');
  assert.equal(stored.chatId, 'chat1', 'goal links back to its chat, not the task id');
  assert.deepEqual(await personal.listGoals('u2'), [], 'goals are account scoped');
  await assert.rejects(personal.updateGoal('u2', created.id, { status: 'done' }), { code: 'NOT_FOUND' });

  let goal = await PERSONAL_TOOLS.goal_update.run({ id: created.id, complete_steps: ['run 3X per week'] }, ctx('u1'));
  assert.equal(goal.status, 'active');
  goal = await PERSONAL_TOOLS.goal_update.run({ id: created.id, complete_steps: [created.steps[1].id] }, ctx('u1'));
  assert.equal(goal.status, 'done', 'checking every step completes the goal');
  goal = await personal.updateGoal('u1', created.id, { reopenSteps: ['Book a race'] });
  assert.equal(goal.status, 'active', 'reopening a step reopens the goal');
  goal = await personal.updateGoal('u1', created.id, { status: 'done' });
  assert.ok(goal.steps.every((st) => st.done), 'marking done checks every step');
  goal = await personal.updateGoal('u1', created.id, { addSteps: ['Stretch daily', 'stretch daily'], removeSteps: ['Run 3x per week'] });
  assert.deepEqual(goal.steps.map((st) => st.title), ['Book a race', 'Stretch daily'], 'duplicate step ignored, removal by title');
  assert.equal(goal.status, 'active', 'a new open step reopens a done goal');
  await assert.rejects(personal.createGoal('u1', { title: '   ' }), { code: 'BAD_INPUT' });
  await assert.rejects(personal.updateGoal('u1', created.id, { status: 'someday' }), { code: 'BAD_INPUT' });
  const imported = await personal.createGoal('u1', { title: 'Old goal', createdAt: 'not-a-date' });
  assert.ok(imported.createdAt > 0, 'bad createdAt falls back to now');
  assert.equal((await PERSONAL_TOOLS.goal_list.run({}, ctx('u1'))).goals.length, 2);
  assert.equal((await PERSONAL_TOOLS.goal_delete.run({ id: imported.id }, ctx('u1'))).action, 'deleted');
  await assert.rejects(PERSONAL_TOOLS.goal_delete.run({ id: imported.id }, ctx('u1')), { code: 'NOT_FOUND' });

  // Library: agent saves text, owner uploads media; the model never gets media bytes.
  const saved = await PERSONAL_TOOLS.library_save.run({ title: 'Trip plan', format: 'md', content: '# Lisbon\nDay 1' }, ctx('u1'));
  assert.equal(saved.title, 'Trip plan.md');
  assert.equal(saved.kind, 'document');
  const png = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
  const upload = await personal.saveLibraryItem('u1', { title: 'photo.png', content: png, source: 'upload' });
  assert.equal(upload.kind, 'image');
  assert.equal(upload.source, 'upload');
  const read = await PERSONAL_TOOLS.library_read.run({ id: upload.id }, ctx('u1'));
  assert.equal(read.content, undefined, 'media content stays out of the model context');
  assert.equal((await PERSONAL_TOOLS.library_read.run({ id: saved.id }, ctx('u1'))).content, '# Lisbon\nDay 1');
  assert.equal((await PERSONAL_TOOLS.library_list.run({ kind: 'image' }, ctx('u1'))).items.length, 1);
  assert.equal((await personal.listLibrary('u1', { query: 'TRIP' }))[0].id, saved.id);
  assert.deepEqual(await personal.listLibrary('u2'), [], 'library is account scoped');
  await assert.rejects(personal.saveLibraryItem('u1', { title: 'clip.mp4', mime: 'video/mp4', content: 'not data' }), { code: 'BAD_INPUT' });
  await assert.rejects(personal.saveLibraryItem('u1', { title: 'big.png', content: 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024) }), { code: 'BAD_INPUT' });
  assert.equal((await PERSONAL_TOOLS.library_rename.run({ id: saved.id, title: 'Lisbon plan.md' }, ctx('u1'))).title, 'Lisbon plan.md');
  assert.equal(PERSONAL_TOOLS.library_delete.approval, true, 'deleting a file needs owner approval');
  assert.equal(await PERSONAL_TOOLS.library_delete.approvalDetail({ id: saved.id }, { userId: 'u1' }), 'Delete “Lisbon plan.md” from your Library');
  await PERSONAL_TOOLS.library_delete.run({ id: saved.id }, ctx('u1'));
  assert.equal(await personal.getLibraryItem('u1', saved.id), null);

  // Generated pages, Canvas files and images are copied to the Library.
  const tools = withLibraryAutosave({
    build_page: { name: 'build_page', run: async () => ({ html: '<h1>Hi</h1>' }) },
    image_generate: { name: 'image_generate', run: async () => ({ name: 'cat.png', mimeType: 'image/png', dataUrl: png }) },
    canvas_show: { name: 'canvas_show', run: async () => ({ title: 'Report', format: 'md', content: '# Report' }) },
  });
  const page = await tools.build_page.run({}, ctx('u3'));
  const image = await tools.image_generate.run({}, ctx('u3'));
  const report = await tools.canvas_show.run({}, ctx('u3'));
  assert.ok(page.libraryId && image.libraryId && report.libraryId, 'artifacts are tagged with their Library id');
  assert.deepEqual((await personal.listLibrary('u3')).map((item) => [item.title, item.kind]).sort(), [['Report.md', 'document'], ['cat.png', 'image'], ['your-page.html', 'web']]);
  assert.equal(withLibraryAutosave(tools).build_page, tools.build_page, 'wrapping is idempotent');

  // Cards, coordinator subset and keyword gating.
  assert.equal(personalResultCard('goal_create', created).type, 'goal');
  assert.equal(personalResultCard('goal_list', { goals: [] }), null, 'read-only calls add no card');
  assert.equal(personalResultCard('library_save', saved).libraryId, saved.id);
  assert.ok(!QUICK_PERSONAL_TOOLS.has('library_delete'), 'approval tools stay out of the quick chat path');
  for (const name of QUICK_PERSONAL_TOOLS) assert.ok(PERSONAL_TOOL_SCHEMAS.some((schema) => schema.name === name));
  assert.deepEqual(Object.keys(PERSONAL_TOOLS).sort(), PERSONAL_TOOL_SCHEMAS.map((schema) => schema.name).sort(), 'every tool has a schema');
  assert.ok(pickPersonalTools('hjalp mig satta ett nytt mal').includes('goal_create'), 'Swedish goal request (folded)');
  assert.ok(pickPersonalTools('rename the pdf in my library').includes('library_rename'));
  assert.deepEqual(pickPersonalTools('what is the weather'), []);
  console.log('personal data: goals, library, autosave, cards and tool gating: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
