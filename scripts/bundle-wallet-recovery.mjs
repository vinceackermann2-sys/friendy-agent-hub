// Dashboard deployments cannot always resolve source files outside the
// function folder. Generate a single entry point from the tested modules.
// The bundle contains source code only; credentials stay in Edge Secrets.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const modules=['wallet-purchases','whop-user-auth','personal-wallet','belna-wallet','belna-wallet-store'].map(name=>
  readFileSync(resolve(root,'src/lingon-server',name+'.js'),'utf8')
    .replace(/^import .* from '\.\/(wallet-purchases|whop-user-auth|personal-wallet)\.js';\r?\n/gm,'')
    .replace(/^export \{[^\n]+\};\r?\n?/gm,''));
const worker=readFileSync(resolve(root,'supabase/functions/wallet-card-recovery/index.ts'),'utf8')
  .replace(/^import .* from '\.\.\/\.\.\/\.\.\/src\/lingon-server\/[^']+';\r?\n/gm,'');
const output=resolve(root,'supabase/.temp/wallet-card-recovery/index.ts');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,modules.join('\n')+'\n'+worker);
console.log('Generated Supabase dashboard entry point: '+output);
