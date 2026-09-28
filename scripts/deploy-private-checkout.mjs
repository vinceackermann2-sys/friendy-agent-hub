// Dedicated payment host. No Whop key or app/agent execution credential is sent.
import 'dotenv/config';
import {readFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const e=process.env,location=e.AZURE_LOCATION||'swedencentral',rg=e.AZURE_RESOURCE_GROUP,subscription=e.AZURE_SUBSCRIPTION_ID;
const name='belna-checkout',suffix=crypto.createHash('sha256').update(subscription+':'+rg).digest('hex').slice(0,10),label=name+'-'+suffix;
const origin=`https://${label}.${location}.cloudapp.azure.com`,base=`/subscriptions/${subscription}/resourceGroups/${rg}`,size=e.PRIVATE_CHECKOUT_VM_SIZE||'Standard_B2s_v2';
if(!process.argv.includes('--deploy')){console.log(JSON.stringify({host:name,origin,location,size,network:'Dedicated VNet; public TLS only; no SSH; UID egress firewall',credentials:'Dedicated token in Supabase Vault and the payment host; no Whop key',command:'node scripts/deploy-private-checkout.mjs --deploy'},null,2));process.exit(0);}
let bearer;
const fail=(code,status)=>Object.assign(Error('Private checkout deployment stopped.'),{code,status});
async function request(method,path,body,version='2023-09-01'){
 const url=path.startsWith('https:')?path:'https://management.azure.com'+path+'?api-version='+version;
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw fail(data.error?.code||'AZURE_HTTP',response.status);
 const pending=response.headers.get('azure-asyncoperation')||response.headers.get('location');
 if([201,202].includes(response.status)&&pending){for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,2000));const s=await request('GET',pending);if(s.status==='Succeeded')return s;if(['Failed','Canceled'].includes(s.status))throw fail(s.error?.code||'AZURE_OPERATION');}throw fail('AZURE_TIMEOUT');}
 return data;
}
async function ensure(path,body,version){
 const found=await fetch('https://management.azure.com'+path+'?api-version='+(version||'2023-09-01'),{headers:{Authorization:'Bearer '+bearer}});
 if(found.ok){const item=await found.json();if(item.tags?.belna!=='private-checkout')throw fail('RESOURCE_OWNERSHIP');if(path.includes('/virtualMachines/')&&item.properties?.provisioningState==='Failed'){await request('PATCH',path,{properties:{hardwareProfile:{vmSize:size}}},version);return request('GET',path,undefined,version);}return item;}
 if(found.status!==404)throw fail('AZURE_READ',found.status);await request('PUT',path,{...body,tags:{belna:'private-checkout'}},version);return request('GET',path,undefined,version);
}
try{
 const auth=await fetch(`https://login.microsoftonline.com/${e.AZURE_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({client_id:e.AZURE_CLIENT_ID,client_secret:e.AZURE_CLIENT_SECRET,grant_type:'client_credentials',scope:'https://management.azure.com/.default'})});
 if(!auth.ok)throw fail('AZURE_AUTH',auth.status);bearer=(await auth.json()).access_token;
 const net=base+'/providers/Microsoft.Network',nsg=await ensure(net+'/networkSecurityGroups/'+name,{location,properties:{securityRules:[{name:'TLS',properties:{priority:100,direction:'Inbound',access:'Allow',protocol:'Tcp',sourcePortRange:'*',destinationPortRanges:['80','443'],sourceAddressPrefix:'Internet',destinationAddressPrefix:'*'}},{name:'DenyOtherInbound',properties:{priority:200,direction:'Inbound',access:'Deny',protocol:'*',sourcePortRange:'*',destinationPortRange:'*',sourceAddressPrefix:'*',destinationAddressPrefix:'*'}}]}});
 console.log('Dedicated checkout network protection ready.');
 const vnet=await ensure(net+'/virtualNetworks/'+name,{location,properties:{addressSpace:{addressPrefixes:['10.40.0.0/16']},subnets:[{name:'payment',properties:{addressPrefix:'10.40.0.0/24',networkSecurityGroup:{id:nsg.id}}}]}});
 const ip=await ensure(net+'/publicIPAddresses/'+name,{location,sku:{name:'Standard'},properties:{publicIPAllocationMethod:'Static',publicIPAddressVersion:'IPv4',dnsSettings:{domainNameLabel:label}}});
 const nic=await ensure(net+'/networkInterfaces/'+name,{location,properties:{networkSecurityGroup:{id:nsg.id},ipConfigurations:[{name:'payment',properties:{privateIPAllocationMethod:'Dynamic',subnet:{id:vnet.id+'/subnets/payment'},publicIPAddress:{id:ip.id}}}]}});
 const jwk=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'jwk'}),pack=b=>{if(b[0]&128)b=Buffer.concat([Buffer.from([0]),b]);const n=Buffer.alloc(4);n.writeUInt32BE(b.length);return Buffer.concat([n,b]);};
 const publicKey='ssh-rsa '+Buffer.concat([pack(Buffer.from('ssh-rsa')),pack(Buffer.from(jwk.e,'base64url')),pack(Buffer.from(jwk.n,'base64url'))]).toString('base64');
 const vmPath=base+'/providers/Microsoft.Compute/virtualMachines/'+name;
 await ensure(vmPath,{location,properties:{hardwareProfile:{vmSize:size},storageProfile:{imageReference:{publisher:'Canonical',offer:'0001-com-ubuntu-server-jammy',sku:'22_04-lts-gen2',version:'latest'},osDisk:{createOption:'FromImage',managedDisk:{storageAccountType:'Standard_LRS'}}},osProfile:{computerName:name,adminUsername:'belna-admin',linuxConfiguration:{disablePasswordAuthentication:true,ssh:{publicKeys:[{path:'/home/belna-admin/.ssh/authorized_keys',keyData:publicKey}]}}},networkProfile:{networkInterfaces:[{id:nic.id}]}}},'2024-07-01');
 console.log('Dedicated checkout VM ready.');
 const db=createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY||e.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const old=await db.rpc('get_server_secret',{p_name:'private_checkout_token'});if(old.error)throw fail('TOKEN_STORE');const token=old.data||crypto.randomBytes(48).toString('base64url');
 if(!old.data){const saved=await db.rpc('put_server_secret',{p_name:'private_checkout_token',p_secret:token});if(saved.error)throw fail('TOKEN_STORE');}
 execFileSync(process.execPath,['scripts/bundle-private-checkout.mjs'],{stdio:'ignore'});const dir='supabase/.temp/private-checkout';
 mkdirSync('supabase/.temp',{recursive:true});execFileSync('tar',['-czf','supabase/.temp/private-checkout.tar.gz','-C',dir,'.']);const archive=readFileSync('supabase/.temp/private-checkout.tar.gz').toString('base64');
 const script=[
  'set -eu','export DEBIAN_FRONTEND=noninteractive','swapoff -a',
  'apt-get update -qq >/dev/null 2>&1',
  'apt-get install -y -qq curl ca-certificates gnupg unzip iptables libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libgtk-3-0 libx11-xcb1 libxcb1 libxcursor1 libxi6 libxtst6 libpango-1.0-0 libcairo2 libatspi2.0-0 libdbus-1-3 fonts-liberation >/dev/null 2>&1',
  'install -d -m 755 /etc/apt/keyrings',
  'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg',
  'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list',
  'curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/caddy.gpg',
  'echo "deb [signed-by=/etc/apt/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy.list',
  'apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq nodejs caddy >/dev/null 2>&1',
  'id -u belna-checkout >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/belna-checkout --shell /usr/sbin/nologin belna-checkout',
  'install -d -m 700 -o belna-checkout -g belna-checkout /var/lib/belna-checkout',
  'install -d -m 755 -o root -g root /opt/belna-checkout',
  `echo '${archive}' | base64 -d | tar -xzf - -C /opt/belna-checkout`,
  'cd /opt/belna-checkout && PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1',
  `cd /opt/belna-checkout; chrome_path=$(PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache node -e 'require("puppeteer").executablePath().then(console.log)'); case "$chrome_path" in /opt/belna-checkout/chrome-cache/chrome/*/chrome-linux64/chrome) if [ ! -x "$chrome_path" ]; then rm -rf -- "$(dirname "$(dirname "$chrome_path")")"; fi ;; *) exit 1;; esac`,
  'cd /opt/belna-checkout && PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache ./node_modules/.bin/puppeteer browsers install chrome >/dev/null 2>&1',
  `printf '%s' '${Buffer.from('PRIVATE_CHECKOUT_TOKEN='+token+'\n').toString('base64')}' | base64 -d > /etc/belna-checkout.env`,
  'chown root:root /etc/belna-checkout.env && chmod 600 /etc/belna-checkout.env',
  'install -d -m 755 /etc/opt/chrome/policies/managed',
  `printf '%s' '{"DownloadRestrictions":3,"PasswordManagerEnabled":false,"AutofillCreditCardEnabled":false,"ExtensionInstallBlocklist":["*"],"AllowFileSelectionDialogs":false,"PrintingEnabled":false}' > /etc/opt/chrome/policies/managed/belna.json`,
  'cp server/private-checkout/belna-checkout.service /etc/systemd/system/belna-checkout.service',
  `printf '%s\n' '${label}.${location}.cloudapp.azure.com {' '  reverse_proxy 127.0.0.1:8020' '}' > /etc/caddy/Caddyfile`,
  'systemctl daemon-reload && systemctl enable --now belna-checkout >/dev/null 2>&1 && systemctl restart caddy',
  `for attempt in $(seq 1 30); do curl -fsS -H 'Authorization: Bearer ${token}' http://127.0.0.1:8020/health >/dev/null 2>&1 && { echo BELNA_CHECKOUT_READY; exit 0; }; sleep 3; done`,
  'echo BELNA_CHECKOUT_NOT_READY; exit 1'
 ].join('\n');
 await request('POST',vmPath+'/runCommand',{commandId:'RunShellScript',script:[script]},'2024-07-01');
 // Never print Azure command content; it can contain server credentials.
 const health=await fetch(origin+'/health',{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token}});
 const report=await health.json().catch(()=>({}));
 const anonymous=await fetch(origin+'/health',{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!health.ok || report.ok!==true || report.protocol!==1 || report.browserSandbox!==true || anonymous.status!==401)throw fail('CHECKOUT_HEALTH');
 console.log(JSON.stringify({host:name,origin,installationCompleted:true,tls:true,browserSandbox:true,anonymousHttpStatus:anonymous.status,next:'Store the server token in Lovable; issuing remains disabled.'}));
}catch(error){console.error(JSON.stringify({error:error.code||'DEPLOYMENT_FAILED',status:error.status||null}));process.exitCode=1;}
