/* ============ Lingon mascot — a cute star, code-drawn, recolorable, animated ============ */
window.Mascot = (() => {

  const PALETTE = {
    lingon:   { name:'Lingon red',  body:'#E15A46', dark:'#B93F2E', glow:'#F7C2B8', blush:'#F7C2B8' },
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
    return `
<svg width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <path d="${STAR}" fill="#E15A46" stroke="#E15A46" stroke-width="18" stroke-linejoin="round"/>
  <ellipse cx="48" cy="48" rx="9" ry="6" fill="#fff" opacity=".3"/>
  ${spark(92, 22, 8, '#5F9E63')}
</svg>`;
  }

  return { svg, logo, PALETTE, keys: Object.keys(PALETTE) };
})();
