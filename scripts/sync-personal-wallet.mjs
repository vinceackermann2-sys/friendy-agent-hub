// These provider modules are identical in Node and the Lovable edge runtime.
import {readFileSync,writeFileSync} from 'node:fs';
for(const name of ['whop-user-auth','personal-wallet','belna-wallet','belna-wallet-store','wallet-purchases']){
  const source=readFileSync('server/'+name+'.js','utf8')
    .replace(/^const \{\s*([^}]+)\s*\}\s*=\s*require\('([^']+)'\);/gm,(_,symbols,path)=>`import {${symbols}} from '${path}.js';`)
    .replace(/module\.exports\s*=\s*\{([^}]+)\};?/g,(_,symbols)=>`export {${symbols}};`);
  writeFileSync('src/lingon-server/'+name+'.js',source);
}
