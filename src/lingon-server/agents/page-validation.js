import { parse } from 'acorn';
// Parse without executing generated code. Safe on Node and the edge runtime.
function validatePage(input) {
  const html=String(input || '');
  if(!html.trim())throw new Error('Provide a nonempty HTML page.');
  if(html.length>60000)throw new Error('The page exceeds 60,000 characters. Reduce it; do not publish truncated code.');
  let script=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    const attrs=match[1],type=/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const mime=String(type?.[1] ?? type?.[2] ?? type?.[3] ?? '').toLowerCase();
    if(mime && !['module','text/javascript','application/javascript','text/ecmascript','application/ecmascript'].includes(mime))continue;
    if(/\bsrc\s*=/i.test(attrs) && !match[2].trim())continue;
    script++;
    try{parse(match[2],{ecmaVersion:'latest',sourceType:mime==='module'?'module':'script'});}
    catch(error){throw new Error(`Page JavaScript ${script} has a syntax error at line ${error.loc?.line || '?'}: ${error.message}. Repair the code and publish again.`);}
  }
  return html;
}
export {validatePage};
