const assert = require('node:assert/strict');
const store = require('../server/store');
const { permissionDecision, recordSuccessfulWeb } = require('../server/agents/permission-policy');

const originalGet = store.getAgentPermissions;
const originalRemember = store.rememberBrowserHost;
let current = { web:'ask_some', connectors:'ask_some', knownHosts:[] };
let remembered = '';
store.getAgentPermissions = async () => current;
store.rememberBrowserHost = async (_, host) => { remembered = host; };

(async () => {
  // The default mode opens and reads any public page, familiar or not, without asking.
  assert.equal((await permissionDecision('u','browser_open',{url:'https://example.com'},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','computer_screenshot',{url:'https://unknown.example/'},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','browser_open',{url:'not a url'},{approval:false})).required,true);
  current.knownHosts=['example.com'];
  assert.equal((await permissionDecision('u','browser_open',{url:'https://example.com'},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','browser_action',{type:'scroll'},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','browser_action',{type:'type',text:'hello'},{approval:false})).required,true);
  // Searches and reading public pages by URL only read: the default mode runs them without asking.
  assert.equal((await permissionDecision('u','web_search',{query:'weather today'},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','web_search',{urls:['https://unknown.example/page']},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','web_search',{urls:['https://example.com/a']},{approval:false})).required,false);
  assert.equal((await permissionDecision('u','composio_execute',{tool:'GITHUB_LIST_REPOS'},{approval:true})).required,false);
  assert.equal((await permissionDecision('u','composio_execute',{tool:'GMAIL_FETCH_EMAILS'},{approval:true})).required,false);
  assert.equal((await permissionDecision('u','composio_execute',{tool:'GMAIL_SEND_EMAIL'},{approval:true})).required,true);
  assert.equal((await permissionDecision('u','composio_execute',{tool:'GITHUB_GET_OR_CREATE_REPO'},{approval:true})).required,true);
  await recordSuccessfulWeb('u','browser_open',{url:'https://example.com/path'},{url:'https://example.com/path'});
  assert.equal(remembered,'example.com');
  current = {...current,web:'always_ask',connectors:'always_ask'};
  assert.equal((await permissionDecision('u','browser_action',{type:'scroll'},{approval:false})).required,true);
  assert.equal((await permissionDecision('u','web_search',{query:'weather today'},{approval:false})).required,true);
  assert.equal((await permissionDecision('u','browser_open',{url:'https://example.com'},{approval:false})).required,true,'Always ask still asks before opening a page');
  assert.equal((await permissionDecision('u','composio_apps',{}, {approval:false})).required,true);
  assert.equal((await permissionDecision('u','composio_execute',{tool:'GITHUB_LIST_REPOS'},{approval:true})).required,true);
  console.log('agent permissions: passed');
})().catch(error => { console.error(error); process.exitCode=1; }).finally(() => {
  store.getAgentPermissions=originalGet;
  store.rememberBrowserHost=originalRemember;
});
