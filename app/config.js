/* Lingon frontend config — backend base URL (same origin by default).
   userId is the Supabase user id when signed in (set by auth.js). Null when
   signed out — there is no 'local'/demo identity; agent use requires auth. */
window.LingonConfig = {
  apiBase: '',
  userId: null,
};
try {
  const s = JSON.parse(localStorage.getItem('lingon.session') || 'null');
  if (s?.user?.id) window.LingonConfig.userId = s.user.id;
} catch {}
