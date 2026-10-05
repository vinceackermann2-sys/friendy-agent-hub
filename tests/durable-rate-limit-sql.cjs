const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261005121000_durable_rate_limits.sql'), 'utf8'));
  const hit = async (key, max = 3) => (await db.query('select public.hit_rate_limit($1, 600, $2) as ok', [key, max])).rows[0].ok;
  assert.deepEqual([await hit('a'), await hit('a'), await hit('a'), await hit('a')], [true, true, true, false]);
  assert.equal(await hit('b'), true, 'each key counts separately');
  assert.equal((await db.query("select hits from public.rate_limit_hits where key = 'a'")).rows[0].hits, 4);
  // Old windows are cleaned up by later hits.
  await db.exec("insert into public.rate_limit_hits values ('old', now() - interval '2 days', 9)");
  await hit('c');
  assert.equal((await db.query("select count(*)::int as n from public.rate_limit_hits where key = 'old'")).rows[0].n, 0);
  await assert.rejects(db.query("select public.hit_rate_limit('', 600, 3)"), /Invalid rate limit/);
  // Only the server may count or read hits.
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select public.hit_rate_limit('x', 600, 3)"), /permission denied/);
    await assert.rejects(db.query('select * from public.rate_limit_hits'), /permission denied/);
    await db.exec('reset role');
  }
  await db.close();
  console.log('durable rate limit SQL: fixed windows, per key, cleanup and server-only access: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
