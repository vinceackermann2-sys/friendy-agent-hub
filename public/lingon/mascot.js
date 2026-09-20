/* ============ Lingon mascot — a cute star, code-drawn, recolorable, animated ============ */
window.Mascot = (() => {

  const PALETTE = {
    lingon:   { name:'Lingon blue', body:'#4A7FD4', dark:'#2E5BA8', glow:'#B8D4F7', blush:'#B8D4F7' },
    blueberry:{ name:'Blueberry',   body:'#5B6EE1', dark:'#4353C6', glow:'#C3CBF7', blush:'#C3CBF7' },
    moss:     { name:'Moss',        body:'#7BA05B', dark:'#5F8344', glow:'#D3E4C2', blush:'#D3E4C2' },
    sun:      { name:'Sunbeam',     body:'#E8B33C', dark:'#C6922A', glow:'#F7DFAE', blush:'#F7DFAE' },
    lavender: { name:'Lavender',    body:'#9B6BD3', dark:'#7E4FB8', glow:'#E2CFF5', blush:'#E2CFF5' },
    rose:     { name:'Rosehip',     body:'#E58BB1', dark:'#C96B94', glow:'#F8D3E2', blush:'#F8D3E2' },
    charcoal: { name:'Charcoal',    body:'#4A4D55', dark:'#33363D', glow:'#8B8E96', blush:'#8B8E96' },
  };

  /* rounded 5-point star: polygon + fat round-join stroke in the same color */
  const STAR = 'M60 30 L69.4 51.1 L92.3 53.5 L75.2 70.9 L80 93.5 L60 82 L40 93.5 L44.8 70.9 L27.7 53.5 L50.6 51.1 Z';

  function eyes(mood, ink){
    if (mood === 'happy') return `
      <path d="M46 62 q5 -6 10 0" stroke="${ink}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M64 62 q5 -6 10 0" stroke="${ink}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    if (mood === 'think') return `
      <circle class="eye" cx="52" cy="58" r="4.2" fill="${ink}"/><circle cx="53.5" cy="56.6" r="1.3" fill="#fff"/>
      <circle class="eye" cx="68" cy="58" r="4.2" fill="${ink}"/><circle cx="69.5" cy="56.6" r="1.3" fill="#fff"/>`;
    return `
      <circle class="eye" cx="52" cy="62" r="4.2" fill="${ink}"/><circle cx="53.5" cy="60.6" r="1.3" fill="#fff"/>
      <circle class="eye" cx="68" cy="62" r="4.2" fill="${ink}"/><circle cx="69.5" cy="60.6" r="1.3" fill="#fff"/>`;
  }

  function mouth(mood, ink){
    if (mood === 'happy') return `<path d="M53 70 q7 9 14 0" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
    if (mood === 'think') return `<circle cx="60" cy="72" r="3" fill="${ink}"/>`;
    if (mood === 'wow')   return `<ellipse cx="60" cy="72" rx="4" ry="5" fill="${ink}"/>`;
    return `<path d="M55 71 q5 5 10 0" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
  }

  function spark(x, y, s, fill){
    return `<path d="M${x} ${y - s} L${x + s * 0.32} ${y - s * 0.32} L${x + s} ${y} L${x + s * 0.32} ${y + s * 0.32} L${x} ${y + s} L${x - s * 0.32} ${y + s * 0.32} L${x - s} ${y} L${x - s * 0.32} ${y - s * 0.32} Z" fill="${fill}"/>`;
  }

  /**
   * svg(colorKey, mood, size, extraClass)
   * moods: idle | happy | think | wave | wow
   */
  function svg(color = 'lingon', mood = 'idle', size = 64, extra = ''){
    const c = PALETTE[color] || PALETTE.lingon;
    const ink = '#1D1E20';
    const waveSpark = mood === 'wave' ? spark(97, 34, 7, c.dark) + spark(106, 48, 4.5, c.body) : '';
    return `
<svg class="mascot ${extra}" width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <ellipse cx="60" cy="110" rx="24" ry="5" fill="#000" opacity=".07"/>
  ${spark(60, 14, 6, c.dark)}
  ${waveSpark}
  <path d="${STAR}" fill="${c.body}" stroke="${c.body}" stroke-width="16" stroke-linejoin="round"/>
  <path d="${STAR}" fill="none" stroke="${c.dark}" stroke-width="16" stroke-linejoin="round" opacity=".16" transform="translate(0 3)" clip-path="inset(55% 0 0 0)"/>
  <ellipse cx="49" cy="47" rx="8" ry="5.5" fill="#fff" opacity=".25"/>
  <circle cx="45" cy="70" r="5" fill="${c.blush}" opacity=".85"/>
  <circle cx="75" cy="70" r="5" fill="${c.blush}" opacity=".85"/>
  ${eyes(mood, ink)}
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
   * loop() — 4-action auto-loop mascot (mail → phone → laptop → wallet).
   * Pure CSS/SMIL-free SVG: plays automatically on a 16s infinite loop,
   * no JS timers needed. Designed to sit inside the homepage headline
   * circle (.mhold); all animation keyframes live in styles.css scoped
   * under .mhold. Defs ids are prefixed (mloop-) so repeat instances
   * never collide.
   */
  function loop(){
    return `
<span class="mloop-stage" aria-hidden="true">
  <span class="mloop-halo"></span>
  <span class="mloop-wrap">
    <svg viewBox="0 0 320 320" role="img" aria-label="Lingon star mascot cycling through mail, phone, laptop and wallet tasks">
      <defs>
        <filter id="mloop-softShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#000" flood-opacity=".12"/>
        </filter>
        <clipPath id="mloop-lowerHalf"><rect x="0" y="160" width="320" height="160"/></clipPath>
        <radialGradient id="mloop-macAluminum" cx="50%" cy="36%" r="75%">
          <stop offset="0%" stop-color="#e5e6e8"/>
          <stop offset="32%" stop-color="#dcdddf"/>
          <stop offset="68%" stop-color="#c6c7ca"/>
          <stop offset="100%" stop-color="#b1b2b5"/>
        </radialGradient>
        <linearGradient id="mloop-macEdge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".9"/>
          <stop offset="45%" stop-color="#d7d8db"/>
          <stop offset="100%" stop-color="#8f9195"/>
        </linearGradient>
        <linearGradient id="mloop-appleMetal" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stop-color="#2c2d30"/>
          <stop offset="40%" stop-color="#191a1c"/>
          <stop offset="100%" stop-color="#050506"/>
        </linearGradient>
        <linearGradient id="mloop-macSheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff" stop-opacity=".34"/>
          <stop offset="34%" stop-color="#fff" stop-opacity=".10"/>
          <stop offset="62%" stop-color="#fff" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity=".06"/>
        </linearGradient>
        <linearGradient id="mloop-bakelite" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#34373d"/>
          <stop offset="38%" stop-color="#15171b"/>
          <stop offset="100%" stop-color="#08090b"/>
        </linearGradient>
        <linearGradient id="mloop-bakeliteHighlight" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".24"/>
          <stop offset="35%" stop-color="#ffffff" stop-opacity=".04"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="mloop-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f1d483"/>
          <stop offset="38%" stop-color="#dbb057"/>
          <stop offset="100%" stop-color="#8f6727"/>
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="282" rx="70" ry="13" fill="#000" opacity=".055"/>
      <g class="body-star">
        <path d="M160 78 L184 131 L241 137 L199 181 L211 237 L160 208 L109 237 L121 181 L79 137 L136 131 Z"
              fill="var(--body)" stroke="var(--body)" stroke-width="34" stroke-linejoin="round"/>
        <path d="M160 78 L184 131 L241 137 L199 181 L211 237 L160 208 L109 237 L121 181 L79 137 L136 131 Z"
              fill="none" stroke="var(--dark)" stroke-width="34" stroke-linejoin="round" opacity=".13" clip-path="url(#mloop-lowerHalf)" transform="translate(0 5)"/>
        <ellipse cx="134" cy="123" rx="21" ry="11" fill="#fff" opacity=".23" transform="rotate(-17 134 123)"/>
        <circle cx="122" cy="180" r="10" fill="var(--blush)" opacity=".82"/>
        <circle cx="198" cy="180" r="10" fill="var(--blush)" opacity=".82"/>
      </g>
      <g class="face-happy">
        <path d="M126 158 q12 -13 24 0" stroke="var(--ink)" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M170 158 q12 -13 24 0" stroke="var(--ink)" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M142 184 q18 19 36 0" stroke="var(--ink)" stroke-width="6" fill="none" stroke-linecap="round"/>
      </g>
      <g class="face-talk">
        <circle cx="140" cy="157" r="8" fill="var(--ink)"/><circle cx="143" cy="154" r="2.6" fill="#fff"/>
        <circle cx="180" cy="157" r="8" fill="var(--ink)"/><circle cx="183" cy="154" r="2.6" fill="#fff"/>
        <ellipse class="mouth-talk" cx="160" cy="187" rx="8" ry="10" fill="var(--ink)"/>
      </g>
      <g class="face-focus">
        <g class="focus-eye"><circle cx="140" cy="158" r="8" fill="var(--ink)"/><circle cx="143" cy="155" r="2.5" fill="#fff"/></g>
        <g class="focus-eye"><circle cx="180" cy="158" r="8" fill="var(--ink)"/><circle cx="183" cy="155" r="2.5" fill="#fff"/></g>
        <path d="M151 187 q9 4 18 0" stroke="var(--ink)" stroke-width="5" fill="none" stroke-linecap="round"/>
      </g>
      <g class="scene-mail">
        <path d="M103 183 C87 193 82 209 95 220" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <path d="M217 183 C233 193 238 209 225 220" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <g class="mail-prop" filter="url(#mloop-softShadow)">
          <rect x="95" y="198" width="130" height="76" rx="14" fill="var(--paper)" stroke="#dfded7" stroke-width="4"/>
          <path d="M99 207 L160 247 L221 207" fill="none" stroke="#d4d2ca" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M99 264 L141 229 M221 264 L179 229" fill="none" stroke="#eceae3" stroke-width="4" stroke-linecap="round"/>
          <circle cx="160" cy="232" r="13" fill="var(--body)"/>
          <path d="M153 232 l5 5 10 -11" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <path class="mail-spark" d="M238 191 l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="var(--dark)"/>
        <path class="mail-spark s2" d="M82 203 l2.5 5.5 5.5 2.5-5.5 2.5-2.5 5.5-2.5-5.5-5.5-2.5 5.5-2.5z" fill="var(--body)"/>
      </g>
      <g class="scene-phone">
        <path d="M103 188 C91 197 92 216 105 227" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <path d="M218 180 C231 168 237 150 232 135" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <g class="phone-base" filter="url(#mloop-softShadow)">
          <path d="M215 236 Q220 219 235 214 H281 Q295 219 299 236 L304 259 Q304 271 292 275 H222 Q210 271 210 259 Z" fill="url(#mloop-bakelite)"/>
          <path d="M224 231 Q232 223 241 223 H275 Q285 223 291 231" fill="none" stroke="#69707b" stroke-opacity=".38" stroke-width="4"/>
          <ellipse cx="257" cy="247" rx="28" ry="23" fill="#0b0d10" stroke="#353a42" stroke-width="3.4"/>
          <ellipse cx="257" cy="247" rx="18" ry="15" fill="#11151a"/>
          <circle cx="257" cy="247" r="8.5" fill="url(#mloop-brass)"/>
          <g fill="#2c3139" stroke="#59616d" stroke-width="1.2">
            <circle cx="257" cy="226" r="3.2"/><circle cx="269" cy="230" r="3.2"/><circle cx="278" cy="239" r="3.2"/>
            <circle cx="280" cy="251" r="3.2"/><circle cx="273" cy="261" r="3.2"/><circle cx="261" cy="267" r="3.2"/>
            <circle cx="248" cy="266" r="3.2"/><circle cx="238" cy="259" r="3.2"/><circle cx="234" cy="247" r="3.2"/><circle cx="238" cy="235" r="3.2"/>
          </g>
          <path d="M227 264 H287" stroke="#020304" stroke-opacity=".34" stroke-width="8" stroke-linecap="round"/>
          <path d="M219 237 H295" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>
        </g>
        <path class="phone-cord" d="M282 221 C279 205 266 202 259 193 C251 183 259 174 251 166 C244 159 236 160 230 154" fill="none" stroke="#121418" stroke-width="4.4" stroke-linecap="round"/>
        <g class="handset" filter="url(#mloop-softShadow)" transform="rotate(-31 230 140)">
          <path d="M198 134 C209 114 245 113 261 132" fill="none" stroke="url(#mloop-bakelite)" stroke-width="18" stroke-linecap="round"/>
          <path d="M204 129 C217 118 240 118 253 129" fill="none" stroke="#6b727d" stroke-opacity=".35" stroke-width="3.6" stroke-linecap="round"/>
          <path d="M202 136 C215 144 243 144 256 136" fill="none" stroke="#08090b" stroke-opacity=".35" stroke-width="2.8" stroke-linecap="round"/>
          <g transform="translate(197 135) rotate(-8)">
            <ellipse cx="0" cy="0" rx="16" ry="21" fill="url(#mloop-bakelite)"/>
            <ellipse cx="-3" cy="-4" rx="8.5" ry="13.5" fill="url(#mloop-bakeliteHighlight)"/>
            <ellipse cx="0" cy="1" rx="16.3" ry="21.3" fill="none" stroke="url(#mloop-brass)" stroke-width="2.6"/>
            <ellipse cx="0" cy="0" rx="10.5" ry="14" fill="#090b0d"/>
            <ellipse cx="-2" cy="-1" rx="6" ry="8.5" fill="#14181d"/>
          </g>
          <g transform="translate(262 135) rotate(8)">
            <ellipse cx="0" cy="0" rx="18" ry="23" fill="url(#mloop-bakelite)"/>
            <ellipse cx="-3" cy="-5" rx="9" ry="14" fill="url(#mloop-bakeliteHighlight)"/>
            <ellipse cx="0" cy="1" rx="18.3" ry="23.3" fill="none" stroke="url(#mloop-brass)" stroke-width="2.8"/>
            <ellipse cx="0" cy="0" rx="12" ry="15.5" fill="#0a0c0f"/>
            <g fill="#393f47">
              <circle cx="-4.5" cy="-5.5" r="1.25"/><circle cx="0" cy="-6.2" r="1.25"/><circle cx="4.5" cy="-5.5" r="1.25"/>
              <circle cx="-6" cy="-1" r="1.25"/><circle cx="-2" cy="-1" r="1.25"/><circle cx="2" cy="-1" r="1.25"/><circle cx="6" cy="-1" r="1.25"/>
              <circle cx="-4.5" cy="3.5" r="1.25"/><circle cx="0" cy="4.5" r="1.25"/><circle cx="4.5" cy="3.5" r="1.25"/>
            </g>
          </g>
        </g>
        <path class="wave1" d="M273 108 q13 10 6 23"/>
        <path class="wave2" d="M284 101 q19 15 8 34"/>
        <path class="wave3" d="M294 94 q26 20 12 45"/>
      </g>
      <g class="scene-laptop">
        <path class="arm-type-left" d="M105 188 C110 211 124 228 145 242" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <path class="arm-type-right" d="M215 188 C210 211 196 228 175 242" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <g class="macbook-group" filter="url(#mloop-softShadow)">
          <rect x="89" y="187" width="142" height="91" rx="10" fill="url(#mloop-macAluminum)" stroke="url(#mloop-macEdge)" stroke-width="2.2"/>
          <rect x="91" y="189" width="138" height="87" rx="8.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>
          <path class="macbook-sheen" d="M99 193 H165 L207 272 H142 Z" fill="url(#mloop-macSheen)" opacity=".6"/>
          <g transform="translate(145 214) scale(.18)">
            <path fill="url(#mloop-appleMetal)" d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.91.13-9.77-1.92-14.57-6.16-3.18-2.75-7.05-7.44-11.61-14.07-6.04-8.82-10.8-18.44-14.28-28.87-3.48-10.43-5.22-20.48-5.22-30.15 0-14.45 3.75-26.23 11.25-35.34 7.5-9.11 17.06-13.75 28.68-13.91 4.8 0 10.05 1.2 15.75 3.6 5.7 2.4 9.68 3.6 11.93 3.6 1.95 0 5.92-1.2 11.92-3.6 6-2.4 10.98-3.53 14.93-3.4 8.08.33 15.43 3.03 22.05 8.1 5.08 3.91 9.07 8.9 11.97 14.98-10.74 6.47-16.01 15.35-15.81 26.64.2 8.78 3.49 16.14 9.87 22.08 6.38 5.94 13.97 9.22 22.77 9.84-2.22 6.49-5.18 12.98-8.88 19.47zM119.22 31.98c0-7.05 2.5-13.72 7.5-20.01 5-6.29 11.39-10.34 19.17-12.15.22.97.33 1.95.33 2.94 0 7.04-2.58 13.82-7.74 20.34-5.16 6.52-11.53 10.5-19.11 11.94-.33-1.07-.49-2.09-.49-3.06z"/>
          </g>
          <path d="M82 277 H238 L222 296 H98 Z" fill="url(#mloop-macEdge)" stroke="#9fa2a7" stroke-width="1.8"/>
          <path d="M99 279 H221 L211 291 H109 Z" fill="#cfd1d5"/>
          <path d="M111 281 H209" stroke="#eef0f2" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/>
          <rect x="141" y="285.5" width="38" height="5.8" rx="2.6" fill="#b3b7bd" opacity=".95"/>
          <path d="M98 296 H222" stroke="#7d8086" stroke-width="1.7" stroke-linecap="round"/>
        </g>
      </g>
      <g class="scene-money">
        <path d="M101 189 C90 204 93 222 109 231" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <path d="M219 189 C230 202 226 221 212 231" fill="none" stroke="var(--dark)" stroke-width="11" stroke-linecap="round"/>
        <g class="wallet" filter="url(#mloop-softShadow)">
          <rect x="96" y="226" width="89" height="57" rx="12" fill="#5A3C2E"/>
          <path d="M106 226 h68 a11 11 0 0 1 11 11 v8 h-79 a10 10 0 0 1 -10 -10 9 9 0 0 1 10 -9z" fill="#704B39"/>
          <rect x="156" y="242" width="35" height="23" rx="8" fill="#4A3025"/>
          <circle cx="174" cy="253.5" r="3.2" fill="#DAB264"/>
        </g>
        <g class="bill-back">
          <rect x="134" y="207" width="74" height="37" rx="5" fill="#A8D6A0" stroke="#75A96B" stroke-width="3"/>
          <circle cx="171" cy="225.5" r="9" fill="#78B271" opacity=".55"/>
          <path d="M165 225.5h12" stroke="#4B8D4C" stroke-width="3" stroke-linecap="round"/>
        </g>
        <g class="bill-front">
          <rect x="125" y="211" width="74" height="37" rx="5" fill="#C4E5BE" stroke="#75A96B" stroke-width="3"/>
          <circle cx="162" cy="229.5" r="9" fill="#78B271" opacity=".55"/>
          <path d="M156 229.5h12" stroke="#4B8D4C" stroke-width="3" stroke-linecap="round"/>
        </g>
        <g fill="var(--gold)">
          <circle class="coin" cx="223" cy="219" r="8"/>
          <circle class="coin c2" cx="243" cy="235" r="6"/>
          <circle class="coin c3" cx="225" cy="254" r="5"/>
        </g>
      </g>
    </svg>
  </span>
</span>`;
  }

  /* 3/4 laptop pose used by the landing-page comparison section. */
  function laptop(){
    const c = PALETTE.lingon;
    return `
<svg class="mascot-laptop" viewBox="0 0 500 500" fill="none" role="img" aria-label="Belna agent working on a laptop">
  <defs>
    <filter id="work-floor-shadow" x="30" y="340" width="440" height="120" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <radialGradient id="work-star" cx="38%" cy="27%" r="72%">
      <stop offset="0%" stop-color="#CFE2FA"/>
      <stop offset="40%" stop-color="${c.body}"/>
      <stop offset="84%" stop-color="${c.dark}"/>
      <stop offset="100%" stop-color="#183B78"/>
    </radialGradient>
    <linearGradient id="work-depth" x1="90" y1="120" x2="300" y2="390" gradientUnits="userSpaceOnUse">
      <stop stop-color="${c.dark}"/><stop offset="1" stop-color="#183B78"/>
    </linearGradient>
    <radialGradient id="work-arm" cx="35%" cy="22%" r="76%">
      <stop stop-color="#CFE2FA"/><stop offset=".45" stop-color="${c.body}"/><stop offset=".84" stop-color="${c.dark}"/><stop offset="1" stop-color="#183B78"/>
    </radialGradient>
    <linearGradient id="work-lid" x1="310" y1="205" x2="442" y2="350" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF"/><stop offset=".38" stop-color="#E2E8F0"/><stop offset="1" stop-color="#AAB5C5"/>
    </linearGradient>
  </defs>

  <ellipse cx="250" cy="411" rx="166" ry="24" fill="#15284B" opacity=".12" filter="url(#work-floor-shadow)"/>
  <ellipse cx="242" cy="405" rx="132" ry="17" fill="#15284B" opacity=".09"/>

  <g class="work-body">
    <path d="M215 82C230 82 250 142 260 152C275 162 335 182 348 195C362 210 325 255 320 272C315 290 332 352 318 368C305 382 248 360 230 360C212 360 160 392 142 382C125 372 135 308 128 290C120 272 75 235 82 218C90 200 148 190 162 178C178 165 200 82 215 82Z" fill="url(#work-depth)"/>
    <path d="M220 85C235 85 252 142 264 152C280 165 342 182 355 198C368 212 328 255 322 272C316 290 335 352 320 365C305 378 250 355 232 355C215 355 162 388 146 378C130 368 140 306 132 288C125 270 80 232 88 215C96 198 152 188 166 175C182 162 205 85 220 85Z" fill="url(#work-star)" stroke="${c.dark}" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="219" cy="126" rx="25" ry="14" fill="#fff" opacity=".3" transform="rotate(-18 219 126)"/>
    <g class="work-brows" stroke="#1C2430" stroke-width="7" stroke-linecap="round">
      <path d="M195 208Q208 215 220 220"/><path d="M268 220Q280 215 293 208"/>
    </g>
    <g fill="#1C2430">
      <ellipse cx="218" cy="242" rx="11" ry="15"/><ellipse cx="282" cy="242" rx="11" ry="15"/>
    </g>
    <g fill="#fff"><circle cx="221" cy="236" r="4.5"/><circle cx="285" cy="236" r="4.5"/></g>
    <g fill="${c.blush}" opacity=".9"><ellipse cx="198" cy="256" rx="16" ry="11"/><ellipse cx="302" cy="256" rx="16" ry="11"/></g>
    <path d="M238 258Q250 268 262 258" stroke="#1C2430" stroke-width="4.5" stroke-linecap="round"/>

    <g class="work-hand-right">
      <ellipse cx="286" cy="324" rx="16" ry="7" fill="#000" opacity=".2"/>
      <path d="M262 284C272 292 292 302 302 314C308 322 298 328 285 325C272 322 258 302 255 288Z" fill="url(#work-arm)" stroke="${c.dark}" stroke-width="2.5"/>
      <ellipse cx="282" cy="305" rx="10" ry="5" fill="#fff" opacity=".3" transform="rotate(-15 282 305)"/>
    </g>
  </g>

  <g class="work-laptop">
    <polygon points="190,340 305,362 440,314 325,296" fill="#15284B" opacity=".13"/>
    <polygon points="195,335 305,355 435,310 325,295" fill="#E2E8F0"/>
    <polygon points="195,335 305,355 305,361 195,341" fill="#8794A8"/>
    <polygon points="305,355 435,310 435,315 305,361" fill="#BAC4D2"/>
    <polygon points="230,328 295,340 395,308 335,298" fill="#1E293B" opacity=".2"/>
    <polygon points="255,333 285,338 315,328 288,324" fill="#0F172A" opacity=".22"/>
    <polygon points="305,355 435,310 445,185 315,225" fill="url(#work-lid)" stroke="#8794A8" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="315" y1="225" x2="445" y2="185" stroke="#fff" stroke-width="2" opacity=".9"/>
    <polygon points="310,348 428,306 436,192 320,229" fill="#fff" opacity=".12"/>
    <g transform="translate(374 266) rotate(-17)">
      <path d="M0-13L4-4L14-3L7 4L9 14L0 9L-9 14L-7 4L-14-3L-4-4Z" fill="${c.body}" opacity=".82"/>
    </g>
  </g>

  <g class="work-body">
    <g class="work-hand-left">
      <ellipse cx="198" cy="350" rx="38" ry="11" fill="#000" opacity=".16"/>
      <path d="M152 278C142 312 155 348 198 350C232 352 246 336 238 318C230 298 195 292 178 280Z" fill="url(#work-arm)" stroke="${c.dark}" stroke-width="2.5"/>
      <ellipse cx="188" cy="315" rx="26" ry="11" fill="#fff" opacity=".3" transform="rotate(-18 188 315)"/>
    </g>
  </g>
</svg>`;
  }

  return { svg, logo, loop, laptop, PALETTE, keys: Object.keys(PALETTE) };
})();
