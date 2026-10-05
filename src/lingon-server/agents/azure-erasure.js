import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

// Only the account's dedicated VM/disk/NIC and hashed blob prefix are eligible.
// A manifest is saved before deletion, so a retry after VM removal still knows
// which detached OS disk to remove. Shared infrastructure is never a target.
function createAzureAccountErasure({ config, arm, userHash, vmNameForUser, storageAccountName, fetchImpl = (...args) => fetch(...args) }) {
  const computeApi = '2024-07-01', diskApi = '2024-03-02', networkApi = '2023-09-01', storageApi = '2023-05-01', blobApi = '2023-11-03';
  const fail = message => Object.assign(new Error(message), { code: 'ACCOUNT_ERASURE' });
  const missing = error => error.code === 'AZURE_NOT_FOUND';
  const root = cfg => `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}`;
  const paths = (cfg, owner) => {
    const name = vmNameForUser(owner), base = root(cfg);
    return { vm: `${base}/providers/Microsoft.Compute/virtualMachines/${name}`, nic: `${base}/providers/Microsoft.Network/networkInterfaces/${name}-nic`, diskPrefix: `${base}/providers/Microsoft.Compute/disks/${name}`.toLowerCase() };
  };
  function verifyVm(vm, owner, p) {
    if (vm.tags?.lingon !== 'sandbox' || vm.tags?.user !== userHash(owner)) throw fail('Workspace resource ownership could not be verified.');
    if (vm.properties?.storageProfile?.dataDisks?.length) throw fail('Unexpected workspace data disks require support cleanup.');
    const nics = vm.properties?.networkProfile?.networkInterfaces || [];
    if (nics.some(n => String(n.id).toLowerCase() !== p.nic.toLowerCase())) throw fail('Unexpected workspace network resources require support cleanup.');
  }
  function verifyDisks(ids, p) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.toLowerCase().startsWith(p.diskPrefix) || !/^[A-Za-z0-9_.-]+$/.test(id.slice(id.lastIndexOf('/') + 1)))) throw fail('Workspace disk ownership could not be verified.');
    return [...new Set(ids)];
  }
  async function plan(owner, previous = {}) {
    const cfg = config(), p = paths(cfg, owner);
    const ids = verifyDisks(previous.diskIds || [], p);
    let vm;
    try { vm = await arm(cfg, 'GET', p.vm, undefined, computeApi); } catch (error) { if (!missing(error)) throw error; }
    if (vm) {
      verifyVm(vm, owner, p);
      const disk = vm.properties?.storageProfile?.osDisk?.managedDisk?.id;
      if (disk) ids.push(disk);
    }
    return { diskIds: verifyDisks(ids, p) };
  }
  function containerSas(account, accountKey, container) {
    const st = new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const se = new Date(Date.now() + 15 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const signature = crypto.createHmac('sha256', Buffer.from(accountKey, 'base64')).update(['dl', st, se, `/blob/${account}/${container}`, '', '', 'https', blobApi, 'c', '', '', '', '', '', '', ''].join('\n')).digest('base64');
    return new URLSearchParams({sp:'dl',st,se,spr:'https',sv:blobApi,sr:'c',sig:signature});
  }
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {...options, signal:AbortSignal.timeout(20000), headers:{'x-ms-version':blobApi,...options.headers}});
    if (!response.ok && response.status !== 404) throw fail('Private workspace archive cleanup failed.');
    return response;
  }
  const parser = new XMLParser({parseTagValue:false, processEntities:true});
  async function list(base, sas, prefix, marker = '') {
    const query = new URLSearchParams(sas);
    for (const [key,value] of Object.entries({restype:'container',comp:'list',prefix,maxresults:'500',include:'versions,snapshots,deleted',...(marker?{marker}:{})})) query.set(key,value);
    const response = await request(base + '?' + query);
    if (response.status === 404) return {blobs:[],next:''};
    const xml = await response.text();
    if (xml.length > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('Unexpected private archive listing.');
    const result = parser.parse(xml)?.EnumerationResults;
    if (!result) throw fail('Private archive listing could not be verified.');
    const value = result.Blobs?.Blob;
    return {blobs:value ? (Array.isArray(value)?value:[value]) : [], next:result.NextMarker || ''};
  }
  async function removeBlobs(cfg, owner) {
    const account = storageAccountName(cfg);
    if (!/^[a-z0-9]{3,24}$/.test(account)) throw fail('Invalid private archive account.');
    const accountId = `${root(cfg)}/providers/Microsoft.Storage/storageAccounts/${account}`;
    let keys;
    try { keys = await arm(cfg, 'POST', `${accountId}/listKeys`, {}, storageApi); } catch(error) { if(missing(error))return; throw error; }
    const key = keys.keys?.find(k => k.value)?.value;
    if (!key) throw fail('Private archive deletion credentials unavailable.');
    const prefix = userHash(owner) + '/';
    for (const container of ['agent-state','browser-shots']) {
      const base = `https://${account}.blob.core.windows.net/${container}`, sas = containerSas(account,key,container);
      let marker = '', pages = 0;
      do {
        const page = await list(base,sas,prefix,marker);
        for (const blob of page.blobs) {
          if (typeof blob.Name !== 'string' || !blob.Name.startsWith(prefix)) throw fail('Private archive ownership could not be verified.');
          // Preserve the provider's retention settings. Retained soft-deleted
          // versions cause a pending result below, never a false success.
          if (String(blob.Deleted).toLowerCase() === 'true') continue;
          const query = new URLSearchParams(sas);
          if (blob.VersionId) query.set('versionid',blob.VersionId);
          if (blob.Snapshot) query.set('snapshot',blob.Snapshot);
          const name = blob.Name.split('/').map(encodeURIComponent).join('/');
          await request(base + '/' + name + '?' + query, {method:'DELETE',headers:blob.VersionId || blob.Snapshot ? {} : {'x-ms-delete-snapshots':'include'}});
        }
        marker = page.next;
        if (++pages > 1000) throw fail('Private archive cleanup needs another attempt.');
      } while(marker);
      if ((await list(base,sas,prefix)).blobs.length) throw fail('Private archives remain under provider retention. Retry deletion after retention expires or contact support.');
    }
  }
  async function erase(owner, manifest) {
    const cfg = config(), p = paths(cfg,owner), disks = verifyDisks(manifest?.diskIds || [],p);
    let vm;
    try { vm = await arm(cfg,'GET',p.vm,undefined,computeApi); } catch(error) { if(!missing(error))throw error; }
    if (vm) {
      verifyVm(vm,owner,p);
      const disk = vm.properties?.storageProfile?.osDisk?.managedDisk?.id;
      if (disk && !disks.some(id => id.toLowerCase() === disk.toLowerCase())) throw fail('Workspace changed; refresh the deletion manifest.');
      await arm(cfg,'POST',p.vm + '/deallocate',undefined,computeApi);
      await arm(cfg,'DELETE',p.vm,undefined,computeApi);
    }
    for (const id of disks) await arm(cfg,'DELETE',id,undefined,diskApi).catch(error => {if(!missing(error))throw error;});
    await arm(cfg,'DELETE',p.nic,undefined,networkApi).catch(error => {if(!missing(error))throw error;});
    await removeBlobs(cfg,owner);
    return {erased:true};
  }
  return {plan,erase};
}
export { createAzureAccountErasure };
