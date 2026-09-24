/* ============ Lingon mascot — a soft 3D star, recolorable, animated ============
   The body is a Blender render (design/mascot/build_mascot.py → mascot/*.webp,
   one ~10 KB sprite per palette colour). Eyes, mouth and blush stay SVG on top
   so moods, blinking and CSS animations keep working at any size. */
window.Mascot = (() => {

  const ASSET = '/lingon/mascot/';

  const PALETTE = {
    lingon:   { name:'Belna blue', body:'#4A7FD4', dark:'#2E5BA8', glow:'#B8D4F7', blush:'#FF8FB0' },
    blueberry:{ name:'Blueberry',   body:'#5B6EE1', dark:'#4353C6', glow:'#C3CBF7', blush:'#FF8FB0' },
    moss:     { name:'Moss',        body:'#7BA05B', dark:'#5F8344', glow:'#D3E4C2', blush:'#FF8FA0' },
    sun:      { name:'Sunbeam',     body:'#E8B33C', dark:'#C6922A', glow:'#F7DFAE', blush:'#FF7F8E' },
    lavender: { name:'Lavender',    body:'#9B6BD3', dark:'#7E4FB8', glow:'#E2CFF5', blush:'#FF8FC0' },
    rose:     { name:'Rosehip',     body:'#E58BB1', dark:'#C96B94', glow:'#F8D3E2', blush:'#E4527E' },
    charcoal: { name:'Charcoal',    body:'#4A4D55', dark:'#33363D', glow:'#8B8E96', blush:'#FF8FB0' },
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

  /**
   * svg(colorKey, mood, size, extraClass)
   * moods: idle | happy | think | wave | wow
   * prop (optional): a held item rendered with the body, carried by the star's
   * own side points — schedule (lingon), school (blueberry), football (moss),
   * bag (rose); see HELPERS in build_mascot.py. Those sprites use a taller
   * frame (HELPER_ORTHO) so the big item fits under the face: the viewBox
   * widens to match while the face keeps its coordinates.
   */
  function svg(color = 'lingon', mood = 'idle', size = 64, extra = '', prop = ''){
    const c = PALETTE[color] || PALETTE.lingon;
    const ink = '#1A1B22';
    const waveSpark = mood === 'wave' ? spark(104, 22, 7, c.dark) + spark(112, 37, 4.5, c.body) : '';
    const [x, y, w] = prop ? [-10.9, 0, 141.8] : [0, 0, 120];
    return `
<svg class="mascot ${extra}" width="${size}" height="${size}" viewBox="${x} ${y} ${w} ${w}" fill="none" aria-hidden="true">
  <ellipse class="mascot-shadow" cx="60" cy="${prop ? 136 : 104}" rx="${prop ? 36 : 30}" ry="4.6" fill="#1B2A4A" opacity=".09"/>
  ${waveSpark}
  <image class="mascot-body" href="${sprite(color, prop ? `-${prop}` : '')}" x="${x}" y="${y}" width="${w}" height="${w}"/>
  ${blush([41.5, 78.5], 70.2, 6.4, 4.2, c.blush)}
  <g class="eyes">${eyes(mood, ink)}</g>
  ${mouth(mood, ink)}
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
  function desk(color = 'lingon'){
    const c = PALETTE[color] || PALETTE.lingon;
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
    </g>
  </g>
  ${note(372, 170, 'n1')}${note(394, 150, 'n2')}${note(128, 178, 'n3')}
</svg>`;
  }

  /* Chat-header badge: both states stacked so switching is a class toggle
     (.working on an ancestor) with no re-render — idle looks around and
     blinks, working types on the laptop with headphones on. */
  function head(color = 'lingon', size = 44){
    return `<span class="mhead" aria-hidden="true"><span class="mhead-idle">${svg(color, 'idle', size, 'mascot-look')}</span><span class="mhead-work">${desk(color)}</span></span>`;
  }

  return { svg, logo, loop, laptop, desk, head, PALETTE, keys: Object.keys(PALETTE) };
})();
