const assert = require('node:assert/strict');

(async () => {
  const runtimes = [
    [require('../server/agents/conversation'), require('../server/agents/task-runtime')],
    [await import('../src/lingon-server/agents/conversation.js'), await import('../src/lingon-server/agents/task-runtime.js')],
  ];
  for (const [conversation, tasks] of runtimes) {
    const oldMessages = Array.from({length:40}, (_,i) => ({role:i%2?'agent':'user',text:'Turn '+i,
      created_at:new Date(Date.UTC(2026,9,2,8,0,i)).toISOString()}));
    const calls = [
      deps => conversation.acknowledgeTask({userId:'owner',prompt:'Research',title:'Research'}, deps),
      deps => conversation.updateChatSummary('owner','chat',{...deps,store:{
        listChatMessages:async()=>oldMessages,latestChatSummary:async()=>null,saveTurn:async()=>{},
      }}),
      deps => tasks.writeProgress({userId:'owner',request:'Research',results:[{text:'A verified result'}]},deps),
    ];
    for (const call of calls) {
      const usage = {promptTokenCount:20,candidatesTokenCount:5,totalTokenCount:25};
      const logged = [];
      const logUsage = async (owner, entries) => {assert.equal(owner,'owner');logged.push(...entries);};
      const failure = Object.assign(new Error('Accepted request interrupted'),{name:'AbortError',usage});
      await assert.rejects(call({model:async()=>{throw failure;},logUsage}),error=>error===failure);
      assert.deepEqual(logged,[usage],'accepted utility calls are charged even when interrupted');
      logged.length=0;
      await assert.rejects(call({model:async()=>{throw new Error('Rejected before acceptance');},logUsage}));
      assert.deepEqual(logged,[],'rejected calls do not consume tokens');
      await call({model:async()=>({text:'{"message":"Working on it."}',usage}),logUsage});
      assert.deepEqual(logged,[usage],'successful utility calls are charged exactly once');
      await assert.rejects(call({model:async()=>({text:'Done',usage}),logUsage:async()=>{throw new Error('Ledger unavailable');}}),/Ledger unavailable/,
        'a failed ledger write is not reported as successfully billed');
      let modelCalled=false;
      logged.length=0;
      await assert.rejects(call({model:async()=>{modelCalled=true;return {text:'Done',usage};},logUsage,
        ensureCredit:async()=>{throw Object.assign(new Error('No tokens left'),{code:'NO_CREDIT'});}}),/No tokens left/);
      assert.equal(modelCalled,false,'supporting calls cannot start after the allowance is exhausted');
      assert.deepEqual(logged,[]);
    }
  }
  console.log('usage accounting: successful, interrupted and rejected utility calls in both runtimes: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
