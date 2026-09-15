/* Lingon frontend config — backend base URL (same origin by default). */
window.LingonConfig = {
  apiBase: '',
  userId: null,
};
try {
  let uid = localStorage.getItem('lingon.userId');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('lingon.userId', uid);
  }
  window.LingonConfig.userId = uid;
} catch (e) {
  window.LingonConfig.userId = 'local';
}
