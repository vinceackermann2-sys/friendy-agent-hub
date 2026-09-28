// Read-only diagnostics for Belna's dedicated payment host. Does not print credentials.
import 'dotenv/config';
const e=process.env;
const auth=await fetch(`https://login.microsoftonline.com/${e.AZURE_TENANT_ID}/oauth2/v2.0/token`,{
  method:'POST',body:new URLSearchParams({client_id:e.AZURE_CLIENT_ID,client_secret:e.AZURE_CLIENT_SECRET,
    grant_type:'client_credentials',scope:'https://management.azure.com/.default'})});
if(!auth.ok)throw Error('Azure authentication unavailable');
const token=(await auth.json()).access_token;
const path=`https://management.azure.com/subscriptions/${e.AZURE_SUBSCRIPTION_ID}/resourceGroups/${e.AZURE_RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/belna-checkout/runCommand?api-version=2024-07-01`;
const repair=process.argv.includes('--repair-browser');
const script=`set +e
systemctl is-active belna-checkout caddy
df -h /opt/belna-checkout/chrome-cache
du -sh /opt/belna-checkout/chrome-cache 2>/dev/null
find /opt/belna-checkout/chrome-cache -maxdepth 4 -type f -name chrome -print
cd /opt/belna-checkout
${repair?`chrome_path=$(PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache node -e 'require("puppeteer").executablePath().then(console.log)')
echo "BROWSER_PATH:$chrome_path"
case "$chrome_path" in /opt/belna-checkout/chrome-cache/chrome/*/chrome-linux64/chrome) if [ ! -x "$chrome_path" ]; then rm -rf -- "$(dirname "$(dirname "$chrome_path")")"; fi ;; *) echo BROWSER_PATH_REJECTED; exit 1;; esac
PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache ./node_modules/.bin/puppeteer browsers install chrome 2>&1 | tail -c 2500
echo BROWSER_INSTALL_ATTEMPTED
`:''}
runuser -u belna-checkout -- env PUPPETEER_CACHE_DIR=/opt/belna-checkout/chrome-cache node - <<'NODE'
const p=require('puppeteer'),fs=require('fs');
const dir=fs.mkdtempSync('/run/belna-checkout-browsers/profile-');
p.launch({headless:true,pipe:true,userDataDir:dir,env:{HOME:'/run/belna-checkout-browsers',PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},args:['--enable-automation','--disable-breakpad','--disable-crash-reporter']}).then(async b=>{console.log('CHROME_OK');await b.close()}).catch(e=>console.log('CHROME_ERROR:'+String(e.message).slice(0,1000))).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
NODE
runuser -u belna-checkout -- sh -c 'curl --connect-timeout 2 --max-time 3 -sS -o /dev/null http://169.254.169.254/ >/dev/null 2>&1; if [ $? -eq 0 ]; then echo METADATA_REACHABLE; else echo METADATA_BLOCKED; fi'
runuser -u belna-checkout -- sh -c 'curl --connect-timeout 2 --max-time 3 -sS -o /dev/null http://127.0.0.1:8020/ >/dev/null 2>&1; if [ $? -eq 0 ]; then echo LOOPBACK_REACHABLE; else echo LOOPBACK_BLOCKED; fi'
`;
let response=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({commandId:'RunShellScript',script:[script]})});
let data=await response.json().catch(()=>({}));const poll=response.headers.get('location')||response.headers.get('azure-asyncoperation');
if(poll)for(let i=0;i<90;i++){
  await new Promise(r=>setTimeout(r,2000));response=await fetch(poll,{headers:{Authorization:'Bearer '+token}});
  data=await response.json().catch(()=>({}));if(response.status!==202&&!['InProgress','Running'].includes(data.status))break;
}
console.log(JSON.stringify({status:response.status,diagnostic:(data.value||[]).map(x=>({code:x.code,message:x.message})),error:data.error?.code||null}));
