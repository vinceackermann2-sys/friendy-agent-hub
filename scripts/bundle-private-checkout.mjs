import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
const root=process.cwd(),target=join(root,'supabase/.temp/private-checkout');
const files=['server/private-checkout/index.js','server/private-checkout/runtime.js','server/private-checkout/network-guard.sh','server/private-checkout/belna-checkout.service','server/agents/azure-vm.js','server/agents/sandbox.js','server/harness.js'];
for(const file of files){mkdirSync(dirname(join(target,file)),{recursive:true});writeFileSync(join(target,file),readFileSync(join(root,file),'utf8').replace(/\r\n/g,'\n'));}
const versions=JSON.parse(readFileSync(join(root,'package.json'))).dependencies;
writeFileSync(join(target,'package.json'),JSON.stringify({name:'belna-private-checkout',private:true,type:'commonjs',dependencies:{express:versions.express,puppeteer:versions.puppeteer}},null,2));
console.log('Private checkout deployment source prepared; no environment files or credentials included.');
