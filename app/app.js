/* ============ Lingon — personal agent app ============ */
(() => {
'use strict';

/* ---------------- utils ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
const fmtWhen = ts => {
  const d = Date.now() - ts;
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h';
  return new Date(ts).toLocaleDateString();
};
const fmtAgo = ts => {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
  if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { day:'numeric', month:'short' });
};
const fmtNext = ts => {
  const d = Number(ts) - Date.now();
  if (d <= 60e3) return 'in under 1m';
  if (d < 3600e3) return `in ${Math.ceil(d / 60e3)}m`;
  if (d < 86400e3) return `in ${Math.ceil(d / 3600e3)}h`;
  return `on ${new Date(ts).toLocaleDateString()}`;
};
async function copyText(text){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(String(text || ''));
  const t = document.createElement('textarea');
  t.value = String(text || ''); t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } finally { t.remove(); }
}

/* ---------------- icons ---------------- */
const IC = {
  plus:'<path d="M12 5v14M5 12h14"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  mic:'<path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9Z"/>',
  websearch:'<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c1.8 1.8 2.8 3.9 2.8 6.5s-1 4.7-2.8 6.5c-1.8-1.8-2.8-3.9-2.8-6.5s1-4.7 2.8-6.5Z"/><circle cx="17.2" cy="17.2" r="3.1"/><path d="M19.6 19.6 22 22"/>',
  term:'<path d="M4 17l6-5-6-5M12 19h8"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield:'<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/>',
  shieldcheck:'<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
  spark:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 21v-8"/>',
  chart:'<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>',
  code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z"/>',
  wallet:'<path d="M20 7H4a2 2 0 0 1 0-4h14v4"/><path d="M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5"/><circle cx="17" cy="14" r="1.2"/>',
  laptop:'<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M2 20h20"/>',
  brief:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  git:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6M18 9a9 9 0 0 1-9 9"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  x:'<path d="M18 6L6 18M6 6l12 12"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  down:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
  dice:'<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  aur:'<path d="M7 17L17 7M7 7h10v10"/>',
  panel:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  board:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-5-5-9 9"/>',
  easel:'<path d="M12 3V1M5 4h14l2 13H3L5 4Z"/><path d="M8 17l-2 6M16 17l2 6M8 9h8M7 13h10"/>',
  left:'<path d="M19 12H5M12 19l-7-7 7-7"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  key:'<circle cx="7.5" cy="15.5" r="4"/><path d="M11 12L21 2M18 5l3 3"/>',
  star:'<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  refresh:'<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 15-3.5L23 10M20.5 15a9 9 0 0 1-15 3.5L1 14"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  more:'<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  alert:'<path d="M10.3 3.8L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  issue:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 17h.01"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.1.9-1.7 1.3-1.7 2.7M12 17h.01"/>',
  chatb:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share:'<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  chev:'<path d="M6 9l6 6 6-6"/>',
  attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/>',
  folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2-2Z"/>',
  pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  card:'<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-5-5-9 9"/>',
  video:'<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  audio:'<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  podcast:'<path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>',
  doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  web:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9Z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  play:'<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5Z" fill="currentColor" stroke="none"/>',
  library:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M9 7h7M9 11h5"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0 0 17.5 4c-1.8 0-3 .5-4 2-.5 1-1 1.5-1.5 2-.5-.5-1-1-1.5-2-1-1.5-2.2-2-4-2A4.5 4.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2.5 2 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.5-2 4-4 4"/>',
  users:'<path d="M16 21v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 19.5V21"/><circle cx="10" cy="8.5" r="3.5"/><path d="M20 21v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/>',
  dollar:'<path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.8 7 7s2 3 5 3.8 5 1.7 5 4.2-2.2 3.5-5 3.5-5-1.1-5-3"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.1.9-1.7 2-1.7h2.3A3.9 3.9 0 0 0 21 10.6C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7" r="1" fill="currentColor"/>',
  checksq:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.8 2.8L16 10"/>',
  game:'<path d="M6.5 8h11A4.5 4.5 0 0 1 22 12.5v1a3.5 3.5 0 0 1-6.3 2.1L14.5 14h-5l-1.2 1.6A3.5 3.5 0 0 1 2 13.5v-1A4.5 4.5 0 0 1 6.5 8Z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".9" fill="currentColor" stroke="none"/><circle cx="18" cy="13.5" r=".9" fill="currentColor" stroke="none"/>',
  clipboard:'<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6M9 18h4"/>',
  calc:'<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="8" y="5" width="8" height="4" rx="1"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3v3H8Z"/>',
  slides:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8M7 12l3-3 2 2 4-4"/>',
  map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
};
const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

/* ---------------- file attachments (pending per promptbox) ---------------- */
const pendingFilesByForm = new Map();
const MAX_ATTACH = 5;
const MAX_FILE_MB = 8;
const MAX_ATTACH_TOTAL_MB = 8;
const MAX_PREVIEW_MB = 4;
function attachmentKind(file){
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const ext = name.split('.').pop();
  if (ext === 'gsheet' || type === 'application/vnd.google-apps.spreadsheet') return 'sheets';
  if (['xls','xlsx','xlsm','xlsb'].includes(ext) || type.includes('spreadsheetml.sheet') || type === 'application/vnd.ms-excel') return 'excel';
  if (ext === 'gdoc' || type === 'application/vnd.google-apps.document') return 'docs';
  if (['doc','docx'].includes(ext) || type.includes('wordprocessingml.document') || type === 'application/msword') return 'word';
  if (ext === 'gslides' || type === 'application/vnd.google-apps.presentation') return 'slides';
  if (['ppt','pptx'].includes(ext) || type.includes('presentationml.presentation') || type === 'application/vnd.ms-powerpoint') return 'powerpoint';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','svg'].includes(ext)) return 'image';
  if (type.startsWith('video/') || ['mp4','mov','webm','mkv','avi'].includes(ext)) return 'video';
  if (type.startsWith('audio/') || ['mp3','wav','m4a','ogg','flac'].includes(ext)) return 'audio';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'archive';
  if (['csv','tsv'].includes(ext)) return 'spreadsheet';
  if (type.startsWith('text/') || ['txt','md','rtf'].includes(ext)) return 'text';
  return 'file';
}
function attachmentIcon(file){
  const kind = attachmentKind(file);
  const extension = String(file.name || '').split('.').pop().toUpperCase();
  const label = kind === 'video' ? (extension.length <= 5 ? extension : 'VIDEO') :
    kind === 'image' ? (extension.length <= 5 ? extension : 'IMAGE') :
    ({ excel:'X', sheets:'', word:'W', docs:'', powerpoint:'P', slides:'', pdf:'PDF', audio:'AUDIO', archive:'ZIP', spreadsheet:'CSV', text:'TXT', file:'FILE' })[kind];
  const colors = { excel:'#107c41', sheets:'#0f9d58', word:'#185abd', docs:'#4285f4', powerpoint:'#c43e1c', slides:'#f4b400', pdf:'#e53736', image:'#2e8fa3', video:'#6650b8', audio:'#8a58ad', archive:'#bd8723', spreadsheet:'#168469', text:'#5c7188', file:'#687487' };
  const color = colors[kind];
  const glyph = kind === 'sheets' || kind === 'spreadsheet' || kind === 'excel'
    ? '<path d="M28 29h28v26H28zM28 37h28M28 46h28M38 29v26M47 29v26" fill="none" stroke="white" stroke-width="3"/>'
    : kind === 'docs' || kind === 'word' || kind === 'text'
      ? '<path d="M29 31h25M29 39h25M29 47h19M29 55h15" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>'
      : kind === 'slides' || kind === 'powerpoint'
        ? '<rect x="28" y="30" width="28" height="22" rx="2" fill="none" stroke="white" stroke-width="3"/><path d="M42 52v7M35 59h14" fill="none" stroke="white" stroke-width="3"/>'
        : kind === 'image'
          ? '<rect x="27" y="30" width="30" height="24" rx="2" fill="none" stroke="white" stroke-width="3"/><circle cx="36" cy="37" r="3" fill="white"/><path d="m29 51 9-9 7 6 5-5 6 8" fill="none" stroke="white" stroke-width="3"/>'
        : kind === 'video'
          ? '<rect x="27" y="29" width="30" height="27" rx="3" fill="none" stroke="white" stroke-width="3"/><path d="m39 36 11 7-11 7z" fill="white"/>'
          : kind === 'audio'
            ? '<path d="M43 29v23a6 6 0 1 1-4-5.7V34l15-4v18a6 6 0 1 1-4-5.7V27z" fill="white"/>'
            : kind === 'archive'
              ? '<path d="M35 29h14v27H35zM42 29v16M38 33h8M38 39h8M38 45h8" fill="none" stroke="white" stroke-width="3"/>'
              : kind === 'pdf'
                ? '<path d="M32 52c11-14 14-26 11-26-5 0-2 20 3 25 4 4 12 3 12 0 0-4-13-3-29 3" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>'
                : '<path d="M32 35h19M32 43h19M32 51h13" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>';
  return `<svg class="file-format-icon" viewBox="0 0 84 84" role="img" aria-label="${esc(kind)} file"><path d="M20 11h31l13 13v47a5 5 0 0 1-5 5H20a5 5 0 0 1-5-5V16a5 5 0 0 1 5-5z" fill="${color}"/><path d="M51 11v13h13" fill="rgba(255,255,255,.3)"/><path d="M51 11v13h13" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>${glyph}${label ? `<rect x="8" y="49" width="${Math.max(30, Math.min(68, label.length * 9 + 14))}" height="19" rx="4" fill="white"/><text x="14" y="62" fill="${color}" font-size="${label.length > 4 ? 10 : 13}" font-weight="800" font-family="Arial, sans-serif">${esc(label)}</text>` : ''}</svg>`;
}
function attachmentPreview(file){
  const kind = attachmentKind(file);
  const iconHtml = `<span class="file-format">${attachmentIcon(file)}</span>`;
  if (!file.previewUrl) return iconHtml;
  const media = kind === 'video'
    ? `<video src="${esc(file.previewUrl)}" muted playsinline preload="metadata" aria-label="Preview of ${esc(file.name)}"></video><span class="attach-play">${icon('play',19)}</span>`
    : `<img src="${esc(file.previewUrl)}" alt="Preview of ${esc(file.name)}">`;
  return `${media}${iconHtml}`;
}
function releasePreview(file){ if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl); }
function storedFile(mode, action){
  return new Promise((resolve, reject) => {
    if (!window.indexedDB){ reject(new Error('Browser file storage is unavailable.')); return; }
    const open = indexedDB.open('belna-composer-files', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error || new Error('Could not open browser file storage.'));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('files', mode);
      const request = action(transaction.objectStore('files'));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not store the file.')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('File storage was interrupted.')); };
    };
  });
}
function hydrateStoredFiles(){
  const files = [
    ...(Array.isArray(state.pendingPromptFiles) ? state.pendingPromptFiles : []),
    ...(state.chats || []).flatMap(c => (c.messages || []).flatMap(m => m.files || [])),
  ];
  return Promise.all(files.filter(f => f.storageId && !f.dataUrl).map(async f => {
    try { f.dataUrl = await storedFile('readonly', store => store.get(f.storageId)) || ''; }
    catch { f.dataUrl = ''; }
  }));
}
function fileBucketKey(form){ return form?.id === 'cform' ? `cform:${state.activeChat || ''}` : form?.id || ''; }
function filesFor(form){ return pendingFilesByForm.get(fileBucketKey(form)) || []; }
function readyFiles(form){
  const files = filesFor(form);
  if (files.some(f => f.loading)) { toast('Wait for the files to finish loading.'); return null; }
  return files.map(({ name, size, type, dataUrl, storageId }) => ({ name, size, type, dataUrl, storageId }));
}
function addFiles(fileList, form){
  const key = fileBucketKey(form);
  if (!key) return;
  if (!pendingFilesByForm.has(key)) pendingFilesByForm.set(key, []);
  const pendingFiles = pendingFilesByForm.get(key);
  for (const f of fileList){
    if (pendingFiles.length >= MAX_ATTACH){ toast(`Max ${MAX_ATTACH} files`); break; }
    if (f.size > MAX_FILE_MB * 1024 * 1024){ toast(`${f.name} exceeds ${MAX_FILE_MB} MB`); continue; }
    if (pendingFiles.reduce((total, file) => total + file.size, 0) + f.size > MAX_ATTACH_TOTAL_MB * 1024 * 1024){ toast(`Attachments can total up to ${MAX_ATTACH_TOTAL_MB} MB.`); continue; }
    if (pendingFiles.some(p => p.name === f.name && p.size === f.size)) continue;
    const item = { name:f.name, size:f.size, type:f.type, dataUrl:null, storageId:uid(), loading:true };
    if (f.size <= MAX_PREVIEW_MB * 1024 * 1024 && ['image','video'].includes(attachmentKind(f))) {
      try { item.previewUrl = URL.createObjectURL(f); } catch {}
    }
    pendingFiles.push(item);
    paintAttachPills();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!pendingFiles.includes(item)) return;
        const dataUrl = String(reader.result || '');
        await storedFile('readwrite', store => store.put(dataUrl, item.storageId));
        if (!pendingFiles.includes(item)) { void storedFile('readwrite', store => store.delete(item.storageId)).catch(() => {}); return; }
        item.dataUrl = dataUrl;
        item.loading = false;
        paintAttachPills();
      } catch {
        const index = pendingFiles.indexOf(item);
        if (index !== -1) pendingFiles.splice(index, 1);
        releasePreview(item);
        paintAttachPills();
        toast(`Could not store ${f.name} in this browser.`);
      }
    };
    reader.onerror = () => {
      const index = pendingFiles.indexOf(item);
      if (index !== -1) pendingFiles.splice(index, 1);
      releasePreview(item);
      paintAttachPills();
      toast(`Could not read ${f.name}.`);
    };
    reader.readAsDataURL(f);
  }
}
function removeFile(idx, form){
  const [file] = filesFor(form).splice(idx, 1);
  releasePreview(file);
  if (file?.storageId) void storedFile('readwrite', store => store.delete(file.storageId)).catch(() => {});
  paintAttachPills();
}
function clearFiles(form){ filesFor(form).forEach(releasePreview); pendingFilesByForm.delete(fileBucketKey(form)); paintAttachPills(); }
function paintAttachPills(){
  document.querySelectorAll('.attach-pills').forEach(el => {
    const pendingFiles = filesFor(el.closest('form'));
    if (!pendingFiles.length){ el.innerHTML = ''; return; }
    el.innerHTML = pendingFiles.map((f, i) =>
      `<span class="attach-pill attach-card${f.loading ? ' loading' : ''}${f.previewUrl ? ' has-preview' : ''}" title="${esc(f.name)} · ${fmtBytes(f.size)}"><span class="attach-visual">${attachmentPreview(f)}</span><span class="ap-name">${esc(f.name)}</span><button type="button" class="ap-x" data-act="rmfile" data-idx="${i}" aria-label="Remove ${esc(f.name)}">${icon('x',12)}</button></span>`
    ).join('');
    el.querySelectorAll('.attach-card img,.attach-card video').forEach(media => media.addEventListener('error', () => media.closest('.attach-card')?.classList.add('preview-failed')));
  });
  syncComposerActions(chat());
}
function resizePrompt(textarea){
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  textarea.style.overflowY = textarea.scrollHeight > 180 ? 'auto' : 'hidden';
}
function wirePromptBox(form, textarea){
  if (!form || !textarea) return;
  textarea.addEventListener('input', () => resizePrompt(textarea));
  resizePrompt(textarea);
  // Hidden file input
  let fileInput = form.querySelector('input[type="file"]');
  if (!fileInput){
    fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';
    fileInput.className = 'attach-input';
    form.appendChild(fileInput);
  }
  fileInput.onchange = () => { if (fileInput.files.length) addFiles(fileInput.files, form); fileInput.value = ''; };
  // Plus button triggers file picker
  const plus = form.querySelector('.iconbtn[data-act="attach"]');
  if (plus) plus.onclick = e => { e.preventDefault(); fileInput.click(); };
  // Drag & drop on the entire promptbox
  const box = form.closest('.promptbox') || form;
  const hasDraggedFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  let dragDepth = 0;
  box.addEventListener('dragenter', e => { if (!hasDraggedFiles(e)) return; e.preventDefault(); dragDepth++; box.classList.add('dragover'); });
  box.addEventListener('dragover', e => { if (!hasDraggedFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  box.addEventListener('dragleave', e => { if (!hasDraggedFiles(e)) return; e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) box.classList.remove('dragover'); });
  box.addEventListener('drop', e => { if (!hasDraggedFiles(e)) return; e.preventDefault(); dragDepth = 0; box.classList.remove('dragover'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, form); });
  // Paste files from clipboard
  textarea.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items){ if (it.kind === 'file'){ const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) addFiles(files, form);
  });
}

const voiceIn = { rec:null, stream:null, chunks:[], on:false, busy:false, timer:null };
function joinSpoken(base, spoken){
  const a = String(base || '');
  const b = String(spoken || '').replace(/\s+/g, ' ').trim();
  if (!b) return a;
  if (!a) return b;
  return /[\s\n]$/.test(a) ? a + b : a + ' ' + b;
}
function applyPromptText(text){
  const ta = $('#cprompt');
  if (!ta) return;
  ta.value = text;
  resizePrompt(ta);
  ta.dispatchEvent(new Event('input', { bubbles:true }));
}
function syncVoiceButton(){
  const btn = $('#cvoice');
  if (!btn) return;
  btn.classList.toggle('on', !!voiceIn.on);
  btn.classList.toggle('busy', !!voiceIn.busy);
  btn.disabled = !!voiceIn.busy;
  const label = voiceIn.busy ? 'Transcribing…' : voiceIn.on ? 'Stop voice' : 'Speak prompt';
  btn.title = label;
  btn.setAttribute('aria-pressed', voiceIn.on ? 'true' : 'false');
  btn.setAttribute('aria-busy', voiceIn.busy ? 'true' : 'false');
  btn.setAttribute('aria-label', voiceIn.busy ? 'Transcribing speech' : voiceIn.on ? 'Stop voice input' : 'Speak your prompt');
}
function voiceMime(){
  const types = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
  for (const t of types){
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t; } catch {}
  }
  return '';
}
function stopVoiceTracks(){
  (voiceIn.stream && voiceIn.stream.getTracks() || []).forEach(t => { try { t.stop(); } catch {} });
  voiceIn.stream = null;
}
function stopVoice(){
  voiceIn.on = false;
  if (voiceIn.timer){ clearTimeout(voiceIn.timer); voiceIn.timer = null; }
  const rec = voiceIn.rec;
  voiceIn.rec = null;
  voiceIn.chunks = [];
  if (rec && rec.state !== 'inactive'){
    rec.ondataavailable = null;
    rec.onstop = null;
    rec.onerror = null;
    try { rec.stop(); } catch {}
  }
  stopVoiceTracks();
  if (!voiceIn.busy) syncVoiceButton();
}
function blobToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Couldn’t read recording.'));
    r.readAsDataURL(blob);
  });
}
async function startVoice(){
  if (voiceIn.busy || voiceIn.on) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){
    toast('Voice input isn’t available in this browser.'); return;
  }
  if (!window.isSecureContext){ toast('Voice input needs a secure connection.'); return; }
  if (!signedIn()){ toast('Sign in to use voice input.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = voiceMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    voiceIn.chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) voiceIn.chunks.push(e.data); };
    rec.onerror = () => { toast('Microphone error.'); stopVoice(); };
    voiceIn.rec = rec;
    voiceIn.stream = stream;
    voiceIn.on = true;
    try { rec.start(250); } catch { rec.start(); }
    voiceIn.timer = setTimeout(() => { if (voiceIn.on) finishVoice(); }, 60000);
    syncVoiceButton();
  } catch (e) {
    stopVoice();
    toast(e && e.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Couldn’t start the microphone.');
  }
}
async function finishVoice(){
  if (voiceIn.busy) return;
  const rec = voiceIn.rec;
  if (!rec){ stopVoice(); return; }
  voiceIn.on = false;
  if (voiceIn.timer){ clearTimeout(voiceIn.timer); voiceIn.timer = null; }
  const mime = rec.mimeType || 'audio/webm';
  const blob = await new Promise(resolve => {
    rec.onstop = () => resolve(new Blob(voiceIn.chunks, { type: mime }));
    try { if (rec.state !== 'inactive') rec.stop(); else resolve(new Blob(voiceIn.chunks, { type: mime })); }
    catch { resolve(new Blob(voiceIn.chunks, { type: mime })); }
  });
  voiceIn.rec = null;
  voiceIn.chunks = [];
  stopVoiceTracks();
  if (!blob.size){ syncVoiceButton(); toast('No speech captured.'); return; }
  voiceIn.busy = true;
  syncVoiceButton();
  try {
    const audio = await blobToDataUrl(blob);
    const j = await window.LingonAuth.api('/api/voice/transcribe', { method:'POST', body: JSON.stringify({ audio, mime: blob.type || mime }) });
    const spoken = String(j.text || '').trim();
    if (!spoken) toast('Couldn’t hear that. Try again.');
    else applyPromptText(joinSpoken((($('#cprompt') || {}).value || ''), spoken));
  } catch (e) {
    toast(e.message || 'Couldn’t transcribe that.');
  } finally {
    voiceIn.busy = false;
    syncVoiceButton();
  }
}
function toggleVoice(){ if (voiceIn.busy) return; if (voiceIn.on) finishVoice(); else startVoice(); }

/* ---------------- markdown-lite ---------------- */
function md(src){
  const s = esc(src)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return s.split(/\n{2,}/).map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*[-•]\s*/.test(l)))
      return '<ul>' + lines.map(l => '<li>' + l.replace(/^\s*[-•]\s*/, '') + '</li>').join('') + '</ul>';
    return '<p>' + lines.join('<br>') + '</p>';
  }).join('');
}

/* ---------------- state ---------------- */
const LS = 'lingon.v1';
const publicAgentName = name => /^lingon$/i.test(String(name || '').trim()) ? 'Your agent' : String(name || '').trim();
const fresh = () => ({
  onboarded:false, agent:null, view:'chat', activeChat:null,
  ownerId:null,
  canvasOpen:false, canvasTab:'canvas', model:'Smart', theme:'grey',
  chats:[], pendingPrompt:null, pendingPromptFiles:[],
  vault:{ secrets:[], apps:[], approvals:[], mode:'default' },
  memory:[], memoryTotal:0,
  subAgents:[], triggerOptions:{ schedules:[15,60,360,1440], apps:[] },
  // Composio connected apps (Belna Apps) — loaded from /api/composio/apps
  composioApps:[], composioLoading:false, appQuery:'', appFilter:'all', appOpen:null, appDetails:{},
  shopPay:null, shopPayLoading:false, shopPayOrders:[],
  merchantPaymentMethods:[],
  // right-side canvas: canvasTab 'canvas' | 'subagents' | 'mail' | 'payments' | 'approvals'
  agentEdit:false, mailTab:'inbox',
  // settings / apps rework
  settingsTab:'profiles', userMenuOpen:false,
  agentPermissions:null,
  userProfile:null, agentContext:null,
  // Library — only real agent artifacts and user uploads.
  libraryCat:'all', librarySearch:'', librarySelect:false, librarySelected:[], libraryLayout:'grid',
  libraryUploads:[], libraryServer:[], systemFile:null, systemManifest:null,
  // goals — user-created life goals with sub-goals, tracked per account.
  goals:[], goalFilter:'all',
});
let state;
let mobileNavOpen = false;
try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS) || 'null')) || fresh(); }
catch (e) { state = fresh(); }
if (state.agent?.name) state.agent.name = publicAgentName(state.agent.name);
if (!state.vault) state.vault = fresh().vault;
// Canvas is never open by default — user or a fresh artifact opens it.
state.canvasOpen = false;
if (state.agentPanel) state.canvasTab = 'approvals';
delete state.agentPanel;
if (state.canvasTab === 'agent') state.canvasTab = 'approvals';
if (state.canvasTab === 'trace' || state.canvasTab === 'wallet' || state.canvasTab === 'live') state.canvasTab = 'canvas';
if (!['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(state.canvasTab)) state.canvasTab = 'canvas';
delete state.agentTab;
delete state.walletTab;
if (!state.mailTab) state.mailTab = 'inbox';
if (!state.settingsTab) state.settingsTab = 'profiles';
if (state.settingsTab === 'theme') state.settingsTab = 'profiles';
if (state.settingsTab === 'library') {
  state.settingsTab = 'profiles';
  if (state.view === 'settings') state.view = 'library';
}
if (state.settingsTab === 'memory') {
  state.settingsTab = 'profiles';
  if (state.view === 'settings') { state.view = 'library'; state.libraryCat = 'system'; state.systemFile = 'system:memory'; }
}
if (state.libraryCat === 'memory') { state.libraryCat = 'system'; state.systemFile = 'system:memory'; }
if (!state.agentContext || typeof state.agentContext !== 'object') state.agentContext = null;
if (!Array.isArray(state.subAgents)) state.subAgents = [];
delete state.builtInAutomationsOpen;
if (!state.triggerOptions) state.triggerOptions = fresh().triggerOptions;
if (!Array.isArray(state.composioApps)) state.composioApps = [];
state.composioLoading = false;
  if (typeof state.appQuery !== 'string') state.appQuery = '';
  if (!state.appFilter || state.appFilter === 'available') state.appFilter = 'all';
  if (typeof state.appOpen !== 'string') state.appOpen = null;
  if (!state.appDetails || typeof state.appDetails !== 'object') state.appDetails = {};
  // Library gallery defaults
  if (!state.libraryCat) state.libraryCat = 'all';
  if (typeof state.librarySearch !== 'string') state.librarySearch = '';
  if (typeof state.librarySelect !== 'boolean') state.librarySelect = false;
  if (!Array.isArray(state.librarySelected)) state.librarySelected = [];
  if (!['grid','list'].includes(state.libraryLayout)) state.libraryLayout = 'grid';
  if (!Array.isArray(state.libraryUploads)) state.libraryUploads = [];
  if (!Array.isArray(state.libraryServer)) state.libraryServer = [];
  if (!Array.isArray(state.goals)) state.goals = [];
  if (!state.goalFilter) state.goalFilter = 'all';
  // migrate legacy goals shape
  state.goals.forEach(g => {
    if (!Array.isArray(g.subgoals)) g.subgoals = [];
    if (typeof g.active !== 'boolean') g.active = true;
    if (typeof g.done !== 'boolean') g.done = false;
    if (!g.category) g.category = 'other';
    if (!g.createdAt) g.createdAt = Date.now();
    g.subgoals.forEach(s => { if (typeof s.done !== 'boolean') s.done = false; });
  });
  delete state.systemPath; // System files is a single list now
  if (state.systemFile !== null && typeof state.systemFile !== 'string') state.systemFile = null;
  // Honest apps: no fake OAuth connections exist — always empty.
  state.vault.apps = [];
  const save = () => {
    const persisted=JSON.parse(JSON.stringify(state, function(key, value){ return key === 'dataUrl' && this?.storageId ? undefined : value; }));
    if(persisted.vault?.secrets)persisted.vault.secrets=persisted.vault.secrets.map((secret)=>secret.backend?{id:secret.id,ref:secret.ref,name:secret.name,at:secret.at,backend:true}:secret);
    localStorage.setItem(LS,JSON.stringify(persisted));
  };
const taskRuns = new Map();

// Remove implementation details left in conversations by older app versions.
const legacyInternalCopy = /(?:powered by \*\*Arche|live backend|through (?:my|the) backend|backend vault|Supabase Auth|Supabase-backed|Agents-API|asking Gemini|summarized with Gemini|generated by Gemini|sandboxed harness|model context)/i;
const neutralInternalReply = `I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.`;
let scrubbedLegacyChat = false;
for (const c of state.chats || []) {
  c.messages = c.messages || [];
  const wasCompleted = c.managedStatus === 'completed';
  if (c.managedStatus === 'running' || c.managedProgress) {
    if (c.managedStatus === 'running') c.managedStatus = 'interrupted';
    c.managedProgress = null;
    scrubbedLegacyChat = true;
  }
  for (const m of c.messages) {
    if (m.card?.type === 'progress' && m.card.status === 'running') {
      m.card.status = wasCompleted ? 'done' : 'interrupted';
      scrubbedLegacyChat = true;
    }
  }
  if (c.coordinatorRuns) { c.coordinatorRuns = 0; scrubbedLegacyChat = true; }
  if (c.busy && !c.onboarding) { c.busy = false; scrubbedLegacyChat = true; }
  if (c.activeTask && c.activeTask.status === 'running') {
    c.activeTask.status = 'interrupted';
    c.activeTask.finishedAt = Date.now();
    c.busy = false;
    const delegation = (c.messages || []).find((m) => m.id === c.activeTask.cardMessageId && m.kind === 'card');
    if (delegation?.card) {
      delegation.card.status = 'interrupted';
      for (const worker of delegation.card.agents || []) { worker.status = 'interrupted'; worker.note = 'page reloaded'; }
    }
    scrubbedLegacyChat = true;
  }
  for (const m of c.messages || []) {
    if (m.kind === 'text' && m.role === 'agent' && legacyInternalCopy.test(String(m.text || ''))) {
      m.text = neutralInternalReply;
      scrubbedLegacyChat = true;
    }
    if (m.kind === 'tools' && Array.isArray(m.items)) {
      const kept = m.items.filter((item) => !legacyInternalCopy.test(`${item.t || ''} ${item.d || ''}`));
      if (kept.length !== m.items.length) {
        m.items = kept;
        scrubbedLegacyChat = true;
      }
    }
  }
  if (Array.isArray(c.trace)) {
    const kept = c.trace.filter((item) => !legacyInternalCopy.test(String(item.t || '')));
    if (kept.length !== c.trace.length) {
      c.trace = kept;
      scrubbedLegacyChat = true;
    }
  }
}
if (scrubbedLegacyChat) save();

/* ---------------- backend-synced memory/vault (auth-scoped) ---------------- */
let backendSyncPending = null;
let backendSyncOwner = null;
let backendSyncedAt = 0;
const BACKEND_SYNC_MS = 30000;
async function syncFromBackend(force = false) {
  const owner = billingIdentity();
  if (!owner) return false;
  if (owner !== backendSyncOwner) {
    backendSyncOwner = owner;
    backendSyncedAt = 0;
    backendSyncPending = null;
    state.merchantPaymentMethods = [];
  }
  if (backendSyncPending) {
    if (!force) return backendSyncPending;
    await backendSyncPending;
  }
  if (!force && Date.now() - backendSyncedAt < BACKEND_SYNC_MS) return false;
  const request = (async () => {
    const [memories, secrets, automationChats, agentContext, paymentMethods] = await Promise.allSettled([
      window.LingonAuth.api('/api/memories?limit=1000'),
      window.LingonAuth.api('/api/secrets'),
      window.LingonAuth.api('/api/automation-chats'),
      window.LingonAuth.api('/api/agent-context'),
      window.LingonAuth.api('/api/payment-methods'),
    ]);
    if (owner !== billingIdentity()) return false;
    const value = (result) => result.status === 'fulfilled' ? result.value : null;
    const m = value(memories);
    if (m) {
      state.memory=(m.memories || []).map(r=>({...r,at:r.at || Date.parse(r.updatedAt || r.observedAt) || Date.now()}));
      state.memoryTotal=Number(m.total ?? state.memory.length);
    }
    const s = value(secrets);
    const payments = value(paymentMethods);
    const paymentBefore = (state.merchantPaymentMethods || []).map((item)=>item.id).join();
    if (payments) state.merchantPaymentMethods = payments.methods || [];
    const vaultBefore = state.vault.secrets.map((item) => item.id).join() + '|' + state.vault.encrypted;
    if (s) {
      const remote=(s.secrets || []).map((r)=>({id:r.id,ref:r.ref,name:r.name,at:r.at,backend:true}));
      const localOnly=state.vault.secrets.filter((item)=>!item.backend && item.value);
      const keptLocal=[];
      for(const item of localOnly){
        try{
          const added=await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name:item.name,value:item.value})});
          if(added?.secret)remote.unshift({...added.secret,backend:true});
        }catch{keptLocal.push(item);}
      }
      state.vault.secrets=[...remote,...keptLocal];
      if(typeof s.encrypted==='boolean')state.vault.encrypted=s.encrypted;
    }
    const ac = value(agentContext);
    if (ac) {
      state.agentContext = ac;
      if (ac.revision > 0 && ac.agent) state.agent = { ...state.agent, ...ac.agent, name:publicAgentName(ac.agent.name) || 'Your agent' };
    }
    for (const remote of (value(automationChats)?.chats || [])) {
      const messages = (remote.messages || []).map((m) => ({
        id:m.id,
        role:m.role === 'assistant' ? 'agent' : m.role,
        kind:m.kind || 'text',
        text:m.text || '',
        automation:true,
      }));
      const existing = state.chats.find((item) => item.id === remote.id);
      const mapped = {
        id:remote.id,
        title:remote.title || 'Sub-agent',
        messages,
        trace:[], artifact:null,
        createdAt:new Date(remote.created_at || remote.createdAt || Date.now()).getTime(),
        updatedAt:new Date(remote.updated_at || remote.updatedAt || Date.now()).getTime(),
        source:'automation',
        subAgentId:remote.sub_agent_id || remote.subAgentId,
      };
      if (existing) Object.assign(existing, mapped);
      else state.chats.unshift(mapped);
    }
    state.chats.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    await ensureMailbox();
    if (owner === billingIdentity()) save();
    // Settings pages that show the vault repaint once it arrives, unless the
    // user is typing there (a repaint would drop their input).
    const vaultAfter = state.vault.secrets.map((item) => item.id).join() + '|' + state.vault.encrypted;
    if (owner === billingIdentity() && (vaultAfter !== vaultBefore || paymentBefore !== (state.merchantPaymentMethods || []).map((item)=>item.id).join()) && state.view === 'settings' && ['secrets','browser'].includes(state.settingsTab)) {
      const main = $('#main');
      if (main && !(main.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) paintSettings(main);
    }
    return owner === billingIdentity();
  })().finally(() => {
    if (backendSyncPending === request) {
      backendSyncPending = null;
      backendSyncedAt = Date.now();
    }
  });
  backendSyncPending = request;
  return request;
}

let subAgentsPending = null;
let subAgentsOwner = null;
let subAgentsCheckedAt = 0;
const SUB_AGENTS_CACHE_MS = 30000;
function refreshSubAgents(repaint = true) {
  const owner = billingIdentity();
  if (!owner) return Promise.resolve();
  if (owner !== subAgentsOwner) {
    subAgentsOwner = owner;
    subAgentsCheckedAt = 0;
    subAgentsPending = null;
  }
  if (subAgentsPending) return subAgentsPending;
  if (Date.now() - subAgentsCheckedAt < SUB_AGENTS_CACHE_MS) return Promise.resolve();
  const request = (async () => {
    try {
      const [agents, options] = await Promise.all([
        window.LingonAuth.api('/api/sub-agents'),
        window.LingonAuth.api('/api/trigger-options'),
      ]);
      if (owner !== billingIdentity()) return;
      state.subAgents = Array.isArray(agents.subAgents) ? agents.subAgents : [];
      state.triggerOptions = options || state.triggerOptions;
      subAgentsCheckedAt = Date.now();
      if (state.subAgentComposer) {
        const nameInput = $('#subname');
        const promptInput = $('#subprompt');
        if (nameInput) state.subAgentDraftName = nameInput.value;
        if (promptInput) state.subAgentDraft = promptInput.value;
      }
      save();
      if (repaint && state.canvasOpen && state.canvasTab === 'subagents') paintCanvas();
    } catch (e) { if (owner === billingIdentity()) toast(e.message || 'Could not load sub-agents.'); }
  })().finally(() => { if (subAgentsPending === request) subAgentsPending = null; });
  subAgentsPending = request;
  return request;
}

/* ---------------- Belna Apps via Composio (per-user OAuth) ---------------- */
let composioRefreshPending = null;
let composioRefreshOwner = null;
let composioCheckedAt = 0;
const COMPOSIO_CACHE_MS = 30000;
function refreshComposioApps(force = false) {
  const owner = billingIdentity();
  if (!owner) return Promise.resolve();
  if (owner !== composioRefreshOwner) {
    composioRefreshOwner = owner;
    composioCheckedAt = 0;
    composioRefreshPending = null;
  }
  if (composioRefreshPending) return composioRefreshPending;
  if (!force && Date.now() - composioCheckedAt < COMPOSIO_CACHE_MS) return Promise.resolve();
  // Mark the attempt before painting; an empty Apps result must not start a loop.
  composioCheckedAt = Date.now();
  state.composioLoading = true;
  if (state.view === 'apps' && $('#main')) paintApps($('#main'));
  const request = (async () => {
    try {
      const j = await window.LingonAuth.api('/api/composio/apps');
      if (owner === billingIdentity() && Array.isArray(j.apps)) {
        state.composioApps = j.apps;
        // A task waiting on a connect card for an app that is now connected resumes.
        for (const app of j.apps.filter((a) => a.connected)) resumeConnectCards(app.toolkit, { tasksOnly: true }).catch(() => {});
      }
    } catch (e) {
      if (owner === billingIdentity()) toast(e.message || 'Could not load apps.');
    } finally {
      if (owner === billingIdentity()) {
        state.composioLoading = false;
        save();
        if (state.view === 'apps' && $('#main')) paintApps($('#main'));
        if (state.canvasOpen && state.canvasTab === 'payments' && $('#cbody')) $('#cbody').innerHTML = paymentsTabContent();
        if (force) {
          try {
            const o = await window.LingonAuth.api('/api/trigger-options');
            if (owner === billingIdentity()) { state.triggerOptions = o || state.triggerOptions; save(); }
          } catch {}
        }
      }
    }
  })().finally(() => { if (composioRefreshPending === request) composioRefreshPending = null; });
  composioRefreshPending = request;
  return request;
}

let pendingConnect = null; // { toolkit, before: string[], startedAt }
function accountLabel(acc){
  if (!acc) return '';
  if (acc.name && acc.email && acc.name !== acc.email) return `${acc.name} · ${acc.email}`;
  return acc.email || acc.name || acc.alias || acc.wordId || 'Connected account';
}
async function connectComposioApp(toolkit, authConfigId, { fromChat = false } = {}) {
  const tk = String(toolkit || '').toLowerCase();
  if (!tk) return;
  try {
    toast(`Opening ${cvAppName(tk)} sign-in…`);
    const before = ((composioAppByToolkit(tk) || {}).accounts || []).map((a) => a.id);
    const j = await window.LingonAuth.api('/api/composio/connect', {
      method: 'POST',
      body: JSON.stringify({ toolkit: tk, authConfigId }),
    });
    if (j.redirectUrl) {
      // From a chat card the owner stays in the chat; elsewhere the connector
      // stays open so the new account identity lands in view.
      if (!fromChat) {
        state.appOpen = tk;
        save();
        if (state.view === 'apps' && $('#main')) paintApps($('#main'));
        else openConnector(tk, true);
      }
      pendingConnect = { toolkit: tk, before, startedAt: Date.now(), fromChat };
      window.open(j.redirectUrl, '_blank', 'noopener');
      toast(fromChat ? 'Finish signing in — I’ll continue here once it’s connected.' : 'Finish signing in — your account will appear here automatically.');
      pollPendingConnect();
    }
  } catch (e) {
    toast(e.message || 'Could not start connection.');
  }
}
// Once an app is connected, the chat picks up where it asked: a task waiting on
// the connect card resumes, and a chat reply that asked for it continues.
async function resumeConnectCards(toolkit, { tasksOnly = false } = {}){
  const tk = String(toolkit || '').toLowerCase();
  let changed = false;
  for (const c of state.chats) {
    for (const m of c.messages) {
      const cd = m.kind === 'card' ? m.card : null;
      if (!cd || cd.type !== 'connect' || cd.status !== 'pending' || String(cd.toolkit || cd.app || '').toLowerCase() !== tk) continue;
      if (tasksOnly && !(cd.managedCallId && cd.taskId)) continue;
      changed = true;
      cd.status = 'connected';
      replaceNode(c, m);
      try {
        if (cd.managedCallId && cd.taskId) await Engine.controlTask(makeRT(c), cd.taskId, 'decide', { callId:cd.managedCallId, allow:true, version:cd.taskVersion });
        else if (cd.chat && c === chat() && state.view === 'chat') sendPrompt(`I connected ${cd.name || cvAppName(tk)}. Please continue.`);
      } catch (e) { if (!tasksOnly) toast(e.message || 'Connected — ask me to continue.'); }
    }
  }
  if (changed) save();
}
async function pollPendingConnect(){
  if (!pendingConnect) return;
  const { toolkit, before, startedAt, fromChat } = pendingConnect;
  // Poll for up to ~2 minutes: Composio OAuth happens in another tab.
  for (let i = 0; i < 30; i++) {
    if (!pendingConnect || pendingConnect.toolkit !== toolkit) return;
    if (Date.now() - startedAt > 120000) break;
    await sleep(4000);
    if (!pendingConnect || pendingConnect.toolkit !== toolkit) return;
    if (!signedIn()) continue;
    try {
      await refreshComposioApps(true);
      const app = composioAppByToolkit(toolkit);
      const now = (app && app.accounts) || [];
      const fresh = now.filter((a) => !before.includes(a.id));
      if (fresh.length) {
        pendingConnect = null;
        const who = accountLabel(fresh[0]);
        if (fromChat) {
          toast(`${who} connected.`);
          await resumeConnectCards(toolkit);
          return;
        }
        state.appOpen = toolkit;
        save();
        await openConnector(toolkit, true);
        toast(`${who} connected. You can add another account anytime.`);
        return;
      }
      // Also refresh the open detail so permissions/accounts stay current.
      if (state.appOpen === toolkit && state.view === 'apps') await openConnector(toolkit, true);
    } catch {}
  }
  pendingConnect = null;
}
// OAuth callback lands back on /?connected_app=<toolkit> (see /api/composio/connect).
// Claim it: open Connectors on that app and surface the connected mail/name/profile.
async function handleConnectedAppReturn(){
  let tk = '';
  try {
    const q = new URLSearchParams(window.location.search);
    tk = String(q.get('connected_app') || '').toLowerCase().trim();
    if (tk && tk !== 'app') {
      q.delete('connected_app');
      const rest = q.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : ''));
    }
  } catch {}
  if (!tk || tk === 'app' || !signedIn()) return;
  state.view = 'apps';
  state.appOpen = tk;
  save();
  if ($('#app')) renderApp();
  toast('Connection finished — loading your account…');
  try {
    await refreshComposioApps(true);
    await openConnector(tk, true);
    const app = composioAppByToolkit(tk);
    if (app && app.accounts && app.accounts.length) {
      const latest = app.accounts[app.accounts.length - 1];
      toast(`${accountLabel(latest)} connected.`);
    } else {
      toast('Press Refresh if your account is not listed yet.');
    }
  } catch (e) {
    toast(e.message || 'Press Refresh to see your account.');
  }
  pendingConnect = null;
}

function patchConnectorAccounts(toolkit, accounts) {
  const next = Array.isArray(accounts) ? accounts : [];
  state.composioApps = (state.composioApps || []).map((a) => {
    if (a.toolkit !== toolkit) return a;
    return {
      ...a,
      accounts: next,
      accountCount: next.length,
      connected: next.length > 0,
      connectedAccountId: next[0] ? next[0].id : null,
      status: next[0] ? next[0].status : 'NOT_CONNECTED',
    };
  });
  if (state.appDetails && state.appDetails[toolkit]) {
    state.appDetails[toolkit] = { ...state.appDetails[toolkit], accounts: next, accountCount: next.length };
  }
}

async function disconnectComposioApp(app, accountId) {
  const id = accountId || (app && app.connectedAccountId);
  if (!app || !id) return;
  const acc = ((app.accounts || []).find((a) => a.id === id)) || {};
  const who = accountLabel(acc) !== 'Connected account' ? accountLabel(acc) : (app.name || 'this account');
  if (!window.confirm(`Disconnect ${who}? Your agent will lose access until you reconnect.`)) return;
  try {
    await window.LingonAuth.api('/api/composio/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connectedAccountId: id }),
    });
    const left = (app.accounts || []).filter((a) => a.id !== id);
    patchConnectorAccounts(app.toolkit, left);
    save();
    paintApps($('#main'));
    toast(`${who} disconnected.`);
  } catch (e) {
    toast(e.message || 'Could not disconnect.');
  }
}

async function openConnector(toolkit, force) {
  const tk = String(toolkit || '').toLowerCase();
  if (!tk) return;
  if (!force && state.appOpen === tk) {
    state.appOpen = null;
    save();
    paintApps($('#main'));
    return;
  }
  state.appOpen = tk;
  if (!state.appDetails) state.appDetails = {};
  const prev = state.appDetails[tk] || {};
  if (force || !prev.permissions) state.appDetails[tk] = { ...prev, loading: true };
  save();
  paintApps($('#main'));
  try {
    const j = await window.LingonAuth.api('/api/composio/toolkit?toolkit=' + encodeURIComponent(tk));
    state.appDetails[tk] = { loading: false, ...j };
    if (Array.isArray(j.accounts)) patchConnectorAccounts(tk, j.accounts);
  } catch (e) {
    state.appDetails[tk] = { loading: false, error: e.message || 'Could not open connector.' };
    toast(e.message || 'Could not open connector.');
  }
  save();
  if (state.view === 'apps' && $('#main')) paintApps($('#main'));
}

async function saveConnectorPermissions(toolkit, permissions) {
  const disabled = (permissions || []).filter((p) => !p.enabled).map((p) => p.slug);
  await window.LingonAuth.api('/api/composio/permissions', {
    method: 'POST',
    body: JSON.stringify({ toolkit, disabled }),
  });
}

async function toggleConnectorPermission(toolkit, slug, enabled) {
  const d = state.appDetails && state.appDetails[toolkit];
  if (!d || !Array.isArray(d.permissions)) return;
  d.permissions = d.permissions.map((p) => p.slug === slug ? { ...p, enabled } : p);
  save();
  paintApps($('#main'));
  try { await saveConnectorPermissions(toolkit, d.permissions); }
  catch (e) { toast(e.message || 'Could not save permission.'); openConnector(toolkit, true); }
}

async function toggleConnectorKind(toolkit, kind, enabled) {
  const d = state.appDetails && state.appDetails[toolkit];
  if (!d || !Array.isArray(d.permissions)) return;
  d.permissions = d.permissions.map((p) => p.kind === kind ? { ...p, enabled } : p);
  save();
  paintApps($('#main'));
  try { await saveConnectorPermissions(toolkit, d.permissions); }
  catch (e) { toast(e.message || 'Could not save permissions.'); openConnector(toolkit, true); }
}

function composioAppByToolkit(toolkit) {
  return (state.composioApps || []).find((a) => a.toolkit === String(toolkit || '').toLowerCase()) || null;
}

function subAgentTriggerLabel(subAgent) {
  const trigger = subAgent?.trigger || {};
  if (trigger.type === 'schedule') {
    const minutes = Number(trigger.intervalMinutes || 0);
    const every = minutes === 1440 ? 'Every day' : minutes === 10080 ? 'Every week' : minutes === 60 ? 'Every hour'
      : minutes > 60 && minutes % 60 === 0 ? `Every ${minutes / 60} hours` : `Every ${minutes} minutes`;
    // An anchored schedule shows when it runs, in the viewer's own time.
    const at = trigger.startAt ? new Date(trigger.startAt) : null;
    if (!at || Number.isNaN(at.getTime())) return every;
    const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (minutes === 10080) return `Every ${at.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
    if (minutes === 1440) return `Every day at ${time}`;
    return `${every}, from ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
  }
  if (trigger.type === 'app') {
    const opt = (state.triggerOptions?.apps || []).find((a) => a.id === trigger.app);
    const label = opt ? opt.name : String(trigger.app || 'app');
    return `${label} · ${trigger.event}`;
  }
  if (trigger.type === 'subagent') {
    const source = state.subAgents.find((item) => item.id === trigger.sourceAgentId);
    return `After ${source ? source.name : 'sub-agent'}`;
  }
  return 'Trigger';
}

function expirePending(){
  state.chats.forEach(c => (c.messages || []).forEach(m => {
    // A background task keeps waiting on the server across reloads, so its
    // approval or secret request stays answerable; the server expires it.
    const waitingTask = m.card?.taskId && c.managedTasks?.[m.card.taskId]?.status === 'waiting_approval';
    // A connect card stays usable: signing in to the app often reloads this page.
    const connect = m.card?.type === 'connect' && m.card.chat;
    if (m.kind === 'card' && m.card.status === 'pending' && !m.card.onboarding && !waitingTask && !connect) m.card.status = 'expired';
  }));
}

/* ---------------- toast ---------------- */
let toastT;
function toast(msg){
  let t = $('#toast');
  if (!t){ t = el('<div id="toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'flex';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

/* ---------------- waits (card promises) ---------------- */
const waits = {};
const wkey = (chatId, msgId) => chatId + '/' + msgId;

let root = document.getElementById('root');
const chat = () => state.chats.find(c => c.id === state.activeChat);
const isActive = c => state.view === 'chat' && state.activeChat === c.id;

/* ---------------- real-account guards (no fake/demo accounts) ----------------
   The agent (Engine.run / /api/*) only ever runs for a verified Supabase
   session. Local `lingon.v1` state is scoped per ownerId so one device never
   leaks chats/agents between real accounts, and no code path can claim or
   chat without a signed-in user. */
const signedIn = () => !!(window.LingonAuth && window.LingonAuth.signedIn());
const needsOnboarding = () => !state.onboarded || !state.agent || state.agent.provisional;
const currentUserId = () => {
  try { return (window.LingonAuth && window.LingonAuth.get() && window.LingonAuth.get().user && window.LingonAuth.get().user.id) || null; }
  catch { return null; }
};
let workspacePresenceTimer = null;
let workspacePresenceState = 'offline';
let workspacePresenceInfo = null;
let workspacePresenceOwner = null;
let browserPresenceChecked = null;
let browserPermissionsChecked = null;
let browserPermissionsVersion = 0;
function workspaceConnectionView(){
  const work = statusFor(chat());
  if (work && work !== 'Available') return { label:work, tone:'busy' };
  if (workspacePresenceState === 'ready') return { label:'Agent ready', tone:'' };
  if (workspacePresenceState === 'warming') return { label:'Warming workspace…', tone:'busy' };
  return { label:'Offline', tone:'offline' };
}
function refreshWorkspaceConnectionView(){
  const badge = document.querySelector('.agent-hero-status');
  if (!badge) return;
  const view = workspaceConnectionView();
  badge.classList.toggle('busy', view.tone === 'busy');
  badge.classList.toggle('offline', view.tone === 'offline');
  const label = badge.querySelector('span');
  if (label) label.textContent = view.label;
}
function setWorkspacePresenceState(next){
  if (workspacePresenceState === next) return;
  workspacePresenceState = next;
  refreshWorkspaceConnectionView();
}
async function workspacePresenceRequest(action) {
  if (!window.LingonAuth || !window.LingonAuth.signedIn()) {
    setWorkspacePresenceState('offline');
    return null;
  }
  const owner = currentUserId();
  if (action === 'acquire') setWorkspacePresenceState('warming');
  try {
    const result = await window.LingonAuth.api('/api/sandbox/presence', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (action !== 'release' && owner === currentUserId()) {
      workspacePresenceInfo = result || null;
      setWorkspacePresenceState(result?.status === 'ready' ? 'ready' : 'offline');
      if (state.view === 'settings' && state.settingsTab === 'browser' && $('#main')) paintSettings($('#main'));
    }
    return result;
  } catch {
    if (owner === currentUserId()) setWorkspacePresenceState('offline');
    return null;
  }
}
function startWorkspacePresence() {
  if (!signedIn() || document.visibilityState === 'hidden') return;
  const owner = currentUserId();
  if (owner !== workspacePresenceOwner) {
    workspacePresenceTimer = null;
    workspacePresenceOwner = owner;
    workspacePresenceInfo = null;
    setWorkspacePresenceState('offline');
  }
  if (workspacePresenceTimer) return;
  // Presence is a zero-compute account status check. Full-OS work acquires
  // its own VM lease from the agent tool path; an open tab never warms it.
  workspacePresenceRequest('status');
  workspacePresenceTimer = true;
}
function stopWorkspacePresence() {
  workspacePresenceTimer = null;
  setWorkspacePresenceState('offline');
  if (workspacePresenceInfo) {
    workspacePresenceInfo = { ...workspacePresenceInfo, warmed:false, status:workspacePresenceInfo.container ? 'cooling' : workspacePresenceInfo.status };
    if (state.view === 'settings' && state.settingsTab === 'browser' && $('#main')) paintSettings($('#main'));
  }
  if (!signedIn()) { workspacePresenceOwner = null; workspacePresenceInfo = null; return; }
}
function ensureOwnerScope(){
  const uid = currentUserId();
  if (!uid) return;
  if (!state.ownerId){ state.ownerId = uid; save(); return; }
  if (state.ownerId !== uid){
    const theme = state.theme;
    const pending = state.pendingPrompt;
    const pendingFiles = state.pendingPromptFiles;
    for (const c of state.chats || []) for (const m of c.messages || []) for (const file of m.files || []) {
      if (file.storageId) void storedFile('readwrite', store => store.delete(file.storageId)).catch(() => {});
    }
    pendingFilesByForm.clear();
    state = Object.assign(fresh(), { theme, pendingPrompt: pending || null, pendingPromptFiles: pendingFiles || [], ownerId: uid });
    save();
  }
}

/* ---------------- promo (hidden /promo landing) ----------------
   Hidden Swedish landing page. Only reachable via the exact /promo URL:
   no links from the main site, noindex meta, not in sitemap.xml.
   window.__promoLeft tracks in-page funnel exits (auth/app) so post-auth
   render() calls don't bounce back to the promo copy. */
function isPromoRoute(){
  try { return String(window.location.pathname || '').replace(/\/+$/, '') === '/promo'; }
  catch { return false; }
}
function leavePromo(){
  if (isPromoRoute()) {
    // Auth and the agent live at /app. Keep the address bar and refresh target
    // aligned with the screen reached from the standalone promo page.
    try {
      window.__promoLeft = true;
      window.history.replaceState(null, '', '/app' + window.location.search);
    } catch {}
  }
  belnaStopLandingFx();
}

function render(){
  applyTheme();
  if (isPromoRoute() && !window.__promoLeft) {
    stopWorkspacePresence();
    return renderPromo();
  }
  if (!signedIn()) {
    stopWorkspacePresence();
    const appRoute = window.location.pathname.replace(/\/+$/, '') === '/app';
    return state.pendingPrompt || appRoute ? renderAuth() : renderLanding();
  }
  ensureOwnerScope();
  startWorkspacePresence();
  if (needsOnboarding()) return startPendingPromptFlow();
  return renderApp();
}

/* ================================================================
   AUTH (real Supabase Auth via backend proxy)
================================================================ */
/* ================================================================
   AUTH — Sign-in / Sign-up card: Google, one-time code, password
================================================================ */
let authMode = 'signin'; // 'signin' | 'signup'
function renderAuth(){
  let lastGoogle = false;
  try { lastGoogle = localStorage.getItem('belna.lastProvider') === 'google'; } catch {}
  root.innerHTML = `
  <div class="fadeup authpage">
    <div class="authcard">
      <h1>${state.pendingPrompt ? 'Sign up / log in to send it to your agent' : 'Log in to manage profile and billing'}</h1>
      ${state.pendingPrompt ? `<div class="kv" style="margin-top:16px;text-align:left"><div class="row"><span style="color:var(--mut)">${icon('chatb',16)}</span><div><b style="font-weight:600">${esc(state.pendingPrompt.length > 140 ? state.pendingPrompt.slice(0, 140) + '…' : state.pendingPrompt)}</b><div class="sub">Your message is saved — it will appear in the agent chat right after you sign in, before anything runs.</div></div></div></div>` : ''}
      <button class="btn gbtn" data-act="google"><span class="glogo" aria-hidden="true"><svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden" viewBox="0 0 268.152 273.883"><defs><linearGradient id="google__a"><stop offset="0" stop-color="#0fbc5c"/><stop offset="1" stop-color="#0cba65"/></linearGradient><linearGradient id="google__g"><stop offset=".231" stop-color="#0fbc5f"/><stop offset=".312" stop-color="#0fbc5f"/><stop offset=".366" stop-color="#0fbc5e"/><stop offset=".458" stop-color="#0fbc5d"/><stop offset=".54" stop-color="#12bc58"/><stop offset=".699" stop-color="#28bf3c"/><stop offset=".771" stop-color="#38c02b"/><stop offset=".861" stop-color="#52c218"/><stop offset=".915" stop-color="#67c30f"/><stop offset="1" stop-color="#86c504"/></linearGradient><linearGradient id="google__h"><stop offset=".142" stop-color="#1abd4d"/><stop offset=".248" stop-color="#6ec30d"/><stop offset=".312" stop-color="#8ac502"/><stop offset=".366" stop-color="#a2c600"/><stop offset=".446" stop-color="#c8c903"/><stop offset=".54" stop-color="#ebcb03"/><stop offset=".616" stop-color="#f7cd07"/><stop offset=".699" stop-color="#fdcd04"/><stop offset=".771" stop-color="#fdce05"/><stop offset=".861" stop-color="#ffce0a"/></linearGradient><linearGradient id="google__f"><stop offset=".316" stop-color="#ff4c3c"/><stop offset=".604" stop-color="#ff692c"/><stop offset=".727" stop-color="#ff7825"/><stop offset=".885" stop-color="#ff8d1b"/><stop offset="1" stop-color="#ff9f13"/></linearGradient><linearGradient id="google__b"><stop offset=".231" stop-color="#ff4541"/><stop offset=".312" stop-color="#ff4540"/><stop offset=".458" stop-color="#ff4640"/><stop offset=".54" stop-color="#ff473f"/><stop offset=".699" stop-color="#ff5138"/><stop offset=".771" stop-color="#ff5b33"/><stop offset=".861" stop-color="#ff6c29"/><stop offset="1" stop-color="#ff8c18"/></linearGradient><linearGradient id="google__d"><stop offset=".408" stop-color="#fb4e5a"/><stop offset="1" stop-color="#ff4540"/></linearGradient><linearGradient id="google__c"><stop offset=".132" stop-color="#0cba65"/><stop offset=".21" stop-color="#0bb86d"/><stop offset=".297" stop-color="#09b479"/><stop offset=".396" stop-color="#08ad93"/><stop offset=".477" stop-color="#0aa6a9"/><stop offset=".568" stop-color="#0d9cc6"/><stop offset=".667" stop-color="#1893dd"/><stop offset=".769" stop-color="#258bf1"/><stop offset=".859" stop-color="#3086ff"/></linearGradient><linearGradient id="google__e"><stop offset=".366" stop-color="#ff4e3a"/><stop offset=".458" stop-color="#ff8a1b"/><stop offset=".54" stop-color="#ffa312"/><stop offset=".616" stop-color="#ffb60c"/><stop offset=".771" stop-color="#ffcd0a"/><stop offset=".861" stop-color="#fecf0a"/><stop offset=".915" stop-color="#fecf08"/><stop offset="1" stop-color="#fdcd01"/></linearGradient><linearGradient xlink:href="#google__a" id="google__s" x1="219.7" x2="254.467" y1="329.535" y2="329.535" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__b" id="google__m" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__c" id="google__n" cx="45.259" cy="279.274" r="71.46" fx="45.259" fy="279.274" gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__d" id="google__l" cx="304.017" cy="118.009" r="47.854" fx="304.017" fy="118.009" gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__e" id="google__o" cx="181.001" cy="177.201" r="71.46" fx="181.001" fy="177.201" gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__f" id="google__p" cx="207.673" cy="108.097" r="41.102" fx="207.673" fy="108.097" gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__g" id="google__r" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__h" id="google__j" cx="154.87" cy="145.969" r="71.46" fx="154.87" fy="145.969" gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)" gradientUnits="userSpaceOnUse"/><filter id="google__q" width="1.097" height="1.116" x="-.048" y="-.058" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.701"/></filter><filter id="google__k" width="1.033" height="1.02" x="-.017" y="-.01" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".242"/></filter><clipPath id="google__i" clipPathUnits="userSpaceOnUse"><path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z"/></clipPath></defs><g clip-path="url(#google__i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)"><path fill="url(#google__j)" d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z" filter="url(#google__k)"/><path fill="url(#google__l)" d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z" filter="url(#google__k)"/><path fill="url(#google__m)" d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z" filter="url(#google__k)"/><path fill="url(#google__n)" d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z" filter="url(#google__k)"/><path fill="#3086ff" d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z" filter="url(#google__k)"/><path fill="url(#google__o)" d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z" filter="url(#google__k)"/><path fill="url(#google__p)" d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z" filter="url(#google__q)"/><path fill="url(#google__r)" d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z" filter="url(#google__k)"/><path fill="url(#google__s)" d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z" filter="url(#google__k)" opacity=".5"/></g></svg></span>Continue with Google${lastGoogle ? '<span class="lastused">Last used</span>' : ''}</button>
      <div class="ordiv"><span></span>OR<span></span></div>
      <div id="authmain">
        <input class="field authfield" id="aemail" type="email" placeholder="Enter Email" autocomplete="email">
        <button class="btn authbtn" data-act="otp-send">Login with one-time code</button>
        <button class="btn ghost authbtn" data-act="pw-mode">Log in with password</button>
      </div>
      <div id="authotp" style="display:none">
        <p class="mut" style="font-size:14px;line-height:1.55">We sent a 6-digit code to <b id="otpemail"></b>.<br>It expires in a few minutes.</p>
        <input class="field authfield mono" id="acode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" style="text-align:center;letter-spacing:.3em;margin-top:12px">
        <button class="btn authbtn" data-act="otp-verify">Verify code</button>
        <button class="btn ghost authbtn" data-act="auth-back">Back</button>
      </div>
      <div id="authpw" style="display:none">
        <div class="pwtitle" id="pwtitle">Welcome back</div>
        <div class="mut" style="font-size:13px;margin-top:2px" id="pwemail"></div>
        <input class="field authfield mono" id="apass" type="password" placeholder="Password (8+ chars)" autocomplete="current-password" style="margin-top:12px">
        <button class="btn authbtn" id="pwgo" data-act="pw-go">Log in with password</button>
        <button class="btn ghost authbtn" data-act="auth-back">Back</button>
      </div>
      <label class="authlegal" for="authlegal">
        <input id="authlegal" type="checkbox" required>
        <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
      </label>
      <div class="secnote" id="amsg" style="min-height:18px;justify-content:center;margin-top:14px"></div>
      <div class="authfoot" id="authfoot">New to Belna? <button data-act="auth-mode">Create an account</button></div>
      <div><button class="backlink" data-act="back-home">← Back to home</button></div>
    </div>
  </div>`;
  authPaintMode();
  paintGoogleState();
  // Surface OAuth callback errors (?auth_error=…) inline when we land back here.
  try {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('auth_error');
    if (err) {
      const m = document.getElementById('amsg');
      if (m) m.textContent = 'Sign-in failed: ' + err;
      window.history.replaceState(null, '', window.location.pathname);
    }
  } catch {}
}
function showAuthPane(id){
  ['authmain', 'authotp', 'authpw'].forEach(p => { const n = document.getElementById(p); if (n) n.style.display = p === id ? '' : 'none'; });
  const m = document.getElementById('amsg'); if (m) m.textContent = '';
}
function authPaintMode(){
  const go = document.getElementById('pwgo');
  const title = document.getElementById('pwtitle');
  const foot = document.getElementById('authfoot');
  if (authMode === 'signup'){
    if (go) go.textContent = 'Create account';
    if (title) title.textContent = 'Create your Belna account';
    if (foot) foot.innerHTML = 'Have an account? <button data-act="auth-mode">Log in</button>';
  } else {
    if (go) go.textContent = 'Log in with password';
    if (title) title.textContent = 'Welcome back';
    if (foot) foot.innerHTML = 'New to Belna? <button data-act="auth-mode">Create an account</button>';
  }
}
const TERMS_VERSION = '2026-09-24';
function authLegalAccepted(){
  const box = document.getElementById('authlegal');
  if (box?.checked) return true;
  const msg = document.getElementById('amsg');
  if (msg) msg.textContent = 'Please agree to the Terms and acknowledge the Privacy Policy to continue.';
  box?.focus();
  return false;
}
async function authOAuth(){
  if (!authLegalAccepted()) return;
  const msg = document.getElementById('amsg');
  const btn = document.querySelector('[data-act="google"]');
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = 'Redirecting to Google…';
  try {
    const r = await fetch('/api/auth/oauth-url?provider=google&next=' + encodeURIComponent('/') + '&terms_version=' + encodeURIComponent(TERMS_VERSION));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Google sign-in unavailable');
    if (!j.url) throw new Error('Google sign-in unavailable — no redirect URL.');
    window.location.href = j.url;
  } catch (e){
    if (btn) btn.disabled = false;
    if (msg) msg.textContent = e.message === 'Google sign-in is not configured.'
      ? 'Google sign-in is not enabled on this server yet (missing GOOGLE_CLIENT_ID). Use a one-time code or password instead.'
      : (e.message || 'Google sign-in unavailable');
  }
}
// Probe whether Google OAuth is configured so the button can explain itself
// instead of failing silently. Non-fatal — button stays clickable as fallback.
async function paintGoogleState(){
  try {
    const r = await fetch('/api/health');
    const j = await r.json().catch(() => ({}));
    const btn = document.querySelector('[data-act="google"]');
    if (!btn) return;
    if (j && j.google === false) {
      btn.title = 'Google sign-in is not enabled on this server yet';
    } else if (j && j.google === true) {
      btn.title = 'Continue with Google';
    }
  } catch {}
}
async function authOtpSend(){
  if (!authLegalAccepted()) return;
  const msg = document.getElementById('amsg');
  const email = ((document.getElementById('aemail') || {}).value || '').trim();
  if (!/.+@.+\..+/.test(email)){ if (msg) msg.textContent = 'Enter a valid email first.'; return; }
  if (msg) msg.textContent = 'Sending code…';
  try {
    const r = await fetch('/api/auth/otp', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, terms_version: TERMS_VERSION }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Could not send code');
    document.getElementById('otpemail').textContent = email;
    showAuthPane('authotp');
    document.getElementById('acode').focus();
  } catch (e){ if (msg) msg.textContent = e.message; }
}
async function authOtpVerify(){
  if (!authLegalAccepted()) return;
  const msg = document.getElementById('amsg');
  const email = ((document.getElementById('aemail') || {}).value || '').trim();
  const token = ((document.getElementById('acode') || {}).value || '').trim();
  if (!token){ if (msg) msg.textContent = 'Enter the code from your email.'; return; }
  if (msg) msg.textContent = 'Verifying…';
  try {
    const r = await fetch('/api/auth/verify', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, token }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Invalid code');
    window.LingonAuth.set({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user });
    try { window.LingonConfig.userId = j.user.id; localStorage.setItem('belna.lastProvider', 'otp'); } catch {}
    await afterSignIn(j.user);
  } catch (e){ if (msg) msg.textContent = e.message; }
}

async function doAuth(kind){
  if (!authLegalAccepted()) return;
  const msg = $('#amsg');
  const email = ($('#aemail').value || '').trim();
  const password = $('#apass').value || '';
  if (msg) msg.textContent = 'Working…';
  try {
    const r = await fetch('/api/auth/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, terms_version: TERMS_VERSION }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Auth failed');
    if (j.confirm_email){
      if (msg) msg.textContent = j.message || 'Check your email to confirm your account, then log in.';
      return;
    }
    window.LingonAuth.set({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user });
    try { window.LingonConfig.userId = j.user.id; } catch {}
    await afterSignIn(j.user);
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

/* Central post-auth routing (real accounts only).
   - Scopes local state to the signed-in user (no cross-account leakage).
   - If a homepage prompt is pending and the account is new (not onboarded),
     the message is placed into the agent chat FIRST, then in-chat onboarding
     (name / color / passport) runs BEFORE the agent starts the task.
   - Otherwise normal render. */
async function afterSignIn(user){
  try {
    ensureOwnerScope();
    if (user && user.id && state.ownerId !== user.id){ state.ownerId = user.id; }
    state.view = 'chat';
    save();
    const owner = billingIdentity();
    syncFromBackend(true).then(() => {
      if (owner === billingIdentity() && $('#side')) paintSide();
    }).catch(() => {});
    if (state.pendingPrompt && (!state.onboarded || !state.agent || state.agent.provisional)){
      const p = state.pendingPrompt;
      toast('Signed in as ' + (user.email || 'you'));
      await startPendingPromptFlow(p);
      return;
    }
    if (state.pendingPrompt && state.onboarded && state.agent && !state.agent.provisional){
      await landingRun(state.pendingPrompt, state.pendingPromptFiles || []);
    } else render();
    toast('Signed in as ' + (user.email || 'you'));
  } catch (e){
    console.error(e);
    render();
  }
}

/* ================================================================
   BILLING (real credits + gifts, no fake charges)
================================================================ */
let billingCache = null;
let billingOwner = null;
let billingFetchedAt = 0;
let billingPending = null;
let billingGeneration = 0;
const BILLING_CACHE_MS = 10000;
function billingIdentity(){
  const session = window.LingonAuth.get();
  return session && session.access_token ? (session.user && session.user.id) || session.access_token : null;
}
function setBillingCache(billing){
  billingOwner = billingIdentity();
  billingCache = billing || null;
  billingFetchedAt = Date.now();
  billingGeneration++;
  billingPending = null;
}
function invalidateBilling(){
  billingFetchedAt = 0;
  billingGeneration++;
  billingPending = null;
}
async function getBilling(){
  const owner = billingIdentity();
  if (!owner) { setBillingCache(null); return null; }
  if (owner !== billingOwner) { setBillingCache(null); billingOwner = owner; billingFetchedAt = 0; }
  if (billingCache && Date.now() - billingFetchedAt < BILLING_CACHE_MS) return billingCache;
  if (billingPending) return billingPending;
  const generation = billingGeneration;
  const request = window.LingonAuth.api('/api/billing').then((billing) => {
    if (billingOwner !== owner || billingGeneration !== generation) return null;
    billingCache = billing;
    billingFetchedAt = Date.now();
    return billing;
  }).catch(() => billingOwner === owner ? billingCache : null).finally(() => {
    if (billingPending === request) billingPending = null;
  });
  billingPending = request;
  return request;
}
function fmtC(n){ return (Math.round(Number(n || 0) * 100) / 100).toString(); }
function fmtTokens(n){ return Math.max(0, Math.floor(Number(n || 0))).toLocaleString('en-US'); }
function fmtPlanTokens(n){
  const tokens = Number(n || 0);
  return tokens >= 1000000 && Number.isInteger(tokens / 1000000)
    ? `${fmtTokens(tokens / 1000000)} million` : fmtTokens(tokens);
}
function creditView(b){
  const amount = n => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
  const plan = amount(b.planTokens), planUsed = Math.min(plan, amount(b.planTokensUsed));
  const extra = amount(b.packTokens), packUsed = Math.min(extra, amount(b.packTokensUsed));
  const planLeft = plan - planUsed, extraLeft = extra - packUsed;
  // An overdrawn request can leave wallet debt. The next available plan tokens
  // repay it first, so show the spendable balance rather than overstating "left".
  const debt = b.tokens == null ? 0 : Math.max(0, planLeft + extraLeft - amount(b.tokens));
  const used = planUsed + Math.min(planLeft, debt);
  const remaining = Math.max(0, plan - used);
  const extraUsed = packUsed + Math.min(extraLeft, Math.max(0, debt - planLeft));
  return { remaining, used, granted: plan, extra, extraUsed,
    extraRemaining: Math.max(0, extra - extraUsed),
    percent: plan ? Math.min(100, used / plan * 100) : 0,
    tone: remaining <= 0 ? 'empty' : remaining <= Math.max(1000000, plan * 0.1) ? 'low' : 'ready' };
}
function creditMeterHtml(v){
  return `<div class="credit-meter" role="meter" aria-label="Monthly plan tokens used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v.percent}" aria-valuetext="${Math.round(v.percent)}% of monthly plan tokens used"><span style="width:${v.percent}%"></span></div>`;
}
function billingPlanName(b){
  const plans = Array.isArray(b.plans) ? b.plans : Object.values(b.plans || {});
  const plan = plans.find(p => p.id === b.plan);
  return (plan && plan.name) || ({ free:'Free', pro:'Pro', max:'Max' })[b.plan] || b.plan || 'Free';
}
function pctOff(p){
  const was = Number(p && p.was), price = Number(p && p.price);
  if (!was || !(was > price) || !isFinite(was) || !isFinite(price)) return '';
  const pct = Math.round((was - price) / was * 100);
  return `<span class="pct-off">-${pct}%</span>`;
}
function giftCardHtml(p){
  const amt = Number(p.giftUsd || 0);
  if (!amt) return '';
  return `<div class="gift-strip"><span class="gift-thumb">$${amt}</span>`
    + `<span class="gift-strip-text">+ FREE $${amt} gift card</span></div>`;
}
function billingShopHtml(b){
  const gifts = Array.isArray(b && b.purchasedGifts) ? b.purchasedGifts : [];
  const giftList = gifts.length ? `<ul class="billing-gift-list" aria-label="Your gift cards">${gifts.map((g) => `<li>
      <span class="billing-gift-amount">$${fmtC(g.amount_usd)}</span>
      <code>${esc(g.code)}</code>
      <span class="chip ${g.redeemed_by ? '' : 'green'}">${g.redeemed_by ? 'Redeemed' : 'Ready to share'}</span>
      ${g.redeemed_by ? '' : `<button class="iconbtn" data-act="copy-gift" data-code="${esc(g.code)}" title="Copy code" aria-label="Copy gift code">${icon('copy',14)}</button>`}
    </li>`).join('')}</ul>` : '';
  return `<section class="billing-card billing-gifts" aria-labelledby="gift-title">
    <div class="billing-card-head"><span class="billing-card-icon" aria-hidden="true">${icon('gift',16)}</span><div><h3 id="gift-title">Gift cards</h3><p>Redeem a code someone shared with you.</p></div></div>
    <div class="billing-redeem-form"><input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" aria-label="Gift code">
    <button class="btn billing-redeem-button" data-act="redeem">${icon('gift',14)} Redeem gift card</button></div>
    ${giftList}
  </section>`;
}
function planCards(b){
  const ids = ['free', 'pro', 'max'];
  const list = Array.isArray(b && b.plans) ? b.plans : Object.values((b && b.plans) || {});
  const byId = {};
  list.forEach((p) => { if (p && p.id) byId[p.id] = p; });
  const pFree = byId.free || { id: 'free', name: 'Free', price: 0, was: null, tokens: 50000000, imagesPerDay: 5, transcriptionsPerDay: 10, giftUsd: 0 };
  const pPro = byId.pro || { id: 'pro', name: 'Pro', price: 50, was: null, tokens: 100000000, imagesPerDay: 10, transcriptionsPerDay: 15, giftUsd: 0, interval: 'month' };
  const pMax = byId.max || { id: 'max', name: 'Max', price: 100, was: null, tokens: 200000000, imagesPerDay: 15, transcriptionsPerDay: 20, giftUsd: 0, interval: 'month' };
  const descriptions = { free:'A little space to get acquainted.', pro:'For your everyday ideas and ambitions.', max:'For the bigger things you have in mind.' };
  const lead = { free:'Your own agent, browser and vault', pro:'Everything in Free', max:'Everything in Pro' };
  return `<div class="pcards">${[pFree,pPro,pMax].map((p, i) => {
    const id = ids[i], current = b && b.plan === id;
    const features = [lead[id], `${Number(p.imagesPerDay || 0)} images a day`, `${Number(p.transcriptionsPerDay || 0)} voice transcriptions a day`];
    const action = current ? `<span class="plan-state">${icon('check',14)} Your current plan</span>`
      : id === 'free' ? '<span class="plan-state plan-included">Your starting point</span>'
      : `<button class="btn ${id === 'pro' ? 'billing-primary' : 'ghost'}" data-act="checkout" data-p="${id}">Choose ${esc(p.name)} ${icon('aur',14)}</button>`;
    return `<article class="pcard${current ? ' is-current' : ''}${id === 'pro' ? ' is-featured' : ''}">
      <div class="billing-plan-heading"><h3 class="pname">${esc(p.name)}</h3>${current ? '<span class="billing-plan-tag">Your plan</span>' : id === 'pro' ? '<span class="billing-plan-tag">A little more room</span>' : ''}</div>
      <p class="pdesc">${descriptions[id]}</p>
      <div class="pprice">$${fmtC(p.price)}${p.was ? ` <s>$${fmtC(p.was)}</s>` : ''}<span>${id === 'free' ? '/ forever' : '/ month'}</span></div>${pctOff(p)}
      <div class="billing-plan-credits">${icon('spark',16)} <b>${fmtPlanTokens(p.tokens)}</b> tokens / month</div>
      <ul>${features.map(text => `<li>${icon('check',13)} ${esc(text)}</li>`).join('')}</ul>
      <div class="pcard-action">${action}${giftCardHtml(p)}</div>
    </article>`;
  }).join('')}</div>`;
}
function billSummary(b){
  const v = creditView(b);
  const firstName = currentUser().name.trim().split(/\s+/)[0];
  const note = v.tone === 'empty'
    ? v.extraRemaining > 0 ? 'Monthly tokens used. Your extra tokens are still available.' : 'Monthly tokens used. Add tokens whenever you need them.'
    : v.tone === 'low' ? 'Your monthly tokens are running low.'
    : `Ready for your next idea${firstName && firstName !== 'Guest' ? ', ' + esc(firstName) : ''}.`;
  const resets = b.resetAt ? `Resets ${esc(new Date(b.resetAt).toLocaleDateString(undefined, { day:'numeric', month:'short' }))}` : '';
  return `<header class="billing-hero credit-tone-${v.tone}" aria-label="Monthly plan token usage">
    <div class="billing-hero-head">
      <span class="billing-hero-icon" aria-hidden="true">${icon('spark',22)}</span>
      <div class="billing-hero-copy">
        <h2>${esc(billingPlanName(b))} plan</h2>
        <p class="billing-balance-note">${note}</p>
        <div class="billing-hero-chips"><span class="chip green billing-status">${esc(b.status || 'active')}</span>${resets ? `<span class="chip">${icon('clock',12)} ${resets}</span>` : ''}</div>
      </div>
    </div>
    <div class="billing-usage">
      <div class="billing-usage-top"><div class="billing-balance-number"><strong>${fmtShortTokens(v.remaining)}</strong><span>of ${fmtShortTokens(v.granted)} left this month</span></div><b>${Math.round(v.percent)}% used</b></div>
      ${creditMeterHtml(v)}
      <dl class="billing-token-breakdown">
        <div><dt>Monthly tokens used</dt><dd>${fmtTokens(v.used)}</dd></div>
        <div><dt>Monthly tokens left</dt><dd>${fmtTokens(v.remaining)}</dd></div>
        <div><dt>Monthly plan allowance</dt><dd>${fmtTokens(v.granted)}</dd></div>
      </dl>
    </div>
  </header>
  <div class="billing-daily" aria-label="Daily limits">
    ${billingDailyTile('image', 'Images today', b.imagesToday, b.imagesPerDay)}
    ${billingDailyTile('mic', 'Transcriptions today', b.transcriptionsToday, b.transcriptionsPerDay)}
  </div>
  <section class="billing-extra-balance" aria-labelledby="extra-token-balance-title">
    <div class="billing-card-head"><span class="billing-card-icon" aria-hidden="true">${icon('plus',16)}</span><div><h3 id="extra-token-balance-title">Extra tokens</h3><p>Packs, gift cards and invite rewards. They carry over until used and don’t change your plan.</p></div></div>
    <div class="billing-extra-total"><strong>${fmtShortTokens(v.extraRemaining)}</strong><span>available whenever your monthly tokens run out</span></div>
    <dl class="billing-token-breakdown billing-extra-stats">
      <div><dt>Extra tokens added</dt><dd title="${fmtTokens(v.extra)} tokens">${fmtShortTokens(v.extra)}</dd></div>
      <div><dt>Extra tokens used</dt><dd title="${fmtTokens(v.extraUsed)} tokens">${fmtShortTokens(v.extraUsed)}</dd></div>
    </dl>
  </section>
  <section class="billing-card billing-add-tokens" aria-labelledby="add-tokens-title">
    <div class="billing-card-head"><span class="billing-card-icon" aria-hidden="true">${icon('spark',16)}</span><div><h3 id="add-tokens-title">Add tokens</h3><p>Choose a pack to keep creating after your monthly allowance runs out.</p></div></div>
    ${tokenPackPickerHtml(b)}
  </section>`;
}
function tokenPackRate(t){
  const perMillion = Number(t && t.millions) ? Number(t.usd) / Number(t.millions) : 0;
  return perMillion ? `$${perMillion.toFixed(2)} per million · one-time · carries over` : 'One-time · carries over';
}
function tokenPackPickerHtml(b){
  const packs = Array.isArray(b && b.tokenPacks) ? b.tokenPacks : [];
  if (!packs.length) return '<p class="billing-fine">Token packs aren’t available right now.</p>';
  return `<div class="billing-topup">
    <span class="billing-label" id="billing-pack-label">Token pack</span>
    <div class="billing-topup-row">
      <details class="billing-select"><summary class="billing-select-trigger" aria-labelledby="billing-pack-label buypack-value"><span id="buypack-value">${esc(packs[0].millions)}M tokens — $${fmtC(packs[0].usd)}</span>${icon('chev',15)}</summary>
        <div class="billing-select-menu" aria-label="Token packs">${packs.map((t, i) => `<button type="button" class="billing-select-option${i === 0 ? ' is-selected' : ''}" data-act="select-pack" data-pack="${esc(t.tokens)}" data-rate="${esc(tokenPackRate(t))}" aria-pressed="${i === 0}"><span>${esc(t.millions)}M tokens — $${fmtC(t.usd)}</span>${icon('check',15)}</button>`).join('')}</div>
        <input type="hidden" id="buypack" value="${esc(packs[0].tokens)}">
      </details>
      <button class="btn billing-primary" data-act="buycredits">${icon('card',14)} Continue to checkout</button>
    </div>
    <span class="billing-fine" id="buypack-rate">${esc(tokenPackRate(packs[0]))} · secure checkout</span>
  </div>`;
}
function fmtShortTokens(n){
  const x = Math.max(0, Number(n) || 0);
  const short = (v, unit) => (v >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10) + unit;
  if (x >= 1e9) return short(x / 1e9, 'B');
  if (x >= 1e6) return short(x / 1e6, 'M');
  if (x >= 1e4) return short(x / 1e3, 'k');
  return fmtTokens(x);
}
function billingDailyTile(ic, label, used, limit){
  const u = Math.max(0, Number(used) || 0), l = Math.max(0, Number(limit) || 0);
  const pct = l ? Math.min(100, u / l * 100) : 0;
  return `<div class="billing-daily-tile${l && u >= l ? ' is-full' : ''}">
    <span class="billing-daily-icon">${icon(ic,15)}</span>
    <div><span class="billing-label">${label}</span><b>${u}<small> / ${l}</small></b>
    <span class="billing-daily-meter" aria-hidden="true"><i style="width:${pct}%"></i></span></div>
  </div>`;
}
function billingLoadingHtml(){
  return `<div class="billing-loading" role="status"><span class="billing-extra-icon" aria-hidden="true">${icon('spark',20)}</span><span>Getting your tokens ready…</span></div>`;
}
function billingPlanOverview(b){
  const paid = b && b.plan !== 'free';
  const date = b?.resetAt ? new Date(b.resetAt).toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' }) : '';
  return `<section class="billing-card billing-account" aria-labelledby="billing-account-title">
    <div class="billing-card-head"><span class="billing-card-icon" aria-hidden="true">${icon('card',16)}</span><div><h3 id="billing-account-title">Current plan</h3><p>${paid ? 'Manage payment details, invoices, and your subscription.' : 'Your free plan is active. Choose a plan below when you need more room.'}</p></div></div>
    <div class="billing-account-row"><div><strong>${esc(billingPlanName(b))}</strong><span>${date ? `${paid ? 'Renews' : 'Monthly tokens reset'} ${esc(date)}` : 'Your monthly plan'}</span></div>
      ${paid ? `<button class="btn billing-primary" data-act="portal">Open billing portal ${icon('aur',14)}</button>` : ''}
    </div>
  </section>`;
}
function billingBodyHtml(tab = 'billing'){
  const b = billingOwner === billingIdentity() ? billingCache : null;
  if (tab === 'usage') return `<div class="billing-content usage-content">
    <div id="billbody">${b ? billSummary(b) : billingLoadingHtml()}</div>
    <div id="billshop">${b ? billingShopHtml(b) : ''}</div>
  </div>`;
  return `<div class="billing-content">
    <div id="billbody">${b ? billingPlanOverview(b) : billingLoadingHtml()}</div>
    <section class="billing-card billing-plans" aria-labelledby="billing-plans-title">
      <div class="billing-card-head"><span class="billing-card-icon" aria-hidden="true">${icon('star',16)}</span><div><h3 id="billing-plans-title">Plans</h3><p>Start small. Switch or cancel any time.</p></div></div>
      <div id="plancards">${b ? planCards(b) : ''}</div>
    </section>
  </div>`;
}
function loadBillingContent(tab = 'billing'){
  const body = $('#billbody'), cards = $('#plancards'), shop = $('#billshop');
  getBilling().then(b => {
    if (!body || !body.isConnected) return;
    if (!b) {
      body.innerHTML = `<div class="billing-loading" role="status"><span>We couldn’t load your balance just now.</span><button class="btn ghost small" data-act="billing-refresh">Try again</button></div>`;
      return;
    }
    body.innerHTML = tab === 'usage' ? billSummary(b) : billingPlanOverview(b);
    if (cards && cards.isConnected) cards.innerHTML = planCards(b);
    if (shop && shop.isConnected) shop.innerHTML = billingShopHtml(b);
  });
}
function paintBilling(M){
  M.innerHTML = `<div class="page"><div class="pageinner">${billingBodyHtml('billing')}</div></div>`;
  loadBillingContent('billing');
}

/* ================================================================
   ONE-TIME INVITE — a friend redeems one code, then both get 10M tokens.
   ================================================================ */
let giftCache = null; // {code, link, invited, earnedTokens, rewardEachTokens}
async function getGift(prefillCode){
  const owner = billingIdentity();
  const j = await window.LingonAuth.api('/api/referrals/mine');
  if (owner !== billingIdentity()) return null;
  giftCache = j || null;
  if (prefillCode && giftCache) giftCache.prefill = prefillCode;
  return giftCache;
}
function closeGift(){
  const m = $('#giftmodal');
  if (m) m.remove();
}
function giftShareMessage(){
  const code = (giftCache && giftCache.code) || '';
  const link = (giftCache && giftCache.link) || '';
  return `Join me on Belna! Redeem my invite code ${code} and we’ll each get 10 million tokens.${link ? ` ${link}` : ''}`;
}
function openGift(prefillCode){
  if (!signedIn()){ renderAuth(); toast('Sign in to use your invite code.'); return; }
  closeGift();
  const overlay = el(`<div id="giftmodal" role="dialog" aria-modal="true" aria-labelledby="giftmodal-title">
    <div class="giftmodal-card">
      <div class="giftmodal-head">
        <button class="iconbtn giftmodal-x" data-act="closegift" aria-label="Close invite">${icon('x',22)}</button>
        <div class="giftmodal-brand">${Mascot.logo(20)}<span>belna</span></div>
        <h2 id="giftmodal-title">Invite a friend</h2>
      </div>
      <div class="giftmodal-body"><p class="mut giftmodal-loading">Getting your invite code…</p></div>
    </div>
  </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGift(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){ e.stopPropagation(); closeGift(); }
    if (e.key === 'Tab'){
      const controls = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Enter' && e.target.id === 'giftfriendcode'){
      e.preventDefault(); e.stopPropagation();
      overlay.querySelector('[data-act="gift-redeem"]')?.click();
    }
  });
  setTimeout(() => { const x = overlay.querySelector('.giftmodal-x'); if (x) x.focus({ preventScroll: true }); }, 50);
  getGift(prefillCode).then((g) => {
    const body = overlay.querySelector('.giftmodal-body');
    if (!body || !body.isConnected) return;
    if (!g || !g.code){ body.innerHTML = `<p class="mut">Couldn’t load your invite right now.</p><button class="btn" data-act="opengift">Try again</button>`; return; }
    const friendCode = String(g.prefill || '').toUpperCase();
    const showFriendBox = !!friendCode && friendCode !== String(g.code).toUpperCase();
    const alreadyUsed = Number(g.invited || 0) > 0;
    body.innerHTML = `
      <div class="giftmodal-illustration" aria-hidden="true">
        <img src="/lingon/mascot/gift-invite-3d.webp" alt="" width="280" height="210" decoding="async">
      </div>
      <div class="giftmodal-code">
        <div class="giftmodal-code-text"><span>Your invite code</span><strong id="giftcode-text">${esc(g.code)}</strong></div>
        <button class="giftmodal-copy" data-act="gift-copy-code" aria-label="Copy invite code" title="Copy invite code">${icon('copy',23)}<span>Copy</span></button>
      </div>
      <p class="giftmodal-description">Invite a friend and you’ll each get <strong>10 million tokens</strong> when they redeem your code in Belna.</p>
      ${alreadyUsed ? '<p class="giftmodal-once">Your invite has been redeemed. Each code works once.</p>' : ''}
      <div class="giftmodal-share" aria-label="Share your invite">
        <button class="giftmodal-share-option" data-act="gift-share"${alreadyUsed ? ' disabled title="Invite already redeemed"' : ''}><span class="giftmodal-share-icon">${icon('share',25)}</span><span>Share</span></button>
        <button class="giftmodal-share-option" data-act="gift-share-sms"${alreadyUsed ? ' disabled title="Invite already redeemed"' : ''}><span class="giftmodal-share-icon">${icon('chatb',25)}</span><span>Messages</span></button>
        <button class="giftmodal-share-option" data-act="gift-share-whatsapp"${alreadyUsed ? ' disabled title="Invite already redeemed"' : ''}><span class="giftmodal-share-icon giftmodal-share-whatsapp">${icon('phone',24)}</span><span>WhatsApp</span></button>
        <button class="giftmodal-share-option" data-act="gift-copy-link"${alreadyUsed ? ' disabled title="Invite already redeemed"' : ''}><span class="giftmodal-share-icon">${icon('copy',24)}</span><span>Copy link</span></button>
      </div>
      <div class="giftmodal-stats"><span><b>${Number(g.invited || 0)}</b> friend${Number(g.invited || 0) === 1 ? '' : 's'} redeemed</span><span class="giftmodal-stat-dot" aria-hidden="true"></span><span><b>${fmtTokens(g.earnedTokens || 0)}</b> tokens earned</span></div>
      <div class="giftmodal-redeem">
        <h3>Have a friend’s invite?</h3><p>Redeem their code and you’ll both get 10 million tokens.</p>
        <label class="giftmodal-redeem-label" for="giftfriendcode">Friend’s invite code</label>
        <div class="giftmodal-redeem-form"><input class="field mono" id="giftfriendcode" placeholder="BELNA-XXXXXX" autocomplete="off" spellcheck="false" value="${esc(showFriendBox ? friendCode : '')}">
        <button class="btn" data-act="gift-redeem">Redeem code</button></div>
      </div>`;
  }).catch(() => {
    const body = overlay.querySelector('.giftmodal-body');
    if (body) body.innerHTML = `<p class="mut">Couldn’t load your invite right now.</p><button class="btn" data-act="opengift">Try again</button>`;
  });
}
function giftAutoOpenFromUrl(){
  try {
    const q = new URLSearchParams(window.location.search);
    const ref = (q.get('ref') || q.get('gift') || '').trim();
    if (!ref) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!signedIn()){ try { sessionStorage.setItem('belna.pendingGift', ref); } catch {} renderAuth(); setTimeout(() => toast('Sign in — your friend’s invite code is waiting.'), 400); return; }
    setTimeout(() => openGift(ref), 600);
  } catch {}
}

/* ================================================================
   LANDING
================================================================ */
/* Belna landing — headline mascot circle hosts Mascot.loop(): a self-contained
   4-action SVG animation (mail → phone → laptop → wallet) on a 16s pure-CSS
   infinite loop that plays automatically. No JS rotator / prop badge needed. */
/* Typewriter examples for the hero prompt box. */
const BELNA_PROMPTS = [
  'Ask Belna to do my taxes...',
  'Ask Belna to organize my schedule...',
  'Ask Belna to plan my move to Gothenburg...',
  'Ask Belna to research anything with sources...',
  'Ask Belna to build me a landing page...',
];
function belnaStopRotator(){ /* headline loop is pure CSS — nothing to stop */ }
function belnaStopTypewriter(){ if (window.__typeTimer){ clearTimeout(window.__typeTimer); window.__typeTimer = null; } }
function belnaStopLandingFx(){ belnaStopRotator(); belnaStopTypewriter(); }
function belnaStartTypewriter(){
  belnaStopTypewriter();
  const ta = document.getElementById('lprompt');
  const ta2 = document.getElementById('lprompt2');
  if (!ta && !ta2) return;
  const CARET = '▏';
  let pi = 0, ci = 0, del = false;
  const setPh = txt => {
    if (ta && document.activeElement !== ta && !ta.value) ta.placeholder = txt;
    if (ta2 && document.activeElement !== ta2 && !ta2.value) ta2.placeholder = txt;
  };
  const tick = () => {
    // Pause while the user focuses either box; resume once they leave it empty.
    if ((ta && document.activeElement === ta) || (ta2 && document.activeElement === ta2)) {
      window.__typeTimer = setTimeout(tick, 1200);
      return;
    }
    const full = BELNA_PROMPTS[pi % BELNA_PROMPTS.length];
    if (!del){
      ci++;
      setPh(full.slice(0, ci) + (ci < full.length ? CARET : ''));
      if (ci >= full.length){ del = true; window.__typeTimer = setTimeout(tick, 1700); return; }
      window.__typeTimer = setTimeout(tick, 34 + Math.random() * 46);
    } else {
      ci--;
      setPh(full.slice(0, Math.max(ci, 0)) + CARET);
      if (ci <= 0){ del = false; pi++; window.__typeTimer = setTimeout(tick, 380); return; }
      window.__typeTimer = setTimeout(tick, 15);
    }
  };
  setPh(CARET);
  window.__typeTimer = setTimeout(tick, 550);
}

/* Star-sky SVG background for the hero section (hand-drawn constellations, moon, planet). */
const STAR_SKY_SVG = `<svg viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice">
<defs>
<filter id="handDrawn" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="1" seed="14" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale=".35" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="moonTexture" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".24" numOctaves="2" seed="4" result="noise"/><feComposite in="noise" in2="SourceGraphic" operator="in" result="texture"/><feBlend in="SourceGraphic" in2="texture" mode="multiply"/></filter>
<symbol id="star4" viewBox="-12 -12 24 24"><path d="M0-8 C1-3 2-1 8 0 C2 1 1 2 0 8 C-1 2-2 1-8 0 C-2-1-1-2 0-8Z" fill="none" stroke="currentColor" stroke-width="1.4"/></symbol>
<symbol id="star8" viewBox="-16 -16 32 32"><path d="M0-15 L1-3 L4-1 L15 0 L4 1 L2 4 L0 15 L-1 4 L-4 1 L-15 0 L-4-1 L-1-4 Z" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M-10-10 L-2-2 M10-10 L2-2 M-10 10 L-2 2 M10 10 L2 2" fill="none" stroke="currentColor" stroke-width=".8" opacity=".68"/></symbol>
<symbol id="small-cross" viewBox="-8 -8 16 16"><path d="M0-7 L0 7 M-7 0 L7 0 M-5-5 L5 5 M5-5 L-5 5" fill="none" stroke="currentColor" stroke-width="1.0"/></symbol>
</defs>
<g fill="var(--ink)"><circle cx="20" cy="58" r="1.2"/><circle cx="58" cy="64" r="1.6"/><circle cx="95" cy="71" r="2"/><circle cx="113" cy="96" r="1.4"/><circle cx="281" cy="72" r="1.5"/><circle cx="327" cy="31" r="2.8"/><circle cx="479" cy="100" r="1.8"/><circle cx="586" cy="29" r="1.2"/><circle cx="413" cy="187" r="1.1"/><circle cx="252" cy="192" r="1.2"/><circle cx="81" cy="279" r="1.5"/><circle cx="135" cy="258" r="1.2"/><circle cx="97" cy="217" r="1.4"/></g>
<circle cx="254" cy="109" r="6.5" class="soft-dot"/><circle cx="112" cy="351" r="5.4" class="soft-dot" opacity=".78"/>
<g transform="translate(198 59)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-19" y="-19" width="38" height="38"/></g>
<g transform="translate(304 149)" style="color:var(--ink)" class="hand twinkle-b"><use href="#small-cross" x="-10" y="-10" width="20" height="20"/></g>
<g transform="translate(409 68)" style="color:var(--ink)" class="hand twinkle-c"><use href="#star4" x="-13" y="-13" width="26" height="26"/></g>
<g class="hand"><path d="M40 153 L124 190 L190 230 L211 295" fill="none" stroke="var(--ink)" stroke-width="1.35" stroke-dasharray="1.35 6"/><path d="M40 153 L124 190 L190 230 L211 295" fill="none" stroke="var(--ink)" stroke-width=".5" opacity=".34"/><use href="#star4" x="31" y="144" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="116" y="182" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="182" y="222" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="202" y="286" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(62 463)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star8" x="-18" y="-18" width="36" height="36"/></g>
<g fill="var(--ink)"><circle cx="31" cy="556" r="1.1"/><circle cx="90" cy="543" r="1.2"/><circle cx="143" cy="543" r="1.7"/><circle cx="43" cy="592" r="2.2"/><circle cx="101" cy="626" r="1.3"/><circle cx="197" cy="654" r="1.4"/><circle cx="204" cy="684" r="1.25"/></g>
<g transform="translate(166 607)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<circle cx="271" cy="658" r="5.9" class="soft-dot" opacity=".83"/>
<path d="M-42 638 C54 647 136 675 191 718 C244 759 271 815 269 900" fill="none" stroke="var(--ink)" stroke-width="1.35" stroke-dasharray="1.35 6.2" opacity=".88" class="hand"/>
<circle cx="197" cy="745" r="4.4" fill="var(--ink)"/><circle cx="78" cy="820" r="5.8" class="soft-dot" opacity=".72"/>
<g transform="translate(100 749)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-10" y="-10" width="20" height="20"/></g>
<g fill="var(--ink)"><circle cx="21" cy="746" r="1.1"/><circle cx="40" cy="777" r="2.1"/><circle cx="94" cy="848" r="1.5"/><circle cx="133" cy="873" r="1.4"/><circle cx="289" cy="783" r="1.25"/><circle cx="330" cy="824" r="2"/><circle cx="343" cy="882" r="1.8"/><circle cx="376" cy="761" r="1.1"/><circle cx="431" cy="870" r="1.8"/><circle cx="516" cy="835" r="1.5"/></g>
<g transform="translate(392 805)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<g fill="var(--ink)"><circle cx="1136" cy="73" r="1.6"/><circle cx="1167" cy="37" r="3.1"/><circle cx="1264" cy="30" r="1.2"/><circle cx="1272" cy="58" r="1.2"/><circle cx="1404" cy="157" r="1.4"/><circle cx="1518" cy="59" r="1.6"/><circle cx="1579" cy="88" r="1.2"/><circle cx="1618" cy="105" r="1.1"/><circle cx="1543" cy="98" r="1.2"/><circle cx="1358" cy="204" r="1.2"/><circle cx="1310" cy="235" r="1.1"/></g>
<circle cx="1458" cy="171" r="5.7" class="soft-dot"/>
<g transform="translate(1321 105)" class="hand"><path d="M-20-37 C-3-42 18-33 27-17 C39 5 30 31 8 39 C-11 46 -31 36 -39 18 C-24 28 -7 26 5 16 C18 4 19-14 10-26 C3-34 -8-38 -20-37 Z" fill="var(--ink)" opacity=".92" filter="url(#moonTexture)"/><path d="M-21-38 C-2-43 19-34 29-18 C42 4 32 32 9 40 C-10 47 -32 37 -41 18" fill="none" stroke="var(--ink)" stroke-width="1.0" opacity=".68"/></g>
<g transform="translate(1457 61)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star4" x="-9" y="-9" width="18" height="18"/></g>
<g transform="translate(1360 268)" style="color:var(--ink)" class="hand twinkle-c"><use href="#small-cross" x="-11" y="-11" width="22" height="22"/></g>
<path d="M1674 150 C1612 163 1559 191 1514 229 C1476 262 1446 306 1437 359" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.2 6.4" opacity=".84" class="hand"/>
<circle cx="1494" cy="251" r="5.2" fill="var(--ink)"/>
<g transform="translate(1574 304) rotate(-18)" class="hand"><ellipse cx="0" cy="0" rx="35" ry="8.5" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle cx="0" cy="0" r="14.5" fill="var(--blue)" opacity=".9"/><path d="M-11 -8 C-3 -13 5 -13 12 -6" fill="none" stroke="#8eafc7" stroke-width="1.0" opacity=".76"/></g>
<g fill="var(--ink)"><circle cx="1610" cy="436" r="1.2"/><circle cx="1570" cy="450" r="1.1"/><circle cx="1613" cy="464" r="1.45"/></g>
<g transform="translate(1556 507)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star8" x="-17" y="-17" width="34" height="34"/></g>
<g fill="var(--ink)"><circle cx="1611" cy="579" r="2"/><circle cx="1431" cy="697" r="1.7"/><circle cx="1325" cy="739" r="1.1"/></g>
<g class="hand"><path d="M1458 624 L1485 601 L1541 677 L1609 696 L1601 755 L1518 728 L1541 677" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.2 6" opacity=".88"/><use href="#star4" x="1449" y="615" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1476" y="592" width="19" height="19" style="color:var(--ink)"/><use href="#star4" x="1532" y="668" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1600" y="687" width="19" height="19" style="color:var(--ink)"/><use href="#star4" x="1592" y="746" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1509" y="719" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(1395 807)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-20" y="-20" width="40" height="40"/></g>
<circle cx="1547" cy="850" r="6.2" class="soft-dot" opacity=".86"/>
<g fill="var(--ink)"><circle cx="1222" cy="821" r="1.1"/><circle cx="1270" cy="823" r="1.6"/><circle cx="1354" cy="863" r="2.3"/><circle cx="1442" cy="843" r="1.15"/><circle cx="1490" cy="871" r="1.4"/><circle cx="1608" cy="810" r="1.5"/><circle cx="1605" cy="876" r="1.2"/></g>
<g transform="translate(1233 864)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-7" y="-7" width="14" height="14"/></g>
<g class="mid-sky">
<g fill="var(--ink)"><circle cx="700" cy="80" r="1.4"/><circle cx="760" cy="52" r="1.1"/><circle cx="890" cy="66" r="1.8"/><circle cx="950" cy="120" r="1.2"/><circle cx="690" cy="200" r="1.1"/><circle cx="980" cy="240" r="1.5"/><circle cx="720" cy="340" r="1.2"/><circle cx="960" cy="380" r="1.1"/><circle cx="680" cy="480" r="1.6"/><circle cx="990" cy="500" r="1.2"/><circle cx="740" cy="620" r="1.1"/><circle cx="950" cy="640" r="1.7"/><circle cx="700" cy="760" r="1.3"/><circle cx="970" cy="790" r="1.2"/><circle cx="800" cy="880" r="1.6"/><circle cx="900" cy="900" r="1.1"/></g>
<circle cx="836" cy="140" r="5.6" class="soft-dot"/><circle cx="730" cy="450" r="4.6" class="soft-dot" opacity=".8"/><circle cx="940" cy="560" r="5.2" class="soft-dot" opacity=".85"/><circle cx="810" cy="770" r="5.8" class="soft-dot" opacity=".75"/>
<g transform="translate(836 290)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-18" y="-18" width="36" height="36"/></g>
<g transform="translate(748 560)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star4" x="-12" y="-12" width="24" height="24"/></g>
<g transform="translate(930 680)" style="color:var(--ink)" class="hand twinkle-c"><use href="#star4" x="-11" y="-11" width="22" height="22"/></g>
<g transform="translate(860 440)" style="color:var(--ink)" class="hand twinkle-b"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<g transform="translate(780 800)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-8" y="-8" width="16" height="16"/></g>
<g class="hand"><path d="M700 200 L768 250 L836 290 L900 350 L930 430" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.3 6"/><use href="#star4" x="691" y="191" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="759" y="241" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="921" y="421" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(905 130) rotate(-16)" class="hand"><ellipse cx="0" cy="0" rx="24" ry="6" fill="none" stroke="var(--ink)" stroke-width="1.4"/><circle cx="0" cy="0" r="10" fill="var(--blue)" opacity=".9"/></g>
</g>
</svg>`;

function landingLifeBento(){
  const ask = 'Do my taxes';
  const apps = [
    { n:'WhatsApp', t:'whatsapp', d:'whatsapp.com', bg:'#fff' },
    { n:'Teams', t:'microsoftteams', d:'teams.microsoft.com', bg:'#fff' },
    { n:'Slack', t:'slack', d:'slack.com', bg:'#4A154B' },
    { n:'GitHub', t:'github', d:'github.com', bg:'#fff' },
    { n:'Notion', t:'notion', d:'notion.so', bg:'#fff' },
    { n:'Outlook', t:'outlook', d:'outlook.com', bg:'#0F6CBD' },
    { n:'Linear', t:'linear', d:'linear.app', bg:'#5E6AD2' },
    { n:'Canva', t:'canva', d:'canva.com', bg:'#fff' },
    { n:'HubSpot', t:'hubspot', d:'hubspot.com', bg:'#FF7A59' },
    { n:'Jira', t:'jira', d:'atlassian.com', bg:'#1868DB' },
    { n:'Stripe', t:'stripe', d:'stripe.com', bg:'#635BFF' },
    { n:'Asana', t:'asana', d:'asana.com', bg:'#F06A6A' },
    { n:'Instagram', t:'instagram', d:'instagram.com', bg:'#E1306C' },
    { n:'Dropbox', t:'dropbox', d:'dropbox.com', bg:'#0061FF' },
    { n:'Figma', t:'figma', d:'figma.com', bg:'#1E1E1E' },
    { n:'Zoom', t:'zoom', d:'zoom.us', bg:'#2D8CFF' },
    { n:'Salesforce', t:'salesforce', d:'salesforce.com', bg:'#00A1E0' },
    { n:'Airtable', t:'airtable', d:'airtable.com', bg:'#18BFFF' },
    { n:'LinkedIn', t:'linkedin', d:'linkedin.com', bg:'#0A66C2' },
    { n:'Monday', t:'monday', d:'monday.com', bg:'#6161FF' },
    { n:'Discord', t:'discord', d:'discord.com', bg:'#5865F2' },
    { n:'Spotify', t:'spotify', d:'spotify.com', bg:'#1DB954' },
    { n:'Shopify', t:'shopify', d:'shopify.com', bg:'#96BF48' },
    { n:'ClickUp', t:'clickup', d:'clickup.com', bg:'#7B68EE' },
    { n:'X', t:'twitter', d:'x.com', bg:'#fff' },
  ];
  const tile = a => `<span class="life-app-tile" title="${esc(a.n)}"><img src="https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(a.d)}" alt="${esc(a.n)}"></span>`;
  return `<section class="asection life-section" id="agent" aria-label="Bring anything to life">
      <div class="life-head">
        <h2>Bring anything to life</h2>
        <p class="lede">If you can think of it, your agent can make it real life.</p>
      </div>
      <div class="life-bento">
        <article class="life-card life-outcome">
          <div class="life-copy">
            <h3>Describe the outcome</h3>
            <p>Say what you want done. Your agent figures out the steps.</p>
          </div>
          <div class="life-visual">
            <button type="button" class="life-prompt" data-act="life-ask" data-prompt="${esc(ask)}" aria-label="${esc(ask)}">
              <span class="life-ph">${esc(ask)}...</span>
            </button>
          </div>
        </article>
        <article class="life-card life-apps">
          <div class="life-copy">
            <h3>Connect your life and apps</h3>
            <p>Mail, calendar, bills, files — your agent works where you already live.</p>
          </div>
          <div class="life-visual">
            <div class="life-apps-stage" aria-hidden="true">
              <div class="life-apps-grid">${apps.map(tile).join('')}</div>
            </div>
          </div>
        </article>
        <article class="life-card life-approve">
          <div class="life-copy">
            <h3>Approve every action</h3>
            <p>Sensitive work pauses until you say yes. Nothing runs without you.</p>
          </div>
          <div class="life-visual">
            <div class="life-chat-frame" aria-hidden="true">
              <div class="msg agent">
                <div class="body">
                  <div class="acard life-acard">
                    <div class="hd">
                      <div class="tile" style="background:var(--acc-soft);color:var(--acc)">${icon('shieldcheck',20)}</div>
                      <div><b>Allow Alva: ${esc(ask)}</b><div class="sub">Action approval</div></div>
                      <div class="st"><span class="chip">waiting for you</span></div>
                    </div>
                    <div class="bd">
                      <div class="life-drive">
                        <div class="life-drive-h"><b>Drive</b></div>
                        <div class="life-drive-path">My Drive › Taxes 2025</div>
                        <div class="life-drive-list">
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Declaration_2025.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Income_statement.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Dentist_receipt.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Interest_statement.pdf</span></div>
                        </div>
                      </div>
                    </div>
                    <div class="stack">
                      <span class="btn">${icon('check',15)} Allow</span>
                      <span class="btn green">Always allow</span>
                      <span class="btn soft">Deny</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
        <article class="life-card life-secure">
          <div class="life-copy">
            <h3>Data is kept secure and private</h3>
            <p>Its own isolated VM and credential store. Secrets never land in chat.</p>
          </div>
          <div class="life-visual">
            <div class="life-appframe" aria-hidden="true">
              <div class="phead"><h1>Vault</h1><span class="chip green">${icon('lock',12)} encrypted at rest</span></div>
              <div class="seg">
                <span>${icon('box',14)} Apps</span>
                <span class="on">${icon('key',14)} Secrets</span>
                <span>${icon('shieldcheck',14)} Approved</span>
              </div>
              <div class="warnband">${icon('shieldcheck',18)}<div><b>Your secrets remain protected.</b>Values are masked in chat and activity history. Reveal below is for your eyes alone, on this device.</div></div>
              <div class="kv">
                <div class="row"><span style="color:var(--mut)">${icon('laptop',16)}</span><div><b>Alva’s computer</b><div class="sub">Isolated VM · Sweden</div></div><div class="rgt"><span class="chip green">running</span></div></div>
                <div class="row"><span style="color:var(--mut)">${icon('lock',16)}</span><div><b class="mono">GMAIL_APP_PASSWORD</b><div class="sub">sec_mail · added 2h</div></div><div class="rgt"><span class="mono mut" style="letter-spacing:.08em">•••• •••• ••••</span><span class="iconbtn">${icon('eye',14)}</span></div></div>
                <div class="row"><span style="color:var(--mut)">${icon('lock',16)}</span><div><b class="mono">STRIPE_SECRET_KEY</b><div class="sub">sec_pay · added 1d</div></div><div class="rgt"><span class="mono mut" style="letter-spacing:.08em">•••• •••• ••••</span><span class="iconbtn">${icon('eye',14)}</span></div></div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>`;
}
function landingAgentPassport(){
  const agent = Mascot.svg('lingon', 'idle', 118);
  return `<div class="landing-passport-card" aria-label="Your secure agent passport">
    <div class="landing-phone-shell">
      <span class="landing-phone-island" aria-hidden="true"></span>
      <div class="landing-phone-screen">
        <div class="landing-passport-hero">
          <div class="landing-passport-mascot">${agent}</div>
          <b>Alva</b>
        </div>
        <div class="landing-passport-tabs" role="tablist" aria-label="Agent passport details">
          <button class="on" type="button" role="tab" aria-selected="true" aria-controls="landing-passport-name" data-act="landing-passport-tab" data-passport-tab="name">Name</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-mail" data-act="landing-passport-tab" data-passport-tab="mail">Mail</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-wallet" data-act="landing-passport-tab" data-passport-tab="wallet">Payments</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-computer" data-act="landing-passport-tab" data-passport-tab="computer">Computer</button>
        </div>
        <div class="landing-passport-slider">
          <section class="landing-passport-panel on" id="landing-passport-name" role="tabpanel" data-passport-panel="name">
            <label class="landing-passport-label">Agent name</label>
            <div class="landing-passport-input"><strong>Alva</strong>${icon('pencil',14)}</div>
            <label class="landing-passport-label">Appearance</label>
            <div class="landing-passport-swatches" aria-label="Appearance colours">${Mascot.keys.map(k => `<i class="${k === 'lingon' ? 'on' : ''}" title="${Mascot.PALETTE[k].name}" style="--swatch:${Mascot.PALETTE[k].body}"></i>`).join('')}</div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-mail" role="tabpanel" data-passport-panel="mail" hidden>
            <div class="landing-passport-mail-head"><span>${icon('mail',16)}</span><div><strong>Alva’s mail</strong><small>alva@mail.belna.se</small></div>${icon('refresh',14)}</div>
            <div class="landing-passport-mail-tabs"><span class="on">Inbox</span><span>Sent</span><span>Drafts</span><span>Write</span></div>
            <div class="landing-passport-mail-row"><i></i><div><strong>Welcome to your inbox</strong><small>Belna team</small><small>Your agent’s mailbox is ready.</small></div><time>now</time></div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-wallet" role="tabpanel" data-passport-panel="wallet" hidden>
            <div class="landing-passport-payment-card" aria-label="Shop Pay checkout preview">
              <div class="landing-passport-card-top"><span>belna</span><small>SHOP PAY</small></div>
              <div class="landing-passport-card-number">Shop with approval</div>
              <div class="landing-passport-card-bottom"><span>ALVA</span><span>SHOP PAY</span></div>
            </div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-computer" role="tabpanel" data-passport-panel="computer" hidden>
            <div class="landing-passport-computer-card">
              <span class="landing-passport-computer-icon">${icon('laptop',30)}</span>
              <strong>Alva’s computer</strong>
              <p>A private workspace for browsing, files and the work you ask your agent to do.</p>
            </div>
          </section>
        </div>
      </div>
      <div class="landing-phone-composer" aria-hidden="true">
        <span class="landing-phone-plus">+</span>
        <span class="landing-phone-message">Message Alva</span>
        <span class="landing-phone-mic">${icon('mic',16)}</span>
        <span class="landing-phone-bars"><i></i><i></i><i></i><i></i></span>
      </div>
      <span class="landing-phone-home" aria-hidden="true"></span>
    </div>
  </div>`;
}

/* ---------------- PROMO (hidden Swedish /promo landing) ----------------
   Hidden landing page: exact /promo URL only, never linked from main site.
   Copy (Swedish):
   - H1 starts with "Så här får du veckan att gå runt utan att barnen får det sämre."
   - Sub: "Städa, hämta, lämna, handla, tar det någonsin slut?"
   - Next: "Man skulle kunna tro att dagen tog slut vid 4, men händer det någonsin?"
   - Overflow visual: handla mat / städa / skola / sport
   - "Blir det någonsin en lugn stund? Hemma, jobbet? Var gick 8 timmars arbetsdagen 😂"
   - Vi-mot-dom: ChatGPT icon left, Belna mascot right, check/cross rows
     (our side only checkmarks: säker, färre trådar, agent, svensk)
   - "Belna är den första agenten som kan sköta handlingen, fakturorna och
      barnens schema – din egen mini-superman 🦸"
   - Phone graphic: Belna agent chat, user shops on ICA, approval card with
     ICA icon + shopping list
   - "Du äger din AI-agent. Varje agent har sin egna säkra dator, och ser aldrig
      dina uppgifter utan de blir krypterade. Och du bestämmer själv vad du vill godkänna."
   - Reused secure-agent phone graphic, then prompt box with
     "Börja gratis idag! Gillar du inte så tar vi bort ditt konto."
   - Top right: Get started etc. */
function renderPromo(){
  const chatgptFav = 'https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com';
  const icaFav = 'https://www.google.com/s2/favicons?sz=128&domain=ica.se';
  root.innerHTML = `
  <div class="fadeup promo-page">
    <div class="anav"><nav class="nav">
      <a class="abrand" href="/promo" data-act="top">${Mascot.logo(28)}belna</a>
      <div class="navlinks"><a href="/">Hem</a><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div class="anav-cta">
        <a class="btn ghost small" href="/app" data-act="signin-nav">Sign in</a>
        <a class="btn small" href="#promo-cta" data-act="promo-cta">Get started</a>
      </div>
    </nav></div>

    <div class="hero-wrap">
    <div class="belna-stars" aria-hidden="true">${STAR_SKY_SVG}</div>
    <header class="hero ahero promo-hero">
      <h1>Så här får du veckan att gå runt utan att barnen får det sämre.</h1>
      <p class="tagline"><strong>Städa, hämta, lämna, handla, tar det någonsin slut?</strong></p>
      <p class="tagline">Man skulle kunna tro att dagen tog slut vid 4, men händer det någonsin?</p>
      <div class="promo-overflow" aria-label="Vardagens överflöde: handla mat, städa, skola, sport">
        <div class="promo-overflow-card po-1"><span class="po-emoji">🛒</span><div><b>Handla mat</b><small>ICA · 17:30 · mjölk, ägg, pasta…</small></div></div>
        <div class="promo-overflow-card po-2"><span class="po-emoji">🧹</span><div><b>Städa</b><small>Tvättstugan · dammsuga · diska</small></div></div>
        <div class="promo-overflow-card po-3"><span class="po-emoji">🎒</span><div><b>Skola</b><small>Hämta 15:00 · lämna 08:00 · läxor</small></div></div>
        <div class="promo-overflow-card po-4"><span class="po-emoji">⚽</span><div><b>Sport</b><small>Träning 18:00 · match lördag · gympapåse</small></div></div>
        <div class="promo-overflow-card po-5"><span class="po-emoji">🧾</span><div><b>Fakturor</b><small>El · förskola · försäkring</small></div></div>
      </div>
      <div class="promo-calm"><span>Blir det någonsin en lugn stund?</span><span>Hemma, jobbet?</span><span>Var gick 8 timmars arbetsdagen? 😂</span></div>
      <p class="tagline promo-why">Det var därför vi skapade Belna, din egen AI-agent som kan sköta dagssysslorna.</p>
    </header>
    </div>

    <section class="asection promo-vs" aria-label="Vi mot dom">
      <div class="promo-section-head">
        <h2>Vanlig AI-chatt eller egen agent?</h2>
      </div>
      <div class="promo-vs-grid">
        <article class="promo-vs-card promo-vs-old">
          <div class="promo-vs-head"><img src="${chatgptFav}" alt="ChatGPT" width="28" height="28"><div><b>Vanliga AI-chattar</b><small>Svarar — men gör det inte åt dig</small></div></div>
          <ul>
            <li><span class="promo-mark cross">${icon('x',15)}</span><span><b>Säker</b><small>Dina uppgifter tränar andras modeller</small></span></li>
            <li><span class="promo-mark cross">${icon('x',15)}</span><span><b>Mer huvudvärk</b><small>Fler trådar – mer att hålla koll på</small></span></li>
            <li><span class="promo-mark cross">${icon('x',15)}</span><span><b>Ingen agent</b><small>Kan inte handla, betala eller boka</small></span></li>
            <li><span class="promo-mark cross">${icon('x',15)}</span><span><b>Inte svensk</b><small>Data utomlands, support på engelska</small></span></li>
          </ul>
        </article>
        <article class="promo-vs-card promo-vs-belna">
          <div class="promo-vs-head"><span class="promo-vs-mascot">${Mascot.svg('lingon','happy',40)}</span><div><b>Belna</b><small>Din egen agent som gör jobbet</small></div><span class="chip green">vår sida ✓</span></div>
          <ul>
            <li><span class="promo-mark check">${icon('check',15)}</span><span><b>Säker</b><small>Krypterat, isolerat, ditt</small></span></li>
            <li><span class="promo-mark check">${icon('check',15)}</span><span><b>Färre trådar</b><small>En agent håller ihop hela veckan</small></span></li>
            <li><span class="promo-mark check">${icon('check',15)}</span><span><b>Egen agent</b><small>Handlar, betalar och bokar åt dig</small></span></li>
            <li><span class="promo-mark check">${icon('check',15)}</span><span><b>Svensk</b><small>Byggd i Sverige, på svenska</small></span></li>
          </ul>
        </article>
      </div>
    </section>

    <section class="asection promo-agent" aria-label="Din egen mini-superman">
      <div class="promo-section-head">
        <p class="promo-superman"><strong>Belna</strong> är den första agenten som kan sköta handlingen, fakturorna och barnens schema — din egen minisuperman 🦸</p>
      </div>
      <div class="promo-phone-row">
        <div class="landing-phone-shell promo-chat-phone">
          <span class="landing-phone-island" aria-hidden="true"></span>
          <div class="landing-phone-screen">
            <div class="promo-chat-head"><span class="promo-chat-mascot">${Mascot.svg('lingon','idle',34)}</span><div><b>Alva</b><small>din agent · online</small></div></div>
            <div class="promo-chat-body">
              <div class="promo-bubble user">Kan du handla veckohandlingen på ICA? 🛒</div>
              <div class="promo-bubble agent">Fixat! Jag har plockat ihop listan — godkänn så betalar jag. 👇</div>
              <div class="promo-ica-card">
                <div class="promo-ica-head"><img src="${icaFav}" alt="ICA" width="22" height="22"><div><b>ICA — godkänn köp</b><small>Veckohandling · ICA Nära · 342 kr</small></div><span class="chip">väntar på dig</span></div>
                <div class="promo-ica-list">
                  <div><span>🥛</span>Mjölk 1 L</div>
                  <div><span>🥚</span>Ägg 12-pack</div>
                  <div><span>🍝</span>Pasta + krossade tomater</div>
                  <div><span>🍌</span>Bananer</div>
                  <div><span>☕</span>Kaffe</div>
                </div>
                <div class="promo-ica-actions"><span class="btn small">${icon('check',14)} Godkänn</span><span class="btn ghost small">Neka</span></div>
                <small class="promo-ica-note">Kort att godkänna köp — inget dras utan ditt ja.</small>
              </div>
            </div>
          </div>
          <div class="landing-phone-composer" aria-hidden="true">
            <span class="landing-phone-plus">+</span>
            <span class="landing-phone-message">Message Alva</span>
            <span class="landing-phone-mic">${icon('mic',16)}</span>
            <span class="landing-phone-bars"><i></i><i></i><i></i><i></i></span>
          </div>
          <span class="landing-phone-home" aria-hidden="true"></span>
        </div>
      </div>
    </section>

    <section class="asection promo-own" aria-label="Du äger din AI-agent">
      <div class="secure-agent-layout">
        <div class="secure-agent-copy">
          <h2>Du äger din AI-agent</h2>
          <p>Varje agent har sin egna säkra dator, och ser aldrig dina uppgifter utan de blir krypterade. Och du bestämmer själv vad du vill godkänna.</p>
        </div>
        ${landingAgentPassport()}
      </div>
    </section>

    <section class="cta2 promo-cta" id="promo-cta" aria-label="Börja gratis">
      <div class="kicker" style="font-size:12.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)">Börja gratis idag!</div>
      <h2>Vad vill du få gjort?</h2>
      <p class="mut" style="margin-top:8px">Gillar du inte så tar vi bort ditt konto.</p>
      <div class="promptwrap">
        <form class="promptbox" id="pform">
          <textarea id="pprompt" rows="2" placeholder="Be Alva handla på ICA, betala fakturorna, planera barnens schema…"></textarea>
          <div class="attach-pills"></div>
          <div class="pb-row">
            <button type="button" class="iconbtn" data-act="attach" title="Attach files" aria-label="Attach files">${icon('plus',17)}</button>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </section>

    <footer class="afooter"><div class="fin">
      <div><div class="abrand">${Mascot.logo(28)}belna</div></div>
      <div><h4>Product</h4><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div><h4>Company</h4><a href="#promo-cta" data-act="promo-cta">Get started</a><a href="/app" data-act="signin-nav">Sign in</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/security">Security</a><a href="/cookies">Cookie Policy</a><a href="/withdrawal">Withdraw from a purchase</a></div>
    </div><div class="base"><span>© 2026 Belna</span><a href="mailto:support@belna.se">support@belna.se</a></div></footer>
  </div>`;
  const f = document.getElementById('pform');
  const p = document.getElementById('pprompt');
  if (f && p){
    f.addEventListener('submit', e => {
      e.preventDefault();
      const v = p.value.trim();
      if (!v && !filesFor(f).length) return;
      const files = readyFiles(f);
      if (!files) return;
      p.value = '';
      clearFiles(f);
      landingRun(v || 'Please review the attached files.', files);
    });
    p.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); f.requestSubmit(); } });
  }
  wirePromptBox(document.getElementById('pform'), document.getElementById('pprompt'));
  try { window.scrollTo({ top:0 }); } catch {}
}

function renderLanding(){
  root.innerHTML = `
  <div class="fadeup">
    <div class="anav"><nav class="nav">
      <a class="abrand" href="/" data-act="top">${Mascot.logo(28)}belna</a>
      <div class="navlinks"><a href="/#agent" data-act="scroll" data-t="#agent">Product</a><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div class="anav-cta">
        <a class="btn ghost small" href="/app" data-act="signin-nav">Sign in</a>
        <a class="btn small" href="/app" data-act="open-app">Get started</a>
      </div>
    </nav></div>

    <div class="hero-wrap">
    <div class="belna-stars" aria-hidden="true">${STAR_SKY_SVG}</div>
    <header class="hero ahero">
      <h1>Bring anything <span class="mhold" id="mhold" title="Your Belna agent at work — handling mail, calls, laptop work and counting" aria-label="Your Belna agent at work — handling mail, calls, laptop work and counting">${Mascot.loop()}</span> to life.</h1>
      <div class="safe-note" style="margin-top:18px">Your personal AI agent</div>
      <div class="promptwrap">
        <form class="promptbox" id="lform">
          <textarea id="lprompt" rows="2" placeholder="Ask Belna to do my taxes..."></textarea>
          <div class="attach-pills"></div>
          <div class="pb-row">
            <button type="button" class="iconbtn" data-act="attach" title="Attach files" aria-label="Attach files">${icon('plus',17)}</button>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </header>
    </div>

    <section class="agent-compare" id="why-belna" aria-label="Why choose a personal Belna agent">
      <div class="compare-grid">
        <article class="compare-side compare-old">
          <div class="compare-copy">
            <span class="compare-kicker">Other AI apps</span>
            <h2>You get more threads,<br><span>more work and more costs.</span></h2>
          </div>
           <div class="thread-cloud" aria-hidden="true">
             <div class="thread-col tc-one">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Newsletter cleanup</span>
                   <span>${icon('chatb',14)} Email to landlord</span>
                   <span>${icon('chatb',14)} Same doc, next section</span>
                   <span>${icon('chatb',14)} Untitled</span>
                   <span>${icon('chatb',14)} Follow up on refund</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Newsletter cleanup</span>
                   <span>${icon('chatb',14)} Email to landlord</span>
                   <span>${icon('chatb',14)} Same doc, next section</span>
                   <span>${icon('chatb',14)} Untitled</span>
                   <span>${icon('chatb',14)} Follow up on refund</span>
                 </div>
               </div>
             </div>
             <div class="thread-col tc-two">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Find that document</span>
                   <span>${icon('chatb',14)} Summarize this PDF</span>
                   <span>${icon('chatb',14)} Draft client follow-up</span>
                   <span>${icon('chatb',14)} What did we decide?</span>
                   <span>${icon('chatb',14)} Meeting prep</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Find that document</span>
                   <span>${icon('chatb',14)} Summarize this PDF</span>
                   <span>${icon('chatb',14)} Draft client follow-up</span>
                   <span>${icon('chatb',14)} What did we decide?</span>
                   <span>${icon('chatb',14)} Meeting prep</span>
                 </div>
               </div>
             </div>
             <div class="thread-col tc-three">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Weekly status update</span>
                   <span>${icon('chatb',14)} New chat</span>
                   <span>${icon('chatb',14)} Trip planning</span>
                   <span>${icon('chatb',14)} Quick question</span>
                   <span>${icon('chatb',14)} Another new chat</span>
                   <span>${icon('chatb',14)} Where was that file?</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Weekly status update</span>
                   <span>${icon('chatb',14)} New chat</span>
                   <span>${icon('chatb',14)} Trip planning</span>
                   <span>${icon('chatb',14)} Quick question</span>
                   <span>${icon('chatb',14)} Another new chat</span>
                   <span>${icon('chatb',14)} Where was that file?</span>
                 </div>
               </div>
             </div>
          </div>
        </article>

        <article class="compare-side compare-belna">
          <div class="compare-copy">
            <span class="compare-kicker">With Belna</span>
            <h2>You get one personal agent<br><span>that does the work.</span></h2>
          </div>
          <div class="agent-system" aria-hidden="true">
            <span class="orbit-ring orbit-one"></span>
            <span class="orbit-ring orbit-two"></span>
            <span class="orbit-ring orbit-three"></span>
            <span class="orbit-agent oa-one" title="Family schedule">${Mascot.svg('lingon','happy',64,'','schedule')}</span>
            <span class="orbit-agent oa-two" title="School">${Mascot.svg('blueberry','think',58,'','school')}</span>
             <span class="orbit-agent oa-three" title="Football practice">${Mascot.svg('moss','happy',54,'','football')}</span>
             <span class="orbit-agent oa-four" title="Grocery shopping">${Mascot.svg('rose','happy',50,'','bag')}</span>
             <div class="compare-mascot">${Mascot.laptop()}</div>
           </div>
        </article>
      </div>
    </section>

    <section class="asection secure-agent-section" id="secure-agent" aria-label="Your own secure agent">
      <div class="secure-agent-layout">
        <div class="secure-agent-copy">
          <h2>Your own secure agent</h2>
          <p>Your agent gets a personal identity, private mailbox, Shop Pay checkout and its own computer — all in one place, always under your control.</p>
        </div>
        ${landingAgentPassport()}
      </div>
    </section>

    ${landingLifeBento()}

    <section class="asection" id="safety" aria-label="Safe Swedish AI">
      <div class="safety-layout">
        <div class="safety-copy">
          <h2>Safe Swedish AI</h2>
          <p class="lede">Arche 1.0 is built on the open source Kimi K3 model, with an Agentic harness optimized for privacy and safety.</p>
        </div>
        <div class="panel model-card">
          <div class="mc-title">Arche 1.0 vs frontier models</div>
          <div class="mc-scroll-hint">Swipe table to compare models →</div>
          <div class="mc-table"><table class="btable">
            <thead><tr><th>Benchmark</th><th class="star">Arche 1.0<sup>†</sup></th><th>GPT-6 Sol</th><th>Claude Opus 5.5</th><th>GPT-6 Astra</th></tr></thead>
            <tbody>
              <tr><td>GDPval-AA v2.1 (Elo)</td><td class="star">1,524</td><td>1,487</td><td>1,846</td><td>1,542</td></tr>
              <tr><td>AA-Briefcase v1.1 (Elo)</td><td class="star">1,510</td><td>1,483</td><td>1,822</td><td>1,569</td></tr>
              <tr><td>AA-LCR v1.1</td><td class="star">89%</td><td>84%</td><td>85%</td><td>81%</td></tr>
              <tr><td>SciCode</td><td class="star">59%</td><td>58%</td><td>67%</td><td>56%</td></tr>
              <tr><td>Humanity's Last Exam</td><td class="star">47%</td><td>48%</td><td>61%</td><td>55%</td></tr>
            </tbody>
          </table></div>
          <div class="fineprint mc-foot"><span>Independent Artificial Analysis results at max effort. † Arche 1.0 scores reflect its foundation model, not the full agent. <a href="/research-arche-1-0#results">Methods and sources</a>.</span></div>
        </div>
      </div>
    </section>

    <section class="cta2" id="cta" aria-label="Start">
      <div class="kicker" style="font-size:12.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)">Start now</div>
      <h2>What do you want to do?</h2>
      <div class="promptwrap">
        <form class="promptbox" id="lform2">
          <textarea id="lprompt2" rows="2" placeholder="Tell your agent… e.g. Plan my week, build me a page, research a topic"></textarea>
          <div class="attach-pills"></div>
          <div class="pb-row">
            <button type="button" class="iconbtn" data-act="attach" title="Attach files" aria-label="Attach files">${icon('plus',17)}</button>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </section>

    <footer class="afooter"><div class="fin">
      <div><div class="abrand">${Mascot.logo(28)}belna</div></div>
      <div><h4>Product</h4><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div><h4>Company</h4><a href="/app" data-act="open-app">Get started</a><a href="/app" data-act="signin-nav">Sign in</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/security">Security</a><a href="/cookies">Cookie Policy</a><a href="/withdrawal">Withdraw from a purchase</a></div>
    </div><div class="base"><span>© 2026 Belna</span><a href="mailto:support@belna.se">support@belna.se</a></div></footer>
  </div>`;
  const wire = (formId, inputId) => {
    const f = document.getElementById(formId);
    const p = document.getElementById(inputId);
    if (f && p){
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = p.value.trim();
        if (!v && !filesFor(f).length) return;
        const files = readyFiles(f);
        if (!files) return;
        p.value = '';
        clearFiles(f);
        landingRun(v || 'Please review the attached files.', files);
      });
      p.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); f.requestSubmit(); } });
    }
  };
  wire('lform', 'lprompt');
  wire('lform2', 'lprompt2');
  wirePromptBox(document.getElementById('lform'), document.getElementById('lprompt'));
  wirePromptBox(document.getElementById('lform2'), document.getElementById('lprompt2'));
  belnaStartTypewriter();
  // The landing sections are rendered after navigation, so a hash from a
  // public page can resolve before its target exists in the document.
  const landingTarget = window.location.hash.slice(1);
  if (landingTarget === 'agent' || landingTarget === 'cta') {
    requestAnimationFrame(() => document.getElementById(landingTarget)?.scrollIntoView({ block:'start' }));
  }
}

async function landingRun(prompt, files = []){
  // Homepage prompt never starts a chat on the homepage itself.
  // It is saved and handed off: signed-out → sign up / log in screen,
  // signed-in → agent chat (with in-chat onboarding first when needed).
  if (!prompt) return;
  prompt = String(prompt).trim().slice(0, 2000);
  if (!prompt) return;
  // Homepage prompt always requires a real account — no demo/sample agents.
  // Save first so sign-up / log-in can place it into the agent chat.
  state.pendingPrompt = prompt;
  state.pendingPromptFiles = files;
  save();
  if (isPromoRoute()) leavePromo();
  if (!signedIn()){
    renderAuth();
    toast('Sign up or log in — your message is saved and will be sent in the agent chat.');
    try { const mm = document.getElementById('amsg'); if (mm) mm.textContent = 'Sign up or log in to send your message to your agent.'; } catch {}
    return;
  }
  ensureOwnerScope();
  if (!state.onboarded || !state.agent || state.agent.provisional){
    await startPendingPromptFlow(prompt);
    return;
  }
  // Already onboarded: open a chat and run for real.
  const c = { id: uid(), title: prompt.length > 42 ? prompt.slice(0, 42) + '…' : prompt, messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat';
  state.pendingPrompt = null; state.pendingPromptFiles = []; save();
  renderApp();
  await sendPromptDirect(c, prompt, files);
}

/* One persisted onboarding chat for every new account, with or without a request. */
function startPendingPromptFlow(pendingOverride){
  if (!signedIn()) { renderAuth(); return; }
  ensureOwnerScope();
  if (typeof pendingOverride === 'string' && pendingOverride.trim()) state.pendingPrompt = pendingOverride.trim();
  if (!state.agent) state.agent = { name:'Your agent', color:'lingon', pers:'Playful', provisional:true };
  state.agent.provisional = true;
  let c = state.chats.find(item => item.onboarding);
  if (!c) {
    c = { id:uid(), title:'Meet your agent', messages:[], trace:[], artifact:null, createdAt:Date.now(), onboarding:true };
    state.chats.unshift(c);
  }
  if (state.pendingPrompt && !c.messages.some(m => m.role === 'user' && m.text === state.pendingPrompt)) {
    c.messages.push({ id:uid(), role:'user', kind:'text', text:state.pendingPrompt, files:state.pendingPromptFiles?.length ? state.pendingPromptFiles : undefined });
  }
  state.activeChat = c.id; state.view = 'chat'; state.canvasOpen = false;
  mobileNavOpen = false;
  runInChatOnboarding(c);
  save(); renderApp();
}

function pendingQuestion(c){
  return c && (c.messages || []).slice().reverse().map(m => ({c,m})).find(({m}) => m.card?.type === 'question' && m.card.status === 'pending');
}

function runInChatOnboarding(c){
  c.busy = false;
  // Migrate interrupted setup from the previous question flow.
  if (!c.onboardingAnswers) {
    c.onboardingAnswers = {};
    for (const m of c.messages) {
      if (!m.card?.onboarding) continue;
      if (m.card.status === 'answered' && m.card.choice) {
        if (/look|color/i.test(m.card.q)) c.onboardingAnswers.color = Mascot.keys.find(k => Mascot.PALETTE[k].name === m.card.choice);
        else if (/name/i.test(m.card.q)) c.onboardingAnswers.name = String(m.card.choice).trim().slice(0,18);
      }
    }
    c.messages = c.messages.filter(m => !m.card?.onboarding || m.card.status === 'answered');
  }
  const answers = c.onboardingAnswers;
  if (c.messages.some(m => m.card?.onboarding && m.card.status === 'pending')) return;
  const say = text => c.messages.push({ id:uid(), role:'agent', kind:'text', text, mood:'happy' });
  const card = data => c.messages.push({ id:uid(), kind:'card', card:{...data, onboarding:true, status:'pending'} });
  if (!answers.name) {
    if (!c.onboardingWelcomed) {
      say(state.pendingPrompt ? 'Hej! I’ve saved your request. Let’s make your agent yours before I get started.' : 'Hej! Let’s set up your personal agent. First, give me a name.');
      c.onboardingWelcomed = true;
    }
    card({ type:'question', step:'name', q:'What should I call myself?', options:['Alex','Rosa','Tao'], customName:true });
  } else if (!answers.color) {
    state.agent.name = publicAgentName(answers.name);
    card({ type:'question', step:'color', q:'Pick a color for ' + state.agent.name, options:Mascot.keys.map(k => Mascot.PALETTE[k].name), mascotColors:true });
  } else {
    state.agent.name = publicAgentName(answers.name); state.agent.color = answers.color;
    say('Hej ' + currentUser().name + '! I’m ' + state.agent.name + ', your personal agent. I have my own secure computer and can work on your behalf: browse the web, research, write, code, create files, and help manage tasks across your connected apps. Tell me what you want done, and I’ll take it from there. I’ll ask for access or approval when needed.');
    card({ type:'passport', title:'Your agent is ready', note:'Finish setup and start chatting.' });
  }
}

function answerOnboarding(c, m, value){
  if (!signedIn() || !needsOnboarding() || !c?.onboarding || !m?.card?.onboarding || m.card.status !== 'pending' || m.card.type !== 'question') return;
  const choice = String(value || '').trim().slice(0, m.card.step === 'name' ? 18 : 60);
  if (!choice) { toast('Type a name or choose a suggestion.'); return; }
  if (m.card.step === 'color') {
    const key = Mascot.keys.find(k => k.toLowerCase() === choice.toLowerCase() || Mascot.PALETTE[k].name.toLowerCase() === choice.toLowerCase());
    if (!key) { toast('Choose one of the colors shown.'); return; }
    c.onboardingAnswers.color = key;
  } else c.onboardingAnswers.name = choice;
  m.card.choice = choice; m.card.status = 'answered';
  runInChatOnboarding(c); save(); renderApp();
}

async function openOnboardingPassport(c, m){
  if (!signedIn() || !c?.onboarding || m?.card?.type !== 'passport' || m.card.status !== 'pending') return;
  const answers = c.onboardingAnswers;
  if (!answers?.name || !Mascot.PALETTE[answers.color]) return;
  const ownerId = currentUserId();
  state.agent = { name:publicAgentName(answers.name), color:answers.color, pers:'Playful', ownerId, claimedAt:Date.now() };
  state.onboarded = true; c.onboarding = false; c.busy = false; m.card.status = 'done';
  const pending = state.pendingPrompt;
  state.pendingPrompt = null;
  state.pendingPromptFiles = [];
  state.canvasOpen = true; state.canvasTab = 'canvas';
  save(); renderApp();
  ensureMailbox(answers.name).catch(() => {});
  if (pending) await runAgentOn(c, pending);
}

function runningTask(c){
  return c && c.activeTask && c.activeTask.status === 'running' ? c.activeTask : null;
}

function updateDelegation(c, task, status, note){
  if (!c || !task || !task.cardMessageId) return;
  const m = (c.messages || []).find((message) => message.id === task.cardMessageId);
  if (!m || m.kind !== 'card' || m.card.type !== 'subagents') return;
  m.card.status = status;
  const worker = m.card.agents && m.card.agents[0];
  if (worker) { worker.status = status; worker.note = note || status; }
  replaceNode(c, m);
}

function stopDelegatedTask(c, status = 'interrupted'){
  const task = runningTask(c);
  if (!task) return null;
  const run = taskRuns.get(c.id);
  if (run && run.taskId === task.id) run.controller.abort();
  taskRuns.delete(c.id);
  task.status = status;
  task.finishedAt = Date.now();
  updateDelegation(c, task, status, status === 'interrupted' ? 'interrupted by you' : status);
  save();
  return task;
}

async function launchDelegatedTask(c, prompt, options = {}){
  const controller = new AbortController();
  const task = {
    id: uid(), kind: options.kind || Engine.taskKind(prompt) || 'general',
    prompt, status: 'running', startedAt: Date.now(), updates: options.updates || [],
  };
  c.activeTask = task;
  c.busy = false;
  const rt = makeRT(c);
  const delegation = rt.card({
    type: 'subagents', status: 'pending',
    agents: [{ name: `${task.kind} worker`, desc: String(prompt).slice(0, 120), status: 'running' }],
  });
  task.cardMessageId = delegation.msg.id;
  taskRuns.set(c.id, { taskId: task.id, controller });
  save(); paintSide(); paintMain();

  const intro = options.openedNewChat
    ? `I opened a new chat for this separate task and delegated the work to a sub-agent. The other task can keep running, and I'm available here while this worker continues.`
    : options.updated
      ? `Understood. I interrupted the previous worker and delegated the updated instructions to a fresh sub-agent. I'm still available while it runs.`
      : `I've delegated the work to a sub-agent so I stay available here. You can ask questions, change direction, or stop it at any time while it runs.`;
  await rt.say(intro, { mood: 'think' });
  if (controller.signal.aborted) return;

  try {
    await Engine.runTask(rt, prompt, { ...task, signal: controller.signal });
    if (c.activeTask?.id !== task.id || controller.signal.aborted) return;
    task.status = 'done'; task.finishedAt = Date.now();
    updateDelegation(c, task, 'done', 'completed');
  } catch (e) {
    if (controller.signal.aborted || e?.name === 'AbortError') return;
    console.error(e);
    if (c.activeTask?.id === task.id) {
      task.status = 'failed'; task.finishedAt = Date.now();
      updateDelegation(c, task, 'failed', 'failed');
      await rt.say('The delegated worker could not complete that task. I am still available, and you can retry or change the instructions.', { mood: 'think' });
    }
  } finally {
    const run = taskRuns.get(c.id);
    if (run?.taskId === task.id) taskRuns.delete(c.id);
    save(); paintMain(); paintSide();
  }
}

/* Run Engine on text already present in the thread (no duplicate user bubble).
   Real accounts only. */
async function runAgentOn(c, text){
  if (!c || !text) return;
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); return; }
  if (state.view !== 'chat') state.view = 'chat';
  if (Engine.isTask(text)) {
    launchDelegatedTask(c, text);
    return;
  }
  c.coordinatorRuns = Number(c.coordinatorRuns || 0) + 1; save();
  floatLive.delete(c.id);
  paintSide(); paintMain();
  const rt = makeRT(c);
  try { await Engine.run(rt, text); }
  catch (e){ console.error(e); await rt.say('Something went wrong on my end — please try again in a moment.'); }
  c.coordinatorRuns = Math.max(0, Number(c.coordinatorRuns || 1) - 1); save(); paintMain(); paintSide();
}
/* Direct send for an already-created chat (message not yet in thread). */
async function sendPromptDirect(c, text, files = []){
  if (!c || !text) return;
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); return; }
  c.messages.push({ id: uid(), role: 'user', kind: 'text', text, files:files.length ? files : undefined });
  if (c.title === 'New chat' || !c.title) c.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
  save(); paintSide(); paintMain();
  await runAgentOn(c, text);
}

/* ================================================================
   ONBOARDING
================================================================ */
const PERS = ['Playful','Precise','Calm','Bold'];
const THEMES = [
  { id:'grey', name:'Standard Grey', c:'#5A5D63' },
  { id:'brick', name:'Classic Blue', c:'#3B6DD9' },
  { id:'blue', name:'Blue', c:'#4353C6' },
  { id:'yellow', name:'Yellow', c:'#8A6D1A' },
  { id:'green', name:'Green', c:'#4E7A38' },
  { id:'pink', name:'Pink', c:'#B14E85' },
];
function applyTheme(){
  if (!THEMES.some(t => t.id === state.theme)) state.theme = 'grey';
  try { document.body.setAttribute('data-accent', state.theme); } catch {}
}

function openOnboarding(){ return startPendingPromptFlow(); }

/* ================================================================
   APP SHELL — smooth drawers (no full re-render on toggle)
   Left nav (mobile) slides via .mobile-nav-open; right canvas slides via
   .nocanvas removal. Both keep their DOM mounted so CSS transitions run.
================================================================ */
function canvasShouldShow(){
  return !!(state.canvasOpen && state.view === 'chat');
}
function syncShellClasses(){
  const app = $('#app');
  if (!app) return;
  app.classList.toggle('nocanvas', !canvasShouldShow());
  app.classList.toggle('mobile-nav-open', !!mobileNavOpen);
  const t = app.querySelector('.mobile-nav-toggle');
  if (t){
    t.setAttribute('aria-label', mobileNavOpen ? 'Close navigation' : 'Open navigation');
    t.setAttribute('aria-expanded', mobileNavOpen ? 'true' : 'false');
    t.innerHTML = icon(mobileNavOpen ? 'x' : 'menu', 20);
  }
  const side = app.querySelector('#side');
  if (side) side.setAttribute('aria-hidden', mobileNavOpen || window.matchMedia('(min-width: 761px)').matches ? 'false' : 'true');
  const cv = app.querySelector('#canvas');
  if (cv) cv.setAttribute('aria-hidden', canvasShouldShow() ? 'false' : 'true');
  try { document.body.classList.toggle('nav-lock', !!mobileNavOpen && window.matchMedia('(max-width: 760px)').matches); } catch {}
}
function setMobileNav(open, opts = {}){
  mobileNavOpen = !!open;
  const app = $('#app');
  if (!app){ return; }
  // In-place class toggle preserves the .side element so the slide animates.
  syncShellClasses();
  if (mobileNavOpen && workspaceIntroStartedAt === null) paintSide();
  if (mobileNavOpen && opts.focus !== false){
    const first = app.querySelector('#side .sitem, #side .btn, #side .sidebrand');
    if (first && window.matchMedia('(max-width: 760px)').matches){ try { first.focus({ preventScroll:true }); } catch {} }
  } else if (!mobileNavOpen && opts.refocus){
    const t = app.querySelector('.mobile-nav-toggle');
    if (t){ try { t.focus({ preventScroll:true }); } catch {} }
  }
}
function setCanvasOpen(open, opts = {}){
  state.canvasOpen = !!open;
  save();
  const app = $('#app');
  if (!app){ return; }
  if (state.canvasOpen){
    // Mount content first, then reveal on next frame so the slide runs.
    if (opts.tab) state.canvasTab = opts.tab;
    paintCanvas();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      syncShellClasses();
      if (opts.focus !== false){
        const close = $('#canvas .canvas-close');
        if (close && window.matchMedia('(max-width: 1100px)').matches){ try { close.focus({ preventScroll:true }); } catch {} }
      }
    }));
  } else {
    // Keep painted content during slide-out; hiding is pure CSS.
    syncShellClasses();
    try { liveClose(); } catch {}
  }
}
let shellKeysWired = false;
function wireShellKeys(){
  if (shellKeysWired) return;
  shellKeysWired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.goalMenu && state.view === 'goals'){
      const id = state.goalMenu;
      state.goalMenu = null; paintGoals($('#main'));
      $('#main [data-act="goal-menu"][data-id="' + id + '"]')?.focus();
      e.preventDefault(); return;
    }
    if (mobileNavOpen){ e.preventDefault(); setMobileNav(false, { refocus:true }); return; }
    if (canvasShouldShow() && window.matchMedia('(max-width: 1100px)').matches){ e.preventDefault(); setCanvasOpen(false); }
  });
  try {
    const mq = window.matchMedia('(min-width: 761px)');
    const onChange = () => { if (mq.matches && mobileNavOpen) setMobileNav(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {}
}
function renderApp(){
  if (!signedIn()){ renderAuth(); return; }
  ensureOwnerScope();
  if (needsOnboarding()) {
    if (!chat()?.onboarding) return startPendingPromptFlow();
    state.view = 'chat';
  }
  if (!state.agent) state.agent = { name: 'Your agent', color: 'lingon', pers: 'Playful', provisional: true, claimedAt: Date.now() };
  applyTheme();
  belnaStopLandingFx();
  root.innerHTML = `
  <div class="app ${canvasShouldShow() ? '' : 'nocanvas'} ${mobileNavOpen ? 'mobile-nav-open' : ''}" id="app">
    <button class="mobile-nav-toggle" data-act="togglemenu" aria-label="${mobileNavOpen ? 'Close navigation' : 'Open navigation'}" aria-expanded="${mobileNavOpen}">${icon(mobileNavOpen ? 'x' : 'menu',20)}</button>
    <button class="side-scrim" data-act="togglemenu" aria-label="Close navigation" tabindex="-1"></button>
    <aside class="side" id="side" aria-hidden="${mobileNavOpen ? 'false' : 'true'}"></aside>
    <main class="main" id="main"></main>
    <aside class="canvas" id="canvas" aria-hidden="${canvasShouldShow() ? 'false' : 'true'}"></aside>
    <button class="canvas-scrim" data-act="closecanvas" aria-label="Close canvas" tabindex="-1"></button>
  </div>`;
  wireShellKeys();
  paintSide(); paintMain(); paintCanvas();
  syncShellClasses();
  // Goals and Library are account data the agent can change; refresh at most every 30s.
  refreshGoals(false); refreshLibrary(false);
}

function currentUser(){
  let sess = null;
  try { sess = window.LingonAuth && window.LingonAuth.get(); } catch {}
  // No fake fallback identity — unauthenticated callers get an explicit guest.
  const email = (sess && sess.user && sess.user.email) || '';
  const name = (state.userProfile && state.userProfile.name) || (email ? email.split('@')[0] : 'Guest');
  return { email: email || 'signed-out', name };
}
function artifactRows(){
  const rows = [];
  state.chats.forEach(c => {
    if (c.artifact) rows.push({
      title: c.artifact.title,
      kind: c.artifact.kind,
      chat: c.title,
      chatId: c.id,
      card: { ...c.artifact, type:'artifact', title:c.artifact.title, name:c.artifact.title },
      source:'agent',
      at: c.updatedAt || c.createdAt || Date.now(),
    });
    (c.messages || []).forEach(m => {
      if (m.kind === 'card' && (m.card.type === 'file' || m.card.type === 'canvas' || m.card.type === 'artifact')) rows.push({
        title: m.card.name || m.card.title,
        kind: m.card.type,
        chat: c.title,
        chatId: c.id,
        messageId:m.id,
        card: m.card,
        source:'agent',
        at: m.at || m.createdAt || c.updatedAt || c.createdAt || Date.now(),
      });
      // attached uploads (jpg / mp4 / mp3 / mov / png …) live on m.files
      (m.files || []).forEach((f, fi) => {
        if (!f || !f.name) return;
        rows.push({
          title: f.name,
          kind:'file',
          chat: c.title,
          chatId: c.id,
          messageId: m.id,
          fileIndex: fi,
          card: { type:'file', name: f.name, dataUrl: f.dataUrl, mime: f.type, size: f.size },
          source:'upload',
          at: m.at || m.createdAt || c.updatedAt || c.createdAt || Date.now(),
        });
      });
    });
  });
  // Library uploads are kept separate from chat history so uploading a file
  // here never creates a pretend chat message. The file itself remains real.
  (state.libraryUploads || []).forEach((f) => {
    if (!f || !f.name) return;
    rows.push({
      id:'upload:' + f.id,
      title:f.name,
      kind:'file',
      chat:'Library upload',
      source:'upload',
      libraryUpload:true,
      uploadId:f.id,
      card:{ type:'file', name:f.name, dataUrl:f.dataUrl, mime:f.type, size:f.size },
      at:Number(f.at || Date.now()),
    });
  });
  rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  return rows;
}
/* ---------- Library: media vs artifacts split + branded previews ---------- */
const LIB_IMAGE_EXT = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
const LIB_VIDEO_EXT = ['mp4','mov','webm','mkv','avi','m4v'];
const LIB_AUDIO_EXT = ['mp3','wav','ogg','m4a','flac','aac','opus'];
const LIB_DOC_EXT = ['pdf','doc','docx','txt','md','csv','xls','xlsx','ppt','pptx','json','zip'];
function libExt(name){
  const s = String(name || '').split('?')[0].split('#')[0];
  const m = s.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}
function libMediaType(row){
  const ext = libExt(row.title);
  if (LIB_IMAGE_EXT.includes(ext)) return 'image';
  if (LIB_VIDEO_EXT.includes(ext)) return 'video';
  if (LIB_AUDIO_EXT.includes(ext)) return 'audio';
  return '';
}
function libItemType(row){
  const media = libMediaType(row);
  if (media) return media;
  const kind = String(row.kind || '').toLowerCase();
  const title = String(row.title || '').toLowerCase();
  if (kind === 'canvas' || row.card?.type === 'canvas') return 'web';
  if (/\.html?$|\bweb\b|website|landing|canvas/.test(title + ' ' + kind)) return 'web';
  const ext = libExt(row.title);
  if (LIB_DOC_EXT.includes(ext) || kind === 'file') return 'document';
  return 'artifact';
}
function libCatFor(item){
  const t = item._type;
  if (t === 'image') return 'images';
  if (t === 'video') return 'videos';
  if (t === 'audio') return 'podcasts';
  if (t === 'document') return 'documents';
  if (t === 'web') return 'web';
  return 'artifact';
}
// Account Library items (agent artifacts and uploads) plus older chat-only files.
const LIB_KIND_TYPE = { document:'document', web:'web', image:'image', video:'video', audio:'audio' };
function libraryItems(){
  const account = (state.libraryServer || []).map(item => ({
    id:'lib:' + item.id, libraryId:item.id, title:item.title, kind:item.kind, mime:item.mime, size:item.size, preview:item.preview,
    chat:item.source === 'upload' ? 'Library upload' : 'Made by agent', chatId:item.chatId, source:item.source, at:item.createdAt,
    card:{ type:'file', name:item.title, mime:item.mime, libraryId:item.id },
    _type:LIB_KIND_TYPE[item.kind] || 'artifact', _source:item.source === 'upload' ? 'upload' : 'agent', sub:null,
  }));
  const onAccount = new Set(account.map(item => item.libraryId));
  const real = artifactRows().filter(r => !(r.card?.libraryId && onAccount.has(r.card.libraryId))).map((r, i) => {
    const type = libItemType(r);
    const fid = r.fileIndex !== undefined ? ':f' + r.fileIndex : '';
    const id = r.libraryUpload ? 'upload:' + r.uploadId : (r.chatId || 'c') + ':' + (r.messageId || 'a') + ':' + i + fid;
    return { id, ...r, _type: type, _source: r.source === 'upload' ? 'upload' : 'agent', sub: null };
  });
  return [...account, ...real].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
function libraryFiltered(){
  const cat = state.libraryCat || 'all';
  const q = String(state.librarySearch || '').toLowerCase().trim();
  if (cat === 'system') return [];
  let items = libraryItems();
  if (cat === 'images') items = items.filter(x => x._type === 'image');
  else if (cat === 'videos') items = items.filter(x => x._type === 'video');
  else if (cat === 'podcasts') items = items.filter(x => x._type === 'audio');
  else if (cat === 'documents') items = items.filter(x => x._type === 'document');
  else if (cat === 'web') items = items.filter(x => x._type === 'web');
  else if (cat === 'artifacts') items = items.filter(x => !['image','video','audio'].includes(x._type));
  else if (cat === 'system') items = [];
  // 'all' shows everything (artifacts + media), like the reference
  if (q) items = items.filter(x => String(x.title || '').toLowerCase().includes(q) || String(x.chat || '').toLowerCase().includes(q));
  return items;
}
function libTypeLabel(t){
  if (t === 'folder') return 'Folder';
  if (t === 'system') return 'System file';
  if (t === 'image') return 'Image';
  if (t === 'video') return 'Video';
  if (t === 'audio') return 'Audio';
  if (t === 'document') return 'Text';
  if (t === 'web') return 'Artifact';
  return 'Artifact';
}
function libIconFor(t){
  if (t === 'folder') return 'folder';
  if (t === 'system') return 'file';
  if (t === 'image') return 'image';
  if (t === 'video') return 'video';
  if (t === 'audio') return 'podcast';
  if (t === 'document') return 'doc';
  if (t === 'web') return 'easel';
  return 'spark';
}
function libraryTextContent(item){
  const card = item.card || {};
  if (typeof card.content === 'string') return card.content;
  if (typeof card.text === 'string') return card.text;
  if (typeof card.code === 'string') return card.code;
  if (Array.isArray(card.items)) return card.items.join('\n');
  return '';
}
function libUnavailablePreview(item, label){
  const managed = item.card?.managedArtifactId && item.chatId
    ? ` data-lib-managed="${esc(item.card.managedArtifactId)}" data-lib-chat="${esc(item.chatId)}"`
    : '';
  return `<div class="lib-prev lib-prev-unavailable"${managed}><span class="lib-prev-unavailable-icon">${icon(libIconFor(item._type), 26)}</span><b>${esc(label)}</b><span>Open the real file to preview it.</span></div>`;
}
function libPreviewHtml(item){
  const t = item._type;
  if (item.libraryId) {
    if (t === 'document' && item.preview) return `<div class="lib-prev lib-prev-doc"><pre>${esc(item.preview)}</pre><span class="lib-prev-fname">${esc(item.title)}</span></div>`;
    const loaded = libraryItemContent(item.libraryId);
    if (!loaded.content) return `<div class="lib-prev lib-prev-unavailable"><span class="lib-prev-unavailable-icon">${icon(libIconFor(t), 26)}</span><b>${loaded.error ? 'Preview unavailable' : 'Loading preview…'}</b></div>`;
    const media = loaded.content.startsWith('data:');
    item = { ...item, card:{ ...item.card, dataUrl:media ? loaded.content : undefined, content:media ? undefined : loaded.content, html:t === 'web' && !media ? loaded.content : undefined } };
  }
  const dataUrl = item.card && item.card.dataUrl;
  const isImgUrl = dataUrl && /^data:image\//.test(String(dataUrl));
  const isVidUrl = dataUrl && /^data:video\//.test(String(dataUrl));
  const isAudioUrl = dataUrl && /^data:audio\//.test(String(dataUrl));
  if (t === 'image'){
    if (isImgUrl) return `<div class="lib-prev lib-prev-photo"><img src="${esc(dataUrl)}" alt="${esc(item.title)}" loading="lazy"><span class="lib-prev-fname">${esc(item.title)}</span></div>`;
    return libUnavailablePreview(item, 'Image file');
  }
  if (t === 'video'){
    if (isVidUrl) return `<div class="lib-prev lib-prev-photo"><video src="${esc(dataUrl)}" muted playsinline preload="metadata"></video><span class="lib-prev-play">${icon('play',26)}</span><span class="lib-prev-fname">${esc(item.title)}</span></div>`;
    return libUnavailablePreview(item, 'Video file');
  }
  if (t === 'audio'){
    if (isAudioUrl) return `<div class="lib-prev lib-prev-audio-real"><audio src="${esc(dataUrl)}" controls preload="metadata"></audio><span class="lib-prev-fname">${esc(item.title)}</span></div>`;
    return libUnavailablePreview(item, 'Audio file');
  }
  if (t === 'document'){
    const content = libraryTextContent(item).trim();
    if (content) return `<div class="lib-prev lib-prev-doc"><pre>${esc(content.slice(0, 560))}</pre><span class="lib-prev-fname">${esc(item.title)}</span></div>`;
    return libUnavailablePreview(item, 'Document');
  }
  // Web/artifact previews are the actual HTML or text emitted by the agent.
  const html = item.card?.html || (item.card?.kind === 'html' ? item.card?.content : '');
  if (html) return `<div class="lib-prev lib-prev-web-real"><iframe sandbox="allow-scripts" title="${esc(item.title || 'Artifact')}" srcdoc="${esc(html)}"></iframe></div>`;
  const content = libraryTextContent(item).trim();
  if (content) return `<div class="lib-prev lib-prev-code"><pre>${esc(content.slice(0, 560))}</pre></div>`;
  return libUnavailablePreview(item, 'Agent artifact');
}
function libCardHtml(item){
  const sel = state.librarySelect && (state.librarySelected || []).includes(item.id);
  const source = item._source === 'upload' ? 'Your upload' : 'Made by agent';
  const sub = esc(libTypeLabel(item._type)) + ' · ' + source + ' · ' + esc(fmtAgo(item.at));
  const action = item.libraryId ? 'library-item-open' : item.libraryUpload ? 'library-upload-open' : 'library-open';
  const attrs = item.libraryId ? ` data-lib-id="${esc(item.libraryId)}"` : item.libraryUpload
    ? ` data-upload="${esc(item.uploadId || '')}"`
    : ` data-chat="${esc(item.chatId || '')}"${item.messageId ? ` data-msg="${esc(item.messageId)}"` : ''}${item.fileIndex !== undefined ? ` data-file="${item.fileIndex}"` : ''}`;
  return `<article class="lib-card${sel ? ' sel' : ''}" data-lib="${esc(item.id)}">
    <button class="lib-card-main" data-act="${action}"${attrs}>
      ${libPreviewHtml(item)}
      <span class="lib-meta"><span class="lib-ico lib-ico-${item._type}">${icon(libIconFor(item._type), 16)}</span><span class="lib-copy"><b>${esc(item.title)}</b><span>${sub}</span></span></span>
    </button>
    <button class="lib-card-download" data-act="lib-download" data-id="${esc(item.id)}" title="Download ${esc(item.title)}" aria-label="Download ${esc(item.title)}">${icon('down',14)}</button>
    ${state.librarySelect ? `<button class="lib-check${sel ? ' on' : ''}" data-act="lib-pick" data-id="${esc(item.id)}" aria-pressed="${sel ? 'true' : 'false'}">${icon('check',12)}</button>` : ''}
  </article>`;
}
function memoryDocumentContent(){
  const rows = (state.memory || []).filter(m => !m.category || m.category === 'long_term');
  return `# MEMORY.md\n\n${rows.map(m => `- ${m.text} <!-- ${memorySource(m)} -->`).join('\n') || 'No long-term memories yet.'}`;
}
// Only files the owner can safely read: their editable agent context and the
// generated memory view. The runtime capability registry is not a user file.
const SYSTEM_FILE_GROUPS = [['agent', 'Agent'], ['user', 'You'], ['memory', 'Memory']];
function systemDocumentItems(){
  const docs = editableAgentDocuments();
  const at = state.agentContext?.updatedAt || Date.now();
  return [
    { id:'system:identity', key:'identity', title:'IDENTITY.md', folder:'agent', path:'/agent/IDENTITY.md', content:docs.identity, editable:true, description:'Your agent’s name and style.', at },
    { id:'system:soul', key:'soul', title:'SOUL.md', folder:'agent', path:'/agent/SOUL.md', content:docs.soul, editable:true, description:'The tone and values behind every reply.', at },
    { id:'system:agents', key:'agents', title:'AGENTS.md', folder:'agent', path:'/agent/AGENTS.md', content:docs.agents, editable:true, description:'How your agent plans, checks its work and asks for approval.', at },
    { id:'system:user', key:'user', title:'USER.md', folder:'user', path:'/user/USER.md', content:docs.user, editable:true, description:'Preferences and background you want your agent to know.', at },
    { id:'system:memory', key:'memory', title:'MEMORY.md', folder:'memory', path:'/memory/MEMORY.md', content:memoryDocumentContent(), editable:false, description:'Everything your agent remembers long term. Generated from your memories.', at:Date.now() },
  ];
}
function systemFileRowHtml(item){
  return `<button class="system-file-row" data-act="system-open" data-system-id="${esc(item.id)}">
    <span class="system-file-icon">${icon(item.editable ? 'doc' : 'book',18)}</span>
    <span class="system-file-copy"><b>${esc(item.title)}</b><span>${esc(item.description)}</span></span>
    <span class="system-file-state">${item.editable ? 'Editable' : 'Read-only'}</span>
    <span class="system-file-chev">${icon('chev',15)}</span>
  </button>`;
}
function systemEditorHtml(item){
  const readOnly = !item.editable;
  return `<div class="system-editor">
    <button class="system-back" data-act="system-back">${icon('left',14)} System files</button>
    <div class="system-editor-head">
      <div><span class="system-eyebrow">${esc(item.path)}</span><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div>
      <span class="chip ${readOnly ? '' : 'acc'}">${readOnly ? 'Read-only' : 'Editable'}</span>
    </div>
    ${readOnly
      ? `<pre class="system-editor-code">${esc(item.content)}</pre>`
      : `<textarea class="field system-editor-text" id="system-editor-text" data-system-key="${esc(item.key)}" maxlength="${item.key === 'user' ? '4000' : '8000'}">${esc(item.content)}</textarea><div class="system-editor-actions"><button class="btn dark small" data-act="system-save">Save changes</button><button class="btn ghost small" data-act="system-back">Cancel</button></div>`}
  </div>`;
}
function systemLibraryBody(){
  const selected = state.systemFile ? systemDocumentItems().find(item => item.id === state.systemFile) : null;
  if (selected) return systemEditorHtml(selected);
  const items = systemDocumentItems();
  return `<div class="lib-head"><div><span class="lib-eyebrow">Library</span><h1>System files</h1></div></div>
    ${SYSTEM_FILE_GROUPS.map(([folder, label]) => `<div class="lib-sec">${label}</div><div class="system-file-list">${items.filter(item => item.folder === folder).map(systemFileRowHtml).join('')}</div>`).join('')}`;
}
let systemFilesPending = null, systemFilesOwner = null, systemFilesCheckedAt = 0;
function refreshSystemFiles(force = false){
  if (!signedIn() || !window.LingonAuth?.api) return Promise.resolve();
  const owner = currentUserId();
  if (owner !== systemFilesOwner){ systemFilesOwner = owner; systemFilesCheckedAt = 0; systemFilesPending = null; }
  if (systemFilesPending) return systemFilesPending;
  if (!force && Date.now() - systemFilesCheckedAt < 30000) return Promise.resolve();
  const request = window.LingonAuth.api('/api/system-files').then((out) => {
    if (owner !== currentUserId()) return;
    state.systemManifest = out || null;
    if (out?.documents) {
      state.agentContext = { ...(state.agentContext || {}), revision:Number(out.revision || state.agentContext?.revision || 0), documents:{ ...((state.agentContext || {}).documents || {}), ...out.documents } };
    }
    save();
    if (state.view === 'library' && $('#main')) paintLibrary($('#main'));
  }).catch(() => {}).finally(() => { systemFilesCheckedAt = Date.now(); systemFilesPending = null; });
  systemFilesPending = request;
  return request;
}
/* The Library lives on the account so the agent's library tools see the same
   files. The list carries names, sizes and a text preview; file content loads
   on demand and is cached for this session. */
const MAX_LIBRARY_UPLOAD_MB = 6;
const libraryContent = new Map(); // item id -> { loading } | { content } | { error }
let libraryPending = null, libraryContentOwner = null, libraryViewer = null, libraryCheckedAt = 0, libraryOwner = null;
function refreshLibrary(force = true){
  if (!signedIn() || !window.LingonAuth?.api) return Promise.resolve();
  if (libraryPending) return libraryPending;
  const owner = currentUserId();
  if (!force && owner === libraryOwner && Date.now() - libraryCheckedAt < 30000) return Promise.resolve();
  libraryOwner = owner; libraryCheckedAt = Date.now();
  libraryPending = (async () => {
    await moveDeviceUploads();
    const { items = [] } = await window.LingonAuth.api('/api/library');
    if (owner !== currentUserId()) return;
    state.libraryServer = items;
    save();
    if (state.view === 'library' && $('#main')) paintLibrary($('#main'));
    if ($('#side')) paintSide();
  })().catch(error => { if (state.view === 'library') toast(error.message || 'Could not load your Library.'); })
    .finally(() => { libraryPending = null; });
  return libraryPending;
}
// Files uploaded before the Library was kept on the account move over once;
// anything the account refuses (for example over 6 MB) stays on this device.
async function moveDeviceUploads(){
  for (const f of (state.libraryUploads || []).slice()) {
    try {
      await window.LingonAuth.api('/api/library', { method:'POST', body:JSON.stringify({ title:f.name, mime:f.type, content:f.dataUrl }) });
      state.libraryUploads = state.libraryUploads.filter(item => item.id !== f.id);
      save();
    } catch {}
  }
}
function libraryItemContent(id, onReady){
  const owner = currentUserId();
  if (owner !== libraryContentOwner) { libraryContent.clear(); libraryContentOwner = owner; }
  if (libraryContent.has(id)) return libraryContent.get(id);
  libraryContent.set(id, { loading:true });
  window.LingonAuth.api('/api/library/' + encodeURIComponent(id))
    .then(out => { if (owner === currentUserId()) libraryContent.set(id, { content:String(out.item?.content || '') }); })
    .catch(error => { if (owner === currentUserId()) libraryContent.set(id, { error:error.message || 'Could not load this file.' }); })
    .finally(() => { if (state.view === 'library' && $('#main')) paintLibrary($('#main')); try { onReady && onReady(); } catch {} });
  return libraryContent.get(id);
}
function addLibraryUploads(fileList){
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (!signedIn()){ renderAuth(); return; }
  let added = 0, finished = 0;
  const settle = () => {
    if (++finished < files.length) return;
    if (added) toast(`${added} file${added === 1 ? '' : 's'} added to your Library.`);
  };
  files.forEach((file) => {
    if (!file || file.size > MAX_LIBRARY_UPLOAD_MB * 1024 * 1024){
      toast(`${file?.name || 'That file'} is over ${MAX_LIBRARY_UPLOAD_MB} MB.`);
      settle();
      return;
    }
    // Text files are stored as text so they preview here and the agent can read them.
    const ext = (file.name.match(/\.([a-z0-9]{2,8})$/i) || [])[1]?.toLowerCase() || '';
    const textMime = { md:'text/markdown', markdown:'text/markdown', txt:'text/plain', csv:'text/csv', json:'application/json', html:'text/html', htm:'text/html' }[ext];
    const asText = !!textMime && file.size <= 500000;
    const reader = new FileReader();
    reader.onload = () => {
      window.LingonAuth.api('/api/library', { method:'POST', body:JSON.stringify({ title:file.name, mime:asText ? textMime : file.type, content:String(reader.result || '') }) })
        .then(out => {
          if (!out?.item) return;
          state.libraryServer = [out.item, ...(state.libraryServer || []).filter(item => item.id !== out.item.id)];
          libraryContent.set(out.item.id, { content:String(reader.result || '') });
          added++; save();
          if (state.view === 'library' && $('#main')) paintLibrary($('#main'));
          if ($('#side')) paintSide();
        })
        .catch(error => toast(`${file.name}: ${error.message || 'could not be uploaded.'}`))
        .finally(settle);
    };
    reader.onerror = () => { toast(`Could not read ${file.name}.`); settle(); };
    if (asText) reader.readAsText(file); else reader.readAsDataURL(file);
  });
}
// Viewer for account files. Content renders through the Canvas document view,
// so HTML runs in a sandboxed frame, never with the app's origin.
function libraryViewerHtml(){
  const item = libraryViewer && (state.libraryServer || []).find(x => x.id === libraryViewer);
  if (!item) return '';
  const loaded = libraryItemContent(item.id);
  const content = String(loaded.content || '');
  const ext = (String(item.title).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
  const body = /^data:video\//.test(content) ? `<video class="lib-viewer-media" src="${esc(content)}" controls playsinline></video>`
    : /^data:audio\//.test(content) ? `<audio class="lib-viewer-audio" src="${esc(content)}" controls></audio>`
    : canvasDocumentHTML({ name:item.title, format:item.kind === 'web' ? 'html' : ext || 'text' }, loaded);
  return `<div class="lib-viewer" role="dialog" aria-modal="true" aria-label="${esc(item.title)}">
    <button class="lib-viewer-scrim" data-act="lib-viewer-close" aria-label="Close" tabindex="-1"></button>
    <div class="lib-viewer-panel">
      <div class="lib-viewer-bar"><span>${item.source === 'upload' ? 'Your upload' : 'Made by agent'} · ${esc(fmtBytes(Number(item.size || 0)))} · ${esc(fmtAgo(item.createdAt))}</span>
        <button class="iconbtn" data-act="lib-download" data-id="lib:${esc(item.id)}" title="Download" aria-label="Download ${esc(item.title)}">${icon('down',16)}</button>
        <button class="iconbtn" data-act="lib-viewer-close" title="Close" aria-label="Close">${icon('x',16)}</button></div>
      <div class="lib-viewer-body">${body}</div>
    </div>
  </div>`;
}
function libraryItemById(id){ return libraryItems().find(item => item.id === id) || null; }
function downloadDataUrl(name, dataUrl){
  const link = document.createElement('a');
  link.href = String(dataUrl || '');
  link.download = name || 'download';
  link.click();
  toast('Downloading ' + (name || 'file'));
}
async function downloadLibraryItem(item){
  if (!item) return;
  const card = item.card || {};
  if (item.libraryId){
    try {
      const cached = libraryContent.get(item.libraryId)?.content;
      const content = cached ?? String((await window.LingonAuth.api('/api/library/' + encodeURIComponent(item.libraryId))).item?.content || '');
      if (content.startsWith('data:')) downloadDataUrl(item.title, content); else dl(item.title, content);
    } catch (error) { toast(error.message || 'Could not download that file.'); }
    return;
  }
  if (card.managedArtifactId && item.chatId && window.Engine?.download){
    try { await window.Engine.download(item.chatId, card); toast('Downloading ' + item.title); }
    catch (error) { toast(error.message || 'Could not download that artifact.'); }
    return;
  }
  if (card.dataUrl){ downloadDataUrl(item.title, card.dataUrl); return; }
  const content = card.html || libraryTextContent(item);
  if (content){ dl(item.title, content); return; }
  toast('This file has no downloadable content in the current view.');
}
function approvalRows(){
  const rows = [];
  const seen = new Set();
  const alwaysFor = key => (state.vault.approvals || []).find(a => a.key && a.key === key);
  state.chats.forEach(c => (c.messages || []).forEach(m => {
    if (!(m.kind === 'card' && m.card.type === 'approval')) return;
    if (m.card.key) seen.add(m.card.key);
    rows.push({
      id: m.id,
      title: m.card.title,
      status: m.card.status,
      chat: c.title,
      chatId: c.id,
      messageId: m.id,
      detail: m.card.detail,
      key: m.card.key,
      at: m.at || m.createdAt || c.updatedAt || c.createdAt || Date.now(),
      alwaysId: alwaysFor(m.card.key)?.id,
    });
  }));
  (state.vault.approvals || []).forEach(x => {
    if (x.key && seen.has(x.key)) return;
    rows.push({
      id: x.id,
      title: x.label,
      status: 'always',
      detail: '',
      key: x.key,
      at: x.at,
      alwaysId: x.id,
    });
  });
  rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  return rows;
}
function approvalArgs(detail){
  if (!detail) return null;
  if (typeof detail === 'object') return detail;
  const s = String(detail).trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return null;
  try { return JSON.parse(s); } catch { return null; }
}
function approvalHost(args){
  const inner = args && (args.args || args);
  const url = args && (args.url || args.uri || args.href || (inner && (inner.url || inner.uri || inner.href)));
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch {
    const m = String(url).match(/https?:\/\/([^/\s]+)/i);
    return m ? m[1].replace(/^www\./, '') : '';
  }
}
function approvalSlug(row, args){
  return String((args && (args.tool || args.name || args.action)) || row.title || row.key || '').toLowerCase();
}
function approvalKind(row){
  const args = approvalArgs(row.detail);
  const slug = approvalSlug(row, args);
  const blob = [row.title, row.key, row.detail, slug].join(' ').toLowerCase();
  if (/mail_send|mail_read|mail_status|mail_draft/.test(blob)) return 'mail';
  if (/gmail|inbox|\bemail\b/.test(blob)) return 'gmail';
  if (/shop_pay|shop_purchase|shop pay|shopify/.test(blob)) return 'wallet';
  if (/github|gh_|git_/.test(blob)) return 'github';
  if (approvalHost(args) || /web_fetch|browser|https?:\/\/|web access/.test(blob)) return 'web';
  return 'action';
}
function humanizeSlug(s){
  return String(s || '')
    .replace(/^(gmail|github|google|slack|notion)_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function approvalHeadline(row){
  const args = approvalArgs(row.detail);
  const slug = approvalSlug(row, args);
  const host = approvalHost(args);
  if (/shop_purchase|shop pay|shopify/.test(slug + ' ' + String(row.title || '').toLowerCase())) return 'Complete this Shop Pay purchase';
  if (/gmail/.test(slug) && /send/.test(slug)) return 'Send this email in Gmail';
  if (/gmail/.test(slug) && /read|fetch|list|get/.test(slug)) return 'Read email in Gmail';
  if (/mail_send/.test(slug)) return 'Send this email from your agent mailbox';
  if (/send.*email|email.*gmail/.test(slug + ' ' + String(row.title || '').toLowerCase())) return 'Send this email in Gmail';
  if (/mail_read/.test(slug)) return 'Read email in Gmail';
  if (/browser_submit|computer_submit|fill_secret/.test(slug + ' ' + String(row.title || '').toLowerCase())) return args && args.summary ? String(args.summary).slice(0, 140) : 'Finish this step for you';
  if (host && !/web_fetch|browser/.test(slug)) return 'Share info with ' + host;
  if (/web_fetch|browser|http/.test(slug) || host) return 'Web access for this task';
  const raw = String(row.title || '').trim();
  if (raw && !/^[a-z0-9_:-]+$/i.test(raw)) return raw;
  if (args && args.tool) return humanizeSlug(args.tool);
  return raw ? humanizeSlug(raw) : 'Action approval';
}
function approvalBlurb(row){
  const prose = String(row.detail || '').trim();
  if (prose && !(prose.startsWith('{') || prose.startsWith('['))) return prose;
  const args = approvalArgs(row.detail);
  const agent = (state.agent && state.agent.name) || 'Your agent';
  const inner = args && (args.args || args);
  const to = inner && (inner.recipient_email || inner.to || inner.recipient || inner.email);
  const host = approvalHost(args);
  const slug = approvalSlug(row, args);
  if (to) return `${agent} wants to email ${Array.isArray(to) ? to.join(', ') : to}.`;
  if (host) return `${agent} wants to look up the contents of ${host}.`;
  if (/gmail/.test(slug)) return `${agent} wants to use Gmail.`;
  if (row.title && !/^[a-z0-9_:-]+$/i.test(row.title)) {
    const lead = row.title.charAt(0).toLowerCase() + row.title.slice(1);
    return `${agent} wants to ${lead.replace(/\.$/, '')}.`;
  }
  const action = humanizeSlug(slug || 'take this action').toLowerCase() || 'take this action';
  return `${agent} wants to ${action}.`;
}
function approvalStatusLine(row){
  const when = fmtAgo(row.at);
  const st = String(row.status || '').toLowerCase();
  let label = 'Allowed';
  if (st === 'pending') label = 'Needs approval';
  else if (st === 'denied' || st === 'rejected') label = 'Denied';
  else if (st === 'always') label = 'Always allowed';
  else if (st === 'approved' || st === 'allowed' || st === 'ok') label = row.chatId ? 'Allowed for this task' : 'Allowed once';
  else if (row.alwaysId && !st) label = 'Always allowed';
  else if (st) label = st.replace(/_/g, ' ');
  return when ? `${label} · ${when}` : label;
}
function approvalIconHtml(row){
  const kind = approvalKind(row);
  const toolkit = kind === 'gmail' ? 'gmail' : kind === 'github' ? 'github' : '';
  const app = toolkit && (state.composioApps || []).find(a => a.toolkit === toolkit);
  if (app && app.logo) return `<span class="appr-ico brand">${appLogoHtml(app)}</span>`;
  if (kind === 'gmail') return `<span class="appr-ico brand">${GMAIL_MARK}</span>`;
  if (kind === 'mail') return `<span class="appr-ico">${icon('mail',18)}</span>`;
  if (kind === 'github') return `<span class="appr-ico">${icon('git',18)}</span>`;
  if (kind === 'web') return `<span class="appr-ico">${icon('websearch',18)}</span>`;
  return `<span class="appr-ico">${icon('shieldcheck',18)}</span>`;
}
const GMAIL_MARK = '<svg class="appr-brand" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M1.5 6.8v10.5c0 .9.7 1.7 1.7 1.7h2.2V10l6.6 4.8L18.6 10v9h2.2c.9 0 1.7-.8 1.7-1.7V6.8L12 14.2Z"/><path fill="#34A853" d="M20.8 4H18L12 8.3 6 4H3.2L12 10.4Z"/><path fill="#EA4335" d="M1.5 4.1C1.5 3.2 2.3 2.5 3.2 2.5H6v1.6L1.5 7.2Z"/><path fill="#FBBC04" d="M20.8 2.5h-2.8v1.6l4.5 3.1V4.1c0-.9-.8-1.6-1.7-1.6Z"/></svg>';

/* ---------------- Goals: categories + helpers ---------------- */
// 'family' keeps its id so goals saved before the Relationships rename still match.
const GOAL_CATS = [
  { id:'health', label:'Health', ic:'heart' },
  { id:'family', label:'Relationships', ic:'users' },
  { id:'finance', label:'Finance', ic:'dollar' },
  { id:'career', label:'Career', ic:'brief' },
  { id:'interests', label:'Interests', ic:'palette' },
  { id:'productivity', label:'Productivity', ic:'laptop' },
  { id:'other', label:'Something else', ic:'checksq' },
];
function goalCat(id){ return GOAL_CATS.find(c => c.id === id) || GOAL_CATS.find(c => c.id === 'other'); }
function goalProgress(g){
  const subs = Array.isArray(g.subgoals) ? g.subgoals : [];
  if (!subs.length) return g.done ? 100 : 0;
  return Math.round(subs.filter(s => s.done).length / subs.length * 100);
}
function goalCounts(){
  const goals = Array.isArray(state.goals) ? state.goals : [];
  return { total: goals.length, active: goals.filter(g => g.active && !g.done).length, done: goals.filter(g => g.done).length };
}
// Goals live on the account so this page and the agent's goal tools share them.
function goalFromServer(g){
  return { id:g.id, title:g.title, category:g.category, chatId:g.chatId || null, createdAt:g.createdAt,
    active:g.status === 'active', done:g.status === 'done',
    subgoals:(g.steps || []).map(s => ({ id:s.id, title:s.title, done:!!s.done })) };
}
function repaintGoalViews(){
  if (state.view === 'goals' && $('#main')) paintGoals($('#main'));
  if ($('#side')) paintSide();
}
let goalsPending = null, goalsCheckedAt = 0, goalsOwner = null;
function refreshGoals(force = true){
  if (!signedIn() || !window.LingonAuth?.api) return Promise.resolve();
  if (goalsPending) return goalsPending;
  const owner = currentUserId();
  if (!force && owner === goalsOwner && Date.now() - goalsCheckedAt < 30000) return Promise.resolve();
  goalsOwner = owner; goalsCheckedAt = Date.now();
  goalsPending = (async () => {
    let { goals = [] } = await window.LingonAuth.api('/api/goals');
    // One-time move of goals that were only kept on this device.
    const deviceGoals = (state.goals || []).filter(g => !String(g.id).startsWith('goal_'));
    if (state.goalsImportedFor !== owner && deviceGoals.length) {
      for (const g of deviceGoals.slice().reverse()) {
        await window.LingonAuth.api('/api/goals', { method:'POST', body:JSON.stringify({ title:g.title, category:g.category,
          status:g.done ? 'done' : g.active === false ? 'paused' : 'active', createdAt:g.createdAt,
          steps:(g.subgoals || []).map(s => ({ title:s.title, done:!!s.done })) }) }).catch(() => {});
      }
      ({ goals = [] } = await window.LingonAuth.api('/api/goals'));
    }
    if (owner !== currentUserId()) return;
    state.goalsImportedFor = owner;
    state.goals = goals.map(goalFromServer);
    save(); repaintGoalViews();
  })().catch(error => { if (state.view === 'goals') toast(error.message || 'Could not load your goals.'); })
    .finally(() => { goalsPending = null; });
  return goalsPending;
}
// Local state changes first so the check feels instant; the server answer wins.
function saveGoalChange(id, request){
  if (!signedIn()) return;
  const path = '/api/goals/' + encodeURIComponent(id);
  (request ? window.LingonAuth.api(path, { method:'PATCH', body:JSON.stringify(request) }) : window.LingonAuth.api(path, { method:'DELETE' }))
    .then(out => {
      if (!out?.goal) return;
      const i = (state.goals || []).findIndex(g => g.id === id);
      if (i >= 0) { state.goals[i] = goalFromServer(out.goal); save(); repaintGoalViews(); }
    })
    .catch(error => { toast(error.message || 'Could not save that change.'); refreshGoals(); });
}

let workspaceIntroStartedAt = null;
function paintSide(){
  const a = state.agent;
  if (!a) return;
  const sidebarVisible = mobileNavOpen || !window.matchMedia('(max-width: 760px)').matches;
  if (workspaceIntroStartedAt === null && sidebarVisible) workspaceIntroStartedAt = performance.now();
  const introElapsed = workspaceIntroStartedAt === null ? Infinity : performance.now() - workspaceIntroStartedAt;
  const workspaceIntroClass = introElapsed < 1500 ? ' is-entering' : '';
  const workspaceIntroStyle = introElapsed < 1500 ? ` style="--workspace-intro-delay:-${Math.round(introElapsed)}ms"` : '';
  const chatScrollTop = $('#side .chatlist')?.scrollTop || 0;
  const u = currentUser();
  const initials = esc((u.name || 'U').slice(0, 1).toUpperCase());
  let libCount = 0;
  try { libCount = libraryItems().length; } catch { libCount = 0; }
  const gc = goalCounts();
  const libOn = state.view === 'library';
  const goalsOn = state.view === 'goals';
  $('#side').innerHTML = `
    <button class="sidebrand" data-act="nav" data-view="chat" title="Belna — back to chat">${Mascot.logo(28)}<span>belna</span></button>
    <button class="btn" style="margin:8px 4px 4px" data-act="newchat">${icon('plus',15)} New chat</button>
    <div class="side-workspace${workspaceIntroClass}"${workspaceIntroStyle}>
      <div class="slabel">Workspace</div>
      <button class="sitem navitem${libOn ? ' on' : ''}" data-act="open-library" title="Open your file library">
        <span class="sicon sicon-lib">${icon('library',15)}</span><span>Library</span>
        ${libCount ? `<span class="cnt">${libCount}</span>` : ''}
      </button>
      <button class="sitem navitem${goalsOn ? ' on' : ''}" data-act="open-goals" title="Set goals and check them off as you go">
        <span class="sicon sicon-goal"><svg class="ic goal-mark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle class="goal-ring-outer" cx="12" cy="12" r="9"/><circle class="goal-ring-inner" cx="12" cy="12" r="5"/><circle class="goal-center" cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg></span><span>Goals</span>
        ${gc.total ? `<span class="cnt">${gc.active}/${gc.total}</span>` : ''}
      </button>
    </div>
    <div class="side-chats">
      <div class="slabel">Chats</div>
      <div class="chatlist" role="region" aria-label="Chats" tabindex="0">
        ${state.chats.map(c => `
          <button class="sitem chatitem ${c.id === state.activeChat && state.view === 'chat' ? 'on' : ''}" data-act="openchat" data-id="${c.id}">
            <span class="chat-bullet" aria-hidden="true"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
            <span class="when">${fmtWhen(c.createdAt)}</span>
            <span class="del" data-act="delchat" data-id="${c.id}" title="Delete chat">${icon('trash',13)}</span>
          </button>`).join('') || '<div class="empty" style="padding:20px">No chats yet</div>'}
      </div>
    </div>
    <div class="sidebottom">
      <div class="usagecard" id="usagecard">${billingOwner === billingIdentity() && billingCache ? usageCardHtml(billingCache) : '<span class="usage-loading" role="status">Getting your tokens ready…</span>'}</div>
      <div class="userwrap">
        ${state.userMenuOpen ? `<div class="usermenu pop">
          <button class="sitem" data-act="nav" data-view="settings">${icon('gear',15)} Settings</button>
          <button class="sitem" data-act="nav" data-view="apps">${icon('box',15)} Connectors</button>
          <button class="sitem" data-act="signout">${icon('x',15)} Sign out</button>
        </div>` : ''}
        <button class="userrow" data-act="usermenu">
          <span class="uava">${initials}</span>
          <span class="uinfo"><b>${esc(u.name)}</b><span class="umail">${esc(u.email)}</span></span>
        </button>
      </div>
    </div>`;
  const chatList = $('#side .chatlist');
  if (chatList) chatList.scrollTop = chatScrollTop;
  // usage card: credit usage meter (real billing when signed in).
  // Only touch the DOM when the resolved HTML actually changed (avoids
  // layout thrash on every paintSide while a billing fetch is in flight).
  try {
    const ownerAtPaint = billingIdentity();
    getBilling().then(b => {
      if (billingIdentity() !== ownerAtPaint) return;
      const box = $('#usagecard');
      if (!box) return;
      const next = b ? usageCardHtml(b) : `<button class="usage-unavailable" data-act="nav" data-view="billing">View billing ${icon('aur',14)}</button>`;
      if (box.dataset.billingHtml !== next){ box.dataset.billingHtml = next; box.innerHTML = next; }
    }).catch(() => {});
  } catch {}
}
function usageCardHtml(b){
  const v = creditView(b);
  const pct = Math.round(v.percent);
  return `<div class="usage-content credit-tone-${v.tone}" title="${fmtTokens(v.used)} of ${fmtTokens(v.granted)} monthly tokens used">
    <div class="usage-balance"><span>Usage</span><strong>${pct}%</strong></div>
    ${creditMeterHtml(v)}
    <button class="usage-link" data-act="nav" data-view="billing" aria-label="${pct}% of monthly tokens used. View billing and tokens"></button>
  </div>`;
}

/* ---------------- Goals page ---------------- */
function paintGoals(M){
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const filter = state.goalFilter || 'all';
  const gc = goalCounts();
  // Active goals first, then paused, finished last; newest first within each.
  const rank = g => g.done ? 2 : g.active ? 0 : 1;
  let list = goals.slice().sort((a, b) => rank(a) - rank(b) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (filter === 'active') list = list.filter(g => g.active && !g.done);
  if (filter === 'done') list = list.filter(g => g.done);
  const goalCard = g => {
    const c = goalCat(g.category);
    const pct = goalProgress(g);
    const subs = Array.isArray(g.subgoals) ? g.subgoals : [];
    const doneLabel = g.done ? 'Mark as not done' : 'Mark as done';
    return `<article class="goal-card${g.done ? ' is-done' : ''}${!g.active && !g.done ? ' is-paused' : ''}">
      <div class="goal-head">
        <button class="goal-check${g.done ? ' on' : ''}" data-act="goal-done" data-id="${g.id}" title="${doneLabel}" aria-label="${doneLabel}: ${esc(g.title)}" aria-pressed="${g.done ? 'true' : 'false'}">${icon('check',14)}</button>
        <div class="goal-title-wrap">
          <b class="goal-title">${esc(g.title)}</b>
          <div class="goal-meta"><span class="goal-category-label">${icon(c.ic,13)} ${c.label}</span>
            <span class="goal-status${g.done ? ' done' : g.active ? ' active' : ''}">${g.done ? 'Done' : g.active ? 'In progress' : 'Paused'}</span>
            ${subs.length ? `<span class="goal-sub-count">${subs.filter(s => s.done).length} of ${subs.length} steps</span>` : ''}
          </div>
        </div>
        <div class="goal-menu-wrap">
          <button class="goal-more" data-act="goal-menu" data-id="${g.id}" title="More options for ${esc(g.title)}" aria-label="More options for ${esc(g.title)}" aria-expanded="${state.goalMenu === g.id}">${icon('more',19)}</button>
          ${state.goalMenu === g.id ? `<div class="goal-menu pop" role="menu">${g.done ? '' : `<button role="menuitem" data-act="goal-active" data-id="${g.id}">${icon(g.active ? 'clock' : 'up',15)} ${g.active ? 'Pause goal' : 'Resume goal'}</button>`}<button role="menuitem" data-act="goal-del" data-id="${g.id}">${icon('trash',15)} Delete goal</button></div>` : ''}
        </div>
      </div>
      ${subs.length ? `<div class="goal-bar" role="progressbar" aria-label="${esc(g.title)} progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
      <div class="sub-list">
        ${subs.map(s => `<div class="sub-row${s.done ? ' is-done' : ''}">
          <button class="goal-check small${s.done ? ' on' : ''}" data-act="sub-done" data-id="${g.id}" data-sub="${s.id}" title="${s.done ? 'Mark step as not done' : 'Mark step as done'}" aria-label="${s.done ? 'Mark step as not done' : 'Mark step as done'}: ${esc(s.title)}" aria-pressed="${s.done}">${icon('check',11)}</button>
          <span class="sub-title">${esc(s.title)}</span>
          <button class="ap-x" data-act="sub-del" data-id="${g.id}" data-sub="${s.id}" title="Remove step" aria-label="Remove step: ${esc(s.title)}">${icon('x',11)}</button>
        </div>`).join('')}
      </div>
      ${g.done ? '' : `<div class="sub-add">
        <span class="sub-add-icon">${icon('plus',14)}</span>
        <input class="field" id="sub-${g.id}" placeholder="Add a step" aria-label="Add a step to ${esc(g.title)}" maxlength="120">
        <button class="btn ghost tiny" data-act="sub-add" data-id="${g.id}">Add</button>
      </div>`}
    </article>`;
  };
  M.innerHTML = `<div class="page"><div class="pageinner goals-page">
    <header class="goals-head"><h1>Goals</h1><p>Pick a category and tell ${esc(state.agent?.name || 'your agent')} what you’re after. You’ll shape a plan together, then track it and check it off here.</p></header>
    ${goals.length ? `<section class="goals-section" aria-labelledby="goals-yours">
      <div class="goals-section-head">
        <div><h2 id="goals-yours">Your goals</h2><span class="goals-summary">${gc.done} of ${gc.total} done${gc.active ? ` · ${gc.active} in progress` : ''}</span></div>
        <div class="seg goals-filter" aria-label="Filter goals">
          <button class="${filter === 'all' ? 'on' : ''}" data-act="goal-filter" data-f="all">All</button>
          <button class="${filter === 'active' ? 'on' : ''}" data-act="goal-filter" data-f="active">Active</button>
          <button class="${filter === 'done' ? 'on' : ''}" data-act="goal-filter" data-f="done">Done</button>
        </div>
      </div>
      <div class="goal-list">${list.map(goalCard).join('') || `<p class="goal-empty">${filter === 'done' ? 'Nothing checked off yet. Tap the circle next to a goal when you reach it.' : 'No goals in progress. Resume a paused goal or create a new one below.'}</p>`}</div>
    </section>` : ''}
    <section class="goals-section" aria-labelledby="goals-create">
      <h2 id="goals-create">Create a goal</h2>
      <div class="goal-create-list">
        ${GOAL_CATS.map(c => {
          const n = goals.filter(g => (g.category || 'other') === c.id).length;
          return `<button class="goal-create-row" data-act="goal-start" data-c="${c.id}"><span class="goal-create-icon">${icon(c.ic,20)}</span><span class="goal-create-label">${c.label}</span>${n ? `<small>${n} ${n === 1 ? 'goal' : 'goals'}</small>` : ''}<span class="goal-create-chev">${icon('chev',16)}</span></button>`;
        }).join('')}
      </div>
    </section>
  </div></div>`;
  refreshGoals(false);
  M.querySelectorAll('.sub-add input').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); inp.parentElement?.querySelector('[data-act="sub-add"]')?.click(); }
    });
  });
}
function paintMain(){
  const M = $('#main');
  if (state.view !== 'chat') stopVoice();
  if (state.view === 'chat') return paintChat(M);
  if (state.view === 'settings') return paintSettings(M);
  if (state.view === 'library') return paintLibrary(M);
  if (state.view === 'apps') return paintApps(M);
  if (state.view === 'goals') return paintGoals(M);
  // Legacy links continue to reach the current destinations.
  if (state.view === 'vault'){ state.view = 'settings'; state.settingsTab = 'secrets'; save(); return paintSettings(M); }
  if (state.view === 'memory'){ state.view = 'library'; state.libraryCat = 'system'; state.systemFile = 'system:memory'; save(); return paintLibrary(M); }
  if (state.view === 'profile'){ state.view = 'settings'; state.settingsTab = 'profiles'; save(); return paintSettings(M); }
  if (state.view === 'billing'){ state.view = 'settings'; state.settingsTab = 'billing'; save(); return paintSettings(M); }
  return paintChat(M);
}

/* floating agent status (chat only) */
function statusFor(c){
  if (!c) return '';
  if (Engine.managed && Object.values(c.managedTasks || {}).some(t=>['queued','running','waiting_peers','waiting_approval','stopping'].includes(t.status))) return Engine.isRunning(c.id) ? 'Replying' : 'Working · available';
  if (Engine.managed && c.managedStatus === 'completed') return 'Available';
  for (let i = c.messages.length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.status === 'pending'){
      switch (m.card.type){
        case 'approval': return 'Needs approval';
        case 'connect': return 'Connecting';
        case 'secret': return 'Waiting for a secret';
        case 'question': return 'Asking you';
        case 'subagents': return 'Sub-agent working · available';
        case 'browser': return 'Browsing';
        case 'computer': return 'Using the sandbox';
      }
    }
  }
  if (runningTask(c)) return 'Sub-agent working · available';
  return c.coordinatorRuns ? 'Replying' : c.busy ? 'Working' : 'Available';
}
/* Header mascot: while the agent works it sits at its laptop with headphones
   and the pill narrates the latest step from this chat (live progress label
   or tool line). Free → just the name; waiting on you → what it needs. */
const floatLive = new Map();   // chat id -> latest real step of the current run
const FLOAT_WAIT = { 'Needs approval':'Needs your approval', 'Connecting':'Waiting for a connection', 'Waiting for a secret':'Waiting for a secret', 'Asking you':'Waiting for your answer' };
function noteActivity(c, t){
  const text = String(t || '').replace(/\s*(\.\.\.|…)\s*$/, '').trim();
  if (!c || !text) return;
  floatLive.set(c.id, text.length > 60 ? text.slice(0, 59) + '…' : text);
  if (isActive(c)) updateFloat();
}
/* Working = an AI call is in flight for this chat: the chat's own model run,
   or a delegated task of this chat that is actually running (not queued or
   waiting for you). Pending cards alone never count. */
function aiWorking(c){
  if (!c) return false;
  if (Engine.managed) return !!Engine.isRunning?.(c.id) || Object.values(c.managedTasks || {}).some(t => t.status === 'running');
  return !!(c.coordinatorRuns || c.busy || runningTask(c));
}
function floatView(c){
  if (!aiWorking(c)) {
    if (c) floatLive.delete(c.id);
    const wait = FLOAT_WAIT[statusFor(c)];
    return { working:false, text:wait || '' };
  }
  const task = Object.values(c.managedTasks || {}).find(t => t.status === 'running');
  const text = floatLive.get(c.id) || (task?.title ? `Working on “${task.title.length > 40 ? task.title.slice(0, 39) + '…' : task.title}”` : '');
  return { working:true, text };
}
function updateFloat(){
  const s = $('#floatstatus');
  if (!s) return;
  const view = floatView(chat());
  s.closest('.floathead')?.classList.toggle('working', view.working);
  if (s.textContent === view.text) return;
  const had = s.textContent;
  s.textContent = view.text;
  if (had) { s.classList.remove('swap'); void s.offsetWidth; s.classList.add('swap'); }
}
function syncComposerActions(c){
  const input = $('#cprompt');
  const send = $('#csend');
  const stop = $('#cstop');
  if (!input || !send || !stop) return;
  // Stop covers the reply being written and, with task cards gone, any task still working.
  const running = !!(Engine.managed && (Engine.isRunning?.(c?.id) || liveTaskIds(c).length));
  const hasDraft = !!input.value.trim() || filesFor($('#cform')).length > 0;
  stop.hidden = !running || hasDraft;
  send.hidden = running && !hasDraft;
}
const liveTaskIds = (c) => Object.entries(c?.managedTasks || {}).filter(([, t]) => ['queued','running','waiting_peers','waiting_approval'].includes(t.status)).map(([id]) => id);

/* ---------------- chat view ---------------- */
function paintChat(M){
  const c = chat();
  if (!c){
    stopVoice();
    M.innerHTML = `<div class="empty" style="margin:auto">${Mascot.svg(state.agent.color,'idle',90,'mascot-bob')}<div style="margin-top:14px;font-weight:700">No chat open</div><div class="t2">Start one and ${esc(state.agent.name)} is on it.</div><button class="btn" data-act="newchat">${icon('plus',15)} New chat</button></div>`;
    return;
  }
  const oldPrompt = M.dataset.chatId === c.id ? M.querySelector('#cprompt') : null;
  const draft = oldPrompt?.value || '';
  const focused = oldPrompt && document.activeElement === oldPrompt;
  const selectionStart = focused ? oldPrompt.selectionStart : 0;
  const selectionEnd = focused ? oldPrompt.selectionEnd : 0;
  // Remember where the reader was in this chat; a different chat opens at the newest message.
  const oldThread = M.dataset.chatId === c.id ? M.querySelector('#thread') : null;
  const keepTop = oldThread && !threadStickNext && oldThread.scrollHeight - oldThread.scrollTop - oldThread.clientHeight >= 120 ? oldThread.scrollTop : null;
  threadStickNext = false;
  const fv = floatView(c);
  M.innerHTML = `
    <div class="floathead${fv.working ? ' working' : ''}"><div class="fav">${Mascot.head(state.agent.color,44)}</div><div class="pill" role="status" aria-live="polite">${esc(state.agent.name)}<span class="st" id="floatstatus">${esc(fv.text)}</span></div></div>
    <div class="chathead">
      <span class="ttl">${esc(c.title)}</span>
      ${c.source === 'automation' ? `<span class="chip">${icon('clock',12)} ${String(c.id).startsWith('updates_') ? 'updates' : 'sub-agent'}</span>` : ''}
      ${runningTask(c) ? '<span class="chip green">' + icon('box',12) + ' delegated · agent available</span>' : (c.coordinatorRuns ? '<span class="chip">' + icon('refresh',12) + ' replying…</span>' : '')}
      <span class="sp"></span>
      ${Engine.managed && c.managedStatus === 'paused' ? `<button class="btn ghost tiny" data-act="managed-resume">Reconnect</button>` : ''}
      <button class="giftbtn" data-act="opengift" title="Invite a friend — 10 million tokens each" aria-label="Open invite code">${Mascot.logo(18)}<span>Invite a friend · 10M each</span></button>
      <button class="iconbtn" data-act="togglecanvas" title="Toggle canvas" aria-label="Toggle canvas">${icon('menu',16)}</button>
    </div>
    <div class="thread" id="thread"><div class="threadinner" id="tinner">
      ${c.messages.map(m => msgNode(c, m).outerHTML).join('')}
    </div></div>
    <div class="composerwrap"><div class="composer">
      ${c.taskReply ? `<div class="reply-draft"><span><b>${c.taskReplyScope==='team'?'Updating the shared goal':'Changing this task'}</b><small>${esc(c.managedTasks?.[c.taskReply]?.title || 'Task')}</small></span><button type="button" class="iconbtn" data-act="task-change-cancel" data-chat="${c.id}" aria-label="Cancel task change">${icon('x',14)}</button></div>` : ''}
      ${c.replyingTo ? `<div class="reply-draft"><span><b>Replying to ${c.replyingTo.role === 'user' ? 'yourself' : esc(state.agent.name)}</b><small>${esc(c.replyingTo.text)}</small></span><button type="button" class="iconbtn" data-act="cancelreply" data-chat="${c.id}" title="Cancel reply" aria-label="Cancel reply">${icon('x',14)}</button></div>` : ''}
      <form class="promptbox" id="cform">
        <textarea id="cprompt" rows="1" placeholder="Ask ${esc(state.agent.name)} anything…"></textarea>
        <div class="attach-pills"></div>
        <div class="pb-row">
          <button type="button" class="iconbtn" data-act="attach" title="Attach files" aria-label="Attach files">${icon('plus',16)}</button>
          <span style="display:flex;gap:10px;align-items:center">
            <button type="button" class="voicebtn" id="cvoice" data-act="voice" title="Speak prompt" aria-label="Speak your prompt" aria-pressed="false">${icon('mic',17)}</button>
            <button type="button" class="micbtn" id="cstop" data-act="managed-stop" title="Stop response" aria-label="Stop response">${icon('stop',17)}</button>
            <button type="submit" class="micbtn" id="csend" title="Send" aria-label="Send">${icon('up',17)}</button>
          </span>
        </div>
      </form>
    </div></div>`;
  M.dataset.chatId = c.id;
  pinThread($('#thread'), keepTop);
  // Animate only the newest message — repainting all rows each time was jank.
  try {
    const rows = M.querySelectorAll('#tinner .msg');
    const last = rows[rows.length - 1];
    if (last) last.classList.add('msg-new');
  } catch {}
  updateFloat();
  const prompt = $('#cprompt');
  prompt.value = draft;
  if (focused) { prompt.focus({ preventScroll:true }); prompt.setSelectionRange(selectionStart, selectionEnd); }
  $('#cform').addEventListener('submit', e => { e.preventDefault(); const form = $('#cform'); const v = $('#cprompt').value.trim(); if (v || filesFor(form).length){ const files = readyFiles(form); if (!files) return; stopVoice(); $('#cprompt').value = ''; sendPrompt(v || 'Please review the attached files.', files); clearFiles(form); } });
  $('#cprompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); $('#cform').requestSubmit(); } });
  prompt.addEventListener('input', () => syncComposerActions(c));
  wirePromptBox($('#cform'), $('#cprompt'));
  paintAttachPills();
  syncVoiceButton();
  if (Engine.managed && signedIn() && !needsOnboarding()) void Engine.recoverTasks?.(makeRT(c));
}

// Keeps the newest message in view: while the reader is at the bottom, any growth
// (new rows, streaming text, images loading, lazily-rendered rows, composer resizing)
// re-pins the thread. Scrolling up releases it until they return to the bottom.
let threadStickNext = false;
let threadObserver = null;
function pinThread(th, keepTop = null){
  threadObserver?.disconnect();
  threadObserver = null;
  if (!th) return;
  let pinned = keepTop == null;
  const toBottom = () => { th.scrollTop = th.scrollHeight; };
  if (pinned) { toBottom(); requestAnimationFrame(toBottom); }
  else th.scrollTop = keepTop;
  th.addEventListener('scroll', () => { pinned = th.scrollHeight - th.scrollTop - th.clientHeight < 120; }, { passive:true });
  if (typeof ResizeObserver !== 'function') return;
  threadObserver = new ResizeObserver(() => { if (pinned && th.isConnected) toBottom(); });
  threadObserver.observe(th);
  const inner = th.querySelector('#tinner');
  if (inner) threadObserver.observe(inner);
}

const APPLE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';
const REACTIONS = [
  { id:'up', emoji:'👍', code:'1f44d', label:'Thumbs up' },
  { id:'down', emoji:'👎', code:'1f44e', label:'Thumbs down' },
  { id:'heart', emoji:'❤️', code:'2764-fe0f', label:'Heart' },
  { id:'poop', emoji:'💩', code:'1f4a9', label:'Poop' },
];
function normalizeReaction(value){
  return String(value || '').replace(/\uFE0F|\uFE0E/g, '');
}
function findReaction(value){
  const raw = String(value || '');
  const norm = normalizeReaction(raw);
  return REACTIONS.find((r) => r.id === raw || r.emoji === raw || normalizeReaction(r.emoji) === norm) || null;
}
function appleEmojiHTML(emoji, code){
  const unified = code || [...String(emoji)].map((ch) => ch.codePointAt(0).toString(16)).join('-');
  const fallback = unified.split('-').filter((p) => p !== 'fe0f' && p !== 'fe0e').join('-');
  return `<img class="imessage-emoji" src="${APPLE_EMOJI_CDN}${unified}.png" alt="${esc(emoji)}" draggable="false" data-fallback="${APPLE_EMOJI_CDN}${fallback}.png" onerror="if(!this.dataset.tried&&this.getAttribute('src')!==this.dataset.fallback){this.dataset.tried=1;this.src=this.dataset.fallback}else{this.replaceWith(document.createTextNode(this.alt))}">`;
}
function paintAppleEmoji(html){
  return String(html).replace(/\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu, (emoji) => appleEmojiHTML(emoji));
}
function replyPreviewHTML(m){
  if (!m.replyTo) return '';
  const who = m.replyTo.role === 'user' ? 'You' : state.agent.name;
  return `<div class="reply-preview"><b>${esc(who)}</b><span>${paintAppleEmoji(esc(m.replyTo.text))}</span></div>`;
}
function messageChromeHTML(c, m){
  const active = new Set((Array.isArray(m.reactions) ? m.reactions : []).map((r) => findReaction(r)?.id).filter(Boolean));
  const agentReaction = m.role === 'user' ? findReaction(m.agentReaction) : null;
  const attrs = `data-chat="${c.id}" data-msg="${m.id}"`;
  const chosen = REACTIONS.filter((r) => active.has(r.id)).map((r) => `<button type="button" class="reaction-pill on" data-act="reactmsg" ${attrs} data-reaction="${r.id}" title="Remove ${r.label}" aria-label="Remove ${r.label}">${appleEmojiHTML(r.emoji, r.code)}</button>`).join('');
  const fromAgent = agentReaction ? `<span class="reaction-pill agent-reaction" title="${esc(state.agent.name)} reacted ${esc(agentReaction.label)}" aria-label="${esc(state.agent.name)} reacted ${esc(agentReaction.label)}">${appleEmojiHTML(agentReaction.emoji, agentReaction.code)}</span>` : '';
  return {
    has: active.size > 0 || !!agentReaction,
    reactions: chosen || fromAgent ? `<div class="message-reactions">${chosen}${fromAgent}</div>` : '',
    actions: `<div class="message-actions" aria-label="Message actions">
    <button type="button" data-act="replymsg" ${attrs} title="Reply">${icon('chatb',13)}<span>Reply</span></button>
    <button type="button" data-act="copymsg" ${attrs} title="Copy">${icon('copy',13)}<span>Copy</span></button>
    <span class="reaction-options">${REACTIONS.map((r) => `<button type="button" class="reaction-choice ${active.has(r.id) ? 'on' : ''}" data-act="reactmsg" ${attrs} data-reaction="${r.id}" title="${r.label}" aria-label="${r.label}">${appleEmojiHTML(r.emoji, r.code)}</button>`).join('')}</span>
  </div>`,
  };
}
function msgNode(c, m){
  const chrome = (m.kind === 'text') ? messageChromeHTML(c, m) : { has:false, reactions:'', actions:'' };
  if (m.kind === 'text' && m.role === 'user'){
    const filesHtml = (m.files && m.files.length) ? `<div class="msg-files">${m.files.map((f,i) => `<button class="attach-pill sent" data-act="canvas-upload" data-chat="${c.id}" data-msg="${m.id}" data-i="${i}" title="View in Canvas">${icon('file',12)}<span class="ap-name">${esc(f.name.length > 24 ? f.name.slice(0,21)+'…' : f.name)}</span><span class="ap-size">${fmtBytes(f.size)}</span></button>`).join('')}</div>` : '';
    return el(`<div class="msg user" data-mid="${m.id}"><div class="message-stack${chrome.has ? ' has-reactions' : ''}"><div class="bub-wrap"><div class="bub">${replyPreviewHTML(m)}${filesHtml}${paintAppleEmoji(esc(m.text))}</div>${chrome.reactions}</div>${chrome.actions}</div></div>`);
  }
  if (m.kind === 'text')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava">${Mascot.svg(state.agent.color, m.mood || 'idle', 30)}</div><div class="body message-stack${chrome.has ? ' has-reactions' : ''}"><div class="bub-wrap"><div class="bub md">${replyPreviewHTML(m)}${paintAppleEmoji(md(m.text))}</div>${chrome.reactions}</div>${chrome.actions}</div></div>`);
  if (m.kind === 'tools')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body"><div class="tools">${m.items.map(t => tlineHTML(t)).join('')}</div></div></div>`);
  if (m.kind === 'chips')
    return el('<div style="display:none"></div>');
  if (m.kind === 'card' && m.card?.type === 'memory')
    return el(`<div class="msg-hidden" data-mid="${m.id}" hidden></div>`);
  // A working task shows only as typing dots at the end of the chat (CSS order keeps
  // them below newer messages). Results, approvals and questions arrive as their own
  // cards; only a paused task keeps a card, for Continue.
  if (m.kind === 'card' && m.card?.type === 'task' && m.card.status !== 'partial') {
    if (!['queued','running','waiting_peers','stopping'].includes(m.card.status)) return el(`<div class="msg-hidden" data-mid="${m.id}" hidden></div>`);
    return el(`<div class="msg agent task-working" data-mid="${m.id}" role="status" aria-label="${esc(state.agent.name)} is working on ${esc(m.card.title || 'a task')}"><div class="ava">${Mascot.svg(state.agent.color,'think',30)}</div><div class="body"><div class="bub-wrap"><div class="bub"><span class="tdots"><i></i><i></i><i></i></span></div></div></div></div>`);
  }
  // Task milestones and "changes queued" notes are progress chatter; the task's
  // answer reports the outcome. Failures still show.
  if (m.kind === 'card' && m.card?.type === 'progress' && m.card.taskId && m.card.status === 'done')
    return el(`<div class="msg-hidden" data-mid="${m.id}" hidden></div>`);
  if (m.kind === 'card')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body">${cardNode(c, m)}${!(m.card.type === 'subagents' || (m.card.type === 'present' && ['dashboard','table'].includes(m.card.kind))) ? '' : `<button class="canvas-card-link" data-act="canvas-card" data-chat="${c.id}" data-msg="${m.id}">${icon('easel',14)} Show in Canvas</button>`}</div></div>`);
  return el('<div></div>');
}
const tlineHTML = t => `<div class="tline">${icon(t.ic,14)}<span>${esc(t.t)}</span>${t.d ? `<span class="d">${esc(t.d)}</span>` : ''}</div>`;

/* Mobile only: hold-to-reveal for Reply / emoji / Copy in agent chat.
   Desktop keeps hover (.msg:hover .message-actions in CSS). On mobile
   (<=760px, same breakpoint as CSS) actions stay hidden until the user
   long-presses a message bubble, then .show-actions reveals them. */
(function wireMobileHoldActions(){
  if (window.__lingonHoldWired) return;
  window.__lingonHoldWired = true;
  const HOLD_MS = 500;
  const MOVE_TOL = 10;
  const isMobileMode = () => {
    try { return window.matchMedia('(max-width: 760px)').matches; } catch { return false; }
  };
  const closeAll = (except) => {
    document.querySelectorAll('.msg.show-actions').forEach((n) => { if (n !== except) n.classList.remove('show-actions'); });
  };
  let timer = null;
  let targetMsg = null;
  let startX = 0, startY = 0;
  let firedAt = 0;
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (targetMsg) { targetMsg.classList.remove('pressing'); targetMsg = null; }
  };
  const fire = () => {
    timer = null;
    if (!targetMsg) return;
    if (!isMobileMode()) { cancel(); return; }
    // Only text messages render .message-actions (Reply/Copy/emoji).
    if (!targetMsg.querySelector('.message-actions')) { cancel(); return; }
    closeAll(targetMsg);
    targetMsg.classList.remove('pressing');
    targetMsg.classList.add('show-actions');
    firedAt = Date.now();
    try { if (navigator.vibrate) navigator.vibrate(10); } catch {}
    try { const sel = window.getSelection(); if (sel && sel.rangeCount) sel.removeAllRanges(); } catch {}
    targetMsg = null;
  };
  const begin = (msg, x, y) => {
    if (!isMobileMode()) return;
    cancel();
    if (!msg.querySelector('.message-actions')) return;
    targetMsg = msg;
    startX = x; startY = y;
    msg.classList.add('pressing');
    timer = setTimeout(fire, HOLD_MS);
  };
  document.addEventListener('touchstart', (e) => {
    if (!isMobileMode()) return;
    const t = e.touches && e.touches[0];
    // Tap outside an open message dismisses it (tap on actions/bubble keeps it).
    if (!e.target.closest || !e.target.closest('.msg.show-actions')) {
      // Defer so a new long-press starting on another bubble isn't closed instantly.
      if (!e.target.closest || !e.target.closest('.msg .bub')) closeAll();
    }
    const bub = e.target.closest ? e.target.closest('.msg .bub') : null;
    if (!bub || (e.target.closest && e.target.closest('.message-actions'))) { cancel(); return; }
    const msg = bub.closest('.msg');
    if (!msg || !t) return;
    begin(msg, t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!timer || !targetMsg) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - startX) > MOVE_TOL || Math.abs(t.clientY - startY) > MOVE_TOL) cancel();
  }, { passive: true });
  document.addEventListener('touchend', () => { cancel(); }, { passive: true });
  document.addEventListener('touchcancel', () => { cancel(); }, { passive: true });
  // Narrow-window desktop testing / stylus: same hold with mouse, mobile breakpoint only.
  document.addEventListener('mousedown', (e) => {
    if (!isMobileMode() || e.button !== 0) return;
    if (e.target.closest && e.target.closest('.message-actions')) return;
    const bub = e.target.closest ? e.target.closest('.msg .bub') : null;
    if (!bub) return;
    const msg = bub.closest('.msg');
    if (msg) begin(msg, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (!timer || !targetMsg) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOL || Math.abs(e.clientY - startY) > MOVE_TOL) cancel();
  });
  document.addEventListener('mouseup', () => { cancel(); });
  document.addEventListener('contextmenu', (e) => {
    // Swallow the native callout when our hold just fired on a bubble.
    if (Date.now() - firedAt < 800 && e.target.closest && e.target.closest('.msg .bub')) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    // Keyboard toggle for connector cards (outer div acts as button).
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('conn-head')) {
      e.preventDefault();
      openConnector(e.target.dataset.toolkit);
    }
  });
  // Tapping far from any open message (e.g. thread padding, composer) closes it.
  document.addEventListener('click', (e) => {
    if (!isMobileMode()) return;
    if (Date.now() - firedAt < 300) return;
    if (e.target.closest && e.target.closest('.msg.show-actions')) return;
    closeAll();
  });
})();

/* ---------------- visual cards ----------------
   Everything the agent asks, shows or wants to do renders as a card: questions
   and picks, approvals that show the exact email, order or action, connect-app
   and credential requests, product lists, dashboards, tables, files, media and
   browser/computer previews. Cards stay in the chat; Canvas opens only when
   the owner asks for it. */
const safeImg = (u) => {
  const s = String(u || '');
  return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
};
const safeLink = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
const hostName = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const optLabel = (o) => (typeof o === 'string' ? o : String(o?.label || ''));
const CV_TOOLKITS = { gmail:'Gmail', googlecalendar:'Google Calendar', googledrive:'Google Drive', googlesheets:'Google Sheets', googledocs:'Google Docs', outlook:'Outlook', slack:'Slack', github:'GitHub', notion:'Notion', linear:'Linear', hubspot:'HubSpot', stripe:'Stripe', mailbox:'Agent mailbox' };
const cvAppName = (tk) => CV_TOOLKITS[String(tk || '').toLowerCase()] || humanizeSlug(tk || 'App');
function cvAppMark(tk){
  const toolkit = String(tk || '').toLowerCase();
  const app = composioAppByToolkit(toolkit);
  if (app && app.logo) return `<span class="cv-app">${appLogoHtml(app)}</span>`;
  if (toolkit === 'gmail') return `<span class="cv-app">${GMAIL_MARK}</span>`;
  if (toolkit === 'github') return `<span class="cv-app">${icon('git',18)}</span>`;
  if (toolkit === 'mailbox') return `<span class="cv-app">${icon('mail',18)}</span>`;
  const letter = `<span class="app-fallback">${esc((cvAppName(toolkit) || '?').slice(0,1).toUpperCase())}</span>`;
  // Before the app list loads, the logo comes from the same logo service it uses.
  if (/^[a-z0-9_-]{2,40}$/.test(toolkit)) return `<span class="cv-app"><img src="https://logos.composio.dev/api/${toolkit}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'app-fallback',textContent:'${esc((cvAppName(toolkit) || '?').slice(0,1).toUpperCase())}'}))"></span>`;
  return `<span class="cv-app">${letter}</span>`;
}
const cvHead = (tile, title, sub, chip) => `<div class="hd">${tile}<div class="cv-hd-copy"><b>${title}</b>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${chip ? `<div class="st">${chip}</div>` : ''}</div>`;
const cvTile = (ic, tone = '') => `<div class="tile cv-tile ${tone}">${icon(ic,20)}</div>`;
// Only long text is clamped behind "Show all"; short text shows in full.
const cvLong = (text, chars = 360, lines = 7) => String(text || '').length > chars || String(text || '').split('\n').length > lines;
const cvClamp = (html, cls = '', long = true) => (long ? `<div class="cv-clamp ${cls}">${html}</div><button type="button" class="cv-more" data-act="cv-expand">Show all</button>` : html);
const cvRow = (label, value) => value ? `<div class="cv-kv"><span>${label}</span><b>${value}</b></div>` : '';
const cvChips = (list) => (list || []).map(a => `<span class="cv-chip">${esc(a)}</span>`).join('');
function cvDecisionChip(status){
  if (status === 'pending') return '<span class="chip">needs you</span>';
  if (['approved','allowed','always'].includes(status)) return STCHIP.approved;
  if (status === 'denied') return STCHIP.denied;
  if (status === 'expired') return STCHIP.expired;
  return '';
}
function cvProductImage(c, title){
  const want = String(title || '').toLowerCase();
  if (!want) return '';
  for (const m of (c.messages || []).slice().reverse()) {
    const hit = m.card?.type === 'present' && (m.card.items || []).find(it => String(it.title || '').toLowerCase() === want && safeImg(it.image));
    if (hit) return safeImg(hit.image);
  }
  return '';
}

function cvEmailHTML(v, opts = {}){
  const from = v.provider === 'mailbox'
    ? ((mailCache && mailCache.address) || `${state.agent.name}’s mailbox`)
    : `Your ${cvAppName(v.provider)} account`;
  return `<div class="cv-mail">
    ${opts.hideFrom ? '' : `<div class="cv-mail-row"><span>From</span><div>${cvAppMark(v.provider)}<b>${esc(from)}</b></div></div>`}
    <div class="cv-mail-row"><span>To</span><div class="cv-chips">${cvChips(v.to) || '<i>No recipient</i>'}</div></div>
    ${(v.cc || []).length ? `<div class="cv-mail-row"><span>Cc</span><div class="cv-chips">${cvChips(v.cc)}</div></div>` : ''}
    ${(v.bcc || []).length ? `<div class="cv-mail-row"><span>Bcc</span><div class="cv-chips">${cvChips(v.bcc)}</div></div>` : ''}
    <div class="cv-mail-subject">${esc(v.subject || '(no subject)')}</div>
    ${v.body ? cvClamp(`<div class="cv-mail-body">${esc(v.body)}</div>`, '', cvLong(v.body)) : ''}
  </div>`;
}
function cvOrderHTML(c, v){
  const items = (v.items || []).map(it => {
    const img = cvProductImage(c, it.title);
    return `<div class="cv-line"><span class="cv-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('card',18)}</span>
      <div class="cv-line-main"><b>${esc(it.title)}</b><small>${esc([v.merchant, it.quantity > 1 ? `Qty ${it.quantity}` : ''].filter(Boolean).join(' · '))}</small></div>
      ${it.price ? `<span class="cv-price">${esc(it.price)}</span>` : ''}</div>`;
  }).join('');
  return `<div class="cv-order">${v.website ? `<div class="cv-kvs">${cvRow('Website', esc(v.website))}</div>` : ''}${items}
    ${v.payment ? `<div class="cv-pay">${icon('card',16)}<div><b>${esc(v.payment)}</b>${v.email ? `<small>${esc(v.email)}</small>` : ''}</div></div>` : ''}
    ${(v.delivery || []).length ? `<div class="cv-kvs">${cvRow('Deliver to', esc(v.delivery.join(' · ')))}</div>` : ''}
    ${v.total ? `<div class="cv-total"><span>${v.estimated === false ? 'Total' : 'Estimated total'}</span><b>${esc(v.total)}</b></div>` : ''}
    ${v.checkoutExcerpt ? `<p class="cv-fine">Live checkout text: ${esc(v.checkoutExcerpt)}</p>` : ''}
  </div>`;
}
const APPROVAL_TILES = { email:'mail', message:'chatb', event:'clock', app_action:'box', purchase:'card', submit:'check', credential:'key', website:'globe', search:'websearch', web_action:'globe', automation:'clock', generic:'shieldcheck' };
const APPROVAL_VERBS = { email:'Send', message:'Send', event:'Add event', purchase:'Place order', automation:'Create', website:'Open site', search:'Search', credential:'Allow', submit:'Allow', web_action:'Allow', app_action:'Allow', generic:'Allow' };
function cvApprovalBody(c, cd){
  const v = cd.view || {};
  switch (v.kind) {
    case 'email': return v.draft ? cvEmailHTML(v, { hideFrom:true }) : cvEmailHTML(v);
    case 'message': return `<div class="cv-kvs">${cvRow('Where', esc(v.to || ''))}</div>${v.body ? cvClamp(`<div class="cv-bubble">${esc(v.body)}</div>`, '', cvLong(v.body)) : ''}`;
    case 'event': return `<div class="cv-event"><b>${esc(v.title || 'Event')}</b><div class="cv-kvs">${cvRow('Starts', esc(v.start))}${cvRow('Ends', esc(v.end))}${cvRow('Where', esc(v.location))}</div>${(v.attendees || []).length ? `<div class="cv-chips">${cvChips(v.attendees)}</div>` : ''}</div>`;
    case 'app_action': return (v.fields || []).length ? `<div class="cv-kvs">${v.fields.map(f => cvRow(esc(f.k), esc(f.v))).join('')}</div>` : '';
    case 'purchase': return cvOrderHTML(c, v) + `<p class="cv-fine">Compare these details with the live merchant checkout before approving.</p>`;
    case 'submit': return `<div class="cv-callout">${icon(v.surface === 'computer' ? 'laptop' : 'globe',16)}<span>${esc(v.summary || 'Final step on the website')}</span></div><p class="cv-fine">This is the final click. It may not be reversible.</p>`;
    case 'credential': return `<div class="cv-callout">${icon('key',16)}<span>${esc(v.summary || 'Type a saved credential')}</span></div><p class="cv-fine">${esc(state.agent.name)} never sees the value. It is typed only while ${esc(v.host || v.window || 'that page')} is open.</p>`;
    case 'website': return `<div class="cv-site">${icon('globe',16)}<div><b>${esc(v.host || 'Website')}</b><small>${esc(v.url || '')}</small></div></div>`;
    case 'search': return v.query ? `<div class="cv-callout">${icon('websearch',16)}<span>“${esc(v.query)}”</span></div>` : `<div class="cv-chips">${cvChips(v.urls)}</div>`;
    case 'web_action': return `<div class="cv-callout">${icon(v.surface === 'computer' ? 'laptop' : 'globe',16)}<span>${esc(humanizeSlug(v.action || 'action'))}${v.text ? ` · ${esc(v.text)}` : ''}</span></div>`;
    case 'automation': return `<div class="cv-kvs">${cvRow('Name', esc(v.name))}${cvRow('When', esc(v.when))}</div>${v.prompt ? cvClamp(`<div class="cv-bubble">${esc(v.prompt)}</div>`, '', cvLong(v.prompt)) : ''}`;
    default: return `<pre class="cv-pre">${esc(cd.detail || '')}</pre>`;
  }
}
function approvalCardHTML(c, m){
  const cd = m.card, v = cd.view || {}, k = c.id, mid = m.id;
  const pending = cd.status === 'pending';
  const app = v.app || (v.kind === 'email' ? v.provider : '');
  const tile = app ? `<div class="tile cv-tile brand">${cvAppMark(app)}</div>` : cvTile(APPROVAL_TILES[v.kind] || 'shieldcheck');
  const sub = pending ? `${esc(state.agent.name)} wants to do this` : v.appName ? esc(v.appName) : 'Action approval';
  const verb = APPROVAL_VERBS[v.kind] || 'Allow';
  return `<div class="acard cv-card cv-approval ${pending ? 'is-pending' : ''}">
    ${cvHead(tile, esc(cd.view && cd.title ? cd.title : approvalHeadline({ title:cd.title, detail:cd.detail })), sub, cvDecisionChip(cd.status))}
    <div class="bd">${cvApprovalBody(c, cd)}</div>
    ${pending ? `<div class="cv-actions"><button class="btn ghost" data-act="managed-deny" data-chat="${k}" data-msg="${mid}">Deny</button><button class="btn" data-act="managed-allow" data-chat="${k}" data-msg="${mid}">${verb}</button></div>`
      : `<div class="ft"><span class="note">${icon('shield',12)} ${cd.status === 'denied' ? 'Nothing was done' : cd.status === 'expired' ? 'No longer needed' : 'Approved by you · logged in activity'}</span></div>`}
  </div>`;
}

function questionCardHTML(c, m){
  const cd = m.card, k = c.id, mid = m.id;
  const opts = (cd.options || []).map(o => (typeof o === 'string' ? { label:o } : o)).filter(o => o && o.label);
  const answered = ['answered','approved'].includes(cd.status);
  const skipped = ['denied','skipped','expired'].includes(cd.status);
  const live = cd.status === 'pending';
  const picked = new Set(answered ? String(cd.choice || '').split(', ') : (cd.sel || []));
  const grid = opts.some(o => safeImg(o.image));
  const staged = cd.multi || grid;
  const attrs = `data-chat="${k}" data-msg="${mid}"`;
  const optHTML = opts.map(o => {
    const on = picked.has(o.label);
    const cls = `${on ? 'on' : answered ? 'dim' : ''}`;
    const act = live ? `data-act="${staged ? 'qpick' : 'qopt'}" ${attrs} data-o="${esc(o.label)}"` : 'disabled';
    const img = safeImg(o.image);
    if (grid) return `<button type="button" class="cv-pick ${cls}" ${act}>${img ? `<img src="${esc(img)}" alt="${esc(o.label)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cv-pick-empty">${icon('image',22)}</span>`}<span class="cv-pick-label">${esc(o.label)}</span><span class="tick">${icon('check',12)}</span></button>`;
    return `<button type="button" class="qopt cv-opt ${cls}" ${act}><span class="cv-opt-copy"><span>${esc(o.label)}</span>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span><span class="tick">${icon('check',12)}</span></button>`;
  }).join('');
  const own = answered && cd.choice && !opts.some(o => o.label === cd.choice) && !String(cd.choice).split(', ').every(x => opts.some(o => o.label === x));
  const image = safeImg(cd.image);
  return `<div class="acard cv-card cv-question">
    ${cvHead(cvTile('spark'), 'Question', `${esc(state.agent.name)} is asking`, answered ? `<span class="chip green">answered</span>` : skipped ? STCHIP.skipped : '')}
    <div class="bd">
      ${cd.context ? `<p class="cv-context">${esc(cd.context)}</p>` : ''}
      ${image ? `<div class="cv-hero"><img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ''}
      <b class="cv-q">${esc(cd.q || '')}</b>
      ${opts.length ? `<div class="${grid ? 'cv-picks' : 'qopts cv-opts'}">${optHTML}</div>` : ''}
      ${own ? `<div class="cv-own">${icon('chatb',13)} ${esc(cd.choice)}</div>` : ''}
      ${live && cd.allowOther ? `<form class="cv-other" data-q-other ${attrs}><input name="answer" aria-label="Type your own answer" placeholder="${opts.length ? 'Or type your own answer' : 'Type your answer'}" maxlength="500" autocomplete="off"><button class="btn small" type="submit">${icon('up',14)}</button></form>` : ''}
    </div>
    ${live && (staged || cd.managedCallId || cd.ask) ? `<div class="cv-actions">${cd.managedCallId || cd.ask ? `<button class="btn ghost" data-act="qskip" ${attrs}>Skip</button>` : ''}${staged ? `<button class="btn" data-act="qsubmit" ${attrs} ${picked.size ? '' : 'disabled'}>${cd.multi ? `Select${picked.size ? ` (${picked.size})` : ''}` : 'Select'}</button>` : ''}</div>` : ''}
  </div>`;
}

function connectCardHTML(c, m){
  const cd = m.card, k = c.id, mid = m.id;
  const tk = String(cd.toolkit || cd.app || '').toLowerCase();
  const name = cd.name || cvAppName(tk);
  const app = composioAppByToolkit(tk);
  const linked = cd.status === 'connected' || (app && (app.accounts || []).length > 0 && cd.status !== 'denied');
  const pending = cd.status === 'pending' && !linked;
  const attrs = `data-chat="${k}" data-msg="${mid}"`;
  const managed = !!cd.managedCallId;
  // One clear action: Connect opens the app's own sign-in, and the chat continues
  // by itself once the account appears (see resumeConnectCards).
  const status = linked ? `<span class="conn-state is-on">${icon('check',13)} Connected</span>`
    : cd.status === 'denied' || cd.status === 'skipped' ? '<span class="conn-state">Not connected</span>' : '';
  return `<div class="acard conn-card${pending ? ' is-pending' : ''}">
    <div class="conn-card-row">
      <span class="conn-card-logo">${cvAppMark(tk)}</span>
      <span class="conn-card-copy"><b>${esc(name)}</b><span>Connector</span></span>
      ${status}
    </div>
    ${pending ? `<button class="conn-card-btn" data-act="cv-connect" data-tk="${esc(tk)}" ${attrs}>Connect</button>
      <button type="button" class="conn-card-skip" data-act="${managed ? 'managed-deny' : 'deny-connect'}" ${attrs}>Not now</button>` : ''}
  </div>`;
}

function cvChartSVG(chart){
  const series = (chart.series || []).filter(s => (s.values || []).length);
  if (!series.length) return '';
  const W = 320, H = 132, pad = 8, base = H - 18;
  const n = Math.max(...series.map(s => s.values.length));
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const min = Math.min(0, ...series.flatMap(s => s.values));
  const y = v => base - ((v - min) / (max - min || 1)) * (base - pad);
  const colors = ['var(--ink)', 'var(--purple)', 'var(--green)'];
  const step = (W - pad * 2) / n;
  let marks = '';
  if (chart.type === 'line') {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${(pad + step * i + step / 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      marks += `<polyline points="${pts}" fill="none" stroke="${colors[si]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.values.forEach((v, i) => { marks += `<circle cx="${(pad + step * i + step / 2).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${colors[si]}"><title>${esc(s.name || '')} ${esc(chart.labels?.[i] || '')}: ${v}</title></circle>`; });
    });
  } else {
    const bw = Math.max(3, (step - 4) / series.length);
    series.forEach((s, si) => s.values.forEach((v, i) => {
      const x = pad + step * i + 2 + bw * si, top = Math.min(y(v), y(0)), h = Math.max(1.5, Math.abs(y(0) - y(v)));
      marks += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${colors[si]}" opacity="${si ? .85 : 1}"><title>${esc(s.name || '')} ${esc(chart.labels?.[i] || '')}: ${v}</title></rect>`;
    }));
  }
  const every = Math.ceil(n / 6);
  const labels = (chart.labels || []).map((l, i) => i % every ? '' : `<text x="${(pad + step * i + step / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(l)}</text>`).join('');
  const legend = series.length > 1 ? `<div class="cv-legend">${series.map((s, i) => `<span><i style="background:${colors[i]}"></i>${esc(s.name || `Series ${i + 1}`)}</span>`).join('')}</div>` : '';
  return `<div class="cv-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart"><line x1="${pad}" x2="${W - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="cv-axis"/>${marks}<g class="cv-ticks">${labels}</g></svg>${legend}</div>`;
}
function presentCardHTML(c, m){
  const cd = m.card;
  const items = cd.items || [];
  const kindIcon = { products:'card', inbox:'mail', gallery:'image', dashboard:'chart', table:'grid', steps:'checksq', list:'list' }[cd.kind] || 'list';
  let body = '';
  if (cd.kind === 'dashboard') {
    body = `${(cd.metrics || []).length ? `<div class="cv-metrics">${cd.metrics.map(x => `<div class="cv-metric"><small>${esc(x.label)}</small><b>${esc(x.value)}</b>${x.delta ? `<span class="cv-delta ${esc(x.trend || '')}">${x.trend === 'up' ? '▲ ' : x.trend === 'down' ? '▼ ' : ''}${esc(x.delta)}</span>` : ''}</div>`).join('')}</div>` : ''}${cd.chart ? cvChartSVG(cd.chart) : ''}`;
  } else if (cd.kind === 'table') {
    body = `<div class="cv-table-wrap"><table class="cv-table">${(cd.columns || []).length ? `<thead><tr>${cd.columns.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${(cd.rows || []).map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } else if (cd.kind === 'gallery') {
    body = `<div class="cv-gallery">${items.map(it => { const img = safeImg(it.image), link = safeLink(it.url); const inner = `${img ? `<img src="${esc(img)}" alt="${esc(it.title)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cv-pick-empty">${icon('image',22)}</span>`}<figcaption>${esc(it.title)}</figcaption>`; return link ? `<a class="cv-fig" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<figure class="cv-fig">${inner}</figure>`; }).join('')}</div>`;
  } else if (cd.kind === 'steps') {
    body = `<ol class="cv-steps">${items.map((it, i) => `<li class="${it.done ? 'done' : ''}"><span class="cv-step-dot">${it.done ? icon('check',12) : i + 1}</span><div><b>${esc(it.title)}</b>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</div></li>`).join('')}</ol>`;
  } else {
    body = `<div class="cv-list">${items.map(it => {
      const img = safeImg(it.image), link = safeLink(it.url);
      const tag = link ? 'a' : 'div';
      const thumb = img ? `<span class="cv-thumb"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : cd.kind === 'inbox' ? `<span class="cv-thumb">${icon('mail',16)}</span>` : cd.kind === 'products' ? `<span class="cv-thumb">${icon('card',16)}</span>` : '';
      return `<${tag} class="cv-item${img ? ' has-img' : ''}"${link ? ` href="${esc(link)}" target="_blank" rel="noopener noreferrer"` : ''}>${thumb}<span class="cv-item-main"><b>${esc(it.title)}</b>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}${it.price ? `<span class="cv-item-price">${esc(it.price)}</span>` : ''}${it.meta ? `<small class="cv-meta">${esc(it.meta)}</small>` : ''}</span>${it.badge ? `<span class="chip green">${esc(it.badge)}</span>` : ''}${link ? `<span class="cv-go">${icon('chev',14)}</span>` : ''}</${tag}>`;
    }).join('') || '<p class="mut">Nothing to show.</p>'}</div>`;
  }
  return `<div class="acard cv-card cv-present is-${esc(cd.kind || 'list')}">
    ${cvHead(cvTile(kindIcon), esc(cd.title || 'Overview'), cd.subtitle ? esc(cd.subtitle) : items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : '', '')}
    <div class="bd">${body}</div>
  </div>`;
}

function orderCardHTML(c, m){
  const cd = m.card;
  const placed = cd.orderStatus === 'completed';
  const title = placed ? 'Order placed' : cd.continueUrl ? 'Finish checkout' : 'Checkout ready';
  const cont = safeLink(cd.continueUrl), view = safeLink(cd.orderUrl);
  return `<div class="acard cv-card cv-order-card">
    ${cvHead(cvTile(placed ? 'check' : 'card', placed ? 'green' : ''), title, esc(cd.merchant || ''), placed ? '<span class="chip green">placed</span>' : cont ? '<span class="chip">needs you</span>' : '')}
    <div class="bd">${cvOrderHTML(c, { ...cd, payment:'', estimated:!placed })}</div>
    ${cont || view ? `<div class="cv-actions">${cont ? `<a class="btn" href="${esc(cont)}" target="_blank" rel="noopener noreferrer">Finish in Shop Pay</a>` : ''}${view ? `<a class="btn ghost" href="${esc(view)}" target="_blank" rel="noopener noreferrer">View order</a>` : ''}</div>` : ''}
  </div>`;
}
function emailCardHTML(c, m){
  const cd = m.card;
  const sent = cd.state === 'sent';
  return `<div class="acard cv-card cv-email">
    ${cvHead(`<div class="tile cv-tile brand">${cvAppMark(cd.provider || 'mailbox')}</div>`, sent ? 'Email sent' : 'Draft saved', sent ? `to ${esc((cd.to || []).join(', ') || 'recipient')}` : 'Not sent yet', sent ? '<span class="chip green">sent</span>' : '<span class="chip">draft</span>')}
    <div class="bd">${cvEmailHTML({ ...cd, provider:cd.provider || 'mailbox' }, { hideFrom:!cd.from })}</div>
  </div>`;
}

function browserCardHTML(c, m){
  const cd = m.card, k = c.id, mid = m.id;
  const running = cd.status === 'running';
  const word = running ? 'Working' : cd.status === 'failed' ? 'Stopped' : cd.status === 'interrupted' ? 'Interrupted' : 'Completed';
  const shot = safeImg(cd.screenshot);
  const host = cd.desktop ? 'Virtual computer' : hostName(cd.url) || cd.url || 'Browser';
  const label = cd.liveId || running ? 'Open live view' : 'Open preview';
  return `<div class="acard cv-card cv-browser ${running ? 'is-running' : ''}">
    ${cvHead(`<div class="tile cv-tile ${cd.status === 'failed' ? '' : 'green'}">${icon(cd.desktop ? 'laptop' : 'globe',20)}</div>`, cd.desktop ? 'Computer' : 'Browser', `${word}${cd.note ? ` · ${esc(cd.note)}` : ''}`, '')}
    <button type="button" class="cv-shot" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" aria-label="${label}">
      ${shot ? `<img src="${esc(shot)}" alt="Screenshot of ${esc(host)}" loading="lazy">` : `<span class="cv-shot-empty">${running ? '<span class="tdots"><i></i><i></i><i></i></span>' : icon(cd.desktop ? 'laptop' : 'globe',26)}</span>`}
      <span class="cv-shot-url">${icon(cd.desktop ? 'laptop' : 'globe',12)} ${esc(host)}</span>
    </button>
    <div class="stack"><button class="btn ghost" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${label}</button></div>
  </div>`;
}
function computerCardHTML(c, m){
  const cd = m.card, k = c.id, mid = m.id;
  const running = cd.status === 'running';
  const lines = (cd.lines || []).slice(-5);
  return `<div class="acard cv-card cv-computer">
    ${cvHead(`<div class="tile cv-tile dark">${icon('term',20)}</div>`, 'Computer', running ? 'Running in your workspace' : cd.status === 'failed' ? 'Stopped with an error' : `${(cd.lines || []).length} output lines`, '')}
    <div class="bd"><div class="term mini cv-term">${lines.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('') || '<div>$ …</div>'}${running ? '<div class="tdots"><i></i><i></i><i></i></div>' : ''}</div></div>
    <div class="stack"><button class="btn ghost" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${cd.pcId || running ? 'Open live view' : 'Open output'}</button></div>
  </div>`;
}

const CV_IMAGE_EXT = ['png','jpg','jpeg','webp','gif'];
/* Artifacts (pages, documents, images the agent made) show as one card: a live
   preview, then an icon that fits what it is, its real title and "Artifact".
   The kind comes from the title and the first part of the content. */
const ARTIFACT_KINDS = [
  ['game', 'game', 'Game', /\b(game|tic.?tac|snake|tetris|puzzle|quiz|trivia|memory match|wordle|chess|sudoku|spel)\b/i],
  ['calc', 'calc', 'Calculator', /\b(calculator|converter|estimator|kalkylator|räknare)\b/i],
  ['list', 'clipboard', 'List', /\b(leads?|prospects?|contacts|shortlist|checklist|to-?do|inventory|directory|lista)\b/i],
  ['dash', 'chart', 'Dashboard', /\b(dashboard|analytics|metrics|kpis?|report|chart|stats|statistics|tracker|budget)\b/i],
  ['plan', 'calendar', 'Plan', /\b(itinerary|schedule|planner|timeline|calendar|agenda|trip|travel|resa|schema)\b/i],
  ['slides', 'slides', 'Presentation', /\b(slides?|presentation|pitch deck|deck)\b/i],
  ['sheet', 'grid', 'Spreadsheet', /\b(spreadsheet|table|csv|comparison|jämförelse)\b/i],
  ['map', 'map', 'Map', /\b(map|route|karta)\b/i],
  ['doc', 'doc', 'Document', /\b(letter|essay|article|blog|resume|cv|contract|proposal|brief|notes|guide|recipe|story|poem)\b/i],
  ['web', 'web', 'Web page', /\b(landing|website|homepage|web ?page|portfolio|site|app)\b/i],
];
function artifactInfo(cd){
  const name = String(cd.name || cd.title || 'Artifact');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const content = typeof cd.content === 'string' && !cd.content.startsWith('data:') ? cd.content : '';
  const format = String(cd.format || ext || '');
  const isImage = /^image\//.test(cd.mime || '') || CV_IMAGE_EXT.includes(ext);
  const htmlTitle = /<title[^>]*>([^<]{2,120})<\/title>/i.exec(content)?.[1] || /<h1[^>]*>([\s\S]{2,200}?)<\/h1>/i.exec(content)?.[1]?.replace(/<[^>]+>/g, '') || '';
  const mdTitle = format === 'md' ? /^#\s+(.{2,120})$/m.exec(content)?.[1] || '' : '';
  // Generic file names ("your-page.html") say nothing; the page's own title does.
  const generic = /^(your-page|page|index|untitled|file|document|generated)(\.\w+)?$/i.test(name);
  const title = String(cd.title && cd.title !== name ? cd.title : (htmlTitle || mdTitle || (generic ? '' : name.replace(/\.(html?|md|txt|csv|json|svg)$/i, '').replace(/[-_]+/g, ' ')) || 'Artifact'))
    .replace(/\s+/g, ' ').trim().slice(0, 90);
  if (isImage) return { title, label:'Image', tone:'image', ic:'image' };
  if (/^video\//.test(cd.mime || '') || ['mp4','webm','mov'].includes(ext)) return { title, label:'Video', tone:'image', ic:'video' };
  if (/^audio\//.test(cd.mime || '') || ['mp3','wav','ogg','m4a'].includes(ext)) return { title, label:'Audio', tone:'plan', ic:'audio' };
  const probe = `${title} ${name} ${content.slice(0, 1500).replace(/<[^>]+>/g, ' ')}`;
  const hit = ARTIFACT_KINDS.find(([, , , rx]) => rx.test(`${title} ${name}`)) || ARTIFACT_KINDS.find(([, , , rx]) => rx.test(probe));
  if (hit) return { title, label:'Artifact', kind:hit[2], tone:hit[0], ic:hit[1] };
  if (format === 'csv') return { title, label:'Spreadsheet', tone:'sheet', ic:'grid' };
  if (format === 'md' || format === 'text') return { title, label:'Document', tone:'doc', ic:'doc' };
  if (['code','json','js','py','ts','css'].includes(format)) return { title, label:'Code', tone:'code', ic:'code' };
  return { title, label:'Artifact', tone:'web', ic:['html','htm','svg'].includes(format) ? 'web' : 'file' };
}
function artifactRow(c, m, info, canDownload){
  const k = c.id, mid = m.id;
  return `<div class="art-row">
      <span class="art-icon tone-${esc(info.tone)}" title="${esc(info.kind || info.label)}">${icon(info.ic, 22)}</span>
      <button type="button" class="art-copy" data-act="canvas-card" data-chat="${k}" data-msg="${mid}"><b>${esc(info.title)}</b><span>${esc(info.label)}</span></button>
      <details class="art-menu"><summary class="iconbtn" aria-label="More actions for ${esc(info.title)}">${icon('more', 18)}</summary>
        <div class="art-menu-list"><button type="button" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${icon('easel',14)} Open in Canvas</button>${canDownload ? `<button type="button" data-act="download" data-chat="${k}" data-msg="${mid}">${icon('down',14)} Download</button>` : ''}</div>
      </details>
    </div>`;
}
function fileCardHTML(c, m){
  const cd = m.card, k = c.id, mid = m.id;
  const name = String(cd.name || 'file');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const fromLibrary = cd.fromLibrary && cd.libraryId ? libraryItemContent(cd.libraryId, () => replaceNode(c, m)) : null;
  const data = String(cd.dataUrl || (String(cd.content || '').startsWith('data:') ? cd.content : '') || (fromLibrary?.content || ''));
  const isImage = /^image\//.test(cd.mime || '') || CV_IMAGE_EXT.includes(ext);
  const img = isImage ? safeImg(data) : '';
  const video = /^data:video\/(mp4|webm|ogg);base64,/.test(data) ? data : '';
  const audio = /^data:audio\/(mpeg|mp3|wav|ogg|webm|mp4);base64,/.test(data) ? data : '';
  const html = !data && ['html','htm'].includes(ext) && typeof cd.content === 'string' ? cd.content : '';
  const info = artifactInfo(cd);
  let media = '';
  if (img) media = `<button type="button" class="art-preview is-image" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" aria-label="Open ${esc(info.title)}"><img src="${esc(img)}" alt="${esc(info.title)}" loading="lazy"></button>`;
  else if (video) media = `<div class="art-preview is-media"><video controls preload="metadata" src="${esc(video)}"></video></div>`;
  else if (audio) media = `<div class="art-audio"><audio controls preload="metadata" src="${esc(audio)}"></audio></div>`;
  else if (html) media = `<button type="button" class="art-preview" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" aria-label="Open ${esc(info.title)}"><span class="art-frame"><iframe sandbox="allow-scripts" srcdoc="${esc(html)}" tabindex="-1" title="${esc(info.title)} preview"></iframe></span></button>`;
  return `<div class="acard art-card${media ? '' : ' no-preview'}">${media}${artifactRow(c, m, info, true)}</div>`;
}
function canvasCardHTML(c, m){
  const cd = m.card;
  const format = String(cd.format || 'text');
  const content = String(cd.content || '');
  let preview;
  // The title shows under the preview, so a leading heading is not repeated.
  if (format === 'md') preview = `<div class="art-doc md">${md(content.replace(/^\s*#{1,3}\s+[^\n]*\n+/, '').slice(0, 1400))}</div>`;
  else if (format === 'html' || format === 'svg') preview = `<span class="art-frame"><iframe sandbox="${format === 'html' ? 'allow-scripts' : ''}" srcdoc="${esc(content.slice(0, 60000))}" tabindex="-1" title="Preview"></iframe></span>`;
  else if (format === 'csv') {
    const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 6).map(r => r.split(',').slice(0, 5));
    preview = `<div class="art-doc"><table class="cv-table">${rows.map((r, i) => `<tr>${r.map(v => i ? `<td>${esc(v)}</td>` : `<th>${esc(v)}</th>`).join('')}</tr>`).join('')}</table></div>`;
  } else preview = `<div class="art-doc"><div class="minicode cv-code">${esc(content.split('\n').slice(0, 9).join('\n'))}</div></div>`;
  return `<div class="acard art-card"><button type="button" class="art-preview is-doc" data-act="canvas-card" data-chat="${c.id}" data-msg="${m.id}" aria-label="Open ${esc(cd.title || 'document')}">${preview}</button>${artifactRow(c, m, artifactInfo({ ...cd, name: cd.title || cd.name }), false)}</div>`;
}

// Question cards from the agent: task questions resume the task with the answer,
// chat questions send the answer as the owner's next message.
async function answerQuestion(c, m, answer, button){
  if (!signedIn()) { renderAuth(); return; }
  const reply = String(answer || '').trim().slice(0, 500);
  if (!reply || m.card.status !== 'pending') return;
  if (m.card.managedCallId) {
    if (button) button.disabled = true;
    try {
      if (m.card.taskId) await Engine.controlTask(makeRT(c), m.card.taskId, 'decide', { callId:m.card.managedCallId, allow:true, answer:reply, version:m.card.taskVersion });
      else await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow:true, answer:reply });
      m.card.status = 'answered'; m.card.choice = reply;
    } catch (error) { toast(error.message); }
    finally { if (button) button.disabled = false; }
    replaceNode(c, m); save(); return;
  }
  m.card.status = 'answered'; m.card.choice = reply;
  replaceNode(c, m); save();
  if (m.card.ask) sendPrompt(reply);
  else resolveCard(c, m, { choice:reply }, 'answered');
}

/* ---------------- cards ---------------- */
const STCHIP = {
  pending:'<span class="chip">waiting for you</span>',
  approved:'<span class="chip green">approved</span>',
  always:'<span class="chip green">always allowed</span>',
  denied:'<span class="chip">denied</span>',
  connected:'<span class="chip green">connected</span>',
  saved:'<span class="chip green">sealed in vault</span>',
  answered:c => `<span class="chip green">you: ${esc(c.choice)}</span>`,
  done:'<span class="chip green">done</span>',
  skipped:'<span class="chip">skipped</span>',
  expired:'<span class="chip">expired</span>',
};
const stChip = c => { const v = STCHIP[c.status]; return typeof v === 'function' ? v(c) : (v || ''); };

function cardNode(c, m){
  const k = c.id, mid = m.id, cd = m.card;
  const auto = cd.type === 'subagents' || cd.type === 'browser' || cd.type === 'computer';
  const chip = auto
    ? (cd.status === 'done' ? STCHIP.done : cd.status === 'interrupted' ? '<span class="chip">interrupted</span>' : cd.status === 'failed' ? '<span class="chip">failed</span>' : '<span class="chip">running</span>')
    : stChip(cd);
  const hd = (ic, bg, fg, title, sub) => `<div class="hd"><div class="tile" style="background:${bg};color:${fg}">${ic}</div><div><b>${title}</b><div class="sub">${sub}</div></div><div class="st">${chip}</div></div>`;
  const pending = cd.status === 'pending';

  if (cd.type === 'memory') return '';
  if (cd.type === 'auth_handoff') return `<div class="acard cv-card cv-approval ${pending ? 'is-pending' : ''}">
    ${cvHead(cvTile('shieldcheck'), esc(cd.method || 'Identity check'), esc(cd.website || 'Secure website'), cvDecisionChip(cd.status))}
    <div class="bd"><p>Complete this sign-in in the live browser. For BankID, check the website and request shown in your BankID app before approving. Your code and PIN stay with you.</p></div>
    ${pending ? `<div class="cv-actions"><button class="btn ghost" data-act="watchlive">Open live browser</button><button class="btn ghost" data-act="managed-deny" data-chat="${k}" data-msg="${mid}">Cancel</button><button class="btn" data-act="managed-allow" data-chat="${k}" data-msg="${mid}">I’ve finished</button></div>` : ''}
  </div>`;
  if (cd.type === 'approval' && cd.managedCallId) return approvalCardHTML(c, m);
  if (cd.type === 'question' && !cd.onboarding && !cd.mascotColors && !cd.customName) return questionCardHTML(c, m);
  if (cd.type === 'connect') return connectCardHTML(c, m);
  if (cd.type === 'present') return presentCardHTML(c, m);
  if (cd.type === 'order') return orderCardHTML(c, m);
  if (cd.type === 'email') return emailCardHTML(c, m);
  if (cd.type === 'browser') return browserCardHTML(c, m);
  if (cd.type === 'computer') return computerCardHTML(c, m);
  if (cd.type === 'file') return fileCardHTML(c, m);
  if (cd.type === 'canvas') return canvasCardHTML(c, m);

  if (cd.type === 'task') {
    const ongoing=['queued','running','waiting_peers','waiting_approval','stopping'].includes(cd.status);
    const teamId=c.managedTasks?.[cd.taskId]?.teamId;
    const hasPeers=teamId && Object.values(c.managedTasks || {}).filter(t=>t.teamId===teamId).length>1;
    const labels={queued:'Queued',running:'Working',waiting_peers:'Combining parallel work',waiting_approval:'Needs approval',stopping:'Stopping',stopped:'Stopped',completed:'Completed',partial:'Paused before finishing',failed:'Could not finish',needs_review:'Check outcome'};
    return `<div class="acard">${hd(icon('box',20),'var(--acc-soft)','var(--acc)',esc(cd.title),cd.status==='partial' ? 'Paused · findings saved' : 'You can keep chatting here')}
      <div class="bd"><b>${esc(labels[cd.status] || cd.status)}</b>${cd.connectionLost ? '<div class="mut">Reconnecting to your saved task…</div>' : ''}${cd.summary && cd.status!=='partial' ? `<p>${esc(cd.summary)}</p>` : ''}</div>
      ${cd.status==='partial' ? `<div class="stack"><button class="btn ghost" data-act="task-continue" data-chat="${k}" data-msg="${mid}">Continue task</button></div>` : ''}
      ${hasPeers ? `<div class="stack"><button class="btn ghost" data-act="task-change-team" data-chat="${k}" data-msg="${mid}">Update shared goal</button></div>` : ''}
      ${ongoing ? `<div class="stack"><button class="btn ghost" data-act="task-change" data-chat="${k}" data-msg="${mid}">Change task</button><button class="btn ghost" data-act="task-stop" data-chat="${k}" data-msg="${mid}" ${cd.status==='stopping'?'disabled':''}>Stop task</button></div>` : ''}</div>`;
  }

  if (cd.type === 'progress') return `<div class="acard progress-card ${cd.status === 'running' ? 'is-running' : 'is-finished'} is-${cd.status || 'done'}" ${cd.status === 'running' ? 'role="status" aria-live="polite"' : ''}>
    <span class="progress-card-icon">${icon(cd.status === 'running' ? 'spark' : cd.status === 'done' ? 'check' : 'x',16)}</span>
    <span>${esc(cd.label || 'Working on it')}</span>
    ${cd.status === 'running' ? '<span class="progress-card-dots"><i></i><i></i><i></i></span>' : ''}
    ${cd.status === 'interrupted' || cd.status === 'failed' ? `<span class="progress-card-state">${esc(cd.status)}</span>` : ''}
  </div>`;

  if (cd.type === 'approval' && cd.managedCallId) return `<div class="acard">
    ${hd(icon('shieldcheck',20),'var(--acc-soft)','var(--acc)',esc(approvalHeadline({title:cd.title,detail:cd.detail})),'Approve this exact action')}
    <div class="bd"><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(cd.detail)}</pre></div>
    ${pending ? `<div class="stack"><button class="btn" data-act="managed-allow" data-chat="${k}" data-msg="${mid}">Allow</button><button class="btn ghost" data-act="managed-deny" data-chat="${k}" data-msg="${mid}">Deny</button></div>` : ''}</div>`;

  if (cd.type === 'approval') return `<div class="acard">
    ${hd(icon('shieldcheck',20),'var(--acc-soft)','var(--acc)',`Allow ${esc(state.agent.name)}: ${esc(cd.title)}`,'Action approval')}
    <div class="bd"><span class="mut">${esc(cd.detail)}</span><div class="secnote" style="color:var(--mut)">${icon('box',13)} Restricted action — credentials remain protected.</div></div>
    ${pending ? `<div class="stack"><button class="btn" data-act="approve" data-chat="${k}" data-msg="${mid}">${icon('check',15)} Allow</button><button class="btn green" data-act="always" data-chat="${k}" data-msg="${mid}">Always allow</button><button class="btn soft" data-act="deny" data-chat="${k}" data-msg="${mid}">Deny</button></div>` : `<div class="ft"><span class="note">${icon('shield',12)} logged in trace</span></div>`}</div>`;

  if (cd.type === 'connect'){
    const app = cd.app === 'github' ? { n:'GitHub', ic:icon('git',20), fg:'var(--ink)' } : { n:'Gmail', ic:icon('mail',20), fg:'var(--acc)' };
    return `<div class="acard">${hd(app.ic,'#fff',app.fg, app.n,'Connector')}
    <div class="bd mut">I'll ask only for the permissions I need. Credentials remain protected.</div>
    ${pending ? `<div class="stack"><button class="btn" data-act="connect" data-chat="${k}" data-msg="${mid}">Connect</button><button class="btn ghost" data-act="deny-connect" data-chat="${k}" data-msg="${mid}">Not now</button></div>` : `<div class="ft"><span class="note">${icon('lock',12)} manage in Vault</span></div>`}</div>`;
  }

  if (cd.type === 'secret') {
    // Agent requests (vault_request) fix the name the agent will look up; the
    // decision event reports them as approved/denied rather than saved/skipped.
    const requested = !!cd.managedCallId;
    const saved = cd.status === 'saved' || cd.status === 'approved';
    const status = saved ? STCHIP.saved : cd.status === 'denied' ? STCHIP.skipped : stChip(cd);
    const login = requested && cd.kind === 'login';
    const title = login ? `${esc(cd.host)} sign-in` : requested ? `${esc(state.agent.name)} needs “${esc(cd.suggest || 'a credential')}”` : 'Save a secret to your vault';
    return `<div class="acard secret-card">
    <div class="hd"><div class="tile" style="background:var(--acc-soft);color:var(--acc)">${icon('key',20)}</div><div><b>${title}</b><div class="sub">${cd.host ? `For ${esc(cd.host)} · ` : ''}encrypted in your vault</div></div><div class="st">${status}</div></div>
    <div class="bd">
      ${requested && cd.note ? `<p class="secret-card-reason">${esc(cd.note)}</p>` : ''}
      ${pending ? `<div class="secret-card-fields">
        ${login ? `<label class="secret-card-label">Email or username<input class="field" data-f="username" type="text" aria-label="Email or username" placeholder="Enter email or username" autocomplete="off" spellcheck="false"></label>
        <label class="secret-card-label">Password<input class="field mono" data-f="password" type="password" aria-label="Password" placeholder="Enter password" autocomplete="new-password" spellcheck="false"></label>` : `
        ${requested ? `<span class="secret-card-name">${icon('lock',13)} ${esc(cd.suggest || '')}</span>` : `<input class="field" data-f="name" aria-label="Secret name" placeholder="Name, e.g. GitHub password" value="${esc(cd.nameVal || cd.suggest || '')}">`}
        <input class="field mono" data-f="val" type="password" aria-label="${cd.kind === 'api_key' ? 'API key' : 'Secret value'}" placeholder="${cd.kind === 'api_key' ? 'Paste API key' : 'Paste or type the value'}" autocomplete="off" spellcheck="false">`}
      </div>
      <div class="secnote">${icon('shieldcheck',14)} ${requested ? `${esc(state.agent.name)} only gets a reference, never the value. You approve each time it is typed into a site.` : 'The value is never shown in chat, logs or activity history.'}</div>` : ''}
    </div>
    ${pending ? `<div class="stack"><button class="btn" data-act="save-secret" data-chat="${k}" data-msg="${mid}">${icon('lock',14)} Save to vault</button><button class="btn ghost" data-act="skip-secret" data-chat="${k}" data-msg="${mid}">Not now</button></div>`
      : saved ? `<div class="ft"><span class="note mono">${cd.ref ? esc(cd.ref) + ' · ' : ''}••••••••</span><button class="btn ghost small" data-act="nav" data-view="vault">Open vault</button></div>` : ''}</div>`;
  }

  if (cd.type === 'passport') return `<div class="acard">
    ${hd(icon('user',20),'var(--acc-soft)','var(--acc)','Your agent is ready',state.agent.name)}
    <div class="bd">${esc(cd.note)}</div>
    <div class="stack"><button class="btn" data-act="open-passport" data-chat="${k}" data-msg="${mid}">Start chatting ${icon('aur',15)}</button></div></div>`;

  if (cd.type === 'question') return `<div class="acard">
    ${hd(icon('spark',20),'var(--acc-soft)','var(--acc)','Question', state.agent.name + ' is asking')}
    <div class="bd"><b>${esc(cd.q)}</b>
    <div class="qopts" style="margin-top:10px">${cd.options.map(o => {
      const on = cd.status === 'answered' && cd.choice === o;
      const dim = cd.status === 'answered' && cd.choice !== o;
      const color = cd.mascotColors && Mascot.keys.find(k => Mascot.PALETTE[k].name === o);
      const label = (color ? Mascot.svg(color,'happy',44) : '') + esc(o);
      return pending
        ? `<button class="qopt" data-act="qopt" data-chat="${k}" data-msg="${mid}" data-o="${esc(o)}">${label}<span class="tick">${icon('check',12)}</span></button>`
        : `<span class="qopt ${on ? 'on' : 'dim'}" style="cursor:default">${label}<span class="tick">${icon('check',12)}</span></span>`;
    }).join('')}${cd.customName ? (pending ? `<form class="qopt qcustom" data-onboarding-name data-chat="${k}" data-msg="${mid}"><input name="agentName" aria-label="Type your own name" placeholder="Type your own" maxlength="18" required value="${esc(cd.draft || '')}"><button class="btn small" type="submit">Use name</button></form>` : (!cd.options.includes(cd.choice) ? `<span class="qopt on">${esc(cd.choice)}<span class="tick">${icon('check',12)}</span></span>` : '')) : ''}</div></div></div>`;

  if (cd.type === 'subagents') return `<div class="acard">
    ${hd(icon('box',20),'var(--line2)','var(--mut)',cd.agents.length === 1 ? 'Delegated task' : 'Parallel tasks',cd.agents.length === 1 ? 'main agent remains available' : 'working concurrently')}
    <div class="bd">${cd.agents.map(a => `<div class="subrow">
      <div><span class="nm">${esc(a.name)}</span><div class="ds">${esc(a.desc)}</div></div>
      <span class="stt">${a.status === 'running' ? `<span class="spin">${icon('refresh',13)}</span> running` : a.status === 'done' ? `<span style="color:var(--green)">${icon('check',13)}</span> ${esc(a.note || 'done')}` : a.status === 'interrupted' || a.status === 'failed' ? `<span style="color:var(--soft)">${icon('x',13)}</span> ${esc(a.note || a.status)}` : `<span style="color:var(--soft)">${icon('clock',13)}</span> queued`}</span>
    </div>`).join('')}</div></div>`;

  if (cd.type === 'browser') return `<div class="acard">
    ${hd(icon(cd.desktop ? 'term' : 'globe',20),'var(--ink)','#fff',cd.desktop ? 'Computer' : 'Browser', esc(cd.note || ''))}
    <div class="bd"><span class="rurl">${esc(cd.url || 'Browser session')}</span></div>
    <div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${cd.liveId || cd.status === 'running' ? 'Open live view' : 'View in Canvas'}</button></div></div>`;

  if (cd.type === 'computer') return `<div class="acard">
    ${hd(icon('term',20),'var(--ink)','#fff',cd.managed ? 'Agent tool output' : 'Read-only tool output',cd.managed ? 'Actual managed sandbox or search result' : 'Computed from the approved API response')}
    <div class="bd mut">${cd.status === 'running' ? 'Computer is working…' : `${(cd.lines || []).length} output lines ready`}</div>
    <div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${cd.pcId || cd.status === 'running' ? 'Open live view' : 'View in Canvas'}</button></div></div>`;

  if (cd.type === 'file') return `<div class="acard"><div class="filrow">
    <div class="fic">${icon('file',17)}</div>
    <div><b>${esc(cd.name)}</b><div class="sz">${fmtBytes(cd.size || 0)} · saved to Files</div></div>
    <div class="acts"><button class="iconbtn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" title="View in Canvas">${icon('easel',15)}</button><button class="iconbtn" data-act="download" data-chat="${k}" data-msg="${mid}" title="Download">${icon('down',15)}</button></div>
  </div></div>`;

  if (cd.type === 'canvas') return `<div class="acard">${hd(icon('easel',20),'var(--acc-soft)','var(--acc)',esc(cd.title || 'Canvas item'),esc(cd.format || 'document'))}
    <div class="bd mut">${esc(String(cd.content || '').slice(0, 180))}</div><div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">Open in Canvas</button></div></div>`;

  if (cd.type === 'artifact') return `<div class="acard">
    <div class="bd" style="padding-top:14px">${prevFor(c, cd)}</div>
    <div class="filrow" style="border-top:1px solid var(--line2);padding-top:12px">
      <div class="fic" style="background:var(--green-soft);color:var(--green)">${icon('spark',16)}</div>
      <div><b>${esc(cd.title)}</b><div class="sz">Artifact</div></div>
      <div class="acts"><button class="iconbtn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" title="View on canvas">${icon('easel',14)}</button><button class="dotmenu" data-act="artmenu" title="More">•••</button></div>
    </div></div>`;

  if (cd.type === 'goal') {
    const cat = goalCat(cd.category === 'relationships' ? 'family' : cd.category);
    const heading = cd.action === 'created' ? 'Goal created' : cd.action === 'deleted' ? 'Goal removed' : cd.goalStatus === 'done' ? 'Goal completed' : 'Goal updated';
    const sub = cd.action === 'deleted' ? 'No longer on your Goals page' : cat.label + (cd.stepsTotal ? ` · ${cd.stepsDone} of ${cd.stepsTotal} steps done` : '');
    return `<div class="acard">${hd(icon(cd.goalStatus === 'done' ? 'check' : 'target',20),'var(--green-soft)','var(--green)',heading,esc(sub))}
      <div class="bd">${esc(cd.title || '')}</div>${cd.action === 'deleted' ? '' : `<div class="ft"><button class="btn ghost small" data-act="goal-view">View goals ${icon('aur',13)}</button></div>`}</div>`;
  }
  if (cd.type === 'library') {
    const heading = cd.action === 'deleted' ? 'Removed from your Library' : cd.action === 'renamed' ? 'Renamed in your Library' : 'Saved to your Library';
    return `<div class="acard">${hd(icon('library',20),'var(--acc-soft)','var(--acc)',heading,esc(cd.kind ? libTypeLabel(cd.kind === 'file' ? 'artifact' : cd.kind) : 'File'))}
      <div class="bd">${esc(cd.title || '')}</div>${cd.action === 'deleted' ? '' : `<div class="ft"><button class="btn ghost small" data-act="open-library">Open Library ${icon('aur',13)}</button></div>`}</div>`;
  }
  if (cd.type === 'system_file') return `<div class="acard">
    ${hd(icon('doc',20),'var(--acc-soft)','var(--acc)','System file updated','Used in future agent replies')}
    <div class="bd">${esc(cd.title || '')}</div><div class="ft"><button class="btn ghost small" data-act="system-file-view" data-key="${esc(cd.key || '')}">View file ${icon('aur',13)}</button></div></div>`;
  if (cd.type === 'memory') return `<div class="acard">
    ${hd(icon('book',20),'var(--green-soft)','var(--green)','Saved to memory','I can recall this in any chat')}
    <div class="bd">${esc(cd.text)}</div></div>`;

  return '';
}

function prevFor(c, cd){
  const a = c.artifact;
  if (!a || a.title !== cd.title) return '';
  if (a.kind === 'html') return `<div class="prev"><iframe sandbox="allow-scripts" srcdoc="${esc(a.html)}"></iframe></div>`;
  if (a.kind === 'chart'){
    const max = Math.max.apply(null, a.data.map(d => d.v));
    return `<div class="prev"><div class="minibars">${a.data.map(d => `<i style="height:${Math.round(d.v / max * 100)}%;background:${d.c}"></i>`).join('')}</div></div>`;
  }
  if (a.kind === 'code') return `<div class="prev"><div class="minicode">${esc(a.code.split('\n').slice(0, 6).join('\n'))}</div></div>`;
  if (a.kind === 'plan') return `<div class="prev"><div class="miniplan">${a.items.slice(0, 3).map(i => `<span>• ${esc(i.replace(/\*\*/g,''))}</span>`).join('')}</div></div>`;
  return '';
}

/* ---------------- runtime for the engine ---------------- */
const managedRunTokens = new WeakMap();
function makeRT(c){
  const active = () => isActive(c);
  const threadInner = () => $('#tinner');
  const scroll = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
  const append = n => { if (active() && threadInner()){ const t=$('#thread');const atBottom=!t || t.scrollHeight-t.scrollTop-t.clientHeight<100;try { n.classList && n.classList.add('msg-new'); } catch {} threadInner().appendChild(n); if(atBottom)scroll(); updateFloat(); } };
  const runToken = uid();
  let answerReady = false;
  let currentProgress = null;
  const finishProgress = (status = 'done') => {
    if (currentProgress?.card.status === 'running') {
      currentProgress.card.status = status;
      replaceNode(c, currentProgress);
      save();
    }
    currentProgress = null;
  };


  const rt = {
    chat: c, agent: state.agent, vault: state.vault,
    isFirst: c.messages.filter(m => m.role === 'user').length <= 1,
    managedTask(task){
      c.managedTasks=c.managedTasks || {};
      const previous=c.managedTasks[task.id];
      const cursor=previous?.sequence || 0;
      const newer=!previous || Number(task.revision)>=Number(previous.revision);
      const snapshot=newer ? {...task} : {...previous};
      delete snapshot.events;
      // Events are immutable and ordered. A late advance response cannot
      // overwrite a newer control decision or replay an already shown card.
      let sequence=cursor;
      for(const event of (task.events || []).slice().sort((a,b)=>a.seq-b.seq)) {
        if(event.seq<=sequence)continue;
        if(event.seq!==sequence+1)break;
        rt.managedEvent(event,{id:task.id,version:event.version || task.version});sequence=event.seq;
      }
      snapshot.sequence=sequence;c.managedTasks[task.id]=snapshot;
      let m=c.messages.find(x=>x.managedId===`task_${task.id}`);
      const card={type:'task',taskId:task.id,title:snapshot.title,status:snapshot.status,summary:snapshot.summary};
      if(!m) {m={id:uid(),managedId:`task_${task.id}`,kind:'card',card};c.messages.push(m);append(msgNode(c,m));}
      else {m.card=card;replaceNode(c,m);}
      save();if(active()){updateFloat();syncComposerActions(c);}
    },
    taskConnection(taskId,connected){
      const m=c.messages.find(x=>x.managedId===`task_${taskId}`);
      if(m){m.card.connectionLost=!connected;replaceNode(c,m);save();}
    },
    managedEvent(event, task){
      if (event.type === 'heartbeat') return;
      if (event.type === 'session' && event.status === 'running') {
        if (managedRunTokens.get(c) !== runToken) {
          for (const m of c.messages) {
            if (!m.card?.taskId && m.card?.type === 'progress' && m.card.status === 'running') {
              m.card.status = 'interrupted';
              replaceNode(c,m);
            }
          }
        }
        managedRunTokens.set(c, runToken);
        c.managedStatus = 'running';
      }
      if (!task && managedRunTokens.get(c) !== runToken && !(answerReady && ['card', 'artifact', 'trace'].includes(event.type))) return;
      if (event.type === 'progress' && typeof event.label === 'string') {
        // Internal stages do not create chat cards (published cards stay in
        // history; task updates arrive as milestone cards) — they only
        // narrate the header mascot's status line.
        if (!task) noteActivity(c, event.label);
        return;
      }
      if (event.type === 'stopped') c.managedStatus = 'stopped';
      if (event.type === 'paused') c.managedStatus = 'paused';
      if (event.type === 'done') c.managedStatus = event.status;
      if (['stopped', 'paused', 'done', 'error'].includes(event.type)) finishProgress(event.type === 'error' ? 'failed' : event.type === 'stopped' ? 'interrupted' : 'done');
      if (event.type === 'trace') { rt.trace(event.trace.ic || 'box', event.trace.t); return; }
      if (event.type === 'artifact') { rt.artifact(event.artifact,{background:!!task}); return; }
      if (event.type === 'decision') {
        const m = c.messages.find(x => x.card?.managedCallId === event.callId && (!task || x.card.taskId===task.id));
        if (m) { m.card.status = event.status; m.card.choice = event.answer; if(event.ref)m.card.ref=event.ref; replaceNode(c,m); }
      }
      if (event.type === 'message_retract') {
        const i = c.messages.findIndex(x => x.managedId === event.id);
        if (i >= 0) {
          const gone = c.messages.splice(i, 1)[0];
          if (active()) document.querySelector(`[data-mid="${gone.id}"]`)?.remove();
        }
      }
      if (event.type === 'message_reaction') {
        const target = c.messages.find(x => x.id === event.messageId && x.kind === 'text' && x.role === 'user');
        const reaction = findReaction(event.emoji);
        if (target && reaction) {
          target.agentReaction = reaction.id;
          if (active()) replaceNode(c, target);
        }
      }
      if (event.type === 'message' || event.type === 'message_delta') {
        if (!task && event.phase === 'final_answer') {
          answerReady = true;
          c.managedStatus = 'completed';
          finishProgress();
          if (active()) { updateFloat(); syncComposerActions(c); }
        }
        let m = c.messages.find(x => x.managedId === event.id);
        if (!m) { m = { id:uid(), managedId:event.id, role:'agent', kind:'text', text:'' }; c.messages.push(m); if (active()) append(msgNode(c,m)); }
        if (event.type === 'message_delta') {
          if (!task && !m.text) noteActivity(c, 'Writing the reply');
          m.text += event.delta || '';
          if (active()) streamPaint(c, m);
        } else {
          m.text = event.text;
          replaceNode(c, m);
        }
      }
      if (event.type === 'card' && event.card?.type === 'memory') {
        // Memory saves stay out of the chat; the Library memory file shows them.
        if (typeof window !== 'undefined' && window.LingonAuth?.signedIn()) syncFromBackend(true).then(()=>{if(state.view==='library'&&state.libraryCat==='system'&&state.systemFile==='system:memory'&&$('#main'))paintLibrary($('#main'));}).catch(()=>{});
        else if (!state.memory.some(x => x.text === event.card.text)) rt.remember(event.card.text, 'account');
        save();
        return;
      }
      if (event.type === 'card') {
        let m = c.messages.find(x => x.managedId === event.id);
        const card = { ...event.card, managedCallId:event.callId, taskId:task?.id, taskVersion:task?.version };
        if (!m) { m = { id:uid(), managedId:event.id, kind:'card', card }; c.messages.push(m); append(msgNode(c,m)); }
        else { m.card = card; replaceNode(c,m); }
        if (card.type === 'goal') refreshGoals();
        if (card.type === 'library' || card.libraryId) refreshLibrary();
        if (card.type === 'system_file') refreshSystemFiles(true);
        if (card.type === 'memory') {
          if (typeof window !== 'undefined' && window.LingonAuth?.signedIn()) syncFromBackend(true).then(()=>{if(state.view==='library'&&state.libraryCat==='system'&&state.systemFile==='system:memory'&&$('#main'))paintLibrary($('#main'));}).catch(()=>{});
          else if (!state.memory.some(x => x.text === card.text)) rt.remember(card.text, 'account');
        }
        if (active() && state.canvasOpen && (state.canvasTab || 'canvas') === 'canvas' && (!c.canvasSelectedMessageId || ['browser','computer'].includes(card.type))) paintCanvas();
      }
      if (event.type === 'error') {
        c.managedStatus = 'failed';
        const m = { id:uid(), role:'agent', kind:'text', text:event.error, mood:'think' };
        c.messages.push(m); append(msgNode(c,m));
        rt.trace('alert', event.error);
      }
      if (event.type !== 'message_delta') save();
      if (event.type === 'session' && active()) syncComposerActions(c);
      if (['done','paused','error','stopped'].includes(event.type) && active()) { invalidateBilling(); paintMain(); paintSide(); }
    },
    recall: () => state.memory.slice(),
    hasApp: n => false,
    hasSecret: n => state.vault.secrets.some(s => s.name === n),
    secretRef: n => { const s = state.vault.secrets.find(s => s.name === n); return s ? s.ref : 'sec_••••'; },
    openSubAgents(prompt){
      state.subAgentDraft = String(prompt || '').slice(0, 4000);
      state.subAgentComposer = true;
      state.canvasTab = 'subagents'; state.canvasOpen = true;
      const app = $('#app'); if (app) app.classList.remove('nocanvas'); syncShellClasses();
      save(); paintCanvas(); refreshSubAgents();
    },
    remember(text, src){ state.memory.unshift({ id: uid(), text, src: src || 'chat', at: Date.now() }); save(); },
    trace(ic, t){
      c.trace = c.trace || []; c.trace.push({ ic, t, at: Date.now() });
      save();
    },
    artifact(a,opts={}){
      c.artifact = a;
      if(!opts.background){c.canvasSelectedMessageId = null; delete c.canvasSelectedFileIndex;}
      if(active()) {
        if(state.canvasOpen && state.canvasTab==='canvas')paintCanvas();
      }
      save();
    },
    chips(){ /* suggestion chips removed — no-op for backward compat */ },
    // iPhone-style typing indicator: an agent bubble with ONLY three dots.
    // Shows instantly (no wait) and stays until replaced by real content.
    // Returns a live handle so callers can stream updates without waiting
    // for the final answer: handle.append(delta) / handle.update(fullText) /
    // handle.done(finalText). Works even if the chat is not active.
    typing(opts){
      const m = { id: uid(), role:'agent', kind:'text', text:'', mood:(opts || {}).mood || 'idle', typing: true };
      c.messages.push(m);
      let node = null;
      let bodyEl = null;
      if (active()){
        node = msgNode(c, m);
        append(node);
        bodyEl = node.querySelector('.md');
        if (bodyEl) bodyEl.innerHTML = '<span class="tdots" aria-label="typing"><i></i><i></i><i></i></span>';
        scroll();
      }
      let full = '';
      let raf = 0;
      const nextFrame = (fn) => {
        if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
        return setTimeout(fn, 0);
      };
      const cancelFrame = (id) => {
        if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame(id);
        return clearTimeout(id);
      };
      const paint = () => {
        raf = 0;
        if (!bodyEl || !bodyEl.isConnected) return;
        if (!full) {
          bodyEl.innerHTML = '<span class="tdots" aria-label="typing"><i></i><i></i><i></i></span>';
        } else {
          bodyEl.innerHTML = md(full);
        }
        scroll();
      };
      const schedule = () => {
        // Coalesce rapid deltas into one paint per frame — updates stream
        // in live without re-render thrash or artificial waiting.
        if (raf) return;
        raf = nextFrame(paint);
      };
      return {
        msg: m,
        append(delta){
          full += String(delta == null ? '' : delta);
          m.text = full;
          if (bodyEl && bodyEl.isConnected) schedule();
          return full;
        },
        update(text){
          full = String(text == null ? '' : text);
          m.text = full;
          if (bodyEl && bodyEl.isConnected) schedule();
          else if (!active()) save();
          return full;
        },
        done(text, doneOpts){
          if (raf) { cancelFrame(raf); raf = 0; }
          if (text != null) { full = String(text); m.text = full; }
          delete m.typing;
          if (doneOpts && doneOpts.mood) m.mood = doneOpts.mood;
          if (active()){
            // Re-render through the normal node so markdown, avatar and
            // actions are identical to a finished message.
            const fresh = msgNode(c, m);
            if (node && node.isConnected) node.replaceWith(fresh);
            else append(fresh);
            updateFloat();
            scroll();
          }
          save();
          return m;
        },
        abort(){
          if (raf) { cancelFrame(raf); raf = 0; }
          const i = c.messages.indexOf(m);
          if (i >= 0) c.messages.splice(i, 1);
          try { if (node && node.isConnected) node.remove(); } catch {}
          save();
        },
      };
    },
    async say(text, opts){
      // Instant send: bubble + three dots appear synchronously, then the
      // text paints without the old 500ms artificial wait.
      const handle = rt.typing(opts);
      const full = String(text == null ? '' : text);
      if (!full) return handle.done('', opts), undefined;
      if (!active()){
        handle.done(full, opts);
        return;
      }
      // Fast progressive paint for non-streamed answers. Chunked (not
      // per-token sleeps) so long answers appear quickly and never block
      // subsequent sends.
      const chunks = full.match(/(\s+|[^\s]+\s*)/g) || [full];
      let acc = '';
      const yieldFrame = () => new Promise((r) => {
        if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => r());
        return setTimeout(r, 0);
      });
      for (let i = 0; i < chunks.length; i++){
        acc += chunks[i];
        handle.update(acc);
        // Yield to the browser every few chunks so the dots/text animate
        // smoothly; no fixed 500ms/16ms waits.
        if (i % 6 === 5) await yieldFrame();
      }
      handle.done(acc, opts);
    },
    async tools(items){
      // No artificial waiting: log tool lines instantly so the chat never
      // stalls on status messages. The "Working on your request" pseudo
      // status is dropped — the typing dots are the only pending signal.
      const list = (items || []).filter((it) => {
        const t = String(it && it.t || '').toLowerCase();
        return t !== 'working on your request';
      });
      if (!list.length) return;
      const m = { id: uid(), kind:'tools', items: [] }; c.messages.push(m);
      const n = active() ? msgNode(c, m) : null; if (n) append(n);
      for (const it of list){
        m.items.push(it);
        noteActivity(c, it.t);
        if (n){ n.querySelector('.tools').insertAdjacentHTML('beforeend', tlineHTML(it)); scroll(); }
        rt.trace(it.ic, it.t + (it.d ? ' · ' + it.d : ''));
      }
      save();
    },
    card(data){
      if (!data.status) data.status = 'pending';
      const m = { id: uid(), kind:'card', card: data }; c.messages.push(m);
      const n = active() ? msgNode(c, m) : null; if (n) append(n);
      save();
      const key = wkey(c.id, m.id);
      return {
        msg: m,
        update(fn){ fn(m.card); replaceNode(c, m); save(); },
        wait: (signal) => new Promise((resolve, reject) => {
          if (signal?.aborted) {
            const error = new Error('Task interrupted'); error.name = 'AbortError'; reject(error); return;
          }
          const onAbort = () => {
            delete waits[key];
            m.card.status = 'interrupted'; replaceNode(c, m); save();
            const error = new Error('Task interrupted'); error.name = 'AbortError'; reject(error);
          };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          waits[key] = (payload) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve(payload);
          };
        }),
        resolve(p){ const f = waits[key]; if (f){ delete waits[key]; f(p); } },
      };
    },
  };
  return rt;
}

const streamPaintPending = new WeakMap();
function streamPaint(c, m){
  const old = document.querySelector(`[data-mid="${m.id}"]`);
  if (!old) { replaceNode(c, m); return; }
  if (streamPaintPending.get(m)) return;
  const run = () => {
    streamPaintPending.delete(m);
    const node = document.querySelector(`[data-mid="${m.id}"]`);
    const bodyEl = node?.querySelector('.md');
    if (!bodyEl || !bodyEl.isConnected) { replaceNode(c, m); return; }
    bodyEl.innerHTML = md(m.text);
    const t = $('#thread');
    if (t && t.scrollHeight - t.scrollTop - t.clientHeight < 100) t.scrollTop = t.scrollHeight;
  };
  streamPaintPending.set(m, true);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function replaceNode(c, m){
  const old = document.querySelector(`[data-mid="${m.id}"]`);
  if (old) old.replaceWith(msgNode(c, m));
  updateFloat();
  // Live-follow: browser/computer progress also renders in the canvas timeline.
  if (m.kind === 'card' && state.canvasOpen && (state.canvasTab || 'canvas') === 'canvas' && isActive(c)) paintCanvas();
}

/* Visual browser and computer activity lives in the canvas. Older chats may
   still contain these cards in their message history. */
function runTimelineHTML(c){
  if (!c) return '';
  const shown = new Set((c.messages || []).map(m => m.managedId).filter(Boolean));
  const runs = (c.canvasRuns || []).filter(run => !shown.has(run.id));
  if (!runs.length) return '';
  return `<div class="runbox"><div class="runhead">${icon('box',14)} Live run — browser &amp; computer use</div>` + runs.map(m => {
    const cd = m.card;
    if (cd.type === 'browser') return `<div class="runrow"><span class="rtile">${icon('globe',14)}</span><div class="rbody">
      <div class="rurl">${esc(cd.url || 'VM browser')}</div><div class="rnote">${cd.status === 'done' ? 'rendered' : cd.status === 'failed' ? 'failed' : 'working…'} · ${esc(cd.note)}</div>
      ${cd.screenshot ? `<div class="shot"><img src="${cd.screenshot}" alt="Rendered page screenshot" loading="lazy"></div>` : ''}
      ${cd.liveId ? `<button class="btn ghost small" data-act="watchlive">Watch live</button>` : ''}</div></div>`;
    return `<div class="runrow"><span class="rtile dark">${icon('term',14)}</span><div class="rbody">
      <div class="term mini">${cd.lines.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('')}</div></div></div>`;
  }).join('') + `</div>`;
}

function resolveCard(c, m, payload, status){
  m.card.status = status;
  replaceNode(c, m); save();
  const key = wkey(c.id, m.id);
  const f = waits[key]; if (f){ delete waits[key]; f(payload); }
}

/* ---------------- send / chats (real accounts only) ---------------- */
async function sendPrompt(text, files){
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); toast('Sign up or log in — your message is saved and will be sent after.'); return; }
  ensureOwnerScope();
  const c = chat();
  if (needsOnboarding()) {
    if (c?.onboarding) {
      const pq = pendingQuestion(c);
      if (pq) answerOnboarding(c, pq.m, text);
      else toast('Finish setup from the agent card.');
    } else startPendingPromptFlow(text);
    return;
  }
  if (!c) return;
  const currentTask = runningTask(c);
  const taskReply=c.taskReply;
  const route = Engine.routeMessage(currentTask, text);
  if (route === 'new-chat') {
    const next = { id: uid(), title: text.length > 42 ? text.slice(0, 42) + '…' : text, messages:[], trace:[], artifact:null, createdAt:Date.now() };
    next.messages.push({ id: uid(), role:'user', kind:'text', text, files: files && files.length ? files : undefined, replyTo: c.replyingTo || undefined });
    c.replyingTo = null;
    state.chats.unshift(next); state.activeChat = next.id; state.view = 'chat';
    save(); renderApp();
    launchDelegatedTask(next, text, { openedNewChat: true });
    return;
  }
  if (c.messages.filter(m => m.role === 'user').length === 0) c.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
  c.messages.push({ id: uid(), role:'user', kind:'text', text, files: files && files.length ? files : undefined, replyTo: c.replyingTo || undefined });
  c.replyingTo = null;
  save();
  if (state.view !== 'chat'){ state.view = 'chat'; }
  threadStickNext = true; // your own message always lands in view
  paintSide(); paintMain();
  if (Engine.managed && taskReply) {
    try {await Engine.controlTask(makeRT(c),taskReply,c.taskReplyScope==='team'?'steer_team':'steer',{instruction:text});c.taskReply=null;c.taskReplyScope=null;save();paintMain();}
    catch(error){toast(error.message);}
    return;
  }
  if (route === 'interrupt') {
    stopDelegatedTask(c);
    await makeRT(c).say(`Stopped. The delegated worker has been interrupted, and I'm ready for your next message.`, { mood: 'idle' });
    paintMain(); paintSide();
    return;
  }
  if (route === 'update-task') {
    const previous = stopDelegatedTask(c);
    const updatedPrompt = `${previous.prompt}\n\nUser update: ${text}`;
    launchDelegatedTask(c, updatedPrompt, {
      kind: previous.kind, updated: true,
      updates: [...(previous.updates || []), text],
    });
    return;
  }
  if (currentTask) {
    c.coordinatorRuns = Number(c.coordinatorRuns || 0) + 1; save(); paintMain();
    try { await Engine.respondWhileWorking(makeRT(c), text, currentTask); }
    finally {
      c.coordinatorRuns = Math.max(0, Number(c.coordinatorRuns || 1) - 1);
      save(); paintMain(); paintSide();
    }
    return;
  }
  await runAgentOn(c, text);
}

function newChat(options = {}){
  if (!signedIn()){ renderAuth(); toast('Sign up or log in to start a chat.'); return; }
  ensureOwnerScope();
  if (!state.onboarded || !state.agent || state.agent.provisional){
    // New accounts finish in-chat onboarding first — no empty demo chats.
    if (state.pendingPrompt) startPendingPromptFlow();
    else openOnboarding();
    return;
  }
  const c = { id: uid(), title:'New chat', messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat'; save();
  renderApp();
  // Goal categories start the conversation right away; the agent saves the goal
  // to the Goals page with its goal tools once the owner has said what they want.
  if (options.goal) {
    const category = GOAL_CATS.some(cat => cat.id === options.category) ? options.category : 'other';
    const area = category === 'other' ? 'personal' : goalCat(category).label.toLowerCase();
    c.title = category === 'other' ? 'New goal' : goalCat(category).label + ' goal';
    sendPromptDirect(c, `Help me create a ${area} goal. Ask what I want to achieve, help me make it specific, then add it to my Goals with a few small steps.`);
    return;
  }
}

/* ---------------- canvas + right-side agent slider ---------------- */
function agentAppearanceForm(a){
  return `<div class="agent-edit-form">
    <label class="alabel">Agent name</label>
    <input class="field" id="agentname" maxlength="18" value="${esc(a.name)}">
    <label class="alabel">Mascot appearance</label>
    <div class="swatches" style="justify-content:flex-start;margin-top:8px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}" title="${Mascot.PALETTE[k].name}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
    <label class="alabel">Personality</label>
    <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
  </div>`;
}
function canvasHeroHTML(){
  const a = state.agent;
  if (!a) return '';
  const editing = !!state.agentEdit;
  const connection = workspaceConnectionView();
  return `<div class="agent-hero">
    <div class="agent-hero-fig">
      ${Mascot.svg(a.color, editing ? 'happy' : 'idle', 84)}
      <button class="iconbtn agent-hero-edit${editing ? ' on' : ''}" data-act="agent-edit" title="Edit appearance">${icon('pencil',14)}</button>
    </div>
    <b class="agent-hero-name">${esc(a.name)}</b>
    <span class="agent-hero-status${connection.tone ? ' ' + connection.tone : ''}"><i></i><span>${esc(connection.label)}</span></span>
    ${mailCache && mailCache.address ? `<div class="sub mono agent-hero-mail">${esc(mailCache.address)}</div>` : ''}
    ${editing ? agentAppearanceForm(a) : ''}
  </div>`;
}
function libraryTabContent(){
  const cat = state.libraryCat || 'all';
  const items = libraryFiltered();
  const all = libraryItems();
  const count = (c) => c === 'all' ? all.length : c === 'images' ? all.filter(x => x._type === 'image').length : c === 'videos' ? all.filter(x => x._type === 'video').length : c === 'podcasts' ? all.filter(x => x._type === 'audio').length : c === 'documents' ? all.filter(x => x._type === 'document').length : c === 'web' ? all.filter(x => x._type === 'web').length : c === 'artifacts' ? all.filter(x => !['image','video','audio'].includes(x._type)).length : 0;
  const titles = { all:'All artifacts', artifacts:'Artifacts', documents:'Documents', web:'Web artifacts', images:'Images', videos:'Videos', podcasts:'Podcasts', system:'System files' };
  const recent = items.slice(0, 4);
  const rest = items.slice(4);
  // Memory is shown as a generated system file, so it has no separate nav entry.
  const sideBtn = (id, ic, label) => {
    const on = cat === id;
    const n = id === 'system' ? 0 : count(id);
    return `<button class="lib-nav${on ? ' on' : ''}" data-act="libcat" data-cat="${id}"${on ? ' aria-current="page"' : ''}>${icon(ic,16)}<span>${label}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  };
  const gridCls = state.libraryLayout === 'list' ? 'lib-grid list' : 'lib-grid';
  const title = titles[cat] || 'All artifacts';
  return `<div class="lib-layout">
    <aside class="lib-side" aria-label="Library sections">
      <label class="lib-search">${icon('search',15)}<input id="libsearch" class="field lib-search-in" placeholder="Search" aria-label="Search the library" value="${esc(state.librarySearch || '')}"></label>
      <div class="lib-group">Artifacts</div>
      ${sideBtn('all','grid','All artifacts')}
      ${sideBtn('documents','doc','Documents')}
      ${sideBtn('web','web','Web artifacts')}
      <div class="lib-group">Media</div>
      ${sideBtn('images','image','Images')}
      ${sideBtn('videos','video','Videos')}
      ${sideBtn('podcasts','podcast','Podcasts')}
      <div class="lib-side-foot">${sideBtn('system','folder','System files')}</div>
    </aside>
    <section class="lib-main"><div class="lib-main-inner">
      ${cat === 'system' ? systemLibraryBody() : `<div class="lib-head">
        <div><span class="lib-eyebrow">Library</span><h1>${esc(title)}</h1></div>
        <span class="lib-actions">
          ${state.librarySelect ? `<button class="btn ghost small" data-act="lib-clear">Cancel</button><button class="btn soft small" data-act="lib-delete">${icon('trash',13)} Delete (${(state.librarySelected || []).length})</button>` : items.length ? `<button class="btn ghost small" data-act="lib-select">Select</button>` : ''}
          ${items.length ? `<button class="iconbtn" data-act="lib-layout" title="${state.libraryLayout === 'list' ? 'Show as grid' : 'Show as list'}" aria-label="${state.libraryLayout === 'list' ? 'Show as grid' : 'Show as list'}">${icon(state.libraryLayout === 'list' ? 'grid' : 'list',16)}</button>` : ''}
          <button class="iconbtn" data-act="lib-upload" title="Upload files" aria-label="Upload files">${icon('attach',16)}</button><input id="libupload" type="file" multiple hidden>
          <button class="btn lib-create small" data-act="lib-create">${icon('plus',14)} Create an artifact</button>
        </span>
      </div>
      ${!items.length ? `<div class="lib-empty">
        <span class="lib-empty-icon">${icon(state.librarySearch ? 'search' : libIconFor(cat === 'images' ? 'image' : cat === 'videos' ? 'video' : cat === 'podcasts' ? 'audio' : cat === 'documents' ? 'document' : cat === 'web' ? 'web' : 'artifact'),22)}</span>
        <b>${state.librarySearch ? 'No matches' : 'No ' + esc(cat === 'all' ? 'artifacts' : title.toLowerCase()) + ' yet'}</b>
        <span>${state.librarySearch ? 'Try another search, or clear it to see everything.' : `Files ${esc(state.agent?.name || 'your agent')} makes and files you upload show up here.`}</span>
      </div>` : `
      <div class="lib-sec">Recent</div>
      <div class="${gridCls}">${recent.map(libCardHtml).join('')}</div>
      ${rest.length ? `<div class="lib-sec">${esc(title)}</div><div class="${gridCls}">${rest.map(libCardHtml).join('')}</div>` : ''}`}
      `}
    </div></section>
  </div>`;
}
function paintLibrary(M){
  const scroller = () => M.querySelector('.lib-main');
  const previousScroll = scroller()?.scrollTop || 0;
  M.innerHTML = `<div class="page lib-page"><div class="pageinner lib-pageinner">${libraryTabContent()}</div></div>${libraryViewerHtml()}`;
  M.querySelector('.lib-viewer')?.addEventListener('keydown', e => { if (e.key === 'Escape'){ libraryViewer = null; paintLibrary(M); } });
  M.querySelector('.lib-viewer [data-act="lib-viewer-close"]:not(.lib-viewer-scrim)')?.focus();
  if (scroller()) scroller().scrollTop = previousScroll;
  const libSearch = M.querySelector('#libsearch');
  if (libSearch) libSearch.addEventListener('input', (e) => {
    state.librarySearch = e.target.value;
    if (state.libraryCat === 'system') state.libraryCat = 'all';
    save();
    const pos = e.target.selectionStart;
    paintLibrary(M);
    const again = M.querySelector('#libsearch');
    if (again){ again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
  });
  const libUpload = M.querySelector('#libupload');
  if (libUpload) libUpload.addEventListener('change', (e) => {
    addLibraryUploads(e.target.files);
    e.target.value = '';
  });
  if (signedIn() && state.libraryCat === 'system') refreshSystemFiles();
  refreshLibrary(false);
}
function approvalsTabContent(){
  const ap = approvalRows();
  const openId = state.approvalOpenId;
  const items = ap.map(x => {
    const open = openId && openId === x.id;
    const more = [
      x.chat ? `<div class="appr-more-line">From “${esc(x.chat)}”</div>` : '',
      x.chatId ? `<button class="btn ghost small" data-act="openchat" data-id="${x.chatId}">Open chat</button>` : '',
      x.alwaysId ? `<button class="btn ghost small" data-act="revoke" data-id="${x.alwaysId}">Revoke</button>` : '',
    ].join('');
    return `<article class="appr-item${open ? ' open' : ''}" data-id="${esc(x.id)}">
      <button type="button" class="appr-row" data-act="appr-toggle" data-id="${esc(x.id)}" aria-expanded="${open ? 'true' : 'false'}">
        ${approvalIconHtml(x)}
        <span class="appr-copy">
          <b>${esc(approvalHeadline(x))}</b>
          <span class="appr-desc">${esc(approvalBlurb(x))}</span>
          <span class="appr-meta${x.status === 'pending' ? ' pending' : ''}">${esc(approvalStatusLine(x))}</span>
        </span>
        <span class="appr-chev">${icon('chev',16)}</span>
      </button>
      <div class="appr-more">${more}</div>
    </article>`;
  }).join('');
  return `<div class="appr-panel">
    <h3 class="appr-heading">Approvals history</h3>
    ${items || '<div class="appr-empty">No approvals yet — sensitive actions will pause for you here.</div>'}
  </div>`;
}

function shopPaySnapshot(){
  return state.shopPay || { configured:false, connected:false, email:null, dailyLimitUsd:200, remainingUsd:null };
}
function refreshShopPay(force = false){
  const owner = billingIdentity();
  if (!owner) return Promise.resolve();
  if (!force && state.shopPay && !state.shopPayLoading) return Promise.resolve();
  state.shopPayLoading = true;
  return window.LingonAuth.api('/api/shop-pay').then((j) => {
    if (owner !== billingIdentity()) return;
    state.shopPay = j.shopPay || null;
    state.shopPayOrders = Array.isArray(j.orders) ? j.orders : [];
  }).catch((e) => {
    if (owner === billingIdentity()) toast(e.message || 'Could not load Shop Pay.');
  }).finally(() => {
    if (owner !== billingIdentity()) return;
    state.shopPayLoading = false;
    save();
    if (state.canvasOpen && state.canvasTab === 'payments' && $('#cbody')) $('#cbody').innerHTML = paymentsTabContent();
  });
}
function paymentsTabContent(){
  const stripe = composioAppByToolkit('stripe');
  const stripeConnected = !!stripe?.connected;
  const shop = shopPaySnapshot();
  const limit = Number(shop.dailyLimitUsd || 200);
  const remaining = Number(shop.remainingUsd != null ? shop.remainingUsd : limit);
  const shopOpen = state.paymentOpenId === 'shop-pay';
  const shopRow = shop.connected
    ? `<article class="appr-item${shopOpen ? ' open' : ''}" data-id="shop-pay">
        <button type="button" class="appr-row" data-act="appr-toggle" data-key="payment" data-id="shop-pay" aria-expanded="${shopOpen ? 'true' : 'false'}">
          <span class="appr-ico wordmark shop-pay-mark">${shopPayBrandMark()}</span>
          <span class="appr-copy"><b>Shop Pay</b><span class="appr-desc">Linked as ${esc(shop.email || 'your Shop account')}</span><span class="appr-meta ok">Connected · $${remaining.toFixed(2)} of $${limit.toFixed(0)} left today</span></span>
          <span class="appr-chev">${icon('chev',16)}</span>
        </button>
        <div class="appr-more">
          <div class="appr-more-line">${shop.nativeCheckout ? 'Eligible checkouts complete here after you approve.' : 'Checkouts finish on the merchant site after you approve.'}</div>
          <label class="payments-limit">Daily limit $<input class="field tiny" id="shoppaylimit" type="number" min="1" max="2000" step="1" value="${esc(limit)}"></label>
          <button class="btn ghost small" data-act="shop-pay-limit">Save limit</button>
          <button class="btn ghost small" data-act="shop-pay-disconnect">Disconnect</button>
        </div>
      </article>`
    : `<article class="appr-item"><div class="appr-row static">
        <span class="appr-ico wordmark shop-pay-mark">${shopPayBrandMark()}</span>
        <span class="appr-copy"><b>Shop Pay</b><span class="appr-desc">Search Shopify stores and prepare checkouts you approve.</span><span class="appr-meta">${state.shopPayLoading ? 'Checking…' : shop.configured ? 'Not connected' : 'Not available on this server yet'}</span></span>
        ${shop.configured ? `<button class="btn small" data-act="shop-pay-connect">Connect</button>` : ''}
      </div></article>`;
  const stripeRow = `<article class="appr-item"><div class="appr-row static">
      <span class="appr-ico wordmark stripe-mark">${stripeIconHtml()}</span>
      <span class="appr-copy"><b>Stripe</b><span class="appr-desc">Payment and revenue tasks in your Stripe account.</span><span class="appr-meta${stripeConnected ? ' ok' : ''}">${state.composioLoading ? 'Checking…' : stripeConnected ? 'Connected' : stripe ? 'Not connected' : 'Not available on this server yet'}</span></span>
      ${stripeConnected
        ? `<button class="btn ghost small" data-act="payments-stripe-apps">Manage</button>`
        : stripe ? `<button class="btn small" data-act="connect-app" data-toolkit="stripe" data-auth="${esc(stripe.authConfigId || '')}">Connect</button>` : ''}
    </div></article>`;
  const orders = (state.shopPayOrders || []).slice(0, 5).map((o) => `<article class="appr-item"><div class="appr-row static">
      <span class="appr-ico">${icon('card',18)}</span>
      <span class="appr-copy"><b>${esc(o.title || o.merchant || 'Order')}</b><span class="appr-meta">${esc([o.amount != null ? '$' + Number(o.amount).toFixed(2) : '', o.status].filter(Boolean).join(' · '))}</span></span>
      ${o.continueUrl ? `<a class="btn ghost small" href="${esc(o.continueUrl)}" target="_blank" rel="noopener">Finish</a>` : ''}
    </div></article>`).join('');
  return `<div class="appr-panel">
    <div class="appr-toolbar"><h3 class="appr-heading">Payments</h3><button class="iconbtn" data-act="payments-refresh" title="Refresh payments" aria-label="Refresh payments">${icon('refresh',15)}</button></div>
    <p class="appr-lede">${esc((state.agent && state.agent.name) || 'Your agent')} can prepare purchases for you. Every payment pauses in Approvals until you say yes.</p>
    <h4 class="appr-group">Payment methods</h4>
    ${shopRow}${stripeRow}
    ${orders ? `<h4 class="appr-group">Recent orders</h4>${orders}` : ''}
  </div>`;
}

const UPKEEP_ICONS = { memory:'book', relationships:'users', ideas:'spark', study:'globe', reflection:'star', skills:'code', quiet:'clock' };
function automationItemHtml(agent){
  const open = state.automationOpenId === agent.id;
  const trigger = agent.trigger || {};
  const ic = agent.systemKind ? (UPKEEP_ICONS[agent.systemKind] || 'clock') : trigger.type === 'app' ? 'box' : trigger.type === 'subagent' ? 'spark' : 'clock';
  const status = !agent.enabled ? 'Paused' : agent.triggerSyncError ? 'App event unavailable' : agent.lastError ? 'Last run failed' : ({waiting_approval:'Waiting for approval',partial:'Work limit reached',idle:'No new signal',done:'Completed',running:'Running now'})[agent.lastStatus] || '';
  const ran = agent.lastRunAt ? 'Last ran ' + fmtAgo(new Date(agent.lastRunAt).getTime()) : 'Not run yet';
  return `<article class="appr-item${open ? ' open' : ''}${agent.enabled ? '' : ' paused'}" data-id="${esc(agent.id)}">
    <button type="button" class="appr-row" data-act="appr-toggle" data-key="automation" data-id="${esc(agent.id)}" aria-expanded="${open ? 'true' : 'false'}">
      <span class="appr-ico">${icon(ic,18)}</span>
      <span class="appr-copy">
        <b>${esc(agent.name)}</b>
        <span class="appr-desc">${esc(trigger.label || subAgentTriggerLabel(agent))}</span>
        <span class="appr-meta${agent.lastError && agent.enabled ? ' warn' : ''}">${esc([status, ran].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="appr-chev">${icon('chev',16)}</span>
    </button>
    <div class="appr-more">
      ${agent.lastError ? `<div class="trigger-error">${esc(agent.lastError)}</div>` : ''}
      ${agent.triggerSyncError ? `<div class="trigger-error">${esc(agent.triggerSyncError)}</div>` : ''}
      ${agent.lastResult ? `<div class="trigger-result">${esc(agent.lastResult)}</div>` : ''}
      <button class="btn ghost small" data-act="open-subagent" data-id="${agent.id}">Open chat</button>
      <button class="btn ghost small" data-act="run-subagent" data-id="${agent.id}" ${agent.enabled ? '' : 'disabled'}>${icon('up',13)} Run now</button>
      <button class="btn ghost small" data-act="toggle-subagent" data-id="${agent.id}">${agent.enabled ? 'Pause' : 'Enable'}</button>
      ${agent.systemKind ? '' : `<button class="btn ghost small" data-act="delete-subagent" data-id="${agent.id}">${icon('trash',13)} Delete</button>`}
    </div>
  </article>`;
}
/* Sub Agents / Automations panel: the user's automations followed by the upkeep routines, in one list. */
function subAgentsTabContent(){
  const agents = state.subAgents || [];
  const upkeepOrder = ['memory','relationships','ideas','study','reflection','skills','quiet'];
  const upkeep = agents.filter(agent => agent.systemKind).sort((a,b) => upkeepOrder.indexOf(a.systemKind)-upkeepOrder.indexOf(b.systemKind));
  const customAgents = agents.filter(agent => !agent.systemKind);
  const displayAgents = [...customAgents, ...upkeep];
  const kind = state.subAgentTriggerType || 'schedule';
  const apps = state.triggerOptions?.apps || [];
  const scheduleOptions = state.triggerOptions?.schedules || [15,60,360,1440];
  const triggerFields = kind === 'schedule'
    ? `<label class="alabel">Run every</label><select class="field" id="subinterval">${scheduleOptions.map((minutes) => `<option value="${minutes}" ${Number(state.subAgentDraftInterval || 60) === Number(minutes) ? 'selected' : ''}>${minutes === 1440 ? 'Day' : minutes === 10080 ? 'Week' : minutes === 60 ? '1 hour' : minutes >= 60 ? (minutes / 60) + ' hours' : minutes + ' minutes'}</option>`).join('')}</select>`
    : kind === 'app'
      ? (apps.length ? `<label class="alabel">Connected app event (via Composio)</label><select class="field" id="subappevent">${apps.flatMap((app) => app.events.map((event) => `<option value="${esc(app.id + ':' + event)}" data-account="${esc(app.connectedAccountId || '')}">${esc(app.name)} · ${esc(event)}</option>`)).join('')}</select>` : `<div class="trigger-empty">${icon('box',16)} No ready connected-app events. <button data-act="nav" data-view="apps">Open Apps</button></div>`)
      : `<label class="alabel">After this sub-agent completes</label><select class="field" id="subsource">${customAgents.map((agent) => `<option value="${agent.id}">${esc(agent.name)}</option>`).join('') || '<option value="">Create another sub-agent first</option>'}</select>`;
  return `<div class="appr-panel">
    <div class="appr-toolbar"><h3 class="appr-heading">Automations</h3><button class="btn ${state.subAgentComposer ? 'ghost ' : ''}small" data-act="new-subagent">${icon(state.subAgentComposer ? 'x' : 'plus',14)} ${state.subAgentComposer ? 'Close' : 'New'}</button></div>
    ${state.subAgentComposer ? `<div class="trigger-form">
      <label class="alabel">Name</label><input class="field" id="subname" maxlength="60" placeholder="Daily brief" value="${esc(state.subAgentDraftName || '')}">
      <label class="alabel">Automation task</label><textarea class="field" id="subprompt" rows="4" placeholder="What should this sub-agent check, decide, or prepare?">${esc(state.subAgentDraft || '')}</textarea>
      <label class="alabel">Trigger</label><select class="field" id="subtrigger"><option value="schedule" ${kind === 'schedule' ? 'selected' : ''}>Schedule</option><option value="app" ${kind === 'app' ? 'selected' : ''}>Connected app</option><option value="subagent" ${kind === 'subagent' ? 'selected' : ''}>Another sub-agent</option></select>
      <div id="triggerfields">${triggerFields}</div>
      <div class="trigger-safety">${icon('shieldcheck',14)} Runs in an isolated, account-scoped sandbox. Chains stop after four handoffs.</div>
      <button class="btn small" data-act="create-subagent" ${kind === 'app' && !apps.length || kind === 'subagent' && !customAgents.length ? 'disabled' : ''}>Create automation</button>
    </div>` : ''}
    ${displayAgents.map(automationItemHtml).join('') || '<div class="appr-empty">No automations yet. Create one to run on a schedule, after an app event, or after another automation.</div>'}
  </div>`;
}

/* Live tab helpers: newest live browser session id for this chat. */
function liveIdFor(c){
  if (!c) return null;
  for (let i = (c.messages || []).length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.type === 'browser' && m.card.liveId) return m.card.liveId;
  }
  for (let i = (c.canvasRuns || []).length - 1; i >= 0; i--){
    const card = c.canvasRuns[i].card;
    if (card.type === 'browser' && card.liveId) return card.liveId;
  }
  return null;
}
function computerLinesFor(c){
  const out = [];
  (c && c.messages || []).forEach(m => {
    if (m.kind === 'card' && m.card.type === 'computer') (m.card.lines || []).forEach(L => out.push(L));
  });
  return out.slice(-14);
}
function pcIdFor(c){
  if (!c) return null;
  for (let i = (c.messages || []).length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.type === 'computer' && m.card.pcId) return m.card.pcId;
  }
  return null;
}

/* Live view client: one WS per tab render. Frames paint the <img>; state
   messages drive the blue working glow; input forwards only in takeover. */
let liveWS = null, liveIdShown = null, liveControl = false;
let pcWS = null, pcIdShown = null;
function liveClose(){
  try { liveWS && liveWS.close(); } catch {}
  try { pcWS && pcWS.close(); } catch {}
  liveWS = null; liveIdShown = null; liveControl = false; pcWS = null; pcIdShown = null;
}
function paintLive(body, c, selectedId){
  const id = selectedId || liveIdFor(c);
  const terms = computerLinesFor(c);
  if (!id){
    if (liveIdShown) liveClose();
    body.innerHTML = `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">No live session</div><div class="mut2">Ask for research and the agent's real browser appears here — watch it, take over, hand back.</div></div>`;
    return;
  }
  const browserCards = [...(c.messages || []).filter(m => m.kind === 'card'), ...(c.canvasRuns || [])];
  const poster = browserCards.filter(m => !selectedId || m.card.liveId === selectedId).reduce((acc, m) => (m.card.type === 'browser' && m.card.screenshot) ? m.card.screenshot : acc, '');
  const desktop = browserCards.some(m => m.card && m.card.liveId === id && m.card.desktop);
  const surface = desktop ? 'computer' : 'browser';
  window.__liveFrames = 0;
  body.innerHTML = `
    <button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>
    <div class="livewrap" id="livewrap">
      <div class="livebar"><span class="url" id="liveurl">connecting…</span><span class="chip purple" id="livestate">connecting</span></div>
      <div class="liveview" id="liveview" tabindex="0" aria-label="Live ${surface} workspace">
        <canvas id="livecanvas" width="1280" height="900" aria-label="Live ${surface} stream"></canvas>
        <img id="liveimg" alt="${desktop ? 'Computer' : 'Browser'} preview" hidden${poster ? ` src="${poster}"` : ''}>
        <div class="bigcursor" id="bigcursor"></div>
      </div>
      <div class="pctitle">${icon('term',13)} Read-only tool output</div>
      <div class="term mini" id="pcout" style="margin-top:6px">${terms.length ? terms.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('') : '<div class="mut">No runs yet in this chat.</div>'}</div>
      <div class="controlbar">
        <span class="cava">${Mascot.svg(state.agent.color,'idle',34)}</span>
        <div class="cinfo"><b id="livestatus">Agent ${surface}</b><div class="sub" id="livesub">${desktop ? 'live virtual computer' : 'live interactive stream'} — the agent is connected to the VM</div></div>
        <button class="btn small" data-act="takeover" id="takebtn">Take over</button>
        <button class="btn ghost small" data-act="canvas-back">Back</button>
      </div>
    </div>`;
  liveConnect(id);
  if (poster) drawLiveFrame(poster);
}
let liveFrameBusy = false, liveFramePending = null;
function drawLiveFrame(data){
  liveFramePending = data;
  if (liveFrameBusy) return;
  liveFrameBusy = true;
  const consume = () => {
    const frame = liveFramePending;
    liveFramePending = null;
    const canvas = $('#livecanvas'), img = $('#liveimg');
    if (!canvas || frame == null) { liveFrameBusy = false; return; }
    const finish = () => {
      if (liveFramePending != null) consume();
      else liveFrameBusy = false;
    };
    const draw = (source) => {
      try {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        if (source.close) source.close();
        window.__liveFrames = (window.__liveFrames || 0) + 1;
      } catch {}
      finish();
    };
    if (typeof frame === 'string' && frame.startsWith('data:')) {
      const image = new Image();
      image.onload = () => draw(image);
      image.onerror = finish;
      image.src = frame;
      if (img) img.src = frame;
      return;
    }
    const blob = frame instanceof Blob ? frame : new Blob([frame], { type: 'image/jpeg' });
    if (window.createImageBitmap) createImageBitmap(blob).then(draw).catch(finish);
    else {
      const image = new Image(); image.onload = () => draw(image); image.onerror = finish; image.src = URL.createObjectURL(blob);
    }
  };
  consume();
}
/* Realtime live view (rt:<channel>): the VM streams its browser over the project's
   Realtime channel for this task. The viewer says it is watching every 10 s (frames
   flow only while someone watches); takeover and input go back on the same channel. */
let liveRealtimeCfg = null;
function liveConnectRealtime(id){
  liveClose();
  liveIdShown = id; liveControl = false;
  const topic = 'realtime:' + id.slice(3);
  const st = () => $('#livestate');
  const cfgRequest = liveRealtimeCfg ? Promise.resolve(liveRealtimeCfg) : window.LingonAuth.api('/api/live/realtime').then((cfg) => (liveRealtimeCfg = cfg));
  cfgRequest.then((cfg) => {
    if (liveIdShown !== id) return;
    const ws = new WebSocket(cfg.url + '?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0');
    let ref = 1, joined = false, beat = null;
    const send = (event, payload) => { if (ws.readyState === 1 && joined) ws.send(JSON.stringify({ topic, event:'broadcast', payload:{ type:'broadcast', event, payload }, ref:String(++ref), join_ref:'1' })); };
    const adapter = {
      realtime: send,
      get readyState(){ return joined ? ws.readyState : 0; },
      send(raw){ try { const m = JSON.parse(raw); if (m.type === 'input') send('input', { ev: m.ev }); } catch {} },
      close(){ clearInterval(beat); if (liveControl) send('control', { takeover:false }); try { ws.close(); } catch {} },
    };
    liveWS = adapter;
    ws.onopen = () => ws.send(JSON.stringify({ topic, event:'phx_join', payload:{ config:{ broadcast:{ self:false, ack:false }, presence:{ key:'' }, private:false } }, ref:'1', join_ref:'1' }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && m.ref === '1') {
        joined = m.payload?.status === 'ok';
        if (!joined) { if (st()) st().textContent = 'live view unavailable'; return; }
        send('watch', {});
        if (st()) st().textContent = 'connecting to the browser…';
        beat = setInterval(() => { if (ws.readyState !== 1) return; ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++ref) })); send('watch', {}); }, 10000);
        return;
      }
      if (m.event !== 'broadcast' || !m.payload) return;
      const data = m.payload.payload || {};
      if (m.payload.event === 'frame' && typeof data.d === 'string') {
        try { drawLiveFrame(Uint8Array.from(atob(data.d), (ch) => ch.charCodeAt(0))); } catch {}
        if (st() && /connecting/.test(st().textContent)) liveState(liveControl ? 'user' : 'live');
      }
      if (m.payload.event === 'state') liveState(liveControl ? 'user' : (data.state === 'user' ? 'user' : 'live'), { ...data, transport:'realtime' });
    };
    ws.onclose = () => { clearInterval(beat); if (liveWS === adapter && st()) st().textContent = 'session ended'; };
    bindLiveInput(adapter);
  }).catch(() => { if (st()) st().textContent = 'live view unavailable'; });
}
function liveConnect(id){
  if (liveWS && liveIdShown === id){ bindLiveInput(liveWS); liveState(liveControl ? 'user' : 'idle'); pcConnect(); return; }
  if (String(id).startsWith('rt:')) { liveConnectRealtime(id); return; }
  liveClose();
  const sess = window.LingonAuth && window.LingonAuth.get();
  if (!sess || !sess.access_token){ $('#livestate').textContent = 'sign in expired'; return; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/live/' + id + '?token=' + encodeURIComponent(sess.access_token));
  liveWS = ws; liveIdShown = id; liveControl = false;
  ws.binaryType = 'arraybuffer';
  const wrap = () => $('#livewrap'), st = () => $('#livestate');
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') { drawLiveFrame(ev.data); return; }
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.frame) {
      try { const bytes = Uint8Array.from(atob(m.frame), (ch) => ch.charCodeAt(0)); drawLiveFrame(bytes); } catch {}
    }
    if (m.hello && $('#liveurl')) $('#liveurl').textContent = (m.kind === 'desktop' ? m.title : m.url) || m.hello;
    if (m.state) liveState(m.state, m);
  };
  ws.onclose = () => { if (st()){ st().textContent = 'session ended'; } const b = $('#takebtn'); if (b){ b.disabled = true; } };
  bindLiveInput(ws);
  pcConnect();
}

function bindLiveInput(ws){
  const view = $('#liveview'), cur = $('#bigcursor');
  if (!view || !cur) return;
  let lastMove = 0;
  const pos = (e) => {
    const r = view.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (1280 / r.width)), y: Math.round((e.clientY - r.top) * (900 / r.height)) };
  };
  view.onmousemove = (e) => {
    const r = view.getBoundingClientRect();
    cur.style.left = (e.clientX - r.left) + 'px'; cur.style.top = (e.clientY - r.top) + 'px';
    const now = Date.now();
    if (liveControl && ws.readyState === 1 && now - lastMove > 80){ lastMove = now; const p = pos(e); liveSend({ type: 'move', ...p }); }
  };
  view.onclick = (e) => { if (!liveControl || ws.readyState !== 1) return; const p = pos(e); liveSend({ type: 'click', ...p }); };
  view.onwheel = (e) => { if (!liveControl || ws.readyState !== 1) return; e.preventDefault(); liveSend({ type: 'scroll', dy: Math.round(e.deltaY) }); };
  document.onkeydown = (e) => {
    if (!liveControl || !liveWS || liveWS.readyState !== 1) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key.length === 1) liveSend({ type: 'type', text: e.key });
    else if (['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete'].includes(e.key)){ e.preventDefault(); liveSend({ type: 'key', key: e.key }); }
  };
}
/* Computer stream: appends real sandbox output lines as runs happen. */
function pcConnect(selectedId){
  const c = chat();
  const pcId = selectedId || pcIdFor(c);
  const out = () => $('#pcout');
  if (!pcId || !out()) return;
  if (pcWS && pcIdShown === pcId) return;
  try { pcWS && pcWS.close(); } catch {}
  const sess = window.LingonAuth && window.LingonAuth.get();
  if (!sess || !sess.access_token) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/pc/' + pcId + '?token=' + encodeURIComponent(sess.access_token));
  pcWS = ws; pcIdShown = pcId;
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.hello && m.log && out()) out().innerHTML = m.log.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('');
    if (Array.isArray(m.out) && out()){
      if (out().querySelector('.mut') && out().children.length <= 1) out().innerHTML = '';
      m.out.forEach(L => { out().insertAdjacentHTML('beforeend', `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`); });
      out().scrollTop = out().scrollHeight;
    }
    if (m.state) liveState(m.state === 'user' ? 'user' : m.state);
  };
}
function liveState(s, m){
  const wrap = $('#livewrap'), st = $('#livestate'), sub = $('#livesub'), btn = $('#takebtn');
  // A desktop session has no URL; its bar shows the active window instead.
  const desktop = m && (m.kind === 'desktop' || m.transport === 'x11-stream');
  if (desktop && $('#livestatus')) $('#livestatus').textContent = 'Agent computer';
  if (m && $('#liveurl') && (desktop ? m.title : m.url)) $('#liveurl').textContent = desktop ? m.title : m.url;
  if (m && m.title && $('#livesub') && !liveControl) sub.textContent = m.title;
  if (m && m.transport && sub && !liveControl) sub.textContent = m.transport === 'x11-stream' ? 'live virtual computer — the agent is connected to the VM' : m.transport === 'cdp-screencast' || m.transport === 'realtime' ? 'live interactive stream — the agent is connected to the VM' : 'compatibility preview — live relay is not connected';
  if (wrap) wrap.classList.toggle('working', s === 'working' && !liveControl);
  if (st) st.textContent = liveControl ? 'you drive' : s;
  if (btn) btn.textContent = liveControl ? 'Give back' : 'Take over';
  if (sub && liveControl) sub.textContent = 'you hold the mouse & keyboard — agent waits';
}
async function liveTakeover(){
  const c = chat();
  const id = liveIdShown;
  if (!id){ toast('No live browser session in this chat yet.'); return; }
  const want = !liveControl;
  try {
    if (liveWS?.realtime) {
      if (liveWS.readyState !== 1) throw new Error('The live view is still connecting.');
      liveWS.realtime('control', { takeover: want });
    } else await window.LingonAuth.api('/api/live/takeover', { method: 'POST', body: JSON.stringify({ liveId: id, on: want }) });
    liveControl = want;
    pcConnect();
    liveState(want ? 'user' : 'idle');
    toast(want ? 'You drive the browser — the agent waits.' : 'Agent drives again.');
  } catch (e) { toast(e.message); }
}
async function liveSend(ev){
  // Input shares the authenticated live socket for low-latency pointer and
  // keyboard control. REST remains a fallback for older sessions.
  const id = liveIdShown; if (!id) return;
  if (liveWS && liveWS.readyState === 1){
    try { liveWS.send(JSON.stringify({ type:'input', ev })); return; } catch {}
  }
  try {
    const j = await window.LingonAuth.api('/api/live/input', { method: 'POST', body: JSON.stringify({ liveId: id, ev }) });
    if (j.url && $('#liveurl')) $('#liveurl').textContent = j.url;
  } catch {}
}
let mailCache = null;
let mailOwner = null;
let mailboxEnsuredName = null;
let mailboxPending = null;
let mailFetchPending = null;
let mailFetchSeq = 0;
function scopeMailCache(){
  const owner = billingIdentity();
  if (owner !== mailOwner) {
    mailOwner = owner;
    mailCache = null;
    mailboxEnsuredName = null;
    mailboxPending = null;
    mailFetchPending = null;
    mailFetchSeq++;
  }
  return owner;
}
async function ensureMailbox(name){
  const owner = scopeMailCache();
  if (!owner) return null;
  const agentName = String(name || (state.agent && state.agent.name) || 'Agent').trim();
  if (mailboxEnsuredName === agentName && mailCache) return mailCache;
  if (mailboxPending) {
    if (mailboxPending.name === agentName) return mailboxPending.promise;
    await mailboxPending.promise;
    if (owner !== billingIdentity()) return null;
  }
  const seq = mailFetchSeq;
  const request = window.LingonAuth.api('/api/mail/ensure', { method:'POST', body: JSON.stringify({ agentName }) })
    .then((data) => {
      if (owner !== billingIdentity()) return null;
      if (seq === mailFetchSeq) mailCache = data;
      mailboxEnsuredName = agentName;
      return data;
    }).catch((e) => {
      if (owner !== billingIdentity()) return null;
      if (seq === mailFetchSeq) mailCache = { configured:false, address:null, messages:[], drafts:[], unread:0, ...(mailCache || {}), error:e.message };
      return mailCache;
    }).finally(() => { if (mailboxPending?.promise === request) mailboxPending = null; });
  mailboxPending = { name: agentName, promise: request };
  return request;
}
async function getMail(force, folder){
  const owner = scopeMailCache();
  if (!owner) return null;
  const tab = folder || state.mailTab || 'inbox';
  if (mailCache && !force && mailCache.folder === tab && tab !== 'write') return mailCache;
  if (mailFetchPending?.owner === owner && mailFetchPending.tab === tab) return mailFetchPending.promise;
  const seq = ++mailFetchSeq;
  const request = (async () => {
    try {
      const name = (state.agent && state.agent.name) || '';
      let result;
      if (tab === 'write') {
        result = await window.LingonAuth.api('/api/mail?folder=inbox&name=' + encodeURIComponent(name));
        result.folder = 'write';
      } else {
        result = await window.LingonAuth.api('/api/mail?folder=' + encodeURIComponent(tab) + '&name=' + encodeURIComponent(name));
      }
      if (owner === billingIdentity() && seq === mailFetchSeq) mailCache = result;
      return result;
    } catch (e) {
      if (owner !== billingIdentity()) return null;
      const fallback = { configured:false, address:null, messages:[], drafts:[], unread:0, ...(mailCache || {}), error:e.message, folder:tab };
      if (seq === mailFetchSeq) mailCache = fallback;
      return fallback;
    }
  })().finally(() => { if (mailFetchPending?.promise === request) mailFetchPending = null; });
  mailFetchPending = { owner, tab, promise: request };
  return request;
}
async function openMailMessage(id){
  const owner = scopeMailCache();
  if (!owner) return null;
  const j = await window.LingonAuth.api('/api/mail/messages/' + encodeURIComponent(id));
  if (owner !== billingIdentity()) return null;
  mailCache = mailCache || {};
  mailCache.selected = j.message;
  if (mailCache.messages) mailCache.messages = mailCache.messages.map((m) => m.id === id ? Object.assign({}, m, { isRead:true }) : m);
  if (mailCache.unread > 0) mailCache.unread -= 1;
  return j.message;
}
function mailListRows(m){
  const sent = m.folder === 'sent';
  const who = sent ? 'To ' + ((m.to || []).join(', ') || 'no recipient') : (m.fromName || m.from || 'Unknown sender');
  const initial = String((sent ? (m.to || [])[0] : m.fromName || m.from) || '?').trim().charAt(0).toUpperCase() || '?';
  return `<button class="appr-row mail-row${m.isRead || sent ? '' : ' unread'}" data-act="m-open" data-id="${esc(m.id)}">
    <span class="appr-ico mail-avatar" aria-hidden="true">${esc(initial)}</span>
    <span class="appr-copy">
      <span class="mail-line"><b>${esc(who)}</b><span class="mail-when">${fmtWhen(m.at)}</span></span>
      <span class="appr-desc mail-subject">${esc(m.subject || '(no subject)')}</span>
      ${m.preview ? `<span class="appr-meta mail-preview">${esc(m.preview)}</span>` : ''}
    </span>
  </button>`;
}
function mailComposeBody(prefill){
  const p = prefill || mailCache && mailCache.compose || {};
  return `<div class="mail-compose">
    <h4 class="appr-group">${p.inReplyTo ? 'Reply' : p.draftId ? 'Edit draft' : 'New message'}</h4>
    <label class="alabel">To</label>
    <input class="field" id="m-to" type="email" placeholder="name@example.com" value="${esc(p.to || '')}">
    <label class="alabel">Subject</label>
    <input class="field" id="m-subject" maxlength="200" value="${esc(p.subject || '')}">
    <label class="alabel">Message</label>
    <textarea class="field" id="m-body" rows="8" placeholder="Written as ${esc((state.agent && state.agent.name) || 'your agent')}…">${esc(p.body || '')}</textarea>
    <input type="hidden" id="m-reply" value="${esc(p.inReplyTo || '')}">
    <input type="hidden" id="m-draft" value="${esc(p.draftId || '')}">
    <div class="mail-actions">
      <button class="btn small" data-act="m-send">${icon('up',14)} Send</button>
      <button class="btn ghost small" data-act="m-draft">${icon('file',14)} Save draft</button>
    </div>
  </div>`;
}
function mailReader(msg){
  if (!msg) return '';
  const who = msg.fromName ? esc(msg.fromName) + ' &lt;' + esc(msg.from) + '&gt;' : esc(msg.from || '');
  return `<div class="mail-read">
    <div class="mail-read-head">
      <button class="canvas-back" data-act="m-back">${icon('left',14)} Back</button>
      <button class="btn ghost small" data-act="m-reply" data-id="${esc(msg.id)}">${icon('mail',14)} Reply</button>
    </div>
    <h3>${esc(msg.subject || '(no subject)')}</h3>
    <div class="sub">${who} · ${fmtWhen(msg.at)}</div>
    <div class="sub">To ${esc((msg.to || []).join(', '))}</div>
    <div class="mail-body">${esc(msg.bodyText || '').replace(/\n/g, '<br>')}</div>
  </div>`;
}
function paintMail(body){
  scopeMailCache();
  const tab = state.mailTab || 'inbox';
  const m = mailCache;
  const unread = m && m.unread ? m.unread : 0;
  const empty = (ic, title, text) => `<div class="appr-empty-state"><span class="appr-ico">${icon(ic,18)}</span><b>${title}</b><span>${text}</span></div>`;
  let inner = `<div class="appr-empty">Loading mail…</div>`;
  if (m) {
    if (m.selected && tab !== 'write') inner = mailReader(m.selected);
    else if (tab === 'write') inner = mailComposeBody(m.compose);
    else if (tab === 'drafts') {
      const drafts = m.drafts || [];
      inner = drafts.length
        ? drafts.map((d) => `<button class="appr-row mail-row" data-act="m-edit-draft" data-id="${esc(d.id)}"><span class="appr-ico">${icon('file',17)}</span><span class="appr-copy"><b>${esc(d.subject || '(no subject)')}</b><span class="appr-desc">${esc((d.to || []).join(', ') || 'No recipient')}</span></span></button>`).join('')
        : empty('file', 'No drafts', 'Drafts your agent saves appear here for you to review before sending.');
    } else {
      const rows = m.messages || [];
      inner = rows.length
        ? rows.map(mailListRows).join('')
        : empty('mail', tab === 'sent' ? 'Nothing sent yet' : 'Inbox is empty', m.address ? 'Anyone can write to ' + esc(m.address) + '.' : 'Claim the mailbox to start receiving.');
    }
  }
  const banner = m && m.configured === false
    ? `<div class="warnband">${icon('mail',18)}<div><b>Mailbox is reserved. Sending needs RESEND_API_KEY.</b>${esc(m.receivingHint || 'Add the MX record Resend shows for mail.belna.se.')}</div></div>`
    : '';
  const filter = (t, label, count) => `<button class="appr-filter${tab === t ? ' on' : ''}" data-act="mtab" data-t="${t}" aria-pressed="${tab === t}">${label}${count ? ` <span class="cnt">${count}</span>` : ''}</button>`;
  body.innerHTML = `<div class="appr-panel mail-panel">
    <div class="appr-toolbar">
      <h3 class="appr-heading">Mail</h3>
      <span class="appr-toolbar-actions">
        <button class="iconbtn" data-act="m-refresh" title="Refresh mail" aria-label="Refresh mail">${icon('refresh',15)}</button>
        <button class="btn ${tab === 'write' ? 'ghost ' : ''}small" data-act="mtab" data-t="${tab === 'write' ? 'inbox' : 'write'}">${icon(tab === 'write' ? 'x' : 'plus',14)} ${tab === 'write' ? 'Close' : 'New'}</button>
      </span>
    </div>
    <div class="mail-address"><span class="mono">${esc((m && m.address) || 'Allocating…')}</span>${m && m.address ? `<button class="iconbtn" data-act="m-copy" title="Copy address" aria-label="Copy mail address">${icon('copy',14)}</button>` : ''}</div>
    ${banner}
    ${tab === 'write' ? '' : `<div class="appr-filters" role="group" aria-label="Mail folders">${filter('inbox', 'Inbox', unread)}${filter('sent', 'Sent', 0)}${filter('drafts', 'Drafts', 0)}</div>`}
    ${inner}
  </div>`;
  if (!m) getMail(true, tab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
}

// Files the agent saved to the Library (generated images) arrive as a reference and load
// on demand through libraryItemContent; they are not kept in the chat's local copy.
const canvasFileCache = new Map();
function canvasFileContent(c, m){
  const card = m.card;
  if (typeof card.content === 'string') return card.content;
  if (card.dataUrl) return card.dataUrl;
  if (card.libraryId && card.fromLibrary) return libraryItemContent(card.libraryId, () => { if (state.activeChat === c.id && c.canvasSelectedMessageId === m.id && state.canvasOpen) paintCanvas(); });
  if (!card.managedArtifactId) return '';
  const key = `${c.id}:${card.managedArtifactId}`;
  if (!canvasFileCache.has(key)) {
    canvasFileCache.set(key, { loading:true });
    window.LingonAuth.apiStream(`/api/agent/artifact?chatId=${encodeURIComponent(c.id)}&id=${encodeURIComponent(card.managedArtifactId)}`)
      .then(async response => {
        if (!response.ok) throw new Error('File preview could not be loaded.');
        const blob = await response.blob();
        if (blob.size > 10 * 1024 * 1024) throw new Error('This file is too large to preview.');
        const content = /^(text\/|application\/(json|xml|javascript))/.test(blob.type) ? await blob.text() : await new Promise((resolve,reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        canvasFileCache.set(key, { content });
      })
      .catch(error => canvasFileCache.set(key, { error:error.message }))
      .finally(() => { if (state.activeChat === c.id && c.canvasSelectedMessageId === m.id && state.canvasOpen) paintCanvas(); });
  }
  return canvasFileCache.get(key);
}
function canvasDocumentHTML(file, value){
  const name = String(file.name || file.title || 'File');
  const format = String(file.format || name.split('.').pop() || 'text').toLowerCase();
  const raw = typeof value === 'string' ? value : value?.content || '';
  const header = `<div class="arti-head"><b>${esc(name)}</b><span class="chip">${esc(format)}</span></div>`;
  if (value?.loading) return header + '<div class="canvas-file-note">Loading preview…</div>';
  if (value?.error) return header + `<div class="canvas-file-note">${esc(value.error)}</div>`;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) return header + `<img class="canvas-file-image" src="${esc(raw)}" alt="${esc(name)}">`;
  if (/^data:application\/pdf;base64,/i.test(raw)) return header + `<iframe class="canvas-file-pdf" title="${esc(name)}" src="${esc(raw)}"></iframe>`;
  let content = raw;
  if (/^data:[^,]*;base64,/i.test(raw)) {
    try { content = new TextDecoder().decode(Uint8Array.from(atob(raw.slice(raw.indexOf(',') + 1)), c => c.charCodeAt(0))); }
    catch { return header + '<div class="canvas-file-note">Preview unavailable. Download this file to open it.</div>'; }
  }
  if (format === 'html' || format === 'htm' || format === 'svg') return header + `<div class="arti-frame"><iframe sandbox="allow-scripts" title="${esc(name)}" srcdoc="${esc(content)}"></iframe></div>`;
  if (format === 'md' || format === 'markdown') return header + `<div class="canvas-document">${md(content)}</div>`;
  return header + `<pre class="canvas-file-text">${esc(content || 'No preview available for this file.')}</pre>`;
}
function canvasGalleryHTML(c){
  if (!c) return '';
  const items = [];
  for (const m of c.messages || []) {
    if (m.kind === 'card' && m.card.type !== 'memory') items.push({m, label:m.card.title || m.card.name || m.card.q || m.card.note || m.card.label || m.card.type, kind:m.card.type});
    for (const [i,file] of (m.files || []).entries()) items.push({m, i, label:file.name, kind:'file'});
  }
  if (!items.length) return '';
  return `<div class="canvas-gallery"><div class="runhead">${icon('easel',14)} From this chat</div>${items.slice(-30).reverse().map(item => `<button class="canvas-gallery-item" data-act="${item.i === undefined ? 'canvas-card' : 'canvas-upload'}" data-chat="${c.id}" data-msg="${item.m.id}"${item.i === undefined ? '' : ` data-i="${item.i}"`}><span>${icon(item.kind === 'browser' ? 'globe' : item.kind === 'file' ? 'file' : item.kind === 'computer' ? 'term' : 'easel',15)}</span><b>${esc(item.label)}</b><small>${esc(item.kind)}</small></button>`).join('')}</div>`;
}
function paintCanvasSelection(body, c, m){
  const file = c.canvasSelectedFileIndex !== undefined ? m.files?.[c.canvasSelectedFileIndex] : null;
  if (file) {
    body.innerHTML = `<button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>${canvasDocumentHTML(file, file.dataUrl || file.content || '')}`;
    return;
  }
  const cd = m.card;
  if (cd.type === 'browser' && cd.liveId) { paintLive(body, c, cd.liveId); return; }
  const back = `<button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>`;
  if (cd.type === 'browser') {
    const index = c.messages.indexOf(m);
    const related = c.messages.slice(index).filter(item => item.card?.type === 'browser' && (!cd.taskId || item.card.taskId === cd.taskId));
    const latest = related.at(-1)?.card || cd;
    const screenshot = [...related].reverse().find(item => item.card.screenshot)?.card.screenshot || cd.screenshot;
    body.innerHTML = back + `<div class="arti-head"><b>Browser view</b><span class="chip">${esc(latest.status || '')}</span></div><div class="rurl">${esc(latest.url || cd.url || '')}</div><p class="rnote">${esc(latest.note || '')}</p>${screenshot ? `<img class="canvas-file-image" src="${esc(screenshot)}" alt="Browser screenshot">` : '<div class="canvas-file-note">Waiting for the browser image…</div>'}`;
    return;
  }
  if (cd.type === 'computer') {
    const index = c.messages.indexOf(m);
    const related = c.messages.slice(index).filter(item => item.card?.type === 'computer' && (!cd.taskId || item.card.taskId === cd.taskId));
    const latest = related.at(-1)?.card || cd;
    const lines = related.flatMap(item => item.card.lines || []).slice(-40);
    body.innerHTML = back + `<div class="arti-head"><b>Computer output</b><span class="chip">${esc(latest.status || '')}</span></div><div class="term mini" id="pcout">${lines.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('')}${latest.status === 'running' ? '<div class="tdots"><i></i><i></i><i></i></div>' : ''}</div>`;
    if (cd.pcId) pcConnect(cd.pcId);
    return;
  }
  if (cd.type === 'file' || cd.type === 'canvas') {
    body.innerHTML = back + canvasDocumentHTML(cd, cd.type === 'file' ? canvasFileContent(c,m) : cd.content);
    return;
  }
  body.innerHTML = back + `<div class="canvas-selected-card">${cardNode(c,m)}</div>`;
}

function paintCanvas(){
  const cv = $('#canvas'); if (!cv) return;
  scopeMailCache();
  if (state.canvasTab === 'agent') state.canvasTab = 'approvals';
  if (state.canvasTab === 'trace' || state.canvasTab === 'wallet' || state.canvasTab === 'live') state.canvasTab = 'canvas';
  if (!['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(state.canvasTab)) state.canvasTab = 'canvas';
  if (!state._showLiveInCanvas) state._showLiveInCanvas = false;
  const c = chat();
  const top = state.canvasTab || 'canvas';
  const selected = c && (c.messages || []).find(m => m.id === c.canvasSelectedMessageId);
  if (!(top === 'canvas' && (state._showLiveInCanvas || selected?.card?.liveId)) && (liveWS || pcWS)) liveClose();
  const liveId = liveIdFor(c);
  cv.innerHTML = `
    <div class="canvas-resize" id="canvasResize"></div>
    <div class="canvas-head">
      ${canvasHeroHTML()}
      <div class="canvas-head-row">
        <div class="canvas-tabs" role="tablist" aria-label="Agent panel">
          ${[
            ['canvas', 'easel', 'Canvas', liveId ? '<span class="livedot"></span>' : ''],
            ['subagents', 'clock', 'Automations', ''],
            ['approvals', 'shieldcheck', 'Approvals', ''],
            ['mail', 'mail', 'Mail', mailCache && mailCache.unread ? `<span class="cnt" aria-hidden="true">${mailCache.unread}</span>` : ''],
            ['payments', 'wallet', 'Payments', ''],
          ].map(([t, ic, label, badge]) => `<button class="canvas-tab${top === t ? ' on' : ''}" role="tab" aria-selected="${top === t}" data-act="ctab" data-t="${t}" title="${label}" aria-label="${label}${t === 'mail' && mailCache?.unread ? `, ${mailCache.unread} unread` : ''}">${icon(ic,18)}${badge}</button>`).join('')}
        </div>
        <button class="canvas-close" data-act="togglecanvas" aria-label="Close canvas">${icon('x',16)}</button>
      </div>
    </div>
    <div class="cbody" id="cbody"></div>`;
  initCanvasResize();
  centerActiveSeg(cv);
  const an = $('#agentname');
  if (an) an.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = publicAgentName(v); save(); paintSide(); paintMain(); paintCanvas();
    ensureMailbox(state.agent.name).then(() => { if ($('#cbody')) paintCanvas(); });
    toast('Renamed — they answer to ' + state.agent.name + ' now.');
  });
  const body = $('#cbody');
  if (top === 'mail'){
    paintMail(body);
    return;
  }
  if (top === 'payments'){
    body.innerHTML = paymentsTabContent();
    if (signedIn()) refreshShopPay();
    if (!state.composioLoading && signedIn()) refreshComposioApps();
    return;
  }
  if (top === 'approvals'){
    body.innerHTML = approvalsTabContent();
    return;
  }
  if (state.canvasTab === 'subagents'){
    body.innerHTML = subAgentsTabContent();
    refreshSubAgents();
    return;
  }
  if (top === 'live'){
    state.canvasTab = 'canvas'; state._showLiveInCanvas = true;
    paintLive(body, c);
    return;
  }
  // Show live session in canvas tab when flagged or when there's an active live session but no artifact
  if (state._showLiveInCanvas && liveIdFor(c)){
    paintLive(body, c);
    return;
  }
  if (selected && (selected.card || selected.files?.[c.canvasSelectedFileIndex])) {
    paintCanvasSelection(body, c, selected);
    return;
  }
  const a = c && c.artifact;
  const run = canvasGalleryHTML(c) + runTimelineHTML(c);
  if (!a){
    body.innerHTML = run || `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">The canvas</div><div class="mut2">Charts, live pages, diffs and plans I create will render here while we chat.</div></div>`;
    return;
  }
  if (a.kind === 'chart'){
    const max = Math.max.apply(null, a.data.map(d => d.v));
    body.innerHTML = run + `<div class="chartbox"><div class="ct">${esc(a.title)}</div><div class="cs">n = 1,392 qualifying comments · last 30 days</div>
      <div class="bars">${a.data.map((d, i) => `<div class="bcol"><span class="v">${d.v}%</span><div class="bar" style="height:${Math.round(d.v / max * 100)}%;background:${d.c};animation-delay:${i * 60}ms"></div><span class="l">${esc(d.l)}</span></div>`).join('')}</div>
      <div class="chartfoot">${esc(a.foot)}</div></div>`;
    return;
  }
  if (a.kind === 'html'){
    body.innerHTML = run + `<div class="arti-head"><b>${esc(a.title)}</b><span class="chip green">live</span></div><div class="arti-frame"><iframe sandbox="allow-scripts" srcdoc="${esc(a.html)}"></iframe></div>`;
    return;
  }
  if (a.kind === 'code'){
    body.innerHTML = run + `<div class="arti-head"><b>${esc(a.title)}</b><button class="btn ghost tiny" data-act="copycode">${icon('copy',13)} Copy</button></div><div class="codebox" id="codebox">${esc(a.code)}</div>`;
    return;
  }
  if (a.kind === 'plan'){
    body.innerHTML = run + `<div class="planbox"><div class="ct" style="font-weight:800;margin-bottom:10px">${esc(a.title)}</div><div class="md">${a.items.map(i => `<p>${md(i).replace(/<\/?p>/g,'')}</p>`).join('')}</div></div>`;
    return;
  }
}

/* ---------------- canvas drag-to-resize ---------------- */
function initCanvasResize(){
  const handle = $('#canvasResize');
  const cv = $('#canvas');
  if (!handle || !cv) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', function(e){
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = cv.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e2){
      if (!dragging) return;
      const delta = startX - e2.clientX;
      const newW = Math.min(1200, Math.max(420, startW + delta));
      cv.style.width = newW + 'px';
    }
    function onUp(){
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ---------------- pages ---------------- */
function fileRows(){
  const rows = [];
  state.chats.forEach(c => c.messages.forEach(m => {
    if (m.kind === 'card' && m.card.type === 'file') rows.push({ ...m.card, chat: c.title, chatId:c.id, messageId:m.id });
  }));
  return rows;
}

function paintVault(M){
  const v = state.vault;
  const tab = state.vaultTab || 'secrets';
  let body = '';

  if (tab === 'secrets'){
    body = `
    <div class="warnband">${icon('shieldcheck',18)}<div><b>Your secrets remain protected.</b>Values are masked in chat and activity history. Reveal below is for your eyes alone, on this device.</div></div>
    <div class="kv">
      ${v.secrets.map(s => `<div class="row secret-row">
        <span style="color:var(--mut)">${icon('lock',16)}</span>
        <div><b class="mono">${esc(s.name)}</b><div class="sub">${esc(s.ref)} · added ${fmtWhen(s.at)}</div></div>
        <div class="rgt">
          <span class="mono mut" data-rev="${s.id}" style="letter-spacing:.08em">${s.revealed ? esc(s.value) : '•••• •••• ••••'}</span>
          <button class="iconbtn" data-act="reveal" data-id="${s.id}" title="Reveal (only you)">${s.revealed ? icon('eyeoff',14) : icon('eye',14)}</button>
          <button class="iconbtn" data-act="delsecret" data-id="${s.id}" title="Delete">${icon('trash',14)}</button>
        </div></div>`).join('') || '<div class="row mut">No secrets yet — the secrets box in chat adds them here.</div>'}
      <div class="row" style="background:var(--panel)">
        <input class="field" id="vname" placeholder="name" style="max-width:170px">
        <input class="field mono" id="vval" type="password" placeholder="value" style="flex:1">
        <button class="btn small" data-act="addsecret">${icon('plus',14)} Add</button>
      </div>
    </div>`;
  } else if (tab === 'apps'){
    const connected = (state.composioApps || []).filter((a) => a.connected);
    const stack = connected.slice(0, 6).map((a) =>
      `<span class="apps-stack-logo on" title="${esc(a.name || a.toolkit)}">${appLogoHtml(a)}</span>`
    ).join('') || `<span class="apps-stack-logo ghost">${icon('box',16)}</span>`;
    body = `<div class="apps-jump">
      <div class="apps-stack">${stack}</div>
      <div><b>${connected.length ? connected.length + ' live' : 'No connected apps'}</b></div>
      <button class="btn small" data-act="nav" data-view="apps">Open Connectors</button>
    </div>`;
  } else if (tab === 'approved'){
    body = `<div class="kv">
      ${v.approvals.map(a => `<div class="row">
        <span style="color:var(--green)">${icon('check',16)}</span>
        <div><b>${esc(a.label)}</b><div class="sub">always allowed · ${fmtWhen(a.at)}</div></div>
        <div class="rgt"><button class="btn ghost small" data-act="revoke" data-id="${a.id}">Revoke</button></div></div>`).join('') || '<div class="row mut">No always-allow rules. Approvals pause for you each time.</div>'}
      <div class="radio ${v.mode === 'default' ? 'on' : ''}" data-act="pmode" data-m="default"><span class="dot"></span><div><b>Default</b><div class="sub mut">Standard rules — sensitive actions ask first.</div></div>${v.mode === 'default' ? '<span class="chip green" style="margin-left:auto">current</span>' : ''}</div>
      <div class="radio ${v.mode === 'ask' ? 'on' : ''}" data-act="pmode" data-m="ask"><span class="dot"></span><div><b>Ask always</b><div class="sub mut">Confirm before every app and browsing action.</div></div>${v.mode === 'ask' ? '<span class="chip green" style="margin-left:auto">current</span>' : ''}</div>
    </div>`;
  } else {
    const rows = fileRows();
    body = `<div class="kv">${rows.map((f, i) => `<div class="row">
      <span style="color:var(--mut)">${icon('file',16)}</span>
      <div><b>${esc(f.name)}</b><div class="sub">${fmtBytes(f.size || 0)} · from “${esc(f.chat)}”</div></div>
      <div class="rgt"><button class="btn ghost small" data-act="library-open" data-chat="${f.chatId}" data-msg="${f.messageId}">View</button><button class="btn ghost small" data-act="dlfile" data-i="${i}">${icon('down',14)} Download</button></div></div>`).join('') || '<div class="row mut">No files yet — artifacts the agent produces land here.</div>'}</div>`;
  }

  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Vault</h1><span class="chip green">${icon('lock',12)} encrypted at rest</span></div>
    <p class="psub">Secrets, apps, approved actions and your file library — owned by you, never revealed to the agent.</p>
    <div class="seg">
      <button class="${tab === 'apps' ? 'on' : ''}" data-act="vtab" data-t="apps">${icon('box',14)} Apps</button>
      <button class="${tab === 'secrets' ? 'on' : ''}" data-act="vtab" data-t="secrets">${icon('key',14)} Secrets</button>
      <button class="${tab === 'approved' ? 'on' : ''}" data-act="vtab" data-t="approved">${icon('shieldcheck',14)} Approved</button>
      <button class="${tab === 'library' ? 'on' : ''}" data-act="vtab" data-t="library">${icon('file',14)} Library</button>
    </div>
    ${body}
  </div></div>`;
  window.__fileRows = fileRows();
}


function memorySource(m){return ({explicit:'You asked to remember this',auto:'Saved automatically',auto_correction:'Updated automatically',agent:'Saved by your agent',agent_correction:'Corrected by your agent',user:'Added by you',user_import:'Imported by you',user_edit:'Edited by you',onboarding:'Added during setup'})[m.src] || 'Account memory';}
function paintProfile(M){
  const a = state.agent;
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Profile</h1><span class="chip acc">${icon('spark',12)} claimed by you</span></div>
    <p class="psub">One agent, one person. Rename or restyle any time — it stays yours.</p>
    <div class="profiletop">
      <div id="pmascot">${Mascot.svg(a.color,'happy',110,'mascot-bob')}</div>
      <div class="info">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input class="field" id="pname" value="${esc(a.name)}" maxlength="18" style="max-width:220px;font-weight:700">
          <span class="chip green">${icon('check',12)} claimed ${new Date(a.claimedAt).toLocaleDateString()}</span>
        </div>
        <div class="swatches" style="justify-content:flex-start;margin-top:16px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
        <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
      </div>
    </div>
    <div class="psec"><h3 style="color:var(--acc)">${icon('alert',15)} Danger zone</h3>
      <div class="kv"><div class="row"><div><b>Release this agent</b><div class="sub">Deletes chats, vault, memory and the claim on this device.</div></div>
      <div class="rgt"><button class="btn soft small" data-act="reset">Release</button></div></div></div>
    </div>
  </div></div>`;
  $('#pname').addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = publicAgentName(v); save(); paintSide(); paintCanvas();
    ensureMailbox(state.agent.name);
    toast('Renamed — they answer to ' + state.agent.name + ' now.');
  });
}

/* ---------------- Settings (profiles / secrets / browser / usage / billing) ---------------- */
/* A login becomes "<site> username" + "<site> password" so the agent can
   fill each field by ref. The settings list groups those refs for the owner. */
const VAULT_KINDS = {
  login: { label:'Login', icon:'user', fields:[
    { k:'site', label:'Website', placeholder:'e.g. github.com' },
    { k:'username', label:'Username or email', secret:true, optional:true },
    { k:'password', label:'Password', secret:true, masked:true },
  ] },
  apikey: { label:'API key', icon:'key', fields:[
    { k:'name', label:'Name', placeholder:'e.g. OpenAI API key' },
    { k:'value', label:'Key', placeholder:'Paste the key', secret:true, masked:true },
  ] },
  other: { label:'Other', icon:'lock', fields:[
    { k:'name', label:'Name', placeholder:'e.g. Wi-Fi password' },
    { k:'value', label:'Value', secret:true, masked:true },
  ] },
};
function vaultKindEntries(kind, f){
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (kind === 'login'){
    const site = clean(f.site).replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '');
    if (!site || !f.password) return { error:'Add the website and the password.' };
    return { entries:[f.username && [`${site} username`, f.username], [`${site} password`, f.password]].filter(Boolean) };
  }
  const name = clean(f.name);
  if (!name || !f.value) return { error:'Add a name and a value.' };
  return { entries:[[name, f.value]] };
}
function vaultDisplayEntries(secrets){
  const used = new Set();
  return secrets.flatMap(s => {
    if (used.has(s.id)) return [];
    used.add(s.id);
    const login = /^(.*) (username|password)$/i.exec(s.name);
    const peer = login && secrets.find(x => !used.has(x.id) && x.name === `${login[1]} ${login[2].toLowerCase() === 'username' ? 'password' : 'username'}`);
    if (login && (peer || /\.|^localhost$/i.test(login[1]))){
      if (peer) used.add(peer.id);
      return [{ name:login[1], kind:'Login', icon:'user', secrets:peer ? [s,peer].sort((a,b) => / username$/i.test(a.name) ? -1 : 1) : [s] }];
    }
    const apiKey = /api[ -]?key|token/i.test(s.name);
    return [{ name:s.name, kind:apiKey ? 'API key' : 'Other', icon:apiKey ? 'key' : 'lock', secrets:[s] }];
  });
}
function settingsSecretsBody(v){
  const secrets = v.secrets || [];
  const entries = vaultDisplayEntries(secrets);
  const agentName = esc((state.agent && state.agent.name) || 'Your agent');
  const kind = VAULT_KINDS[state.vaultKind] ? state.vaultKind : 'login';
  const locked = v.encrypted === false;
  return `<section class="vault">
    ${locked ? `<div class="warnband vault-warn">${icon('alert',18)}<div><b>The vault is locked on this server.</b>New secrets can’t be saved until ENCRYPTION_KEY is set on the backend, so nothing is ever stored unencrypted.</div></div>` : ''}
    <div class="vault-add">
      <div class="vault-section-head"><h3>Add to vault</h3><span>${locked ? 'Locked' : `${icon('shieldcheck',12)} Encrypted, only a ref is shared with ${agentName}`}</span></div>
      <div class="vault-kinds" role="radiogroup" aria-label="Credential type">
        ${Object.entries(VAULT_KINDS).map(([k, d]) => `<button type="button" class="vault-kind ${k === kind ? 'on' : ''}" role="radio" aria-checked="${k === kind}" data-act="vault-kind" data-k="${k}"><span class="vault-kind-icon">${icon(d.icon,16)}</span><span>${d.label}</span><span class="vault-kind-indicator" aria-hidden="true"></span></button>`).join('')}
      </div>
      <form class="vault-add-form" data-kind="${kind}" autocomplete="off" onsubmit="return false">
        ${VAULT_KINDS[kind].fields.map(fd => `<label class="${fd.short ? 'vault-add-short' : fd.secret ? 'vault-add-value' : ''}"><span>${fd.label}${fd.optional ? ' <i>optional</i>' : ''}</span><input class="field${fd.secret ? ' mono' : ''}" data-vf="${fd.k}" type="${fd.masked ? 'password' : 'text'}" placeholder="${esc(fd.placeholder || '')}" maxlength="${fd.secret ? 4000 : 80}" autocomplete="${fd.masked ? 'new-password' : 'off'}" spellcheck="false"${fd.inputmode ? ` inputmode="${fd.inputmode}"` : ''}${locked ? ' disabled' : ''}></label>`).join('')}
        <button class="btn" data-act="addsecret"${locked ? ' disabled' : ''}>${icon('plus',14)} Save</button>
      </form>
    </div>
    <div class="vault-list">
      <div class="vault-section-head"><h3>Saved credentials</h3><span>${entries.length} · reveal is only for you</span></div>
      ${entries.map(entry => { const shown = entry.secrets.every(s => s.revealed); const ids = esc(JSON.stringify(entry.secrets.map(s => s.id))); return `<div class="vault-item">
        <span class="vault-item-icon">${icon(entry.icon,16)}</span>
        <div class="vault-item-copy">
          <b>${esc(entry.name)}</b>
          <div class="vault-item-meta"><span class="vault-item-type">${entry.kind}</span><span>Added ${fmtAgo(entry.secrets[0].at)}</span>${entry.secrets.some(s => !s.backend) ? '<span>Only on this device</span>' : ''}</div>
          ${shown ? `<div class="vault-item-details">${entry.secrets.map(s => `<div class="vault-item-detail"><div><span>${entry.kind === 'Login' ? (/ username$/i.test(s.name) ? 'Username' : 'Password') : 'Value'}</span><code>${esc(s.ref)}</code></div><div class="vault-item-value mono" data-rev="${esc(s.id)}">${esc(s.value)}</div><button class="iconbtn" data-act="copysecret" data-id="${esc(s.id)}" title="Copy value" aria-label="Copy ${esc(s.name)}">${icon('copy',14)}</button></div>`).join('')}</div>` : ''}
        </div>
        <div class="vault-item-actions">
          <button class="iconbtn" data-act="reveal-credential" data-ids="${ids}" title="${shown ? 'Hide' : 'Reveal (only you)'}" aria-label="${shown ? 'Hide' : 'Reveal'} ${esc(entry.name)}">${shown ? icon('eyeoff',16) : icon('eye',16)}</button>
          <button class="iconbtn" data-act="delete-credential" data-ids="${ids}" data-name="${esc(entry.name)}" title="Delete" aria-label="Delete ${esc(entry.name)}">${icon('trash',14)}</button>
        </div>
      </div>`; }).join('') || `<div class="vault-empty"><span class="vault-item-icon">${icon('key',16)}</span><div><b>Nothing saved yet</b><p>Add a credential above, or ${agentName} will ask when a task needs one.</p></div></div>`}
    </div>
    <div class="vault-payment">
      <div class="vault-section-head"><h3>Cards saved on websites</h3><span>Masked details for purchase review</span></div>
      <p class="vault-payment-note">First save your card in the merchant’s own account. Add its visible details here so each purchase approval can name the card. Full card numbers and security codes stay out of the agent vault.</p>
      <form class="vault-payment-form" autocomplete="off" onsubmit="return false">
        <div class="vault-payment-preview">${icon('card',22)}<span>Card on file</span><strong>•••• <span data-pm-preview>••••</span></strong></div>
        <label>Website<input class="field" data-pm="merchant" placeholder="shop.example" autocomplete="url" spellcheck="false"></label>
        <label>Card name<input class="field" data-pm="label" placeholder="My everyday card" maxlength="60" autocomplete="off"></label>
        <label>Brand<input class="field" data-pm="brand" placeholder="Visa" maxlength="32" autocomplete="cc-type"></label>
        <label>Last four digits<input class="field" data-pm="last4" placeholder="1234" maxlength="4" inputmode="numeric" autocomplete="off"></label>
        <button class="btn" data-act="save-merchant-card">${icon('plus',14)} Add masked card</button>
      </form>
      <div class="vault-payment-list">${(state.merchantPaymentMethods || []).map(method=>`<div class="vault-payment-saved"><span class="vault-item-icon">${icon('card',16)}</span><div><b>${esc(method.label)}</b><small>${esc(method.brand)} •••• ${esc(method.last4)} · ${esc(method.merchant)}</small></div><button class="iconbtn" data-act="delete-merchant-card" data-id="${esc(method.id)}" aria-label="Delete ${esc(method.label)}">${icon('trash',14)}</button></div>`).join('') || '<p class="vault-payment-empty">No masked cards added yet.</p>'}</div>
      <p class="vault-payment-note">For BankID or a similar login, take over the live browser and approve the request in your own identity app. Your agent never needs your PIN or security code.</p>
    </div>
  </section>`;
}
function settingsBrowserBody(){
  const a=state.agent || {name:'Your agent',color:'lingon'};
  const permissions=state.agentPermissions || {web:'ask_some',connectors:'ask_some'};
  const profileStatus=workspacePresenceInfo?.persistence?.browserProfile === 'private-workspace-backup' ? 'Browser data backed up' : workspacePresenceInfo?.persistence?.browserProfile === 'vm-os-disk-only' ? 'Browser data kept on your agent computer' : 'Your agent’s browser profile';
  const modeOptions=(group,selected,options)=>`<div class="browser-mode-options" role="radiogroup" aria-label="${group === 'web' ? 'Web access' : 'Connected apps'} permissions">${options.map(([value,title,description])=>`<button type="button" class="browser-mode-option ${selected===value?'is-selected':''}" role="radio" aria-checked="${selected===value}" data-act="browser-permission" data-group="${group}" data-mode="${value}"><span class="browser-mode-indicator" aria-hidden="true"></span><span><b>${title}</b><small>${description}</small></span></button>`).join('')}</div>`;
  return `<section class="agent-browser browser-stack">
    <article class="browser-settings-card">
      <div class="browser-settings-heading"><span class="browser-card-icon">${icon('user',17)}</span><div><h2>Browser profile</h2><p>Your agent’s profile and memory</p></div></div>
      <div class="browser-profile-identity"><div class="browser-profile-avatar">${Mascot.svg(a.color,'happy',76,'mascot-bob')}</div><div><b>${esc(a.name)}</b><span>${esc(profileStatus)}</span></div></div>
      <p class="browser-settings-note">Website sessions stay in your private VM browser profile across tasks. Passwords and API keys stay in Secrets and are used only with your approval.</p>
      <label class="alabel" for="browser-agent-name">Agent name</label>
      <input class="field browser-name-input" id="browser-agent-name" value="${esc(a.name)}" maxlength="18" autocomplete="off">
      <div class="browser-profile-actions"><button class="btn soft small" data-act="browser-reset-agent">${icon('clock',14)} Reset agent</button><button class="btn soft small" data-act="import-memory">${icon('book',14)} Import memory</button><input id="browser-memory-file" type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" hidden></div>
      <p class="browser-settings-note">Reset restores the agent’s name and appearance. Import adds facts from a text, Markdown, or JSON file to account memory.</p>
    </article>
    <article class="browser-settings-card">
      <div class="browser-settings-heading"><span class="browser-card-icon">${icon('globe',17)}</span><div><h2>Web access</h2><p>Choose when your agent asks before using websites</p></div></div>
      ${modeOptions('web',permissions.web,[['ask_some','Ask for some actions','Search, open and read public pages freely. Ask before typing, submitting, signing in or buying.'],['always_ask','Always ask','Ask before accessing any website or taking a web action.']])}
    </article>
    <article class="browser-settings-card">
      <div class="browser-settings-heading"><span class="browser-card-icon">${icon('box',17)}</span><div><h2>Connected apps</h2><p>Choose when your agent asks before using a connection</p></div></div>
      ${modeOptions('connectors',permissions.connectors,[['ask_some','Ask for some actions','Read connected apps when asked; ask before every write action.'],['always_ask','Always ask','Ask before every connected app action.']])}
    </article>
  </section>`;
}
function settingsIssueBody(){
  return `<section class="support-stack">
    <article class="browser-settings-card">
      <div class="browser-settings-heading"><span class="browser-card-icon support-circle">${icon('issue',20)}</span><div><h2>Report an issue</h2><p>Tell us what happened so we can investigate.</p></div></div>
      <form class="support-form" data-support-kind="issue">
        <label for="issue-description">What went wrong?</label>
        <textarea class="field" id="issue-description" name="description" rows="6" maxlength="4000" placeholder="Describe what happened and what you expected instead" required></textarea>
        <label for="issue-images">Attachments <span class="support-optional">optional</span></label>
        <input class="field support-file" id="issue-images" name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-describedby="issue-images-note">
        <p class="browser-settings-note" id="issue-images-note">Up to 3 images, 2 MB each. Screenshots can help us find the problem.</p>
        <label for="issue-topic">What is the problem related to?</label>
        <select class="field" id="issue-topic" name="topic" required><option value="">Select an area</option><option>Chat or agent</option><option>Account or sign in</option><option>Billing or payments</option><option>Apps or integrations</option><option>Files or attachments</option><option>Other</option></select>
        <div class="support-actions"><button class="btn" type="submit">Submit report</button><span class="support-status" role="status" aria-live="polite"></span></div>
      </form>
    </article>
  </section>`;
}
function settingsSupportBody(){
  const u=currentUser();
  return `<section class="support-stack">
    <article class="browser-settings-card">
      <div class="browser-settings-heading"><span class="browser-card-icon support-circle">${icon('help',20)}</span><div><h2>Submit feedback</h2><p>Share a question, suggestion or support request.</p></div></div>
      <form class="support-form" data-support-kind="feedback">
        <div class="support-two-col"><div><label for="feedback-name">Name</label><input class="field" id="feedback-name" name="name" value="${esc(u.name === 'Guest' ? '' : u.name)}" maxlength="120" autocomplete="name" required></div><div><label for="feedback-email">Email</label><input class="field" id="feedback-email" name="email" type="email" value="${esc(u.email === 'signed-out' ? '' : u.email)}" maxlength="254" autocomplete="email" required></div></div>
        <label for="feedback-topic">Topic</label><input class="field" id="feedback-topic" name="topic" maxlength="120" placeholder="What is this about?" required>
        <label for="feedback-description">Describe your issue</label><textarea class="field" id="feedback-description" name="description" rows="6" maxlength="4000" placeholder="How can we help?" required></textarea>
        <div class="support-actions"><button class="btn" type="submit">Submit feedback</button><span class="support-status" role="status" aria-live="polite"></span></div>
      </form>
    </article>
    <article class="browser-settings-card"><div class="browser-settings-heading"><span class="browser-card-icon">${icon('mail',18)}</span><div><h2>Contact</h2><p><a href="mailto:support@belna.se">support@belna.se</a></p></div></div></article>
  </section>`;
}
function centerActiveSeg(container){
  const tabs = container && container.querySelector('.seg');
  const active = tabs && tabs.querySelector('.on');
  if (!tabs || !active) return;
  requestAnimationFrame(() => {
    if (!tabs.isConnected) return;
    const tabBox = tabs.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.left < tabBox.left || activeBox.right > tabBox.right) {
      tabs.scrollLeft += activeBox.left - tabBox.left - (tabBox.width - activeBox.width) / 2;
    }
  });
}
function centerActiveSettingsTab(container){ centerActiveSeg(container); }
function editableAgentDocuments(){
  const a=state.agent || {name:'Your agent',pers:'Playful'};
  const fallback = {
    identity:`# Identity\n\nName: ${a.name}\nStyle: ${a.pers}`,
    soul:'# Soul\n\nBe warm, candid, practical, and reliable. Adapt detail to the user and keep promises explicit.',
    user:'# User\n\nAdd stable preferences, background, language, and timezone here.',
    agents:'# Working agreement\n\nPlan substantial work, verify results with evidence, surface uncertainty, and ask before irreversible external actions.',
  };
  return { ...fallback, ...(state.systemManifest?.documents || {}), ...(state.agentContext?.documents || {}) };
}
let agentContextSavePending=null,agentContextSaveVersion=0,queuedAgentDocuments=null;
async function persistAgentContext(documents){
  if(!window.LingonAuth.signedIn())return;
  agentContextSaveVersion++;if(documents)queuedAgentDocuments=documents;
  if(agentContextSavePending)return agentContextSavePending;
  agentContextSavePending=(async()=>{let completed=0;do{
    const target=agentContextSaveVersion,current=state.agentContext || {revision:0,documents:editableAgentDocuments()};
    const nextDocuments=queuedAgentDocuments || current.documents;queuedAgentDocuments=null;
    const saved=await window.LingonAuth.api('/api/agent-context',{method:'PUT',body:JSON.stringify({agent:state.agent,documents:nextDocuments,revision:current.revision})});
    state.agentContext=saved;if(saved.agent)state.agent={...state.agent,...saved.agent};
    state.systemManifest={...(state.systemManifest || {}),revision:saved.revision,documents:{...((state.systemManifest || {}).documents || {}),...(saved.documents || {})}};
    save();completed=target;
  }while(completed<agentContextSaveVersion);})();
  try{return await agentContextSavePending;}finally{agentContextSavePending=null;}
}
function paintSettings(M){
  const a = state.agent;
  const u = currentUser();
  const tab = state.settingsTab || 'profiles';
  const curTheme = THEMES.find(t => t.id === (state.theme || 'grey')) || THEMES[0];
  let body = '';
  if (tab === 'profiles'){
    body = `
    <div class="profiletop">
      <div><span class="uava big">${esc((u.name || 'U').slice(0, 1).toUpperCase())}</span></div>
      <div class="info">
        <label class="alabel">Display name</label>
        <input class="field" id="uname" value="${esc(u.name)}" maxlength="40" style="max-width:280px;font-weight:700">
        <div class="sub" style="margin-top:6px">${esc(u.email)} · Arche 1.0 · your data is never shared with other users</div>
      </div>
    </div>
    <div class="psec"><h3>${icon('spark',15)} Your agent</h3>
      <div class="profiletop">
        <div id="pmascot">${Mascot.svg(a.color,'happy',90,'mascot-bob')}</div>
        <div class="info">
          <input class="field" id="pname" value="${esc(a.name)}" maxlength="18" style="max-width:220px;font-weight:700">
          <div class="swatches" style="justify-content:flex-start;margin-top:14px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
          <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
        </div>
      </div>
      <div class="kv" style="margin-top:12px">
        <div class="row"><span style="color:var(--mut)">${icon('mail',16)}</span><div><b>Agent mail</b><div class="sub">${mailCache?.address ? esc(mailCache.address) : 'Open Mail to see the agent’s address'}</div></div></div>
        <div class="row"><span style="color:var(--mut)">${icon('wallet',16)}</span><div><b>Shop Pay</b><div class="sub">${state.shopPay?.connected ? 'Connected for approved purchases' : state.shopPay?.configured ? 'Ready to connect in Payments' : 'Payment connection unavailable'}</div></div></div>
      </div>
    </div>
    <div class="psec"><h3>${icon('star',15)} Theme</h3>
      <div class="kv"><div class="row" style="align-items:flex-start"><span style="color:var(--mut)">${icon('star',16)}</span>
        <div style="flex:1"><b>Chat color</b><div class="sub">Current: ${esc(curTheme.name)} · colors your messages and the send button</div>
          <div class="swatches" style="justify-content:flex-start;margin-top:12px">${THEMES.map(t => `<button class="swatch ${curTheme.id === t.id ? 'on' : ''}" data-act="theme" data-v="${t.id}" title="${t.name}"><span style="width:26px;height:26px;border-radius:50%;background:${t.c};display:block"></span></button>`).join('')}</div>
        </div></div></div>
    </div>
    <div class="psec"><h3 style="color:var(--acc)">${icon('alert',15)} Danger zone</h3>
      <div class="kv"><div class="row"><div><b>Release this agent</b><div class="sub">Deletes chats, vault, memory and the claim on this device.</div></div>
      <div class="rgt"><button class="btn soft small" data-act="reset">Release</button></div></div></div>
    </div>`;
  } else if (tab === 'secrets'){
    body = settingsSecretsBody(state.vault);
  } else if (tab === 'browser'){
    body = settingsBrowserBody();
  } else if (tab === 'billing' || tab === 'usage'){
    body = billingBodyHtml(tab);
  } else if (tab === 'issue'){
    body = settingsIssueBody();
  } else if (tab === 'support'){
    body = settingsSupportBody();
  }
  const previousTabScroll = M.querySelector('.settings-tabs')?.scrollLeft || 0;
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Settings</h1><button class="btn ghost small" data-act="nav" data-view="chat">Back to chat</button></div>
    <p class="psub">${({ billing:'Plans, payment details, and invoices.', usage:'Your monthly tokens, daily limits, extra tokens, and gift cards.', profiles:'Your account, agent appearance, and private settings — all scoped to you.', secrets:'Logins, API keys and other credentials your agent can use without seeing them.', browser:'Manage your agent’s browser profile and approval settings.', issue:'Report a problem with the app.', support:'Send feedback or contact our support team.' })[tab] || 'Scoped to your account, never shared.'}</p>
    <div class="seg settings-tabs" aria-label="Settings sections">
      <button class="${tab === 'profiles' ? 'on' : ''}" data-act="stab" data-t="profiles" aria-pressed="${tab === 'profiles'}">${icon('user',14)} Profiles</button>
      <button class="${tab === 'secrets' ? 'on' : ''}" data-act="stab" data-t="secrets" aria-pressed="${tab === 'secrets'}">${icon('key',14)} Secrets</button>
      <button class="${tab === 'browser' ? 'on' : ''}" data-act="stab" data-t="browser" aria-pressed="${tab === 'browser'}">${icon('globe',14)} Browser</button>
      <button class="${tab === 'usage' ? 'on' : ''}" data-act="stab" data-t="usage" aria-pressed="${tab === 'usage'}">${icon('spark',14)} Usage</button>
      <button class="${tab === 'billing' ? 'on' : ''}" data-act="stab" data-t="billing" aria-pressed="${tab === 'billing'}">${icon('card',14)} Billing</button>
      <button class="${tab === 'issue' ? 'on' : ''}" data-act="stab" data-t="issue" aria-pressed="${tab === 'issue'}">${icon('issue',14)} Report an issue</button>
      <button class="${tab === 'support' ? 'on' : ''}" data-act="stab" data-t="support" aria-pressed="${tab === 'support'}">${icon('help',14)} Help &amp; support</button>
    </div>
    ${body}
  </div></div>`;
  M.querySelector('.settings-tabs').scrollLeft = previousTabScroll;
  centerActiveSettingsTab(M);
  const pn = $('#pname');
  if (pn) pn.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = publicAgentName(v); save(); paintSide(); paintCanvas();
    persistAgentContext().catch(e=>toast(e.message));
    ensureMailbox(v);
    toast('Renamed — they answer to ' + v + ' now.');
  });
  const un = $('#uname');
  if (un) un.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.userProfile = Object.assign({}, state.userProfile, { name: v }); save(); paintSide(); toast('Profile updated.');
  });
  const browserName=M.querySelector('#browser-agent-name');
  if(browserName)browserName.addEventListener('change',e=>{
    const name=String(e.target.value || '').trim();if(!name){e.target.value=state.agent.name;return;}
    state.agent.name=publicAgentName(name);save();paintSide();paintCanvas();persistAgentContext().catch(err=>toast(err.message));ensureMailbox(state.agent.name);paintSettings(M);toast('Agent name updated.');
  });
  const memoryFile=M.querySelector('#browser-memory-file');
  if(memoryFile)memoryFile.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>1024*1024){toast('Choose a memory file smaller than 1 MB.');e.target.value='';return;}
    try{
      const raw=await file.text();let entries;
      if(/\.json$/i.test(file.name)){
        const parsed=JSON.parse(raw),items=Array.isArray(parsed)?parsed:parsed?.memories;
        if(!Array.isArray(items))throw new Error('JSON must contain a memories array.');
        entries=items.map(item=>typeof item==='string'?{text:item}:item);
      }else entries=raw.split(/\r?\n/).map(line=>({text:line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()})).filter(item=>item.text && !/^#/.test(item.text));
      entries=entries.filter(item=>item && typeof item.text==='string' && item.text.trim()).map(item=>({text:item.text.trim().slice(0,2000),category:['user','long_term','daily'].includes(item.category)?item.category:'long_term'}));
      if(!entries.length)throw new Error('No memories found in that file.');
      if(entries.length>100)throw new Error('Import up to 100 memories at a time.');
      const result=await window.LingonAuth.api('/api/memories/import',{method:'POST',body:JSON.stringify({memories:entries})});
      const out=await window.LingonAuth.api('/api/memories');state.memory=out.memories || [];state.memoryTotal=Number(out.total ?? state.memory.length);save();paintSide();toast(`${result.imported} memories imported.`);
    }catch(err){toast(err.message || 'Could not import memory.');}
    e.target.value='';
  });
  if (tab === 'billing' || tab === 'usage'){
    loadBillingContent(tab);
  }
  // One status check per user if presence has not reported yet; the reply repaints this tab.
  if (tab === 'browser' && !workspacePresenceInfo && signedIn() && browserPresenceChecked !== currentUserId()) {
    browserPresenceChecked = currentUserId();
    workspacePresenceRequest('status');
  }
  if(tab==='browser' && signedIn() && browserPermissionsChecked!==currentUserId()){
    browserPermissionsChecked=currentUserId();
    const version=browserPermissionsVersion;
    window.LingonAuth.api('/api/agent-permissions').then(result=>{if(version!==browserPermissionsVersion)return;state.agentPermissions=result.permissions;save();if(state.view==='settings' && state.settingsTab==='browser' && $('#main'))paintSettings($('#main'));}).catch(err=>{if(version!==browserPermissionsVersion)return;browserPermissionsChecked=null;toast(err.message || 'Could not load permissions.');});
  }
}

/* ---------------- Apps — Belna connected apps via Composio ---------------- */
function appLogoHtml(a){
  return a && a.logo
    ? `<img src="${esc(a.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<span class="app-fallback">${esc(String((a && (a.name || a.toolkit)) || '?').slice(0, 1).toUpperCase())}</span>`;
}
/* Payment marks in the chat side panel. Shop Pay's wordmark is embedded so it
   renders consistently; Stripe never uses a connector-supplied image here. */
function stripeBrandMark(){
  return `<svg class="brandmark" viewBox="54 36 360.02 149.84" width="34" height="15" fill="none" role="img" aria-label="Stripe"><g fill="#fff"><path fill-rule="evenodd" clip-rule="evenodd" d="M414 113.4c0-25.6-12.4-45.8-36.1-45.8-23.8 0-38.2 20.2-38.2 45.6 0 30.1 17 45.3 41.4 45.3 11.9 0 20.9-2.7 27.7-6.5v-20c-6.8 3.4-14.6 5.5-24.5 5.5-9.7 0-18.3-3.4-19.4-15.2h48.9c.2-1.1.2-6.3.2-8.9zm-49.4-9.5c0-11.3 6.9-16 13.2-16 6.1 0 12.6 4.7 12.6 16h-25.8z"/><path d="M301.1 67.6c-9.8 0-16.1 4.6-19.6 7.8l-1.3-6.2h-22v116.6l25-5.3.1-28.3c3.6 2.6 8.9 6.3 17.7 6.3 17.9 0 34.2-14.4 34.2-46.1 0-28.9-16.6-44.8-34.1-44.8zm-6 68.9c-5.9 0-9.4-2.1-11.8-4.7l-.1-37.1c2.6-2.9 6.2-4.9 11.9-4.9 9.1 0 15.4 10.2 15.4 23.3 0 13.9-6.2 23.4-15.4 23.4z"/><polygon points="223.8,61.7 248.9,56.3 248.9,36 223.8,41.3"/><rect x="223.8" y="69.3" width="25.1" height="87.5"/><path d="M196.9 76.7l-1.6-7.4h-21.6v87.5h25V97.5c5.9-7.7 15.9-6.3 19-5.2v-23c-2.6-1.2-14.3-3.4-20.8 7.4z"/><path d="M146.9 47.6l-24.4 5.2-.1 80.1c0 14.8 11.1 25.7 25.9 25.7 8.2 0 14.2-1.5 17.5-3.3V135c-3.2 1.3-19 5.9-19-8.9V90.6h19V69.3h-19l.1-21.7z"/><path d="M79.3 94.7c0-3.9 3.2-5.4 8.5-5.4 7.6 0 17.2 2.3 24.8 6.4V72.2c-8.3-3.3-16.5-4.6-24.8-4.6C67.5 67.6 54 78.2 54 95.9c0 27.6 38 23.2 38 35.1 0 4.6-4 6.1-9.6 6.1-8.3 0-18.9-3.4-27.3-8v23.8c9.3 4 18.7 5.7 27.3 5.7 20.8 0 35.1-10.3 35.1-28.2 0-29.8-38.1-24.5-38.2-35.7z"/></g></svg>`;
}
function shopPayBrandMark(){
  return `<svg class="brandmark" width="86" height="21" role="img" aria-label="Shop Pay" viewBox="0 0 683 164" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M454.942 0C441.175 0 430.015 11.1602 430.015 24.927V138.295C430.015 152.062 441.175 163.222 454.942 163.222H658.072C671.839 163.222 682.999 152.062 682.999 138.295V24.927C682.999 11.1602 671.839 0 658.072 0H454.942ZM490.023 113.902V85.1661H508.1C524.616 85.1661 533.399 75.9057 533.399 61.872C533.399 47.8383 524.616 39.4371 508.1 39.4371H478.376V113.902H490.023ZM490.023 50.5114H505.427C516.119 50.5114 521.37 54.9029 521.37 62.2539C521.37 69.6049 516.31 73.9964 505.904 73.9964H490.023V50.5114ZM553.933 115.429C562.811 115.429 568.635 111.515 571.308 104.832C572.071 112.279 576.558 116.098 586.296 113.52L586.391 105.596C582.477 105.978 581.714 104.546 581.714 100.441V80.9655C581.714 69.5094 574.172 62.7312 560.233 62.7312C546.486 62.7312 538.562 69.6049 538.562 81.2519H549.255C549.255 75.7148 553.169 72.3734 560.042 72.3734C567.298 72.3734 570.639 75.5239 570.544 80.9655V83.4477L558.229 84.7842C544.386 86.3117 536.748 91.5624 536.748 100.727C536.748 108.269 542.095 115.429 553.933 115.429ZM556.319 106.837C550.305 106.837 547.918 103.591 547.918 100.345C547.918 95.9539 552.882 93.9491 562.62 92.8035L570.257 91.9443C569.78 100.345 564.148 106.837 556.319 106.837ZM621.754 117.625C616.885 129.463 609.057 132.995 596.837 132.995H591.586V123.258H597.219C603.902 123.258 607.148 121.157 610.68 115.143L589.009 64.2587H601.038L616.504 101.396L630.251 64.2587H641.993L621.754 117.625Z" fill="#fff"/><path d="M57.3945 71.7445C41.4471 68.2852 34.3427 66.9315 34.3427 60.7862C34.3427 55.0063 39.1506 52.127 48.7662 52.127C57.2228 52.127 63.4043 55.8228 67.9545 63.0638C68.2979 63.6225 69.0062 63.8159 69.5857 63.5151L87.5292 54.4476C88.1731 54.1253 88.4092 53.3088 88.0443 52.6857C80.5965 39.7721 66.8384 32.7029 48.7233 32.7029C24.9203 32.7029 10.132 44.4347 10.132 63.0853C10.132 82.8962 28.1398 87.9027 44.1086 91.3621C60.0774 94.8215 67.2033 96.1751 67.2033 102.32C67.2033 108.466 62.0091 111.366 51.6423 111.366C42.0696 111.366 34.9652 106.983 30.6725 98.4742C30.3505 97.8511 29.5993 97.5933 28.9769 97.9156L11.0764 106.79C10.4539 107.112 10.1964 107.864 10.5183 108.509C17.6227 122.797 32.1964 130.833 51.6637 130.833C76.454 130.833 91.4355 119.295 91.4355 100.064C91.4355 80.8335 73.3418 75.2469 57.3945 71.7875V71.7445Z" fill="#fff"/><path d="M153.551 32.7032C143.377 32.7032 134.384 36.3129 127.924 42.7375C127.516 43.1243 126.85 42.845 126.85 42.2863V1.26785C126.85 0.558781 126.292 0.00012207 125.584 0.00012207H103.133C102.425 0.00012207 101.867 0.558781 101.867 1.26785V128.578C101.867 129.287 102.425 129.845 103.133 129.845H125.584C126.292 129.845 126.85 129.287 126.85 128.578V72.7332C126.85 61.9468 135.114 53.6743 146.253 53.6743C157.393 53.6743 165.463 61.7749 165.463 72.7332V128.578C165.463 129.287 166.021 129.845 166.729 129.845H189.18C189.889 129.845 190.447 129.287 190.447 128.578V72.7332C190.447 49.2695 175.079 32.7246 153.551 32.7246V32.7032Z" fill="#fff"/><path d="M235.991 29.0505C223.8 29.0505 212.381 32.7893 204.182 38.1825C203.624 38.5477 203.431 39.2998 203.774 39.8799L213.669 56.7901C214.034 57.3917 214.806 57.6066 215.407 57.2413C221.632 53.4811 228.758 51.5258 236.034 51.5688C255.63 51.5688 270.032 65.4063 270.032 83.6917C270.032 99.2697 258.506 110.808 243.889 110.808C231.977 110.808 223.714 103.868 223.714 94.0698C223.714 88.4618 226.096 83.8636 232.299 80.619C232.943 80.2753 233.179 79.4802 232.793 78.8571L223.456 63.0428C223.156 62.5271 222.512 62.2907 221.932 62.5056C209.419 67.1468 200.641 78.3199 200.641 93.3178C200.641 116.008 218.691 132.94 243.868 132.94C273.273 132.94 294.414 112.549 294.414 83.3049C294.414 51.9556 269.817 29.0505 235.991 29.0505Z" fill="#fff"/><path d="M360.069 32.5311C348.714 32.5311 338.584 36.7211 331.179 44.1126C330.771 44.5208 330.106 44.22 330.106 43.6613V34.7658C330.106 34.0567 329.548 33.498 328.839 33.498H306.968C306.26 33.498 305.702 34.0567 305.702 34.7658V161.882C305.702 162.591 306.26 163.15 306.968 163.15H329.419C330.127 163.15 330.685 162.591 330.685 161.882V120.198C330.685 119.639 331.351 119.36 331.758 119.725C339.142 126.601 348.908 130.619 360.09 130.619C386.426 130.619 406.966 109.282 406.966 81.5642C406.966 53.8461 386.404 32.5096 360.09 32.5096L360.069 32.5311ZM355.84 109.089C340.859 109.089 329.505 97.1637 329.505 81.3923C329.505 65.6209 340.837 53.6957 355.84 53.6957C370.843 53.6957 382.155 65.4275 382.155 81.3923C382.155 97.357 370.994 109.089 355.819 109.089H355.84Z" fill="#fff"/></svg>`;
}
function stripeIconHtml(){
  return stripeBrandMark();
}
function appsStackList(apps){
  const featured = ['gmail','googlecalendar','slack','github','notion','outlook','linear','googledrive','jira','hubspot'];
  const connected = apps.filter((a) => a.connected);
  const extras = featured.map((t) => apps.find((a) => a.toolkit === t && !a.connected)).filter(Boolean);
  const more = apps.filter((a) => !connected.includes(a) && !extras.includes(a));
  return [...connected, ...extras, ...more].slice(0, 7);
}
function accountFace(acc, app){
  if (acc && acc.picture) return `<img src="${esc(acc.picture)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  const letter = String((acc && (acc.name || acc.email)) || (app && (app.name || app.toolkit)) || '?').replace(/^[^A-Za-z0-9]+/, '').slice(0, 1).toUpperCase() || '?';
  return `<span>${esc(letter)}</span>`;
}
function accountPrimary(acc){
  if (!acc) return 'Connected account';
  return acc.name || acc.email || acc.alias || acc.wordId || 'Connected account';
}
function accountSecondary(acc){
  if (!acc) return '';
  // Show mail + name together whenever we have both so the user can tell
  // exactly which account they connected.
  if (acc.name && acc.email && acc.name !== acc.email) return acc.email;
  if (!acc.name && acc.email && acc.alias && acc.alias !== acc.email) return acc.alias;
  if (acc.name && !acc.email && acc.alias && acc.alias !== acc.name) return acc.alias;
  return '';
}
function accountTitle(acc){
  if (!acc) return '';
  return [acc.name, acc.email, acc.alias].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
}
function switchHtml(on, attrs){
  return `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" ${attrs}><i></i></button>`;
}
function connectorBodyHtml(a){
  const detail = (state.appDetails && state.appDetails[a.toolkit]) || {};
  const accounts = Array.isArray(detail.accounts) ? detail.accounts : (Array.isArray(a.accounts) ? a.accounts : []);
  const perms = Array.isArray(detail.permissions) ? detail.permissions : [];
  if (detail.loading && !perms.length) {
    return `<div class="conn-body"><div class="conn-skel"></div><div class="conn-skel"></div></div>`;
  }
  if (detail.error && !perms.length && !accounts.length) {
    return `<div class="conn-body"><div class="conn-empty">${esc(detail.error)}</div></div>`;
  }
  const connectLabel = accounts.length ? 'Add account' : 'Connect';
  const accountRows = accounts.map((acc) => {
    const primary = accountPrimary(acc);
    const secondary = accountSecondary(acc);
    return `<div class="conn-account" title="${esc(accountTitle(acc))}">
      <span class="conn-ava">${accountFace(acc, a)}</span>
      <div class="conn-who"><b>${esc(primary)}</b>${secondary ? `<span>${esc(secondary)}</span>` : ''}</div>
      <button class="btn ghost tiny" data-act="disconnect-app" data-toolkit="${esc(a.toolkit)}" data-account="${esc(acc.id)}">Disconnect</button>
    </div>`;
  }).join('') || `<div class="conn-empty">No accounts yet. Connect one to let your agent use ${esc(a.name || a.toolkit)}.</div>`;
  const kindBlock = (kind, label) => {
    const rows = perms.filter((p) => p.kind === kind);
    if (!rows.length) return '';
    const allOn = rows.every((p) => p.enabled);
    return `<div class="conn-kind">
      <div class="conn-kind-h">
        <b>${label}</b>
        <span>${rows.filter((p) => p.enabled).length}/${rows.length}</span>
        ${switchHtml(allOn, `data-act="perm-kind" data-toolkit="${esc(a.toolkit)}" data-kind="${kind}"`)}
      </div>
      ${rows.map((p) => `<div class="conn-perm">
        <div><b>${esc(p.name || p.slug)}</b><span>${esc(p.description || p.slug)}</span></div>
        ${switchHtml(!!p.enabled, `data-act="perm-toggle" data-toolkit="${esc(a.toolkit)}" data-slug="${esc(p.slug)}"`)}
      </div>`).join('')}
    </div>`;
  };
  return `<div class="conn-body">
    <div class="conn-actions">
      <button class="btn small" data-act="connect-app" data-toolkit="${esc(a.toolkit)}" data-auth="${esc(a.authConfigId || '')}">${icon('plus',14)} ${connectLabel}</button>
    </div>
    ${accounts.length ? `<p class="conn-hint">You can add more than one account — pick which one the agent should use when it acts.</p>` : ''}
    <div class="conn-sec"><h3>Accounts${accounts.length > 1 ? ` (${accounts.length})` : ''}</h3>${accountRows}</div>
    <div class="conn-sec">
      <h3>Permissions</h3>
      <p class="conn-hint">Read and write access your agent may use. Turn any off to block it.</p>
      ${detail.loading ? `<div class="conn-skel"></div>` : (perms.length ? `${kindBlock('read', 'Read')}${kindBlock('write', 'Write')}` : `<div class="conn-empty">No permissions listed for this connector.</div>`)}
    </div>
  </div>`;
}
function paintApps(M){
  const apps = Array.isArray(state.composioApps) ? state.composioApps : [];
  const q = String(state.appQuery || '').toLowerCase().trim();
  const filter = state.appFilter === 'connected' ? 'connected' : 'all';
  const connectedCount = apps.filter((a) => a.connected).length;

  let list = apps.slice();
  if (filter === 'connected') list = list.filter((a) => a.connected);
  if (q) {
    list = list.filter((a) =>
      String(a.name || '').toLowerCase().includes(q) ||
      String(a.toolkit || '').toLowerCase().includes(q) ||
      String(a.description || '').toLowerCase().includes(q) ||
      (a.accounts || []).some((acc) => String(acc.email || acc.name || acc.alias || acc.wordId || '').toLowerCase().includes(q))
    );
  }
  list.sort((a, b) => (Number(b.connected) - Number(a.connected)) || String(a.name || a.toolkit).localeCompare(String(b.name || b.toolkit)));

  const rows = list.map((a) => {
    const open = state.appOpen === a.toolkit;
    const accts = Array.isArray(a.accounts) ? a.accounts : [];
    const n = Number(a.accountCount || accts.length || (a.connected ? 1 : 0));
    const first = accts[0] || null;
    const firstMail = first ? (first.email || '') : '';
    const firstName = first ? (first.name && first.name !== first.email ? first.name : '') : '';
    // Collapsed row shows WHO is connected: profile picture + name first
    // (mail only as secondary), so the user recognises the account
    // without expanding. Quick Connect/Add sits next to the arrow.
    const primary = firstName || firstMail || (a.connected ? '1 account' : '');
    const sub = !a.connected ? 'Not connected'
      : n <= 1 ? primary
      : `${primary} +${n - 1} more`;
    const subTitle = first
      ? (firstName && firstMail ? `${firstName} · ${firstMail}` : (firstName || firstMail || ''))
      : '';
    const faces = accts.slice(0, 3).map((acc) => `<span class="conn-ava mini" title="${esc(accountTitle(acc))}">${accountFace(acc, a)}</span>`).join('');
    const quickLabel = a.connected ? 'Add account' : 'Connect';
    return `<article class="conn-row ${a.connected ? 'is-connected' : ''} ${open ? 'is-open' : ''}" data-toolkit="${esc(a.toolkit)}">
      <div class="conn-head" data-act="toggle-connector" data-toolkit="${esc(a.toolkit)}" role="button" tabindex="0" title="${esc(subTitle)}">
        <span class="app-logo">${appLogoHtml(a)}${a.connected ? `<i class="app-pip">${icon('check',10)}</i>` : ''}</span>
        <span class="conn-meta"><b>${esc(a.name || a.toolkit)}</b><span title="${esc(subTitle)}">${esc(sub)}${firstName && firstMail ? ` · ${esc(firstMail)}` : ''}</span></span>
        ${a.connected ? `<span class="conn-faces">${faces}</span><span class="chip green">Connected</span>` : ''}
        <button type="button" class="btn ghost small conn-quick" data-act="connect-app" data-toolkit="${esc(a.toolkit)}" data-auth="${esc(a.authConfigId || '')}" title="${esc(quickLabel + ' ' + (a.name || a.toolkit))}">${icon('plus',13)} ${quickLabel}</button>
        <span class="conn-chev">${icon('chev',16)}</span>
      </div>
      ${open ? connectorBodyHtml(a) : ''}
    </article>`;
  }).join('');

  let board = `<div class="conn-list">${rows}</div>`;
  if (state.composioLoading && !list.length) board = `<div class="conn-list">${'<article class="conn-row skel"></article>'.repeat(6)}</div>`;
  else if (!state.composioLoading && !apps.length) board = `<div class="apps-empty">${icon('box',22)}<b>No connectors yet</b><span>Connections aren't configured on this server.</span></div>`;
  else if (!state.composioLoading && !list.length) board = `<div class="apps-empty">${icon('search',22)}<b>No match</b></div>`;

  M.innerHTML = `<div class="page"><div class="pageinner apps-page">
    <div class="apps-toolbar">
      <h1>Connectors</h1>
      <label class="apps-search-wrap">${icon('search',16)}<input class="field apps-search" id="appquery" placeholder="Search connectors" value="${esc(state.appQuery || '')}"></label>
      <div class="seg apps-filter">
        <button class="${filter === 'connected' ? 'on' : ''}" data-act="app-filter" data-f="connected">Connected${connectedCount ? ` ${connectedCount}` : ''}</button>
        <button class="${filter === 'all' ? 'on' : ''}" data-act="app-filter" data-f="all">All</button>
      </div>
      <button class="iconbtn" data-act="refresh-apps" title="Refresh">${icon('refresh',16)}</button>
    </div>
    ${board}
  </div></div>`;
  const input = $('#appquery');
  if (input) {
    input.addEventListener('input', (e) => {
      state.appQuery = e.target.value;
      save();
      const pos = e.target.selectionStart;
      paintApps($('#main'));
      const again = $('#appquery');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
  }
  if (!state.composioLoading && signedIn()) refreshComposioApps();
}

/* ================================================================
   GLOBAL EVENTS
================================================================ */
window.addEventListener('resize', () => {
  if (state.view === 'settings' && $('#main')) centerActiveSettingsTab($('#main'));
});
window.addEventListener('focus', () => {
  startWorkspacePresence();
  if (signedIn() && state.onboarded) syncFromBackend().then((updated) => { if (updated && $('#side')) paintSide(); });
  if (signedIn() && state.canvasOpen && state.canvasTab === 'payments') refreshComposioApps(true);
  // Returning from the OAuth tab: pull the fresh account list so the newly
  // connected mail/name/profile appears without a manual Refresh.
  if (signedIn() && (pendingConnect || (state.view === 'apps' && state.appOpen))) {
    refreshComposioApps(true).then(() => { if (state.appOpen) openConnector(state.appOpen, true); });
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopWorkspacePresence();
  else startWorkspacePresence();
});
window.addEventListener('pagehide', () => { stopVoice(); stopWorkspacePresence(); });
document.addEventListener('submit', async e => {
  const supportForm=e.target.closest('[data-support-kind]');
  if(supportForm){
    e.preventDefault();
    const button=supportForm.querySelector('button[type="submit"]');
    const status=supportForm.querySelector('.support-status');
    if(button.disabled)return;
    const kind=supportForm.dataset.supportKind;
    const fields=new FormData(supportForm);
    const images=kind==='issue' ? Array.from(supportForm.querySelector('[name="images"]')?.files || []) : [];
    if(images.length>3 || images.some(file=>file.size>2*1024*1024 || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))){
      status.textContent='Choose up to 3 PNG, JPEG, WebP or GIF images, 2 MB each.';return;
    }
    button.disabled=true;status.textContent='Submitting…';
    try{
      const encoded=await Promise.all(images.map(file=>new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve({mime:file.type,data:String(reader.result).split(',')[1] || ''});reader.onerror=()=>reject(new Error('Could not read an image.'));reader.readAsDataURL(file);
      })));
      await window.LingonAuth.api('/api/support/submissions',{method:'POST',body:JSON.stringify({kind,name:fields.get('name'),email:fields.get('email'),topic:fields.get('topic'),description:fields.get('description'),images:encoded})});
      supportForm.reset();
      status.textContent=kind==='issue' ? 'Report submitted. Thank you.' : 'Feedback submitted. Thank you.';
    }catch(error){status.textContent=error.message || 'Could not submit. Please try again.';}
    finally{button.disabled=false;}
    return;
  }
  const other = e.target.closest('[data-q-other]');
  if (other) {
    e.preventDefault();
    const c = state.chats.find(x => x.id === other.dataset.chat);
    const m = c?.messages.find(x => x.id === other.dataset.msg);
    if (c && m) answerQuestion(c, m, other.elements.answer.value, other.querySelector('button'));
    return;
  }
  const form = e.target.closest('[data-onboarding-name]');
  if (!form) return;
  e.preventDefault();
  const c = state.chats.find(c => c.id === form.dataset.chat);
  const m = c?.messages.find(m => m.id === form.dataset.msg);
  answerOnboarding(c, m, form.elements.agentName.value);
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-pm="last4"]')) {
    const preview = e.target.closest('.vault-payment-form')?.querySelector('[data-pm-preview]');
    if (preview) preview.textContent = (e.target.value.replace(/\D/g,'').slice(0,4) || '••••');
  }
  const form = e.target.closest('[data-onboarding-name]');
  if (!form) return;
  const c = state.chats.find(c => c.id === form.dataset.chat);
  const m = c?.messages.find(m => m.id === form.dataset.msg);
  if (m?.card.status === 'pending') { m.card.draft = e.target.value; save(); }
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'subtrigger') {
    state.subAgentDraft = (($('#subprompt') || {}).value || '');
    state.subAgentDraftName = (($('#subname') || {}).value || '');
    state.subAgentTriggerType = e.target.value;
    save(); paintCanvas();
  }
  if (e.target && e.target.id === 'subinterval') {
    state.subAgentDraftInterval = Number(e.target.value || 60);
    save();
  }
});
document.addEventListener('click', e => {
  document.querySelectorAll('.billing-select[open], .art-menu[open]').forEach(menu => {
    // A choice in an artifact menu closes it too.
    if (!menu.contains(e.target) || (menu.classList.contains('art-menu') && e.target.closest('.art-menu-list button'))) menu.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const menu = document.querySelector('.billing-select[open], .art-menu[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary')?.focus();
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (state.goalMenu && state.view === 'goals' && !e.target.closest('.goal-menu-wrap')){
    state.goalMenu = null;
    if (!b) paintGoals($('#main'));
  }
  if (!b) return;
  const act = b.dataset.act;
  const c = state.chats.find(x => x.id === b.dataset.chat);
  const m = c && c.messages.find(x => x.id === b.dataset.msg);

  if (signedIn() && needsOnboarding() && !['qopt','open-passport','togglemenu','usermenu','signout','voice'].includes(act)) {
    e.preventDefault(); toast('Finish setting up your agent first.'); return;
  }
  if (act === 'select-pack'){
    const picker = b.closest('.billing-select');
    if (!picker) return;
    picker.querySelector('#buypack').value = b.dataset.pack;
    picker.querySelector('#buypack-value').textContent = b.querySelector('span').textContent;
    picker.querySelectorAll('.billing-select-option').forEach(option => {
      const selected = option === b;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    const rate = $('#buypack-rate');
    if (rate) rate.textContent = `${b.dataset.rate} · secure checkout`;
    picker.open = false;
    picker.querySelector('summary').focus();
    return;
  }
  if (act === 'qopt' && m?.card?.onboarding) { answerOnboarding(c, m, b.dataset.o); return; }
  if (act === 'life-ask'){
    e.preventDefault();
    const prompt = (b.dataset.prompt || '').trim();
    if (prompt) landingRun(prompt);
    return;
  }
  if (act === 'landing-passport-tab') {
    const card = b.closest('.landing-passport-card');
    const selected = b.dataset.passportTab;
    if (!card || !selected) return;
    card.querySelectorAll('[data-passport-tab]').forEach(tab => {
      const active = tab.dataset.passportTab === selected;
      tab.classList.toggle('on', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    card.querySelectorAll('[data-passport-panel]').forEach(panel => {
      const active = panel.dataset.passportPanel === selected;
      panel.hidden = !active;
      panel.classList.toggle('on', active);
    });
    return;
  }
  if (act === 'open-passport') {
    if (!signedIn()) { renderAuth(); return; }
    if (needsOnboarding()) { await openOnboardingPassport(c, m); return; }
    state.canvasOpen = false; state.view = 'settings'; state.settingsTab = 'profiles'; save(); renderApp(); return;
  }

  if (act === 'rmfile'){ e.preventDefault(); removeFile(+b.dataset.idx, b.closest('form')); return; }
  if (act === 'scroll'){ e.preventDefault(); const t = $(b.dataset.t); if (t) t.scrollIntoView({ behavior:'smooth' }); return; }
  if (act === 'open-app'){
    e.preventDefault();
    window.location.assign('/app');
    return;
  }
  if (act === 'top'){ e.preventDefault(); window.scrollTo({ top:0, behavior:'smooth' }); return; }
  if (act === 'back-home'){
    if (window.__promoLeft){ window.location.assign('/promo'); return; }
    if (isPromoRoute()){ renderPromo(); return; }
    if (window.location.pathname.replace(/\/+$/, '') === '/app'){ window.location.assign('/'); return; }
    belnaStopLandingFx(); renderLanding(); return;
  }
  if (act === 'promo-cta'){ e.preventDefault(); const t = $('#promo-cta'); if (t) t.scrollIntoView({ behavior:'smooth', block:'start' }); return; }
  if (act === 'signin-nav'){
    e.preventDefault();
    window.location.assign('/app');
    return;
  }
  if (act === 'claim'){
    belnaStopLandingFx();
    if (!signedIn()){ renderAuth(); toast('Sign in first, then claim your agent — your message is saved.'); return; }
    ensureOwnerScope();
    if (state.onboarded && state.agent && !state.agent.provisional){ renderApp(); if (state.pendingPrompt){ const p = state.pendingPrompt; const files = state.pendingPromptFiles || []; state.pendingPrompt = null; state.pendingPromptFiles = []; save(); sendPrompt(p, files); } }
    else if (state.pendingPrompt){ await startPendingPromptFlow(); }
    else { openOnboarding(); }
    return;
  }
  // No demo/sample-agent path: every agent requires a real signed-in account.
  if (act === 'skip-claim'){
    if (!signedIn()){ renderAuth(); toast('Sign up or log in — demo accounts are disabled.'); return; }
    ensureOwnerScope();
    if (state.pendingPrompt){ await startPendingPromptFlow(); return; }
    openOnboarding(); return;
  }

  /* navigation — toggles animate in place, no full re-render */
  if (act === 'togglemenu'){ setMobileNav(!mobileNavOpen); return; }
  if (act === 'closecanvas'){ setCanvasOpen(false); return; }
  if (act === 'nav'){
    if (!signedIn()){ renderAuth(); return; }
    mobileNavOpen = false; state.view = b.dataset.view; state.userMenuOpen = false; save(); renderApp();
    if (state.view === 'apps') refreshComposioApps();
    return;
  }
  if (act === 'refresh-apps'){
    refreshComposioApps(true).then(() => { if (state.appOpen) openConnector(state.appOpen, true); });
    return;
  }
  if (act === 'payments-stripe-apps'){
    state.appQuery = 'stripe'; state.appFilter = 'all'; state.view = 'apps';
    save(); renderApp(); refreshComposioApps(true); return;
  }
  if (act === 'shop-pay-connect'){
    window.LingonAuth.api('/api/shop-pay/connect', { method:'POST', body:'{}' }).then((j) => {
      if (j.url) { window.location.href = j.url; }
      else toast('Could not start Shop Pay.');
    }).catch((e) => toast(e.message || 'Could not start Shop Pay.'));
    return;
  }
  if (act === 'shop-pay-disconnect'){
    window.LingonAuth.api('/api/shop-pay/disconnect', { method:'POST', body:'{}' }).then((j) => {
      state.shopPay = j.shopPay || { connected:false, configured:true };
      state.shopPayOrders = j.orders || [];
      save();
      if ($('#cbody') && state.canvasTab === 'payments') $('#cbody').innerHTML = paymentsTabContent();
      toast('Shop Pay disconnected.');
    }).catch((e) => toast(e.message || 'Could not disconnect Shop Pay.'));
    return;
  }
  if (act === 'shop-pay-limit'){
    const n = Number(($('#shoppaylimit') || {}).value);
    window.LingonAuth.api('/api/shop-pay/limit', { method:'POST', body: JSON.stringify({ dailyLimitUsd: n }) }).then((j) => {
      state.shopPay = j.shopPay || state.shopPay;
      state.shopPayOrders = j.orders || state.shopPayOrders;
      save();
      if ($('#cbody') && state.canvasTab === 'payments') $('#cbody').innerHTML = paymentsTabContent();
      toast('Shop Pay daily limit saved.');
    }).catch((e) => toast(e.message || 'Could not save limit.'));
    return;
  }
  if (act === 'shop-pay-refresh'){ refreshShopPay(true); return; }
  if (act === 'payments-refresh'){ refreshShopPay(true); refreshComposioApps(true); return; }
  if (act === 'app-filter'){ state.appFilter = b.dataset.f === 'connected' ? 'connected' : 'all'; save(); paintApps(document.getElementById('main')); return; }
  if (act === 'app-focus'){
    const tk = String(b.dataset.toolkit || '');
    openConnector(tk, true);
    return;
  }
  if (act === 'toggle-connector'){ openConnector(b.dataset.toolkit); return; }
  if (act === 'perm-toggle'){
    const on = b.getAttribute('aria-checked') !== 'true';
    toggleConnectorPermission(b.dataset.toolkit, b.dataset.slug, on);
    return;
  }
  if (act === 'perm-kind'){
    const on = b.getAttribute('aria-checked') !== 'true';
    toggleConnectorKind(b.dataset.toolkit, b.dataset.kind, on);
    return;
  }
  if (act === 'connect-app'){ connectComposioApp(b.dataset.toolkit, b.dataset.auth); return; }
  if (act === 'disconnect-app'){ disconnectComposioApp(composioAppByToolkit(b.dataset.toolkit), b.dataset.account); return; }
  if (act === 'automate-app'){
    const _tk = String(b.dataset.toolkit || '').toLowerCase();
    state.canvasTab = 'subagents'; state.canvasOpen = true;
    state.subAgentComposer = true; state.subAgentTriggerType = 'app';
    save(); paintCanvas(); refreshSubAgents();
    toast(_tk ? ('Pick a ' + _tk + ' event for the trigger.') : 'Pick a connected-app event.');
    return;
  }
  if (act === 'usermenu'){ state.userMenuOpen = !state.userMenuOpen; save(); paintSide(); return; }
  if (act === 'stab'){ state.settingsTab = b.dataset.t; save(); paintSettings($('#main')); return; }
  if(act==='browser-permission'){
    const group=b.dataset.group,mode=b.dataset.mode;
    if(!['web','connectors'].includes(group) || !['ask_some','always_ask'].includes(mode))return;
    browserPermissionsVersion++;
    const previous={...(state.agentPermissions || {web:'ask_some',connectors:'ask_some'})};
    state.agentPermissions={...previous,[group]:mode};save();paintSettings($('#main'));
    try{const result=await window.LingonAuth.api('/api/agent-permissions',{method:'PUT',body:JSON.stringify({[group]:mode})});state.agentPermissions=result.permissions;save();paintSettings($('#main'));toast('Permission setting saved.');}
    catch(err){state.agentPermissions=previous;browserPermissionsChecked=null;save();paintSettings($('#main'));toast(err.message || 'Could not save permission setting.');}
    return;
  }
  if(act==='import-memory'){$('#browser-memory-file')?.click();return;}
  if(act==='browser-reset-agent'){
    if(!window.confirm('Reset your agent’s name and appearance to the defaults? Your chats and memory will stay.'))return;
    state.agent={...state.agent,name:'Your agent',color:'lingon',pers:'Playful'};save();paintSide();paintCanvas();
    try{await persistAgentContext({...editableAgentDocuments(),identity:'# Identity\n\nName: Your agent\nStyle: Playful'});paintSettings($('#main'));toast('Agent profile reset.');}
    catch(err){toast(err.message || 'Could not save agent reset.');}
    return;
  }
  if (act === 'open-library'){ mobileNavOpen = false; state.view = 'library'; state.userMenuOpen = false; save(); renderApp(); refreshLibrary(); return; }
  if (act === 'system-file-view'){
    const key=b.dataset.key;
    if(!['identity','soul','user','agents'].includes(key))return;
    mobileNavOpen=false;state.view='library';state.libraryCat='system';state.systemFile=`system:${key}`;state.userMenuOpen=false;
    save();renderApp();refreshSystemFiles(true);return;
  }
  if (act === 'open-goals'){ mobileNavOpen = false; state.view = 'goals'; state.userMenuOpen = false; save(); renderApp(); refreshGoals(); return; }
  /* goals */
  const repaintGoals = repaintGoalViews;
  if (act === 'goal-start'){ mobileNavOpen = false; newChat({goal:true, category:b.dataset.c}); return; }
  if (act === 'goal-view'){
    state.view = 'goals'; state.goalFilter = 'all'; save(); renderApp(); refreshGoals();
    return;
  }
  if (act === 'goal-menu'){
    state.goalMenu = state.goalMenu === b.dataset.id ? null : b.dataset.id;
    paintGoals($('#main'));
    if (state.goalMenu) $('#main .goal-menu [role="menuitem"]')?.focus();
    else $('#main [data-act="goal-menu"][data-id="' + b.dataset.id + '"]')?.focus();
    return;
  }
  if (act === 'goal-del'){
    const id = b.dataset.id;
    const goal = (state.goals || []).find(g => g.id === id);
    if (!goal || !window.confirm(`Delete “${goal.title}”?`)) return;
    state.goals = (state.goals || []).filter(g => g.id !== id);
    state.goalMenu = null;
    save(); repaintGoals(); toast('Goal deleted.');
    saveGoalChange(id, null);
    return;
  }
  if (act === 'goal-done'){
    const g = (state.goals || []).find(x => x.id === b.dataset.id);
    if (!g) return;
    g.done = !g.done;
    if (g.done){ g.active = false; (g.subgoals || []).forEach(s => { s.done = true; }); }
    else g.active = true;
    save(); repaintGoals();
    saveGoalChange(g.id, { status:g.done ? 'done' : 'active' });
    return;
  }
  if (act === 'goal-active'){
    const g = (state.goals || []).find(x => x.id === b.dataset.id);
    if (!g || g.done) return;
    g.active = !g.active;
    state.goalMenu = null;
    save(); repaintGoals();
    saveGoalChange(g.id, { status:g.active ? 'active' : 'paused' });
    return;
  }
  if (act === 'goal-filter'){ state.goalFilter = b.dataset.f || 'all'; save(); repaintGoals(); return; }
  if (act === 'sub-add'){
    const g = (state.goals || []).find(x => x.id === b.dataset.id);
    if (!g || g.done) return;
    const inp = document.getElementById('sub-' + g.id);
    const title = String((inp && inp.value) || '').trim().slice(0, 120);
    if (!title){ toast('Write the step first.'); return; }
    if (!Array.isArray(g.subgoals)) g.subgoals = [];
    g.subgoals.push({ id: uid(), title, done: false });
    save(); repaintGoals();
    saveGoalChange(g.id, { addSteps:[title] });
    return;
  }
  // Steps are addressed by title too, so a step added a moment ago still matches.
  if (act === 'sub-done'){
    const g = (state.goals || []).find(x => x.id === b.dataset.id);
    const s = g && (g.subgoals || []).find(x => x.id === b.dataset.sub);
    if (!s) return;
    s.done = !s.done;
    if ((g.subgoals || []).length && (g.subgoals || []).every(x => x.done)) { g.done = true; g.active = false; }
    else if (g.done && !s.done) { g.done = false; g.active = true; }
    save(); repaintGoals();
    saveGoalChange(g.id, s.done ? { completeSteps:[s.title] } : { reopenSteps:[s.title] });
    return;
  }
  if (act === 'sub-del'){
    const g = (state.goals || []).find(x => x.id === b.dataset.id);
    const s = g && (g.subgoals || []).find(x => x.id === b.dataset.sub);
    if (!s) return;
    g.subgoals = (g.subgoals || []).filter(x => x.id !== s.id);
    save(); repaintGoals();
    saveGoalChange(g.id, { removeSteps:[s.title] });
    return;
  }
  if (act === 'theme'){ state.theme = b.dataset.v || 'grey'; save(); applyTheme(); if (state.view === 'settings' && $('#main')) paintSettings($('#main')); toast('Chat color: ' + ((THEMES.find(t => t.id === state.theme) || THEMES[0]).name)); return; }
  if (act === 'goto-secrets'){ state.view = 'settings'; state.settingsTab = 'secrets'; save(); renderApp(); return; }
  if (act === 'agentpanel'){
    state.canvasTab = 'canvas';
    state.canvasOpen = true; const app = $('#app'); if (app) app.classList.remove('nocanvas'); syncShellClasses();
    save(); paintCanvas(); return;
  }
  if (act === 'agent-edit'){
    state.agentEdit = !state.agentEdit;
    state.canvasOpen = true;
    const app = $('#app'); if (app) app.classList.remove('nocanvas'); syncShellClasses();
    save(); paintCanvas();
    return;
  }
  if (act === 'new-subagent'){
    state.subAgentComposer = !state.subAgentComposer;
    if (!state.subAgentComposer) { state.subAgentDraft = ''; state.subAgentDraftName = ''; }
    save(); paintCanvas(); return;
  }
  if (act === 'open-subagents'){
    state.canvasTab = 'subagents'; state.canvasOpen = true;
    const app = $('#app'); if (app) app.classList.remove('nocanvas'); syncShellClasses();
    save(); paintCanvas(); refreshSubAgents(); return;
  }
  if (act === 'create-subagent'){
    const name = (($('#subname') || {}).value || '').trim();
    const prompt = (($('#subprompt') || {}).value || '').trim();
    const type = (($('#subtrigger') || {}).value || 'schedule');
    let trigger;
    if (type === 'schedule') trigger = { type, intervalMinutes:Number((($('#subinterval') || {}).value) || 60) };
    if (type === 'app') {
      const _ae = String((($('#subappevent') || {}).value) || ''); const _ci = _ae.indexOf(':'); const app = _ci >= 0 ? _ae.slice(0, _ci) : _ae; const event = _ci >= 0 ? _ae.slice(_ci + 1) : '';
      const connectedAccountId = ($('#subappevent')?.selectedOptions?.[0]?.dataset.account) || '';
      trigger = { type, app, event, connectedAccountId };
    }
    if (type === 'subagent') trigger = { type, sourceAgentId:(($('#subsource') || {}).value) || '' };
    if (!name || !prompt){ toast('Name and automation task are required.'); return; }
    b.disabled = true;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents', { method:'POST', body:JSON.stringify({ name, prompt, trigger, enabled:true }) });
      state.subAgents.unshift(result.subAgent);
      state.subAgentComposer = false; state.subAgentDraft = ''; state.subAgentDraftName = ''; save(); paintCanvas();
      toast(`${result.subAgent.name} is watching for its trigger.`);
    } catch (err) { b.disabled = false; toast(err.message); }
    return;
  }
  if (act === 'toggle-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id), { method:'PATCH', body:JSON.stringify({ enabled:!agent.enabled }) });
      Object.assign(agent, result.subAgent); save(); paintCanvas();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'run-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    b.disabled = true; b.innerHTML = `${icon('refresh',12)} Running…`;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id) + '/run', { method:'POST', body:'{}' });
      subAgentsCheckedAt = 0;
      await refreshSubAgents(false);
      if (agent.systemKind) {
        save(); paintCanvas();
        toast(result.skipped ? (result.reason || `${agent.name} found no new signal.`) : result.status === 'running' ? `${agent.name} is running.` : result.status === 'waiting_approval' ? `${agent.name} needs your approval.` : `${agent.name} completed.`);
        return;
      }
      await syncFromBackend(true);
      state.activeChat = result.chatId || agent.chatId; state.view = 'chat'; save(); renderApp();
      toast(result.status === 'running' ? `${agent.name} is running.` : result.status === 'waiting_approval' ? `${agent.name} needs your approval.` : result.status === 'partial' ? `${agent.name} reached its work limit.` : `${agent.name} completed its run.`);
    } catch (err) { b.disabled = false; toast(err.message); }
    return;
  }
  if (act === 'open-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    await syncFromBackend(true);
    if (!state.chats.some((item) => item.id === agent.chatId)) state.chats.unshift({ id:agent.chatId, title:agent.name, messages:[], trace:[], artifact:null, source:'automation', subAgentId:agent.id, createdAt:Date.now() });
    state.activeChat = agent.chatId; state.view = 'chat'; save(); renderApp(); return;
  }
  if (act === 'delete-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    if (!window.confirm(`Delete ${agent.name}? Its automation chat will remain in history.`)) return;
    try {
      await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id), { method:'DELETE' });
      state.subAgents = state.subAgents.filter((item) => item.id !== agent.id); save(); paintCanvas(); toast('Sub-agent deleted.');
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'newchat'){ mobileNavOpen = false; newChat(); return; }
  if (act === 'openchat'){
    if (!signedIn()){ renderAuth(); return; }
    mobileNavOpen = false; state.activeChat = b.dataset.id; state.view = 'chat'; save(); renderApp(); return;
  }
  if (act === 'delchat'){
    e.stopPropagation();
    const deleting = state.chats.find(x => x.id === b.dataset.id);
    if (deleting){
      stopDelegatedTask(deleting);
      for (const m of deleting.messages || []) for (const file of m.files || []) {
        if (file.storageId) void storedFile('readwrite', store => store.delete(file.storageId)).catch(() => {});
      }
    }
    pendingFilesByForm.delete(`cform:${b.dataset.id}`);
    state.chats = state.chats.filter(x => x.id !== b.dataset.id);
    if (state.activeChat === b.dataset.id) state.activeChat = state.chats[0] ? state.chats[0].id : null;
    save(); renderApp(); return;
  }
  if (act === 'togglecanvas'){ setCanvasOpen(!canvasShouldShow()); return; }
  if (act === 'ctab'){
    const next = b.dataset.t === 'agent' || b.dataset.t === 'trace' || b.dataset.t === 'wallet' ? 'canvas' : b.dataset.t;
    state.canvasTab = ['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(next) ? next : 'canvas';
    if (next !== 'canvas') state._showLiveInCanvas = false;
    save(); paintCanvas();
    if (next === 'subagents') refreshSubAgents(true);
    if (next === 'mail') getMail(true, state.mailTab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
    if (next === 'payments') { refreshComposioApps(true); refreshShopPay(true); }
    return;
  }
  if (act === 'appr-toggle'){
    const item = b.closest('.appr-item');
    if (!item) return;
    const willOpen = !item.classList.contains('open');
    document.querySelectorAll('.appr-item.open').forEach(n => {
      if (n === item) return;
      n.classList.remove('open');
      const t = n.querySelector('[data-act="appr-toggle"]');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
    item.classList.toggle('open', willOpen);
    b.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    // Approvals, Automations and Payments share this row; each remembers its own open row.
    const openKey = { automation:'automationOpenId', payment:'paymentOpenId' }[b.dataset.key] || 'approvalOpenId';
    state[openKey] = willOpen ? (b.dataset.id || item.dataset.id) : null;
    return;
  }
  if (act === 'mtab'){
    state.mailTab = b.dataset.t || 'inbox';
    if (mailCache) mailCache.selected = null;
    if (state.mailTab === 'write' && mailCache) mailCache.compose = { to:'', subject:'', body:'' };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    if (state.mailTab !== 'write') getMail(true, state.mailTab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
    return;
  }
  if (act === 'm-refresh'){ getMail(true, state.mailTab === 'write' ? 'inbox' : state.mailTab).then(() => { if ($('#cbody')) paintMail($('#cbody')); }); return; }
  if (act === 'm-copy'){
    const addr = mailCache && mailCache.address;
    if (!addr){ toast('No address yet.'); return; }
    copyText(addr).then(() => toast('Copied ' + addr)).catch(() => toast('Could not copy'));
    return;
  }
  if (act === 'm-open'){
    openMailMessage(b.dataset.id).then(() => { if ($('#cbody')) paintMail($('#cbody')); }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'm-back'){
    if (mailCache) mailCache.selected = null;
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-reply'){
    const msg = mailCache && mailCache.selected;
    if (!msg) return;
    state.mailTab = 'write';
    mailCache.selected = null;
    mailCache.compose = {
      to: msg.direction === 'outbound' ? (msg.to || []).join(', ') : msg.from,
      subject: /^re:/i.test(msg.subject || '') ? msg.subject : 'Re: ' + (msg.subject || ''),
      body: '',
      inReplyTo: msg.messageId || msg.id,
    };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-edit-draft'){
    const draft = ((mailCache && mailCache.drafts) || []).find((d) => d.id === b.dataset.id);
    if (!draft) return;
    state.mailTab = 'write';
    mailCache.compose = { to: (draft.to || []).join(', '), subject: draft.subject, body: draft.bodyText, draftId: draft.id, inReplyTo: draft.inReplyTo };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-draft'){
    const to = (($('#m-to') || {}).value || '').trim();
    const subject = (($('#m-subject') || {}).value || '').trim();
    const bodyTxt = (($('#m-body') || {}).value || '').trim();
    const draftId = (($('#m-draft') || {}).value || '').trim();
    window.LingonAuth.api('/api/mail/drafts', { method:'POST', body: JSON.stringify({ id: draftId || undefined, to, subject, body: bodyTxt }) }).then((j) => {
      toast('Draft saved.');
      if (mailCache) mailCache.compose = Object.assign({}, mailCache.compose, { draftId: j.draft && j.draft.id });
    }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'm-send'){
    const to = (($('#m-to') || {}).value || '').trim();
    const subject = (($('#m-subject') || {}).value || '').trim();
    const bodyTxt = (($('#m-body') || {}).value || '').trim();
    const inReplyTo = (($('#m-reply') || {}).value || '').trim();
    const draftId = (($('#m-draft') || {}).value || '').trim();
    if (!to || !subject || !bodyTxt){ toast('To, subject and message are required.'); return; }
    if (!window.confirm('Send this email as ' + ((state.agent && state.agent.name) || 'your agent') + '?')) return;
    b.disabled = true;
    window.LingonAuth.api('/api/mail/send', { method:'POST', body: JSON.stringify({ to, subject, body: bodyTxt, inReplyTo: inReplyTo || undefined, draftId: draftId || undefined, agentName: (state.agent && state.agent.name) || '', confirm:true }) }).then((j) => {
      mailCache = j.mailbox || mailCache;
      state.mailTab = 'sent';
      save();
      if ($('#cbody')) paintMail($('#cbody'));
      toast('Sent from ' + ((mailCache && mailCache.address) || 'the agent mailbox') + '.');
    }).catch((err) => { b.disabled = false; toast(err.message); });
    return;
  }
  if (act === 'library-open' && c){
    state.activeChat = c.id; state.view = 'chat'; state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    c.canvasSelectedMessageId = m ? m.id : null;
    if (b.dataset.file !== undefined) c.canvasSelectedFileIndex = Number(b.dataset.file); else delete c.canvasSelectedFileIndex;
    save(); renderApp(); return;
  }
  if (act === 'library-upload-open'){
    const item = libraryItemById('upload:' + (b.dataset.upload || ''));
    if (!item) return;
    if (item.card?.dataUrl){
      const opened = window.open(item.card.dataUrl, '_blank', 'noopener');
      if (!opened) downloadLibraryItem(item);
    } else downloadLibraryItem(item);
    return;
  }
  if (act === 'lib-download'){ downloadLibraryItem(libraryItemById(b.dataset.id)); return; }
  if (act === 'library-item-open'){ libraryViewer = b.dataset.libId || null; paintLibrary($('#main')); return; }
  if (act === 'lib-viewer-close'){ libraryViewer = null; paintLibrary($('#main')); return; }
  if (act === 'lib-upload'){ $('#libupload')?.click(); return; }
  if (act === 'libcat'){
    state.libraryCat = b.dataset.cat || 'all'; state.librarySelect = false; state.librarySelected = [];
    if (state.libraryCat === 'system') state.systemFile = null;
    save(); paintLibrary($('#main')); $('#main .lib-main, #main .page').forEach(n => { n.scrollTop = 0; });
    return;
  }
  if (act === 'system-open'){
    state.systemFile = b.dataset.systemId || null; save(); paintLibrary($('#main'));
    if (state.systemFile === 'system:memory' && signedIn()) syncFromBackend(true).then(() => {
      if (state.view === 'library' && state.libraryCat === 'system' && state.systemFile === 'system:memory') paintLibrary($('#main'));
    }).catch(e => toast(e.message));
    return;
  }
  if (act === 'system-back'){
    state.systemFile = null;
    save(); paintLibrary($('#main')); return;
  }
  if (act === 'system-save'){
    const field = $('#system-editor-text');
    const key = field?.dataset.systemKey;
    if (!field || !['identity','soul','user','agents'].includes(key)) return;
    const documents = editableAgentDocuments(); documents[key] = field.value;
    b.disabled = true;
    try {
      await persistAgentContext(documents);
      state.systemFile = null; save(); paintLibrary($('#main')); toast(`${key.toUpperCase()}.md saved.`);
    } catch (error) { b.disabled = false; toast(error.message || 'Could not save that file.'); }
    return;
  }
  if (act === 'lib-select'){ state.librarySelect = true; state.librarySelected = []; save(); paintLibrary($('#main')); return; }
  if (act === 'lib-clear'){ state.librarySelect = false; state.librarySelected = []; save(); paintLibrary($('#main')); return; }
  if (act === 'lib-layout'){ state.libraryLayout = state.libraryLayout === 'list' ? 'grid' : 'list'; save(); paintLibrary($('#main')); return; }
  if (act === 'lib-pick'){
    const id = b.dataset.id;
    const sel = new Set(state.librarySelected || []);
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    state.librarySelected = [...sel]; save(); paintLibrary($('#main')); return;
  }
  if (act === 'lib-delete'){
    const ids = new Set(state.librarySelected || []);
    if (!ids.size){ toast('Select items first.'); state.librarySelect = false; state.librarySelected = []; save(); paintLibrary($('#main')); return; }
    if (!window.confirm(`Delete ${ids.size} selected item${ids.size > 1 ? 's' : ''}?`)) return;
    let removed = 0;
    ids.forEach(id => {
      if (String(id).startsWith('lib:')){
        const libId = String(id).slice(4);
        state.libraryServer = (state.libraryServer || []).filter(item => item.id !== libId);
        libraryContent.delete(libId);
        removed++;
        window.LingonAuth.api('/api/library/' + encodeURIComponent(libId), { method:'DELETE' })
          .catch(error => { toast(error.message || 'A file could not be deleted.'); refreshLibrary(); });
        return;
      }
      if (String(id).startsWith('upload:')){
        const before = state.libraryUploads.length;
        state.libraryUploads = state.libraryUploads.filter(item => 'upload:' + item.id !== id);
        if (state.libraryUploads.length !== before) removed++;
        return;
      }
      const parts = String(id).split(':');
      if (parts.length < 2) return;
      const chatId = parts[0], msgId = parts[1];
      const ch = state.chats.find(x => x.id === chatId);
      if (!ch) return;
      const fMatch = String(id).match(/:f(\d+)$/);
      if (msgId === 'a'){
        if (ch.artifact){ ch.artifact = null; removed++; }
        return;
      }
      const mi = (ch.messages || []).findIndex(mm => mm.id === msgId);
      if (mi < 0) return;
      const target = ch.messages[mi];
      if (fMatch && target.files && target.files[Number(fMatch[1])]){
        target.files.splice(Number(fMatch[1]), 1);
        if (!target.files.length && (!target.card || target.kind !== 'card')) ch.messages.splice(mi, 1);
        else if (!target.files.length && target.kind !== 'card' && !target.text) ch.messages.splice(mi, 1);
        removed++;
      } else {
        ch.messages.splice(mi, 1);
        removed++;
      }
    });
    state.librarySelect = false; state.librarySelected = []; save(); paintLibrary($('#main')); paintSide();
    toast(removed ? `Deleted ${removed} item${removed > 1 ? 's' : ''}.` : 'Nothing to delete.');
    return;
  }
  if (act === 'lib-create'){
    const prompt = window.prompt('What should your agent create?', 'Create an artifact for me.');
    if (prompt === null) return;
    const c2 = { id: uid(), title:'Create an artifact', messages:[], trace:[], artifact:null, createdAt:Date.now() };
    state.chats.unshift(c2); state.activeChat = c2.id; state.view = 'chat'; state.canvasOpen = false; save(); renderApp();
    setTimeout(() => { if ($('#cprompt')) { applyPromptText(String(prompt || 'Create an artifact for me.')); $('#cprompt').focus(); } }, 0);
    toast('Your request is ready for the agent. Send it when you’re ready.');
    return;
  }
  if (act === 'canvas-card' && c && m?.card){
    state.activeChat = c.id;
    c.canvasSelectedMessageId = m.card.type === 'artifact' && c.artifact?.title === m.card.title ? null : m.id;
    delete c.canvasSelectedFileIndex;
    state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    $('#app')?.classList.remove('nocanvas'); syncShellClasses(); save(); paintCanvas(); return;
  }
  if (act === 'canvas-upload' && c && m?.files?.[Number(b.dataset.i)]){
    state.activeChat = c.id; c.canvasSelectedMessageId = m.id; c.canvasSelectedFileIndex = Number(b.dataset.i);
    state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    $('#app')?.classList.remove('nocanvas'); syncShellClasses(); save(); paintCanvas(); return;
  }
  if (act === 'canvas-back'){
    const current = chat(); if (current) { current.canvasSelectedMessageId = null; delete current.canvasSelectedFileIndex; }
    state._showLiveInCanvas = false; liveClose(); save(); paintCanvas(); return;
  }
  if (act === 'viewcanvas'){ const current = chat(); if (current) { current.canvasSelectedMessageId = null; delete current.canvasSelectedFileIndex; } state._showLiveInCanvas = false; state.canvasOpen = true; state.canvasTab = 'canvas'; $('#app') && $('#app').classList.remove('nocanvas'); syncShellClasses(); paintCanvas(); return; }
  if (act === 'watchlive'){ state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = true; $('#app') && $('#app').classList.remove('nocanvas'); syncShellClasses(); save(); paintCanvas(); return; }
  if (act === 'takeover'){ liveTakeover(); return; }
  if (act === 'closestop-live'){
    const id = liveIdShown;
    if (id){ window.LingonAuth.api('/api/live/stop', { method: 'POST', body: JSON.stringify({ liveId: id }) }).catch(() => {}); }
    liveClose(); state._showLiveInCanvas = false; state.canvasTab = 'canvas'; save(); paintCanvas(); return;
  }
  if (act === 'openbrowser'){ toast('For safety, browsing stays contained in the sandbox window above.'); return; }
  if (act === 'artmenu'){ toast('Artifact saved — find it in Vault → Library.'); return; }
  if (act === 'replymsg' && c && m){
    const draft = ($('#cprompt') || {}).value || '';
    c.replyingTo = { id:m.id, role:m.role === 'user' ? 'user' : 'agent', text:String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 220) };
    save(); paintChat($('#main'));
    if ($('#cprompt')) { $('#cprompt').value = draft; $('#cprompt').focus(); }
    return;
  }
  if (act === 'cancelreply' && c){
    const draft = ($('#cprompt') || {}).value || '';
    c.replyingTo = null; save(); paintChat($('#main'));
    if ($('#cprompt')) { $('#cprompt').value = draft; $('#cprompt').focus(); }
    return;
  }
  if (act === 'copymsg' && m){
    try { await copyText(m.text); toast('Message copied'); } catch { toast('Could not copy message'); }
    return;
  }
  if (act === 'reactmsg' && c && m){
    const reaction = findReaction(b.dataset.reaction || b.dataset.emoji);
    if (!reaction) return;
    const reactions = new Set((Array.isArray(m.reactions) ? m.reactions : []).map((r) => findReaction(r)?.id).filter(Boolean));
    reactions.has(reaction.id) ? reactions.delete(reaction.id) : reactions.add(reaction.id);
    m.reactions = [...reactions]; save(); replaceNode(c, m); return;
  }
  if (act === 'copycode'){ const t = $('#codebox'); if (t) await copyText(t.textContent); toast('Copied'); return; }

  /* card resolutions (real accounts only — no anonymous approvals) */
  if (act === 'task-change-cancel' && c) {c.taskReply=null;c.taskReplyScope=null;save();paintMain();return;}
  if (['task-change','task-change-team'].includes(act) && m?.card?.taskId) {c.taskReply=m.card.taskId;c.taskReplyScope=act==='task-change-team'?'team':'task';save();paintMain();$('#cprompt')?.focus();return;}
  if (['task-stop','task-continue'].includes(act) && m?.card?.taskId) {
    b.disabled=true;
    try {await Engine.controlTask(makeRT(c),m.card.taskId,act==='task-stop'?'cancel':'continue');}catch(error){toast(error.message);}
    finally{b.disabled=false;}return;
  }
  if (act === 'voice') { toggleVoice(); return; }
  if (act === 'managed-stop') {
    // Stop means stop: the reply being written and every task working in this chat.
    const current = chat();
    b.disabled = true;
    const stops = [Engine.isRunning?.(current?.id) ? Engine.stop(makeRT(current)) : null,
      ...liveTaskIds(current).map((id) => Engine.controlTask(makeRT(current), id, 'cancel'))].filter(Boolean);
    const failed = (await Promise.allSettled(stops)).find((r) => r.status === 'rejected');
    if (failed) toast(failed.reason?.message || 'Could not stop everything. Try again.');
    b.disabled = false; syncComposerActions(current);
    return;
  }
  if (act === 'managed-resume') { await Engine.resume(makeRT(chat())); return; }
  if (m?.card?.managedCallId && ['save-secret','skip-secret'].includes(act)) {
    if (!signedIn()) { renderAuth(); return; }
    const allow = act === 'save-secret';
    b.disabled = true;
    try {
      // Save first so the agent's vault_request finds the name when it resumes.
      // A retry after a failed resume reuses the already-saved secret.
      if (allow && m.card.kind === 'login' && !m.card.ref) {
        const node = document.querySelector(`[data-mid="${m.id}"]`);
        const username = node?.querySelector('[data-f="username"]');
        const password = node?.querySelector('[data-f="password"]');
        if ((!m.card.usernameRef && !username?.value?.trim()) || !password?.value) { toast('Enter the username and password to save.'); return; }
        const saveField = async (name, value) => {
          const added = await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name,value})});
          if (!added?.secret?.ref) throw new Error('Could not save that credential.');
          state.vault.secrets = [{ ...added.secret, backend:true }, ...state.vault.secrets.filter(s => s.id !== added.secret.id)];
          return added.secret.ref;
        };
        if (!m.card.usernameRef) {
          m.card.usernameRef = await saveField(`${m.card.host} username`, username.value.trim());
          username.value = '';
          save();
        }
        m.card.ref = await saveField(`${m.card.host} password`, password.value);
        password.value = '';
        save();
      } else if (allow && !m.card.ref) {
        const input = document.querySelector(`[data-mid="${m.id}"] [data-f="val"]`);
        if (!input?.value) { toast('Enter the value to save.'); return; }
        const added = await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name:m.card.suggest,value:input.value})});
        if (!added?.secret?.ref) throw new Error('Could not save that secret.');
        input.value = '';
        state.vault.secrets = [{ ...added.secret, backend:true }, ...state.vault.secrets.filter(s => s.id !== added.secret.id)];
        m.card.ref = added.secret.ref;
      }
      if (m.card.taskId) await Engine.controlTask(makeRT(c), m.card.taskId, 'decide', { callId:m.card.managedCallId, allow, version:m.card.taskVersion });
      else await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow });
      m.card.status = allow ? 'saved' : 'skipped';
      replaceNode(c, m); save(); paintSide();
    } catch (err) { toast(err.message || 'Could not save that secret.'); }
    finally { b.disabled = false; }
    return;
  }
  if (act === 'cv-expand') { const card = b.closest('.acard'); if (card) { card.classList.toggle('cv-open'); b.textContent = card.classList.contains('cv-open') ? 'Show less' : 'Show all'; } return; }
  if (act === 'cv-connect') { if (!signedIn()) { renderAuth(); return; } connectComposioApp(b.dataset.tk, undefined, { fromChat: !!m }); return; }
  if (m?.card?.type === 'question' && !m.card.onboarding && !m.card.mascotColors && !m.card.customName && ['qopt','qpick','qsubmit','qskip'].includes(act)) {
    if (m.card.status !== 'pending') return;
    if (act === 'qpick') {
      const sel = new Set(m.card.multi ? (m.card.sel || []) : []);
      if (sel.has(b.dataset.o)) sel.delete(b.dataset.o); else sel.add(b.dataset.o);
      m.card.sel = [...sel]; replaceNode(c, m); save(); return;
    }
    if (act === 'qskip') {
      if (m.card.managedCallId) {
        if (!signedIn()) { renderAuth(); return; }
        b.disabled = true;
        try {
          if (m.card.taskId) await Engine.controlTask(makeRT(c), m.card.taskId, 'decide', { callId:m.card.managedCallId, allow:false, version:m.card.taskVersion });
          else await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow:false });
          m.card.status = 'skipped';
        } catch (error) { toast(error.message); }
        b.disabled = false;
      } else m.card.status = 'skipped';
      replaceNode(c, m); save(); return;
    }
    await answerQuestion(c, m, act === 'qsubmit' ? (m.card.sel || []).join(', ') : b.dataset.o, b);
    return;
  }
  if (m?.card?.managedCallId && ['managed-allow','managed-deny','qopt'].includes(act)) {
    if (!signedIn()) { renderAuth(); return; }
    b.disabled = true;
    const allow = act !== 'managed-deny';
    try {
      if(m.card.type === 'auth_handoff' && m.card.liveId){
        await window.LingonAuth.api('/api/live/takeover',{method:'POST',body:JSON.stringify({liveId:m.card.liveId,on:false})});
        liveControl = false;
      }
      if(m.card.taskId) await Engine.controlTask(makeRT(c),m.card.taskId,'decide',{callId:m.card.managedCallId,allow,version:m.card.taskVersion});
      else await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow, answer:act === 'qopt' ? b.dataset.o : undefined });
    }catch(error){toast(error.message);}
    b.disabled = false;
    replaceNode(c,m); save(); return;
  }
  if (act === 'approve' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:true }, 'approved'); return; }
  if (act === 'deny' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'always' && m){
    state.vault.approvals.push({ id: uid(), key: m.card.key, label: m.card.title, at: Date.now() });
    save(); resolveCard(c, m, { ok:true, always:true }, 'always'); return;
  }
  if (act === 'connect' && m){
    resolveCard(c, m, { ok:false }, 'denied');
    state.view = 'apps'; save(); renderApp(); refreshComposioApps();
    toast('Connect that app under Apps — secure OAuth, no tokens to paste.');
    return;
  }
  if (act === 'deny-connect' && m){ resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'skip-secret' && m){ resolveCard(c, m, { ok:false }, 'skipped'); return; }
  if (act === 'save-secret' && m){
    const node = document.querySelector(`[data-mid="${m.id}"]`);
    const name = (node.querySelector('[data-f="name"]').value || '').trim();
    const val = node.querySelector('[data-f="val"]').value;
    if (!name || !val){ toast('Give the secret a name and a value first.'); return; }
    if (!signedIn()){ renderAuth(); return; }
    try{
      const added=await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name,value:val})});
      const secret={...added.secret,backend:true};
      state.vault.secrets.unshift(secret);
      m.card.ref=secret.ref;m.card.nameVal=name;
      save();resolveCard(c,m,{ok:true},'saved');paintSide();return;
    }catch(err){toast(err.message || 'Could not save that secret.');return;}
  }
  if (act === 'qopt' && m){ if (!signedIn()){ renderAuth(); return; } m.card.choice = b.dataset.o; resolveCard(c, m, { choice: b.dataset.o }, 'answered'); return; }
  if (act === 'download' && m){
    if (m.card.managedArtifactId) { try { await Engine.download(c.id, m.card); } catch (err) { toast(err.message); } }
    else if (m.card.fromLibrary && m.card.libraryId) {
      // A Library file loads first; its data is a data: URL (images) or text.
      let got = libraryItemContent(m.card.libraryId);
      for (let i = 0; got?.loading && i < 100; i++) { await sleep(150); got = libraryContent.get(m.card.libraryId); }
      if (got?.error) toast(got.error);
      else if (String(got?.content || '').startsWith('data:')) downloadDataUrl(m.card.name, got.content);
      else dl(m.card.name, got?.content || '');
    }
    else dl(m.card.name, m.card.content);
    return;
  }

  /* vault / settings page */
  if (act === 'vtab'){ state.vaultTab = b.dataset.t; paintVault($('#main')); return; }
  const repaintSettings = () => {
    if (state.view === 'settings' && $('#main')) paintSettings($('#main'));
    else if ($('#main') && state.view === 'vault') paintVault($('#main'));
    if ($('#canvas')) paintCanvas();
  };
  if (act === 'reveal-credential'){
    const ids=JSON.parse(b.dataset.ids || '[]');
    const secrets=ids.map(id=>state.vault.secrets.find(s=>s.id===id)).filter(Boolean);
    if(!secrets.length)return;
    b.disabled=true;
    const initiallyRevealed=new Set(secrets.filter(s=>s.revealed).map(s=>s.id));
    try{
      if(secrets.every(s=>s.revealed)){
        secrets.forEach(s=>{s.revealed=false;if(s.backend)delete s.value;});
      }else{
        for(const s of secrets){
          if(s.revealed)continue;
          if(s.backend && signedIn()){
            const revealed=await window.LingonAuth.api('/api/secrets/'+encodeURIComponent(s.id)+'/reveal',{method:'POST'});
            s.value=revealed.value;
          }
          s.revealed=true;
        }
      }
      repaintSettings();
    }catch(err){
      secrets.filter(s=>!initiallyRevealed.has(s.id)).forEach(s=>{s.revealed=false;if(s.backend)delete s.value;});
      b.disabled=false;
      toast(err.message || 'Could not reveal that credential.');
    }
    return;
  }
  if (act === 'delete-credential'){
    const ids=JSON.parse(b.dataset.ids || '[]');
    const secrets=ids.map(id=>state.vault.secrets.find(s=>s.id===id)).filter(Boolean);
    if(!secrets.length || !window.confirm(`Delete “${b.dataset.name}”? Your agent will no longer be able to use it.`))return;
    b.disabled=true;
    try{
      for(const secret of secrets){
        if(secret.backend && signedIn())await window.LingonAuth.api('/api/secrets/'+encodeURIComponent(secret.id),{method:'DELETE'});
        state.vault.secrets=state.vault.secrets.filter(s=>s.id!==secret.id);
      }
      save();repaintSettings();paintSide();toast('Credential deleted');
    }catch(err){save();repaintSettings();toast(err.message || 'Could not delete that credential.');}
    return;
  }
  if (act === 'reveal'){
    const s=state.vault.secrets.find(x=>x.id===b.dataset.id);if(!s)return;
    try{
      if(s.backend && signedIn()){
        if(s.revealed){s.revealed=false;delete s.value;}
        else{const revealed=await window.LingonAuth.api('/api/secrets/'+encodeURIComponent(s.id)+'/reveal',{method:'POST'});s.value=revealed.value;s.revealed=true;}
      }else s.revealed=!s.revealed;
      repaintSettings();
    }catch(err){toast(err.message || 'Could not reveal that secret.');}
    return;
  }
  if (act === 'copysecret'){
    const s=state.vault.secrets.find(x=>x.id===b.dataset.id);if(!s?.revealed || !s.value)return;
    try{await navigator.clipboard.writeText(s.value);toast('Copied — clear your clipboard when you are done.');}
    catch{toast('Could not copy in this browser.');}
    return;
  }
  if (act === 'delsecret'){
    const secret=state.vault.secrets.find(x=>x.id===b.dataset.id);if(!secret)return;
    if(!window.confirm(`Delete “${secret.name}”? Your agent will no longer be able to use it.`))return;
    try{
      if(secret.backend && signedIn())await window.LingonAuth.api('/api/secrets/'+encodeURIComponent(secret.id),{method:'DELETE'});
      state.vault.secrets=state.vault.secrets.filter(x=>x.id!==secret.id);save();repaintSettings();paintSide();toast('Secret deleted');
    }catch(err){toast(err.message || 'Could not delete that secret.');}
    return;
  }
  if (act === 'vault-kind'){ state.vaultKind = b.dataset.k; save(); repaintSettings(); return; }
  if (act === 'save-merchant-card'){
    if (!signedIn()){ renderAuth(); return; }
    const form = b.closest('.vault-payment-form');
    if (!form) return;
    const data = {};
    form.querySelectorAll('[data-pm]').forEach(input => { data[input.dataset.pm] = input.value.trim(); });
    if (!data.merchant || !data.label || !data.brand || !/^\d{4}$/.test(data.last4 || '')){ toast('Enter the website, card name, brand and last four digits.'); return; }
    b.disabled = true;
    try {
      const added = await window.LingonAuth.api('/api/payment-methods',{method:'POST',body:JSON.stringify(data)});
      state.merchantPaymentMethods = [added.method,...(state.merchantPaymentMethods || [])];
      save(); repaintSettings(); toast('Masked card added for purchase approvals.');
    } catch(err){ toast(err.message || 'Could not add that card.'); b.disabled = false; }
    return;
  }
  if (act === 'delete-merchant-card'){
    const method = (state.merchantPaymentMethods || []).find(item=>item.id===b.dataset.id);
    if (!method || !window.confirm(`Remove “${method.label}” from purchase approvals?`)) return;
    b.disabled = true;
    try {
      await window.LingonAuth.api('/api/payment-methods/'+encodeURIComponent(method.id),{method:'DELETE'});
      state.merchantPaymentMethods = state.merchantPaymentMethods.filter(item=>item.id!==method.id);
      save(); repaintSettings(); toast('Masked card removed.');
    } catch(err){ toast(err.message || 'Could not remove that card.'); b.disabled = false; }
    return;
  }
  if (act === 'addsecret'){
    // Secrets live only in the encrypted server vault the agent reads from,
    // never in this browser's storage.
    if (!signedIn()){ renderAuth(); return; }
    const form = b.closest('.vault-add-form');
    if (!form) return;
    const fields = {};
    form.querySelectorAll('[data-vf]').forEach(input => { fields[input.dataset.vf] = input.value; });
    const { entries, error } = vaultKindEntries(form.dataset.kind, fields);
    if (error){ toast(error); return; }
    b.disabled = true;
    const saved = [];
    try{
      for (const [name, value] of entries){
        const added = await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name,value})});
        saved.push({ ...added.secret, backend:true });
      }
      form.querySelectorAll('[data-vf]').forEach(input => { input.value = ''; });
      toast(saved.length > 1 ? `Saved ${saved.length} items — your agent only sees their refs` : `Saved — your agent only sees ${saved[0].ref}`);
    }catch(err){toast(err.message || 'Could not save that secret.');}
    finally{
      if (saved.length){ state.vault.secrets = [...saved.reverse(), ...state.vault.secrets]; save(); repaintSettings(); paintSide(); }
      else b.disabled = false;
    }
    return;
  }
  if (act === 'toggleapp'){
    state.view = 'apps'; save(); renderApp(); refreshComposioApps();
    return;
  }
  if (act === 'signin'){ doAuth('signin'); return; }
  if (act === 'signup'){ doAuth('signup'); return; }
  if (act === 'pw-go'){ doAuth(authMode === 'signup' ? 'signup' : 'signin'); return; }
  if (act === 'google'){ authOAuth(); return; }
  if (act === 'pw-mode'){ const em = ((document.getElementById('aemail') || {}).value || '').trim(); const pe = document.getElementById('pwemail'); if (pe) pe.textContent = em; showAuthPane('authpw'); return; }
  if (act === 'auth-back'){ showAuthPane('authmain'); return; }
  if (act === 'auth-mode'){ authMode = authMode === 'signin' ? 'signup' : 'signin'; authPaintMode(); return; }
  if (act === 'otp-send'){ authOtpSend(); return; }
  if (act === 'otp-verify'){ authOtpVerify(); return; }
  if (act === 'signout'){
    stopWorkspacePresence();
    closeGift();
    giftCache = null;
    window.LingonAuth.set(null);
    state.view = 'chat';
    render();
    return;
  }
  if (act === 'billing-refresh'){
    invalidateBilling(); paintSide();
    if (state.view === 'settings') paintSettings($('#main')); else paintBilling($('#main'));
    return;
  }
  if (act === 'opengift'){ openGift(); return; }
  if (act === 'closegift'){ closeGift(); return; }
  if (act === 'gift-copy-code'){
    const code = (giftCache && giftCache.code) || (($('#giftcode-text') || {}).textContent || '').trim();
    if (!code){ toast('Your code isn’t ready yet.'); return; }
    copyText(code).then(() => toast('Invite code copied — share it with a friend.')).catch(() => toast(code));
    return;
  }
  if (act === 'gift-copy-link'){
    const link = giftCache && giftCache.link;
    if (!link){ toast('Invite link isn’t ready yet.'); return; }
    copyText(link).then(() => toast('Invite link copied.')).catch(() => toast(link));
    return;
  }
  if (act === 'gift-share'){
    const message = giftShareMessage();
    if (navigator.share){ navigator.share({ title: 'Belna invite', text: message }).catch(() => {}); return; }
    copyText(message).then(() => toast('Invite copied — send it to a friend.')).catch(() => toast(message));
    return;
  }
  if (act === 'gift-share-sms'){
    if (!giftCache || !giftCache.code){ toast('Your invite isn’t ready yet.'); return; }
    window.location.href = 'sms:?&body=' + encodeURIComponent(giftShareMessage());
    return;
  }
  if (act === 'gift-share-whatsapp'){
    if (!giftCache || !giftCache.code){ toast('Your invite isn’t ready yet.'); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(giftShareMessage()), '_blank', 'noopener,noreferrer');
    return;
  }
  if (act === 'gift-redeem'){
    const code = (($('#giftfriendcode') || {}).value || '').trim();
    if (!code){ toast('Paste your friend’s code first.'); return; }
    const owner = billingIdentity();
    b.disabled = true;
    window.LingonAuth.api('/api/referrals/redeem', { method: 'POST', body: JSON.stringify({ code }) }).then((j) => {
      if (owner !== billingIdentity()) return;
      giftCache = null; invalidateBilling();
      setBillingCache(j.billing);
      paintSide();
      toast(`+${fmtTokens(j.tokens || 10000000)} tokens for you — your friend got +${fmtTokens(j.inviterTokens || 10000000)} too.`);
      openGift();
    }).catch((e) => { b.disabled = false; toast(e.message); });
    return;
  }
  if (act === 'copy-gift'){
    try { await navigator.clipboard.writeText(b.dataset.code || ''); toast('Gift code copied.'); }
    catch { toast('Could not copy in this browser.'); }
    return;
  }
  if (act === 'redeem'){
    const code = (($('#giftcode') || {}).value || '').trim();
    if (!code){ toast('Paste a gift code first.'); return; }
    const owner = billingIdentity();
    try {
      const j = await window.LingonAuth.api('/api/billing/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      if (owner !== billingIdentity()) return;
      setBillingCache(j.billing);
      toast(`Redeemed ${fmtTokens(j.tokens)} tokens ($${j.amount} gift).`);
      if (state.view === 'settings') paintSettings($('#main')); else paintBilling($('#main'));
      paintSide();
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'buycredits'){
    try {
      const pack = Number(($('#buypack') || {}).value || 0);
      if (!pack){ toast('Pick a token pack.'); return; }
      const j = await window.LingonAuth.api('/api/billing/tokens', { method: 'POST', body: JSON.stringify({ packTokens: pack }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Checkout started.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'checkout'){
    try {
      const plan = b.dataset.p;
      const j = await window.LingonAuth.api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Checkout started.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'portal'){
    try {
      const j = await window.LingonAuth.api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}) });
      if (j.url) { window.location.href = j.url; return; }
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'upgrade'){
    try {
      const plan = b.dataset.p;
      const j = await window.LingonAuth.api('/api/billing/upgrade', { method: 'POST', body: JSON.stringify({ plan }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Request recorded.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'revoke'){ state.vault.approvals = state.vault.approvals.filter(x => x.id !== b.dataset.id); save(); repaintSettings(); toast('Revoked — it will ask again'); return; }
  if (act === 'pmode'){ state.vault.mode = b.dataset.m; save(); repaintSettings(); return; }
  if (act === 'dlfile'){ const f = window.__fileRows && window.__fileRows[+b.dataset.i]; if (f) dl(f.name, f.content); return; }

  /* profile / appearance (shared by Settings + right slider) */
  if (act === 'p-color'){ state.agent.color = b.dataset.c; save();persistAgentContext().catch(()=>{}); paintSide(); paintCanvas(); if (state.view === 'chat') paintMain(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
  if (act === 'p-pers'){ state.agent.pers = b.dataset.p; save();persistAgentContext().catch(()=>{}); paintSide(); paintCanvas(); if (state.view === 'chat') paintMain(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
  if (act === 'reset'){
    if (confirm('Release this agent? This deletes the claim, chats, vault and memory on this device.')){
      localStorage.removeItem(LS); location.reload();
    }
    return;
  }
});

function dl(name, content){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content || ''], { type:'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Downloading ' + name);
}

function handleBillingReturn(flag, q){
  const sid = q && q.get('session_id');
  if (flag === 'cancelled') { setTimeout(() => toast('Checkout cancelled — no charge made.'), 800); return; }
  if (flag === 'portal') { setTimeout(() => toast('Subscription updated.'), 800); return; }
  if ((flag === 'gift' || flag === 'credits' || flag === 'tokens' || flag === 'success') && sid && window.LingonAuth.signedIn()) {
    const owner = billingIdentity();
    window.LingonAuth.api('/api/billing/checkout-result?session_id=' + encodeURIComponent(sid)).then((j) => {
      if (owner !== billingIdentity()) return;
      if (j.billing) { setBillingCache(j.billing); if ($('#side')) paintSide(); }
      if (j.gift && j.gift.code) toast('Gift card ready: ' + j.gift.code + ' — redeem or share it.');
      else if (j.kind === 'tokens') toast('Tokens added. See Billing.');
      else if (j.kind === 'credits') toast('Credits added. See Billing.');
      else if (j.ok) toast('Payment complete — your tokens are on the way. See Billing.');
      else toast('Payment is still processing. Your tokens will appear once it clears.');
    }).catch((e) => toast(e.message || 'Payment complete. See Billing.'));
    return;
  }
  if (flag === 'success') setTimeout(() => toast('Payment complete — your monthly tokens are on the way. See Billing.'), 800);
}

/* ---------------- boot (OAuth hash callback first) ---------------- */
async function bootHash(){
  // returns 'error' | 'google' | 'none' so boot can route correctly
  try {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('auth_error');
    if (err){ window.history.replaceState(null, '', window.location.pathname); return 'error:' + err; }
    const h = window.location.hash || '';
    const m = h.match(/access_token=([^&]+)/);
    if (m){
      const r = h.match(/refresh_token=([^&]+)/);
      const access_token = decodeURIComponent(m[1]);
      const refresh_token = r ? decodeURIComponent(r[1]) : '';
      window.history.replaceState(null, '', window.location.pathname);
      window.LingonAuth.set({ access_token, refresh_token, user: null });
      try {
        const me = await window.LingonAuth.api('/api/auth/me');
        window.LingonAuth.set({ access_token, refresh_token, user: me.user });
        try { window.LingonConfig.userId = me.user.id; localStorage.setItem('belna.lastProvider', 'google'); } catch {}
        // Scope persisted state before the background sync can merge remote data.
        try { ensureOwnerScope(); if (me.user && me.user.id) { state.ownerId = me.user.id; state.view = 'chat'; save(); } } catch {}
        const owner = billingIdentity();
        syncFromBackend(true).then(() => {
          if (owner === billingIdentity() && $('#side')) paintSide();
        }).catch(() => {});
        setTimeout(() => toast('Signed in as ' + me.user.email), 400);
        return 'google';
      } catch {
        window.LingonAuth.set(null);
        return 'error:Could not complete sign-in. Please try again.';
      }
    }
  } catch {}
  return 'none';
}
const bootReady = hydrateStoredFiles().then(() => bootHash()).then((st) => {
  expirePending();
  applyTheme();
  // Navigation can remove the React host while the scripts/auth are loading.
  // A later mount will attach the already initialized app to its new host.
  root = document.getElementById('root');
  if (!root) return;
  if (st && String(st).startsWith('error:')) {
    const msg = String(st).slice(6);
    // Land on the auth card so the failure is visible in context.
    renderAuth();
    const m = document.getElementById('amsg');
    if (m) m.textContent = 'Sign-in failed: ' + msg;
    else setTimeout(() => toast('Sign-in failed: ' + msg), 400);
    return;
  }
  if (signedIn() && state.pendingPrompt && !needsOnboarding()) {
    void landingRun(state.pendingPrompt, state.pendingPromptFiles || []).catch(error => { console.error(error); render(); });
  } else render();
  try {
    // Referral gift link (?ref= / ?gift=) auto-opens the gift popup.
    // A pre-sign-in visit stashes the code, then opens it after login.
    try {
      const pending = sessionStorage.getItem('belna.pendingGift');
      if (pending && signedIn() && !needsOnboarding()){
        sessionStorage.removeItem('belna.pendingGift');
        setTimeout(() => openGift(pending), 800);
      } else giftAutoOpenFromUrl();
    } catch { giftAutoOpenFromUrl(); }
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected_app')) { handleConnectedAppReturn(); return; }
    const f = q.get('billing');
    const shop = q.get('shop_pay');
    if (f || shop) {
      const msg = q.get('shop_pay_msg');
      window.history.replaceState(null, '', window.location.pathname);
      if (f) handleBillingReturn(f, q);
      if (shop) {
        state.canvasOpen = true;
        state.canvasTab = 'payments';
        save();
        if ($('#app')) { const app = $('#app'); app.classList.remove('nocanvas'); syncShellClasses(); }
        paintCanvas();
        refreshShopPay(true);
        setTimeout(() => toast(shop === 'connected' ? 'Shop Pay connected. Purchases still need your approval.' : ('Shop Pay: ' + (msg || 'could not connect.'))), 400);
      }
    }
  } catch {}
});
window.LingonAppRuntime = {
  async mount(element){
    await bootReady;
    if (root === element && root.childElementCount) return;
    root = element;
    render();
  },
};
})();
