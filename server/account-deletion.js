async function accountDeletionPending(owner, client) {
  if (!client) throw new Error('Account cleanup storage unavailable.');
  const {data,error} = await client.from('account_deletions').select('user_id').eq('user_id',String(owner)).maybeSingle();
  if (error) throw new Error('Account cleanup status unavailable.');
  return !!data;
}

async function eraseLibraryStorage(client, owner) {
  const bucket = client.storage.from('library-private'), root = encodeURIComponent(String(owner));
  let calls = 0;
  async function eraseFolder(prefix) {
    while(true) {
      if (++calls > 10000) throw new Error('Library cleanup needs another attempt.');
      const {data,error} = await bucket.list(prefix,{limit:100,sortBy:{column:'name',order:'asc'}});
      if(error || !Array.isArray(data)) throw new Error('Library cleanup unavailable.');
      if(!data.length)return;
      const files=[];
      for(const item of data) {
        if(!item.name || item.name.includes('/') || item.name.includes('\\') || item.name === '.' || item.name === '..') throw new Error('Unexpected Library storage path.');
        const path = prefix + '/' + item.name;
        if(item.id)files.push(path);else await eraseFolder(path);
      }
      if(files.length) { const {error:removeError} = await bucket.remove(files);if(removeError)throw new Error('Library cleanup did not finish.'); }
    }
  }
  await eraseFolder(root);
}
module.exports = { accountDeletionPending, eraseLibraryStorage };
