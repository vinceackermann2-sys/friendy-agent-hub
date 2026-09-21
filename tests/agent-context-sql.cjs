const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create table profiles(id text primary key); insert into profiles values('user-a');");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260921120000_agent_context.sql'), 'utf8'));
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const first = (await query('select * from write_agent_context($1,$2,$3,$4)', ['user-a', { name:'Lingon', pers:'Precise' }, { soul:'# Soul' }, 0]))[0];
  assert.equal(first.revision, 1);
  assert.equal(first.agent.name, 'Lingon');
  const second = (await query('select * from write_agent_context($1,$2,$3,$4)', ['user-a', { name:'Mira' }, { soul:'# Soul v2' }, 1]))[0];
  assert.equal(second.revision, 2);
  assert.equal(second.documents.soul, '# Soul v2');
  await assert.rejects(query('select * from write_agent_context($1,$2,$3,$4)', ['user-a', { name:'Stale' }, {}, 1]), /changed/i);
  await db.exec('set role authenticated');
  await assert.rejects(query('select * from agent_contexts'), /permission denied/);
  await assert.rejects(query('select * from write_agent_context($1,$2,$3,$4)', ['user-a', {}, {}, 2]), /permission denied/);
  await db.close();
  console.log('agent context SQL: revision checks and service-only access: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
