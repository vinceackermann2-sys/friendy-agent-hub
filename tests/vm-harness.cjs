const assert = require('node:assert/strict');
const { TOOL_SCHEMAS, selectToolSchemas, emitResultCard, buildSystem } = require('../server/agents/vm-harness');
const { TOOLS } = require('../server/agents/tools');
const { isConfigured, MODEL_DEFAULT, REASONING_EFFORT } = require('../server/foundry');

async function main(){
  assert.equal(MODEL_DEFAULT, 'gpt-6-luna');
  assert.equal(REASONING_EFFORT, 'xhigh');
  assert.ok(Array.isArray(TOOL_SCHEMAS));
  for(const name of ['capability_search','web_search','browser_open','browser_action','code_run','shell','computer_screenshot'])assert.ok(TOOL_SCHEMAS.some((t)=>t.name===name));
  // header status: every tool can carry the model's note; labels come from real args
  assert.ok(TOOL_SCHEMAS.every((t)=>t.parameters.properties.activity?.type==='string'));
  const { describeTool, splitActivity } = require('../server/agents/activity');
  assert.deepEqual(splitActivity({activity:'Verifying your leads',query:'acme'}),{args:{query:'acme'},note:'Verifying your leads'});
  assert.equal(describeTool('web_search',{query:'dentists in Solna'}),'Searching the web for “dentists in Solna”');
  assert.equal(describeTool('memory_search',{}),'Checking memory');
  assert.equal(describeTool('browser_open',{url:'https://www.example.com/a'}),'Opening example.com');
  const simpleSchemas=selectToolSchemas('Explain this idea in two sentences.');
  assert.deepEqual(simpleSchemas.map((tool)=>tool.name).sort(),['capability_search','memory_write','web_search']);
  assert.ok(JSON.stringify(simpleSchemas).length<JSON.stringify(TOOL_SCHEMAS).length/3,'ordinary chat sends a much smaller tool schema payload');
  assert.ok(selectToolSchemas('Run this Python script in my workspace.').some((tool)=>tool.name==='code_run'));
  assert.ok(selectToolSchemas('Create an image of a moonlit forest.').some((tool)=>tool.name==='image_generate'));
  assert.ok(selectToolSchemas('',[],{name:'composio_execute'}).some((tool)=>tool.name==='composio_execute'),'approved actions remain available on resume');
  assert.ok(selectToolSchemas('Continue.',[{role:'user',text:'Tool capability_search result: {"tools":[{"name":"mail_list"}]}'}]).some((tool)=>tool.name==='mail_list'),'discovered capabilities become available on the next model step');
  const discovered=await TOOLS.capability_search.run({query:'mejl'},{trace:()=>{}});
  assert.ok(discovered.tools.some((tool)=>tool.name==='mail_list'),'capability discovery understands common localized requests');
  assert.equal(TOOLS.code_run.approval,false);
  assert.equal(TOOLS.shell.approval,false);
  assert.equal(TOOLS.browser_action.approval,false);
  assert.equal(TOOLS.trigger_create.approval,true);
  assert.equal(TOOLS.composio_execute.approval,true);
  assert.ok(isConfigured()===true || isConfigured()===false);
  const system=await buildSystem({
    agent:{agent:{name:'Lingon',pers:'Precise'},documents:{identity:'I'.repeat(6000),soul:'S'.repeat(6000),user:'U'.repeat(6000),agents:'A'.repeat(6000)}},
    memories:Array.from({length:8},(_,i)=>({id:`m${i}`,category:'long_term',text:`MEMORY-MARKER-${i} `+'x'.repeat(1000)})),
    sandbox:{mode:'local'},
  });
  assert.ok(system.length<=11800,'system context stays below the downstream clipping limit');
  assert.match(system,/MEMORY-MARKER-7/,'all ranked memory survives large profile documents');
  assert.match(system,/capability_search/);
  const cards=[];
  for(const name of ['shell','code_run','web_search'])emitResultCard((event)=>cards.push(event),name,name,{});
  assert.deepEqual(cards,[]);
  for(const name of ['browser_open','computer_screenshot','browser_action'])emitResultCard((event)=>cards.push(event),name,name,{url:'https://example.com',screenshot:'data:image/jpeg;base64,AA=='});
  assert.equal(cards.length,3);
  assert.ok(cards.every((event)=>event.card.surface==='canvas'&&event.card.type==='browser'));
  console.log('vm-harness schemas: ok');
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
