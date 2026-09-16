/* Lingon frontend config — backend base URL (same origin by default).
   userId is the Supabase user id when signed in (set by auth.js). */
window.LingonConfig = {
  apiBase: '',
  userId: 'local',
};
try {
  const s = JSON.parse(localStorage.getItem('lingon.session') || 'null');
  if (s?.user?.id) window.LingonConfig.userId = s.user.id;
} catch {}
