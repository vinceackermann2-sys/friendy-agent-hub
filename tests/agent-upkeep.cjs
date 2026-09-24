const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {UPKEEP_DEFINITIONS,upkeepRows,prepareUpkeepSignal,nextUpkeepRun}=require('../server/agents/upkeep');

const kinds=UPKEEP_DEFINITIONS.map(item=>item.kind);
assert.deepEqual(kinds,['memory','relationships','ideas','study','reflection','skills','quiet']);
assert.equal(new Set(kinds).size,7);
assert(UPKEEP_DEFINITIONS.every(item=>item.description&&item.prompt&&Array.isArray(item.allowedTools)));

const seeded=upkeepRows('owner-1',Date.parse('2026-09-22T08:00:00Z'));
assert.equal(seeded.length,7);
assert(seeded.every(item=>item.systemKind&&item.id.startsWith(`upkeep_${item.systemKind}_`)));
assert.equal(upkeepRows('owner-1')[0].id,seeded[0].id,'system ids are stable per owner');
assert.notEqual(upkeepRows('owner-2')[0].id,seeded[0].id,'system ids are account scoped');

const memory=seeded.find(item=>item.systemKind==='memory');
assert.equal(prepareUpkeepSignal(memory,[]).eligible,false,'idle accounts skip inference');
const signal=[{role:'user',text:'Remember that I prefer concise answers',created_at:'2026-09-22T07:00:00Z'}];
assert.equal(prepareUpkeepSignal(memory,signal,{now:Date.parse('2026-09-22T08:00:00Z')}).eligible,true);
const relationship=seeded.find(item=>item.systemKind==='relationships');
assert.equal(prepareUpkeepSignal(relationship,signal,{now:Date.parse('2026-09-22T08:00:00Z')}).eligible,false,'unrelated signals are consumed without inference');
assert.equal(prepareUpkeepSignal(relationship,[{role:'user',text:'My sister Mia runs the store',created_at:'2026-09-22T07:00:00Z'}],{now:Date.parse('2026-09-22T08:00:00Z')}).eligible,true);
const quiet=seeded.find(item=>item.systemKind==='quiet');
assert.equal(prepareUpkeepSignal(quiet,[{role:'user',text:'We decided to ship Friday',created_at:'2026-09-22T07:50:00Z'}],{now:Date.parse('2026-09-22T08:00:00Z')}).eligible,false,'quiet pass waits for conversation inactivity');
assert.equal(prepareUpkeepSignal(quiet,[{role:'user',text:'We decided to ship Friday',created_at:'2026-09-22T07:30:00Z'}],{now:Date.parse('2026-09-22T08:00:00Z')}).eligible,true);
assert.equal(Date.parse(nextUpkeepRun(memory,Date.parse('2026-09-22T08:00:00Z'))),Date.parse('2026-09-22T09:00:00Z'));

const ui=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
assert.match(ui,/const displayAgents = \[\.\.\.customAgents, \.\.\.upkeep\]/);
assert.doesNotMatch(ui,/automation-builtins|Built-in routines/);
assert.match(ui,/agent\.systemKind/);
const backend=fs.readFileSync(path.join(__dirname,'../server/agents/automations.js'),'utf8');
assert.match(backend,/listUpkeepSignals/);
assert.match(backend,/if\(!upkeepSignal\.eligible\)/);
assert.match(backend,/allowedTools/);
console.log('agent upkeep: seven routines, stable seeding, signal gating, quiet delay, and tool limits: ok');
