import * as store from '../store.js';

const WEB_TOOLS = new Set(['web_search','browser_open','browser_action','browser_submit','browser_fill_secret','computer_screenshot','computer_action','computer_submit','computer_fill_secret']);
const CONNECTOR_TOOLS = new Set(['composio_apps','composio_tools','composio_execute']);
const READ_PREFIX = /(?:^|_)(?:LIST|GET|FETCH|SEARCH|READ|DOWNLOAD|EXPORT|LOOKUP|FIND)(?:_|$)/;
const WRITE_VERB = /(?:^|_)(?:SEND|CREATE|UPDATE|DELETE|POST|WRITE|INSERT|REMOVE|TRASH|ARCHIVE|MODIFY|REPLY|FORWARD|UPLOAD|PUBLISH|INVITE|EDIT|PATCH|MOVE|RENAME|SHARE|MERGE|APPROVE|CANCEL|SCHEDULE|BOOK|PAY|CHARGE|TRANSFER|SET)(?:_|$)/;
function hostOf(url){try {const u=new URL(String(url || ''));return /^https?:$/.test(u.protocol)?u.hostname.toLowerCase():'';}catch{return '';}}
function connectorRead(slug){const value=String(slug || '').toUpperCase();return READ_PREFIX.test(value) && !WRITE_VERB.test(value);}
async function permissionDecision(userId, name, args = {}, tool = {}) {
  if(!WEB_TOOLS.has(name) && !CONNECTOR_TOOLS.has(name))return {required:!!tool.approval};
  const p=await store.getAgentPermissions(userId);
  if(CONNECTOR_TOOLS.has(name)){
    if(p.connectors==='always_ask')return {required:true,detail:`Connected app action: ${name} ${JSON.stringify(args).slice(0,1400)}`};
    if(name!=='composio_execute')return {required:false};
    const slug=String(args.tool || '').toUpperCase();
    const read=connectorRead(slug);
    // "Ask for some" reads the owner's apps when asked (mail, calendar, files) and asks before
    // every write. Reads reveal nothing outside the account; sends and changes stay gated.
    return {required:!read,detail:`${read?'Read from':'Write to'} a connected app with ${slug}: ${JSON.stringify(args.args || {}).slice(0,1200)}`};
  }
  if(tool.approval)return {required:true};
  if(p.web==='always_ask')return {required:true,detail:`Web action: ${name} ${JSON.stringify(args).slice(0,1400)}`};
  // "Ask for some" opens and reads any public page without asking, like a person browsing;
  // the tools themselves refuse private and local addresses. Typing, clicking to submit,
  // sign-ins and purchases still ask. "Always ask" (above) asks for every web step.
  if(name==='browser_open' || name==='computer_screenshot'){
    const host=hostOf(args.url);
    return {required:!host,detail:`Open ${host || String(args.url || 'this website')}`};
  }
  if(name==='web_search'){
    const invalid=(Array.isArray(args.urls)?args.urls:[]).filter(url=>!hostOf(url));
    return {required:invalid.length>0,detail:`Read: ${invalid.join(', ')}`};
  }
  if(name==='browser_action' || name==='computer_action'){
    const action=String(args.type || args.action || '').toLowerCase();
    const interactive=!['screenshot','scroll','hover','move','wait','back','reload'].includes(action);
    return {required:interactive,detail:`Interact with a website: ${action} ${JSON.stringify(args).slice(0,1000)}`};
  }
  return {required:false};
}
async function recordSuccessfulWeb(userId,name,args,out){
  if(!['browser_open','computer_screenshot'].includes(name) || !out || out.error || out.ok===false)return;
  const host=hostOf(out.url || args.url);
  if(host)await store.rememberBrowserHost(userId,host);
}
export {permissionDecision,recordSuccessfulWeb};
