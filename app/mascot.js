/* ============ Lingon mascot — a soft 3D star, recolorable, animated ============
   The body is a Blender render (design/mascot/build_mascot.py → mascot/*.webp,
   one ~10 KB sprite per palette colour). Eyes, mouth and blush stay SVG on top
   so moods, blinking and CSS animations keep working at any size. */
window.Mascot = (() => {

  const ASSET = '/lingon/mascot/';

  const PALETTE = {
    lingon:   { name:'Belna blue', body:'#4A7FD4', dark:'#2E5BA8', glow:'#B8D4F7', blush:'#FF8FB0' },
    blueberry:{ name:'Sky',         body:'#B7D6FF', dark:'#7EA6DB', glow:'#E2EEFF', blush:'#FF8FB0' },
    moss:     { name:'Pistachio',   body:'#D8F3B0', dark:'#9BC468', glow:'#EEF9DF', blush:'#FF8FA0' },
    sun:      { name:'Apricot',     body:'#FFE0A3', dark:'#E3B25A', glow:'#FFF1D6', blush:'#FF7F8E' },
    rose:     { name:'Orchid',      body:'#E8B5F4', dark:'#BF7FD3', glow:'#F6E2FB', blush:'#FF8FC0' },
  };

  const sprite = (color, view = '') => `${ASSET}star-${PALETTE[color] ? color : 'lingon'}${view}.webp`;
  let uid = 0;

  /* face geometry in the 120×120 viewBox, measured from the front render */
  const EL = 49.6, ER = 70.4, EY = 63.5;

  function eyes(mood, ink){
    if (mood === 'happy') return `
      <path d="M${EL - 4} ${EY + 1} q4 -5.2 8 0" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M${ER - 4} ${EY + 1} q4 -5.2 8 0" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    const y = mood === 'think' ? EY - 2 : EY;
    const dx = mood === 'think' ? .8 : 0;
    const r = mood === 'wow' ? 1.18 : 1;
    const eye = x => `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="${3.1 * r}" ry="${3.8 * r}" fill="${ink}"/>`
      + `<circle cx="${x + 1.1 + dx}" cy="${y - 1.5}" r="${1.15 * r}" fill="#fff"/></g>`;
    return eye(EL) + eye(ER);
  }

  function mouth(mood, ink){
    if (mood === 'happy') return `<path d="M55.4 68.6 q4.6 6.4 9.2 0" stroke="${ink}" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (mood === 'think') return `<circle cx="61.4" cy="70" r="1.9" fill="${ink}"/>`;
    if (mood === 'wow')   return `<ellipse cx="60" cy="70.4" rx="2.8" ry="3.5" fill="${ink}"/>`;
    return `<path d="M56.6 68.8 q3.4 3.6 6.8 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }

  function spark(x, y, s, fill){
    return `<path d="M${x} ${y - s} L${x + s * 0.32} ${y - s * 0.32} L${x + s} ${y} L${x + s * 0.32} ${y + s * 0.32} L${x} ${y + s} L${x - s * 0.32} ${y + s * 0.32} L${x - s} ${y} L${x - s * 0.32} ${y - s * 0.32} Z" fill="${fill}"/>`;
  }

  /* soft-edged cheek blush; ids are per-instance so colours never cross-talk */
  function blush(cx, cy, rx, ry, fill){
    const id = `mblush${++uid}`;
    return `<radialGradient id="${id}"><stop offset="0" stop-color="${fill}" stop-opacity=".78"/><stop offset=".6" stop-color="${fill}" stop-opacity=".5"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient>`
      + cx.map(x => `<ellipse cx="${x}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id})"/>`).join('');
  }

  /* Accessories the owner can dress the star in (Edit in the agent panel).
     Drawn as SVG over the body in the 120×120 face frame, so they fit every
     colour without new renders. One item per slot: eyes, head, neck. */
  const OUTFITS = {
    glasses:    { name:'Glasses',    slot:'eyes' },
    shades:     { name:'Shades',     slot:'eyes' },
    headphones: { name:'Headphones', slot:'head' },
    partyhat:   { name:'Party hat',  slot:'head' },
    flower:     { name:'Flower',     slot:'head' },
    bowtie:     { name:'Bow tie',    slot:'neck' },
  };
  /* keeps known items, at most one per slot (the last one picked wins) */
  function cleanOutfit(list){
    const bySlot = {};
    (Array.isArray(list) ? list : []).forEach(k => { if (OUTFITS[k]) bySlot[OUTFITS[k].slot] = k; });
    return Object.values(bySlot);
  }
  let worn = [];
  function wear(list){ worn = cleanOutfit(list); return worn; }

  /* front-view drawings; `back` items sit behind the face, the rest on top */
  function accessory(key){
    const id = `macc${++uid}`;
    switch (key) {
      case 'glasses': return `
        <g class="macc macc-glasses" stroke="#23252E" stroke-width="1.9" fill="#fff" fill-opacity=".16">
          <circle cx="${EL}" cy="${EY}" r="7"/><circle cx="${ER}" cy="${EY}" r="7"/>
          <path d="M${EL + 7} ${EY - 1} q${(ER - EL - 14) / 2} -2.6 ${ER - EL - 14} 0" fill="none"/>
          <path d="M${EL - 7} ${EY - 1.5} l-6 -2.2 M${ER + 7} ${EY - 1.5} l6 -2.2" fill="none" stroke-linecap="round"/>
        </g>`;
      case 'shades': return `
        <g class="macc macc-shades">
          <path d="M${EL - 8.2} ${EY - 4.6} h16.4 q.6 9.4 -8.2 9.8 q-8.8 -.4 -8.2 -9.8z M${ER - 8.2} ${EY - 4.6} h16.4 q.6 9.4 -8.2 9.8 q-8.8 -.4 -8.2 -9.8z" fill="#1E2029"/>
          <path d="M${EL - 9.4} ${EY - 4.8} H${ER + 9.4}" stroke="#1E2029" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M${EL - 5.2} ${EY - 2.2} l3.4 0 M${ER - 5.2} ${EY - 2.2} l3.4 0" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
        </g>`;
      case 'headphones': return `
        <g class="macc macc-headphones">
          <path d="M37.5 47 C35 18 85 18 82.5 47" stroke="#E9ECF3" stroke-width="4.6" fill="none" stroke-linecap="round"/>
          <path d="M37.5 47 C35 18 85 18 82.5 47" stroke="#C4C9D6" stroke-width="1.4" fill="none" stroke-linecap="round" transform="translate(0 1.6)"/>
          <ellipse cx="37" cy="48.5" rx="6.6" ry="7.6" fill="#F4F5F9" stroke="#C4C9D6" stroke-width="1"/><ellipse cx="37" cy="48.5" rx="3.4" ry="4" fill="#F07B6A"/>
          <ellipse cx="83" cy="48.5" rx="6.6" ry="7.6" fill="#F4F5F9" stroke="#C4C9D6" stroke-width="1"/><ellipse cx="83" cy="48.5" rx="3.4" ry="4" fill="#F07B6A"/>
        </g>`;
      case 'partyhat': return `
        <g class="macc macc-partyhat" transform="rotate(8 58.6 24)">
          <defs><clipPath id="${id}"><path d="M58.6 3.6 L67.4 24 Q58.6 27.4 49.8 24 Z"/></clipPath></defs>
          <path d="M58.6 3.6 L67.4 24 Q58.6 27.4 49.8 24 Z" fill="#FFC94D"/>
          <g clip-path="url(#${id})" stroke="#F0717D" stroke-width="2.8"><path d="M46 14 L72 6 M46 21.5 L72 13.5 M46 29 L72 21"/></g>
          <path d="M49.8 24 Q58.6 27.4 67.4 24" stroke="#E2A82F" stroke-width="1.3" fill="none"/>
          <circle cx="58.6" cy="3.4" r="2.9" fill="#F0717D"/>
        </g>`;
      case 'flower': return `
        <g class="macc macc-flower" transform="translate(70 30) rotate(14)">
          ${[0, 72, 144, 216, 288].map(r => `<ellipse cx="0" cy="-5.2" rx="3.6" ry="5" fill="#fff" stroke="#E6E1EA" stroke-width=".8" transform="rotate(${r})"/>`).join('')}
          <circle r="3.3" fill="#FFC94D" stroke="#E7A93A" stroke-width=".8"/>
        </g>`;
      case 'bowtie': return `
        <g class="macc macc-bowtie">
          <path d="M60 82.5 L49 76.5 Q46.6 82.5 49 88.5 Z M60 82.5 L71 76.5 Q73.4 82.5 71 88.5 Z" fill="#E5484D" stroke="#B9343A" stroke-width="1" stroke-linejoin="round"/>
          <rect x="56.8" y="79.2" width="6.4" height="6.6" rx="2.2" fill="#C93C41"/>
          <path d="M51 79.4 q-1 3 0 6" stroke="#fff" stroke-opacity=".4" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        </g>`;
    }
    return '';
  }
  /* head items go under the face, eye and neck items over it */
  const outfitLayer = (list, slots) => list.filter(k => slots.includes(OUTFITS[k].slot)).map(accessory).join('');

  /**
   * svg(colorKey, mood, size, extraClass)
   * moods: idle | happy | think | wave | wow
   * prop (optional): a held item rendered with the body, carried by the star's
   * own side points — schedule (lingon), school (blueberry), football (moss),
   * bag (rose); see HELPERS in build_mascot.py. Those sprites use a taller
   * frame (HELPER_ORTHO) so the big item fits under the face: the viewBox
   * widens to match while the face keeps its coordinates.
   */
  function svg(color = 'lingon', mood = 'idle', size = 64, extra = '', prop = '', outfit = worn){
    const c = PALETTE[color] || PALETTE.lingon;
    const ink = '#1A1B22';
    const waveSpark = mood === 'wave' ? spark(104, 22, 7, c.dark) + spark(112, 37, 4.5, c.body) : '';
    const [x, y, w] = prop ? [-10.9, 0, 141.8] : [0, 0, 120];
    return `
<svg class="mascot ${extra}" width="${size}" height="${size}" viewBox="${x} ${y} ${w} ${w}" fill="none" aria-hidden="true">
  <ellipse class="mascot-shadow" cx="60" cy="${prop ? 136 : 104}" rx="${prop ? 36 : 30}" ry="4.6" fill="#1B2A4A" opacity=".09"/>
  ${waveSpark}
  <image class="mascot-body" href="${sprite(color, prop ? `-${prop}` : '')}" x="${x}" y="${y}" width="${w}" height="${w}"/>
  ${outfitLayer(outfit, ['head'])}
  ${blush([41.5, 78.5], 70.2, 6.4, 4.2, c.blush)}
  <g class="eyes">${eyes(mood, ink)}</g>
  ${mouth(mood, ink)}
  ${outfitLayer(outfit, ['eyes', 'neck'])}
</svg>`;
  }

  function logo(size = 26){
    const w = size;
    const h = +(size * 128.72 / 200).toFixed(2);
    return `
<svg class="belna-mark" width="${w}" height="${h}" viewBox="0 0 200 128.72" fill="#4A7FD4" aria-hidden="true">
  <polygon points="100 0 126.9 68.556872 100 95.44588 73.1 68.556872"/>
  <polygon points="0 99.992568 68.56 73.11296 95.46 99.992568 68.56 126.892176"/>
  <polygon points="200 99.992568 131.44 73.11296 104.54 99.992568 131.44 126.892176"/>
  <polygon points="100 104.546384 124.18 128.72 75.82 128.72"/>
</svg>`;
  }

  /**
   * loop() — 4-scene auto-loop mascot (mail → phone → laptop → wallet).
   * The body is the hold pose (star-lingon-hold): its own side arms bend
   * forward and the tips grip each Blender-rendered prop (mascot/prop-*.webp,
   * same frame; the arm tips are already cut out of the prop). Props swap on
   * a little squash-and-hop while the eyes are mid-blink. Pure CSS: 16s loop,
   * no JS timers. Keyframes live in styles.css scoped under .mhold.
   */
  function loop(){
    const at = 'x="40" y="29.5" width="240" height="240"';
    const layer = name => `<image href="${ASSET}${name}.webp" ${at}/>`;
    const ink = '#1A1B22';
    return `
<span class="mloop-stage" aria-hidden="true">
  <span class="mloop-halo"></span>
  <span class="mloop-wrap">
    <svg viewBox="0 0 320 320" role="img" aria-label="Star mascot cycling through mail, phone, laptop and wallet tasks">
      <ellipse cx="160" cy="238" rx="64" ry="8" fill="#1B2A4A" opacity=".08"/>
      <g class="body-star">
        <image href="${sprite('lingon', '-hold')}" ${at}/>
        <g class="scene scene-mail">${layer('prop-mail')}</g>
        <g class="scene scene-phone">${layer('prop-phone')}</g>
        <g class="scene scene-laptop">${layer('prop-laptop')}</g>
        <g class="scene scene-wallet">${layer('prop-wallet')}</g>
        <g transform="translate(40 29.5) scale(2)">
          ${blush([41.5, 78.5], 70.2, 6.4, 4.2, PALETTE.lingon.blush)}
          <g class="face face-happy"><g class="eyes">${eyes('happy', ink)}</g>${mouth('happy', ink)}</g>
          <g class="face face-talk"><g class="eyes">${eyes('idle', ink)}</g><ellipse class="mouth-talk" cx="60" cy="70.2" rx="2.5" ry="2.9" fill="${ink}"/></g>
          <g class="face face-focus"><g transform="translate(0 1)"><g class="eyes">${eyes('idle', ink)}</g></g><path d="M57.2 69.8 q2.8 1.4 5.6 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/></g>
        </g>
      </g>
      <path class="spark" d="M216 170 l2.6 6 6 2.6-6 2.6-2.6 6-2.6-6-6-2.6 6-2.6z" fill="var(--dark)"/>
      <path class="spark s2" d="M102 186 l2 4.4 4.4 2-4.4 2-2 4.4-2-4.4-4.4-2 4.4-2z" fill="var(--body)"/>
    </svg>
  </span>
</span>`;
  }

  /* 3/4 laptop pose used by the landing-page comparison section: the hold
     pose typing (star-lingon-laptop.webp, 640px render shown in a 500 box).
     FACE maps the front-view face onto it; anchors come from project_face()
     in build_mascot.py (eyes 304.9,351 / 391.9,342.5, mouth 351.4,375.5). */
  function laptop(){
    const c = PALETTE.lingon;
    const ink = '#1A1B22';
    const face = 'translate(272.2 270.9) rotate(-5.5) scale(3.28 3.7) translate(-60 -63.5)';
    return `
<svg class="mascot-laptop" viewBox="0 0 500 500" fill="none" role="img" aria-label="Belna agent working on a laptop">
  <defs>
    <filter id="work-floor-shadow" x="30" y="340" width="440" height="120" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>
  <ellipse cx="262" cy="410" rx="160" ry="22" fill="#15284B" opacity=".12" filter="url(#work-floor-shadow)"/>
  <ellipse cx="258" cy="404" rx="124" ry="15" fill="#15284B" opacity=".09"/>
  <g class="work-body">
    <image href="${sprite('lingon', '-laptop')}" x="0" y="0" width="500" height="500"/>
    <g transform="${face}">
      ${blush([41.5, 78.5], 70.2, 6.4, 4.2, c.blush)}
      <g class="work-brows" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" fill="none">
        <path d="M45.4 57.2 q4.4 .6 8.2 2.6"/><path d="M66.4 59.8 q3.8 -2 8.2 -2.6"/>
      </g>
      <g class="eye-blink">${eyes('idle', ink)}</g>
      <path d="M57.2 69.6 q2.8 1.6 5.6 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;
  }

  /* Chat-header "working" pose: the laptop pose wearing headphones, one
     sprite per colour (star-<colour>-desk.webp, 320px render in the same
     500 box as laptop(), so the face transform is shared). The viewBox crops
     to the figure so it fills the round header badge. */
  /* the desk pose's head tip sits lower and further left than the front view's */
  const DESK_HEAD = { partyhat:'translate(-2 7)', flower:'translate(-7 -1)' };
  function desk(color = 'lingon', outfit = worn){
    const c = PALETTE[color] || PALETTE.lingon;
    const extras = outfit.filter(k => k !== 'headphones');   // the pose wears its own
    const ink = '#1A1B22';
    const face = 'translate(272.2 270.9) rotate(-5.5) scale(3.28 3.7) translate(-60 -63.5)';
    const note = (x, y, cls) => `<g transform="translate(${x} ${y}) scale(1.5)"><g class="mdesk-note ${cls}"><path d="M0 0v-26l18 -6v25" stroke="${c.dark}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="-5" cy="1" rx="7" ry="5.4" fill="${c.dark}"/><ellipse cx="13" cy="-5" rx="7" ry="5.4" fill="${c.dark}"/></g></g>`;
    return `
<svg class="mascot-desk" viewBox="80 30 380 380" fill="none" aria-hidden="true">
  <ellipse cx="262" cy="408" rx="130" ry="14" fill="#15284B" opacity=".1"/>
  <g class="mdesk-body">
    <image href="${sprite(color, '-desk')}" x="0" y="0" width="500" height="500"/>
    <g transform="${face}">
      ${blush([41.5, 78.5], 70.2, 6.4, 4.2, c.blush)}
      <g class="mdesk-eyes"><g class="eye-blink">${eyes('idle', ink)}</g></g>
      <path class="mdesk-mouth" d="M57.2 69.6 q2.8 1.6 5.6 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="mdesk-outfit">${outfitLayer(extras, ['eyes', 'neck'])}${extras.filter(k => DESK_HEAD[k]).map(k => `<g transform="${DESK_HEAD[k]}">${accessory(k)}</g>`).join('')}</g>
    </g>
  </g>
  ${note(372, 170, 'n1')}${note(394, 150, 'n2')}${note(128, 178, 'n3')}
</svg>`;
  }

  /* Chat-header badge: both states stacked so switching is a class toggle
     (.working on an ancestor) with no re-render — idle looks around and
     blinks, working types on the laptop with headphones on. */
  function head(color = 'lingon', size = 44, outfit = worn){
    return `<span class="mhead" aria-hidden="true"><span class="mhead-idle">${svg(color, 'idle', size, 'mascot-look', '', outfit)}</span><span class="mhead-work">${desk(color, outfit)}</span></span>`;
  }

  /* Fetches and decodes a colour's sprites before the app swaps them in; an
     <image> whose sprite is not decoded yet paints blank for a few frames. */
  const ready = new Map(), kept = [];
  function preload(color = 'lingon'){
    const key = PALETTE[color] ? color : 'lingon';
    if (!ready.has(key)) ready.set(key, Promise.all(['', '-desk'].map(view => {
      const img = new Image();
      img.src = sprite(key, view);
      kept.push(img);
      return img.decode().catch(() => {});
    })));
    return ready.get(key);
  }

  return { svg, logo, loop, laptop, desk, head, preload, wear, cleanOutfit, PALETTE, keys: Object.keys(PALETTE), OUTFITS, outfitKeys: Object.keys(OUTFITS) };
})();
