/* Persistence for the owner's own connectors (see connectors.js). Supabase table
   custom_connectors, or the local store without Supabase. The credential lives in
   vault_secrets; a connector row keeps only its id and is deleted with it. */
const COLUMNS = 'id,kind,slug,name,url,description,config,secret_id,tools,disabled,status,last_error,checked_at,created_at';

function createCustomConnectorStore({ supa, loadLocal, saveLocal, ensureProfile, uid }) {
  const failure = (error, action) => {
    const missing = ['42P01', 'PGRST205'].includes(String(error?.code || '')) || /custom_connectors/.test(String(error?.message || '')) && /does not exist|schema cache/.test(String(error?.message || ''));
    console.warn('[store] custom connectors', action, 'failed:', error?.message);
    return Object.assign(new Error(missing ? 'Your own connectors are not set up on this server yet.' : `Your connectors could not be ${action}. Try again.`), { code: missing ? 'NOT_SET_UP' : 'PERSISTENCE' });
  };
  const view = (row) => row ? ({
    id: row.id, kind: row.kind, slug: row.slug, name: row.name, url: row.url, description: row.description || '',
    config: row.config && typeof row.config === 'object' ? row.config : {}, secretId: row.secret_id || null,
    tools: Array.isArray(row.tools) ? row.tools : [], disabled: Array.isArray(row.disabled) ? row.disabled.map(String) : [],
    status: row.status === 'error' ? 'error' : 'connected', lastError: row.last_error || '',
    checkedAt: row.checked_at ? new Date(row.checked_at).getTime() : null, at: new Date(row.created_at || Date.now()).getTime(),
  }) : null;
  const columns = (patch) => {
    const out = { updated_at: new Date().toISOString() };
    for (const [key, column] of [['name', 'name'], ['description', 'description'], ['config', 'config'], ['secretId', 'secret_id'], ['tools', 'tools'], ['disabled', 'disabled'], ['status', 'status'], ['lastError', 'last_error']]) {
      if (patch[key] !== undefined) out[column] = patch[key];
    }
    if (patch.checkedAt !== undefined) out.checked_at = patch.checkedAt ? new Date(patch.checkedAt).toISOString() : null;
    return out;
  };

  async function listCustomConnectors(userId) {
    const s = supa();
    if (s) {
      const { data, error } = await s.from('custom_connectors').select(COLUMNS).eq('user_id', userId).order('created_at', { ascending: true });
      if (error) throw failure(error, 'loaded');
      return (data || []).map(view);
    }
    return (loadLocal().customConnectors || []).filter((row) => row.user_id === userId).map(view);
  }
  async function addCustomConnector(userId, input) {
    const now = new Date().toISOString();
    const row = {
      id: 'con_' + uid(), user_id: userId, kind: input.kind, slug: input.slug, name: input.name, url: input.url,
      description: input.description || '', config: input.config || {}, secret_id: input.secretId || null,
      tools: input.tools || [], disabled: input.disabled || [], status: input.status || 'connected', last_error: input.lastError || '',
      checked_at: input.checkedAt ? new Date(input.checkedAt).toISOString() : null, created_at: now, updated_at: now,
    };
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      const { error } = await s.from('custom_connectors').insert(row);
      if (error) throw failure(error, 'saved');
      return view(row);
    }
    const d = loadLocal();
    d.customConnectors = [...(d.customConnectors || []), row];
    saveLocal(d);
    return view(row);
  }
  async function updateCustomConnector(userId, id, patch = {}) {
    const fields = columns(patch);
    const s = supa();
    if (s) {
      const { data, error } = await s.from('custom_connectors').update(fields).eq('id', id).eq('user_id', userId).select(COLUMNS).maybeSingle();
      if (error) throw failure(error, 'saved');
      if (!data) throw Object.assign(new Error('That connector was not found.'), { code: 'NOT_FOUND' });
      return view(data);
    }
    const d = loadLocal();
    const row = (d.customConnectors || []).find((item) => item.id === id && item.user_id === userId);
    if (!row) throw Object.assign(new Error('That connector was not found.'), { code: 'NOT_FOUND' });
    Object.assign(row, fields);
    saveLocal(d);
    return view(row);
  }
  async function deleteCustomConnector(userId, id) {
    const s = supa();
    if (s) {
      const { error } = await s.from('custom_connectors').delete().eq('id', id).eq('user_id', userId);
      if (error) throw failure(error, 'removed');
      return;
    }
    const d = loadLocal();
    d.customConnectors = (d.customConnectors || []).filter((item) => !(item.id === id && item.user_id === userId));
    saveLocal(d);
  }
  // Local stand-in for the table's ON DELETE CASCADE from vault_secrets.
  function dropConnectorsForSecret(d, userId, secretId) {
    d.customConnectors = (d.customConnectors || []).filter((item) => !(item.user_id === userId && item.secret_id === secretId));
  }
  return { listCustomConnectors, addCustomConnector, updateCustomConnector, deleteCustomConnector, dropConnectorsForSecret };
}

module.exports = { createCustomConnectorStore };
