const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createAppleDeviceBroker, validateAppleAction } = require('../server/apple-devices');

// Exercise the actual broker against PostgreSQL, including concurrent claims.
// This adapter only maps the Supabase query builder to parameterized SQL.
function clientFor(db) {
  class Query {
    constructor(table) { this.table=table; this.kind='select'; this.filters=[]; this.columns='*'; this.orders=[]; this.parameters=[]; }
    param(value) { this.parameters.push(value && typeof value==='object' ? JSON.stringify(value) : value); return '$'+this.parameters.length; }
    select(columns='*') { this.columns=columns; this.returnRows=true; return this; }
    eq(name,value) { this.filters.push(`"${name}" = ${this.param(value)}`); return this; }
    gt(name,value) { this.filters.push(`"${name}" > ${this.param(value)}`); return this; }
    lt(name,value) { this.filters.push(`"${name}" < ${this.param(value)}`); return this; }
    in(name,values) { this.filters.push(`"${name}" in (${values.map(v=>this.param(v)).join(',')})`); return this; }
    order(name,{ascending=true}={}) { this.orders.push(`"${name}" ${ascending?'asc':'desc'}`); return this; }
    limit(n) { this.n=n; return this; }
    maybeSingle() { this.single=true; return this; }
    update(values) { this.kind='update'; this.values=values; return this; }
    insert(values) { this.kind='insert'; this.values=values; return this; }
    upsert(values,options) { this.kind='insert'; this.values=values; this.conflict=options.onConflict; return this; }
    delete() { this.kind='delete'; return this; }
    async run() {
      const where=this.filters.length?' where '+this.filters.join(' and '):'';
      let sql;
      if(this.kind==='select')sql=`select ${this.columns} from ${this.table}${where}${this.orders.length?' order by '+this.orders.join(','):''}${this.n?' limit '+this.n:''}`;
      else if(this.kind==='delete')sql=`delete from ${this.table}${where}`;
      else if(this.kind==='update')sql=`update ${this.table} set ${Object.entries(this.values).map(([k,v])=>`"${k}"=${this.param(v)}`).join(',')}${where}`;
      else {
        const keys=Object.keys(this.values);
        sql=`insert into ${this.table} (${keys.map(k=>`"${k}"`).join(',')}) values (${keys.map(k=>this.param(this.values[k])).join(',')})`;
        if(this.conflict)sql+=` on conflict (${this.conflict}) do update set ${keys.filter(k=>!this.conflict.split(',').includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',')}`;
      }
      if(this.kind!=='select' && this.returnRows)sql+=' returning '+this.columns;
      try { const {rows}=await db.query(sql,this.parameters);return {data:this.single?rows[0]||null:rows,error:null}; }
      catch(error) { return {data:null,error}; }
    }
    then(resolve,reject) { return this.run().then(resolve,reject); }
  }
  return {from:table=>new Query(table)};
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  const db = new PGlite(), alice=crypto.randomUUID(), bob=crypto.randomUUID(), phone=crypto.randomUUID();
  const oldKey=process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY='apple-test-key-never-production';
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create table profiles(id text primary key); create table agent_chat_tasks(id text primary key,user_id text,state jsonb);');
    await db.exec(fs.readFileSync('supabase/migrations/20261004133503_apple_device_connections.sql','utf8'));
    await db.query('insert into auth.users values($1),($2)',[alice,bob]);
    await db.query('insert into profiles values($1),($2)',[alice,bob]);
    const client=clientFor(db), broker=createAppleDeviceBroker({client:()=>client,wait:()=>sleep(10)});
    await broker.register(alice,{id:phone,platform:'ios',name:'Phone',capabilities:{calendar:true,contacts:true,health:true}});
    assert.equal((await broker.devices(alice))[0].online,true);
    assert.deepEqual(await broker.devices(bob),[]);
    assert.throws(()=>validateAppleAction('contacts.search',{}),/specific name/);
    assert.throws(()=>validateAppleAction('health.summary',{purpose:'advertising'}),/fitness and wellness/);
    assert.throws(()=>validateAppleAction('health.write',{value:42}),/Unsupported/);
    assert.throws(()=>validateAppleAction('calendar.list',{start:'2026-01-01',end:'2026-04-01'}),/31 days/);
    assert.throws(()=>validateAppleAction('reminders.delete',{}),/exact item id/);
    assert.throws(()=>validateAppleAction('__proto__',{}),/Unsupported/);
    await assert.rejects(broker.execute(bob,{deviceId:phone,action:'contacts.search',args:{query:'Alice'}}),/Open Belna/);
    let execution=broker.execute(alice,{deviceId:phone,action:'contacts.search',args:{query:'Private Contact'}});
    for(let i=0;i<100;i++){if((await db.query('select count(*)::int n from apple_device_commands')).rows[0].n)break;await sleep(5);}
    const raw=(await db.query('select * from apple_device_commands')).rows[0];
    assert.doesNotMatch(JSON.stringify(raw),/Private Contact/,'private arguments are encrypted');
    assert.deepEqual((await broker.claim(bob,phone)).commands,[],'another account cannot claim the command');
    const claims=await Promise.all([broker.claim(alice,phone),broker.claim(alice,phone)]);
    const commands=claims.flatMap(r=>r.commands);assert.equal(commands.length,1,'only one worker leases a command');
    const command=commands[0];assert.equal(command.args.query,'Private Contact');
    assert.deepEqual((await broker.claim(alice,phone)).commands,[],'running commands are never replayed');
    await assert.rejects(broker.complete(bob,phone,command.id,{leaseToken:command.leaseToken,result:{contacts:[]}}),/expired or was cancelled/);
    await assert.rejects(broker.complete(alice,phone,command.id,{leaseToken:crypto.randomUUID(),result:{contacts:[]}}),/expired or was cancelled/);
    await broker.complete(alice,phone,command.id,{leaseToken:command.leaseToken,result:{contacts:[{givenName:'Private Contact'}]}});
    assert.equal((await execution).contacts[0].givenName,'Private Contact');
    const consumed=(await db.query('select * from apple_device_commands')).rows[0];
    assert.equal(consumed.status,'consumed');assert.equal(consumed.payload,null);assert.equal(consumed.result,null);
    assert.deepEqual(await broker.complete(alice,phone,command.id,{leaseToken:command.leaseToken,result:{contacts:[]}}),{ok:true},'completion delivery is idempotent');
    await broker.register(alice,{id:crypto.randomUUID(),platform:'mac',capabilities:{contacts:true}});
    await assert.rejects(broker.execute(alice,{action:'contacts.search',args:{query:'Alice'}}),/exact Apple device id/);
    await db.query("update apple_devices set last_seen_at=now()-interval '1 hour' where id=$1",[phone]);
    await assert.rejects(broker.execute(alice,{deviceId:phone,action:'contacts.search',args:{query:'Alice'}}),/Open Belna/);
    await broker.register(alice,{id:phone,platform:'ios',capabilities:{contacts:true}});
    await db.query('insert into agent_chat_tasks values($1,$2,$3)',['task-cancel',alice,JSON.stringify({status:'running'})]);
    const queued = await broker.submit(alice,{deviceId:phone,action:'contacts.search',args:{query:'Cancel'}},{taskId:'task-cancel'});
    assert.equal((await broker.state(alice,phone,queued.requestId)).active,true);
    await db.query('update agent_chat_tasks set state=$1 where id=$2',[JSON.stringify({status:'stopping'}),'task-cancel']);
    assert.equal((await broker.state(alice,phone,queued.requestId)).active,false,'task cancellation prevents the device action');
    assert.deepEqual((await broker.claim(alice,phone)).commands,[]);
    let clock=Date.now();
    const timeout=createAppleDeviceBroker({client:()=>client,now:()=>clock,wait:async()=>{clock+=120001;}});
    await assert.rejects(timeout.execute(alice,{deviceId:phone,action:'contacts.search',args:{query:'Timeout'}}),/did not return/);
    assert.equal((await db.query("select payload from apple_device_commands where status='expired'")).rows[0].payload,null);
    for(const table of ['apple_devices','apple_device_commands']){
      assert.equal((await db.query("select has_table_privilege('authenticated',$1,'SELECT') allowed",[table])).rows[0].allowed,false);
      assert.equal((await db.query('select relrowsecurity from pg_class where relname=$1',[table])).rows[0].relrowsecurity,true);
    }
    assert.equal((await db.query("select has_function_privilege('anon','delete_belna_account_data(uuid)','EXECUTE') allowed")).rows[0].allowed,false);
    await db.query('select delete_belna_account_data($1)',[alice]);
    assert.equal((await db.query('select count(*)::int n from apple_devices where user_id=$1',[alice])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from profiles where id=$1',[bob])).rows[0].n,1,'deletion keeps another account');
    console.log('Apple devices: SQL migration, ownership, encrypted transport, concurrent leases, no replay, expiry, content erasure, RLS and scoped deletion passed');
  } finally { if(oldKey===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=oldKey;await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
