/* Raw token wallet shared by the Node and edge stores. The Supabase RPCs keep
   charges and daily claims atomic across workers; local JSON is dev-only. */
function createTokenWallet({ supa, loadLocal, saveLocal, ensureProfile, getSignupAt, uid, plans }) {
  const nowIso = () => new Date().toISOString();
  const todayUtc = () => nowIso().slice(0, 10);
  function freePeriod(signupAt, now = new Date()) {
    const signup = new Date(signupAt);
    if (!Number.isFinite(signup.getTime())) throw new Error('Signup date is required for the free token cycle.');
    const anchorDay = signup.getUTCDate();
    const atMonth = (offset) => {
      const first = new Date(Date.UTC(signup.getUTCFullYear(), signup.getUTCMonth() + offset, 1));
      const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchorDay, lastDay),
        signup.getUTCHours(), signup.getUTCMinutes(), signup.getUTCSeconds(), signup.getUTCMilliseconds()));
    };
    let months = (now.getUTCFullYear() - signup.getUTCFullYear()) * 12 + now.getUTCMonth() - signup.getUTCMonth();
    while (atMonth(months) > now) months--;
    while (atMonth(months + 1) <= now) months++;
    const start = atMonth(months), end = atMonth(months + 1);
    return { start: start.toISOString(), end: end.toISOString(), ref: `free:${start.toISOString()}` };
  }
  async function addTokenGrant(userId, tokens, reason, ref, expiresAt = null) {
    const amount = Number(tokens);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !ref) throw new Error('Invalid token grant.');
    const row = { id: 'tg_' + uid(), user_id: userId, tokens: amount, remaining: amount,
      reason, ref, expires_at: expiresAt };
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      const { data, error } = await s.from('token_grants').upsert(row,
        { onConflict: 'user_id,ref', ignoreDuplicates: true }).select('id').maybeSingle();
      if (error) throw error;
      return !!data;
    }
    const d = loadLocal();
    d.tokenGrants = d.tokenGrants || [];
    if (d.tokenGrants.some((g) => g.user_id === userId && g.ref === ref)) return false;
    d.tokenGrants.push(row); saveLocal(d); return true;
  }
  async function ensureMonthlyTokens(userId, plan, signupAt) {
    if (plan !== 'free') return null;
    const period = freePeriod(signupAt || await getSignupAt(userId));
    const s = supa();
    if (s) {
      await ensureProfile(userId);
      // Preserve spent tokens when moving an active calendar grant into the
      // signup-based cycle. The unique ref also makes repeat calls harmless.
      const { data: legacy, error } = await s.from('token_grants').select('id,ref')
        .eq('user_id', userId).eq('reason', 'plan').like('ref', 'free:_______')
        .gt('expires_at', nowIso()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (legacy) {
        const { data: existing, error: existingError } = await s.from('token_grants').select('id')
          .eq('user_id', userId).eq('ref', period.ref).maybeSingle();
        if (existingError) throw existingError;
        const fields = existing ? { expires_at: nowIso() } : { ref: period.ref, expires_at: period.end };
        const { error: updateError } = await s.from('token_grants').update(fields)
          .eq('id', legacy.id).eq('user_id', userId);
        if (updateError) throw updateError;
      }
    } else {
      const d = loadLocal();
      const legacy = (d.tokenGrants || []).find(g => g.user_id === userId && g.reason === 'plan'
        && /^free:\d{4}-\d{2}$/.test(g.ref) && new Date(g.expires_at).getTime() > Date.now());
      if (legacy) {
        if ((d.tokenGrants || []).some(g => g.user_id === userId && g.ref === period.ref)) legacy.expires_at = nowIso();
        else { legacy.ref = period.ref; legacy.expires_at = period.end; }
        saveLocal(d);
      }
    }
    await addTokenGrant(userId, plans.free.tokens, 'plan', period.ref, period.end);
    return period;
  }
  async function retireFreeTokensOnUpgrade(userId) {
    const s = supa();
    const expiry = nowIso();
    if (s) {
      const { error } = await s.from('token_grants').update({ expires_at: expiry })
        .eq('user_id', userId).eq('reason', 'plan').like('ref', 'free:%').gt('expires_at', expiry);
      if (error) throw error;
    } else {
      const d = loadLocal();
      let changed = false;
      for (const grant of d.tokenGrants || []) {
        if (grant.user_id === userId && grant.reason === 'plan' && grant.ref.startsWith('free:')
          && new Date(grant.expires_at).getTime() > Date.now()) {
          grant.expires_at = expiry; changed = true;
        }
      }
      if (changed) saveLocal(d);
    }
  }
  async function tokenWallet(userId, plan, periodEnd = null) {
    const freeCycle = await ensureMonthlyTokens(userId, plan);
    if (plan !== 'free') await retireFreeTokensOnUpgrade(userId);
    const s = supa();
    let totals;
    if (s) {
      const { data, error } = await s.rpc('token_wallet_status', { p_user_id: userId });
      if (error) throw error;
      totals = Array.isArray(data) ? data[0] : data;
    } else {
      const d = loadLocal(); const now = Date.now();
      const rows = (d.tokenGrants || []).filter((g) => g.user_id === userId
        && (!g.expires_at || new Date(g.expires_at).getTime() > now));
      const sum = (subset, field) => subset.reduce((n, r) => n + (field === 'used'
        ? Number(r.tokens) - Number(r.remaining) : Number(r[field] || 0)), 0);
      const p = rows.filter((r) => r.reason === 'plan'), packs = rows.filter((r) => r.reason !== 'plan');
      const claims = (d.tokenDailyClaims || []).filter((r) => r.user_id === userId && r.day === todayUtc());
      const debt = Number((d.tokenDebts || {})[userId] || 0);
      totals = { granted: sum(rows,'tokens'), used: sum(rows,'used'),
        remaining: Math.max(0, sum(rows,'remaining') - debt),
        plan_granted: sum(p,'tokens'), plan_used: sum(p,'used'),
        pack_granted: sum(packs,'tokens'), pack_used: sum(packs,'used'), debt,
        images_today: claims.filter((r) => r.kind === 'image').length,
        transcriptions_today: claims.filter((r) => r.kind === 'transcription').length };
    }
    const tier = plans[plan] || plans.free;
    return {
      granted: Number(totals?.granted || 0), used: Number(totals?.used || 0),
      remaining: Number(totals?.remaining || 0),
      planGranted: Number(totals?.plan_granted || 0), planUsed: Number(totals?.plan_used || 0),
      packGranted: Number(totals?.pack_granted || 0), packUsed: Number(totals?.pack_used || 0),
      debt: Number(totals?.debt || 0),
      imagesToday: Number(totals?.images_today || 0), transcriptionsToday: Number(totals?.transcriptions_today || 0),
      imagesPerDay: tier.imagesPerDay, transcriptionsPerDay: tier.transcriptionsPerDay,
      resetAt: plan === 'free' ? freeCycle.end : periodEnd || null,
    };
  }
  async function claimTokenDaily(userId, kind, limit) {
    if (!['image','transcription'].includes(kind)) throw new Error('Invalid daily limit kind.');
    const id = 'tc_' + uid();
    const s = supa();
    if (s) {
      const { data, error } = await s.rpc('claim_token_daily', {
        p_user_id: userId, p_kind: kind, p_limit: limit, p_claim_id: id,
      });
      if (error) throw error;
      return data ? id : null;
    }
    const d = loadLocal(); d.tokenDailyClaims = d.tokenDailyClaims || [];
    const count = d.tokenDailyClaims.filter((r) => r.user_id === userId && r.kind === kind && r.day === todayUtc()).length;
    if (count >= limit) return null;
    d.tokenDailyClaims.push({ id, user_id: userId, kind, day: todayUtc(), finalized: false });
    saveLocal(d); return id;
  }
  async function releaseTokenDaily(userId, claimId) {
    if (!claimId) return;
    const s = supa();
    if (s) {
      const { error } = await s.rpc('release_token_daily', { p_user_id: userId, p_claim_id: claimId });
      if (error) throw error;
      return;
    }
    const d = loadLocal();
    d.tokenDailyClaims = (d.tokenDailyClaims || []).filter((r) => r.id !== claimId || r.user_id !== userId || r.finalized);
    saveLocal(d);
  }
  async function chargeRawTokens(userId, { model, usage, cost = 0, usageEstimated = false, claimId = null, id = null }) {
    usageEstimated = usageEstimated || !!usage?.estimated;
    const input = Math.max(0, Number(usage?.promptTokenCount ?? usage?.input_tokens ?? 0) || 0);
    const output = Math.max(0, Number(usage?.candidatesTokenCount ?? usage?.output_tokens ?? 0) || 0);
    const total = Math.max(input + output, Number(usage?.totalTokenCount ?? usage?.total_tokens ?? 0) || 0);
    const tokenCount = Math.ceil(total);
    if (!Number.isSafeInteger(tokenCount) || tokenCount > 1_000_000_000 || (!tokenCount && Number(cost) > 0)) {
      throw Object.assign(new Error('Provider did not return billable token usage.'), { code: 'USAGE_MISSING' });
    }
    const usageId = id || 'use_' + uid();
    const s = supa();
    if (s) {
      const { data, error } = await s.rpc('charge_raw_tokens', {
        p_usage_id: usageId, p_user_id: userId, p_model: model || 'gpt-6-luna',
        p_input: Math.ceil(input), p_output: Math.ceil(output), p_total: tokenCount,
        p_cost_usd: Number(cost || 0), p_estimated: !!usageEstimated, p_claim_id: claimId,
      });
      if (error) throw error;
      return { id: usageId, tokens_charged: tokenCount, remaining: Number(data || 0) };
    }
    const d = loadLocal(); d.usage = d.usage || [];
    if (d.usage.some((r) => r.id === usageId)) return d.usage.find((r) => r.id === usageId);
    d.tokenGrants = d.tokenGrants || []; d.tokenDebts = d.tokenDebts || {};
    let needed = tokenCount + Number(d.tokenDebts[userId] || 0);
    const now = Date.now();
    const grants = d.tokenGrants.filter((r) => r.user_id === userId && r.remaining > 0
      && (!r.expires_at || new Date(r.expires_at).getTime() > now))
      .sort((a,b) => (a.expires_at || '9999').localeCompare(b.expires_at || '9999')
        || a.created_at?.localeCompare(b.created_at || '') || a.id.localeCompare(b.id));
    for (const grant of grants) {
      const take = Math.min(grant.remaining, needed);
      grant.remaining -= take; needed -= take;
      if (!needed) break;
    }
    d.tokenDebts[userId] = needed;
    const row = { id: usageId, user_id: userId, model, prompt_tokens: input,
      candidates_tokens: output, total_tokens: tokenCount, cost_usd: Number(cost || 0),
      credits_charged: 0, tokens_charged: tokenCount, token_usage_estimated: !!usageEstimated };
    d.usage.push(row);
    if (claimId) {
      const claim = (d.tokenDailyClaims || []).find((r) => r.id === claimId && r.user_id === userId);
      if (claim) claim.finalized = true;
    }
    saveLocal(d); return row;
  }
  return { addTokenGrant, ensureMonthlyTokens, tokenWallet, claimTokenDaily, releaseTokenDaily, chargeRawTokens, freePeriod };
}

module.exports = { createTokenWallet };
