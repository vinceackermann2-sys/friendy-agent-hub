window.Mascot=(()=>{const x="/lingon/mascot/",c={lingon:{name:"Belna blue",body:"#4A7FD4",dark:"#2E5BA8",glow:"#B8D4F7",blush:"#FF8FB0"},blueberry:{name:"Sky",body:"#B7D6FF",dark:"#7EA6DB",glow:"#E2EEFF",blush:"#FF8FB0"},moss:{name:"Pistachio",body:"#D8F3B0",dark:"#9BC468",glow:"#EEF9DF",blush:"#FF8FA0"},sun:{name:"Apricot",body:"#FFE0A3",dark:"#E3B25A",glow:"#FFF1D6",blush:"#FF7F8E"},rose:{name:"Orchid",body:"#E8B5F4",dark:"#BF7FD3",glow:"#F6E2FB",blush:"#FF8FC0"}},$=(e,s="")=>`${x}star-${c[e]?e:"lingon"}${s}.webp`;let b=0;const p=49.6,d=70.4,r=63.5;function h(e,s){if(e==="happy")return`
      <path d="M${p-4} ${r+1} q4 -5.2 8 0" stroke="${s}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M${d-4} ${r+1} q4 -5.2 8 0" stroke="${s}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;const t=e==="think"?r-2:r,a=e==="think"?.8:0,l=e==="wow"?1.18:1,o=n=>`<g class="eye"><ellipse cx="${n}" cy="${t}" rx="${3.1*l}" ry="${3.8*l}" fill="${s}"/><circle cx="${n+1.1+a}" cy="${t-1.5}" r="${1.15*l}" fill="#fff"/></g>`;return o(p)+o(d)}function v(e,s){return e==="happy"?`<path d="M55.4 68.6 q4.6 6.4 9.2 0" stroke="${s}" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`:e==="think"?`<circle cx="61.4" cy="70" r="1.9" fill="${s}"/>`:e==="wow"?`<ellipse cx="60" cy="70.4" rx="2.8" ry="3.5" fill="${s}"/>`:`<path d="M56.6 68.8 q3.4 3.6 6.8 0" stroke="${s}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`}function M(e,s,t,a){return`<path d="M${e} ${s-t} L${e+t*.32} ${s-t*.32} L${e+t} ${s} L${e+t*.32} ${s+t*.32} L${e} ${s+t} L${e-t*.32} ${s+t*.32} L${e-t} ${s} L${e-t*.32} ${s-t*.32} Z" fill="${a}"/>`}function y(e,s,t,a,l){const o=`mblush${++b}`;return`<radialGradient id="${o}"><stop offset="0" stop-color="${l}" stop-opacity=".78"/><stop offset=".6" stop-color="${l}" stop-opacity=".5"/><stop offset="1" stop-color="${l}" stop-opacity="0"/></radialGradient>`+e.map(n=>`<ellipse cx="${n}" cy="${s}" rx="${t}" ry="${a}" fill="url(#${o})"/>`).join("")}const f={glasses:{name:"Glasses",slot:"eyes"},shades:{name:"Shades",slot:"eyes"},headphones:{name:"Headphones",slot:"head"},partyhat:{name:"Party hat",slot:"head"},flower:{name:"Flower",slot:"head"},bowtie:{name:"Bow tie",slot:"neck"}};function B(e){const s={};return(Array.isArray(e)?e:[]).forEach(t=>{f[t]&&(s[f[t].slot]=t)}),Object.values(s)}let g=[];function C(e){return g=B(e),g}function E(e){const s=`macc${++b}`;switch(e){case"glasses":return`
        <g class="macc macc-glasses" stroke="#23252E" stroke-width="1.9" fill="#fff" fill-opacity=".16">
          <circle cx="${p}" cy="${r}" r="7"/><circle cx="${d}" cy="${r}" r="7"/>
          <path d="M${p+7} ${r-1} q${(d-p-14)/2} -2.6 ${d-p-14} 0" fill="none"/>
          <path d="M${p-7} ${r-1.5} l-6 -2.2 M${d+7} ${r-1.5} l6 -2.2" fill="none" stroke-linecap="round"/>
        </g>`;case"shades":return`
        <g class="macc macc-shades">
          <path d="M${p-8.2} ${r-4.6} h16.4 q.6 9.4 -8.2 9.8 q-8.8 -.4 -8.2 -9.8z M${d-8.2} ${r-4.6} h16.4 q.6 9.4 -8.2 9.8 q-8.8 -.4 -8.2 -9.8z" fill="#1E2029"/>
          <path d="M${p-9.4} ${r-4.8} H${d+9.4}" stroke="#1E2029" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M${p-5.2} ${r-2.2} l3.4 0 M${d-5.2} ${r-2.2} l3.4 0" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
        </g>`;case"headphones":return`
        <g class="macc macc-headphones">
          <path d="M37.5 47 C35 18 85 18 82.5 47" stroke="#E9ECF3" stroke-width="4.6" fill="none" stroke-linecap="round"/>
          <path d="M37.5 47 C35 18 85 18 82.5 47" stroke="#C4C9D6" stroke-width="1.4" fill="none" stroke-linecap="round" transform="translate(0 1.6)"/>
          <ellipse cx="37" cy="48.5" rx="6.6" ry="7.6" fill="#F4F5F9" stroke="#C4C9D6" stroke-width="1"/><ellipse cx="37" cy="48.5" rx="3.4" ry="4" fill="#F07B6A"/>
          <ellipse cx="83" cy="48.5" rx="6.6" ry="7.6" fill="#F4F5F9" stroke="#C4C9D6" stroke-width="1"/><ellipse cx="83" cy="48.5" rx="3.4" ry="4" fill="#F07B6A"/>
        </g>`;case"partyhat":return`
        <g class="macc macc-partyhat" transform="rotate(8 58.6 24)">
          <defs><clipPath id="${s}"><path d="M58.6 3.6 L67.4 24 Q58.6 27.4 49.8 24 Z"/></clipPath></defs>
          <path d="M58.6 3.6 L67.4 24 Q58.6 27.4 49.8 24 Z" fill="#FFC94D"/>
          <g clip-path="url(#${s})" stroke="#F0717D" stroke-width="2.8"><path d="M46 14 L72 6 M46 21.5 L72 13.5 M46 29 L72 21"/></g>
          <path d="M49.8 24 Q58.6 27.4 67.4 24" stroke="#E2A82F" stroke-width="1.3" fill="none"/>
          <circle cx="58.6" cy="3.4" r="2.9" fill="#F0717D"/>
        </g>`;case"flower":return`
        <g class="macc macc-flower" transform="translate(70 30) rotate(14)">
          ${[0,72,144,216,288].map(t=>`<ellipse cx="0" cy="-5.2" rx="3.6" ry="5" fill="#fff" stroke="#E6E1EA" stroke-width=".8" transform="rotate(${t})"/>`).join("")}
          <circle r="3.3" fill="#FFC94D" stroke="#E7A93A" stroke-width=".8"/>
        </g>`;case"bowtie":return`
        <g class="macc macc-bowtie">
          <path d="M60 82.5 L49 76.5 Q46.6 82.5 49 88.5 Z M60 82.5 L71 76.5 Q73.4 82.5 71 88.5 Z" fill="#E5484D" stroke="#B9343A" stroke-width="1" stroke-linejoin="round"/>
          <rect x="56.8" y="79.2" width="6.4" height="6.6" rx="2.2" fill="#C93C41"/>
          <path d="M51 79.4 q-1 3 0 6" stroke="#fff" stroke-opacity=".4" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        </g>`}return""}const m=(e,s)=>e.filter(t=>s.includes(f[t].slot)).map(E).join("");function A(e="lingon",s="idle",t=64,a="",l="",o=g){const n=c[e]||c.lingon,i="#1A1B22",F=s==="wave"?M(104,22,7,n.dark)+M(112,37,4.5,n.body):"",[k,q,u]=l?[-10.9,0,141.8]:[0,0,120];return`
<svg class="mascot ${a}" width="${t}" height="${t}" viewBox="${k} ${q} ${u} ${u}" fill="none" aria-hidden="true">
  <ellipse class="mascot-shadow" cx="60" cy="${l?136:104}" rx="${l?36:30}" ry="4.6" fill="#1B2A4A" opacity=".09"/>
  ${F}
  <image class="mascot-body" href="${$(e,l?`-${l}`:"")}" x="${k}" y="${q}" width="${u}" height="${u}"/>
  ${m(o,["head"])}
  ${y([41.5,78.5],70.2,6.4,4.2,n.blush)}
  <g class="eyes">${h(s,i)}</g>
  ${v(s,i)}
  ${m(o,["eyes","neck"])}
</svg>`}function j(e=26){const s=e,t=+(e*128.72/200).toFixed(2);return`
<svg class="belna-mark" width="${s}" height="${t}" viewBox="0 0 200 128.72" fill="#4A7FD4" aria-hidden="true">
  <polygon points="100 0 126.9 68.556872 100 95.44588 73.1 68.556872"/>
  <polygon points="0 99.992568 68.56 73.11296 95.46 99.992568 68.56 126.892176"/>
  <polygon points="200 99.992568 131.44 73.11296 104.54 99.992568 131.44 126.892176"/>
  <polygon points="100 104.546384 124.18 128.72 75.82 128.72"/>
</svg>`}function S(){const e='viewBox="0 0 320 320"',s='x="40" y="29.5" width="240" height="240"',t="#1A1B22",a=o=>`<svg ${e}><g transform="translate(40 29.5) scale(2)">${o}</g></svg>`,l=o=>`<span class="mloop-layer scene scene-${o}"><svg ${e}><image href="${x}prop-${o}.webp" ${s}/></svg></span>`;return`
<span class="mloop-stage" aria-hidden="true">
  <span class="mloop-halo"></span>
  <span class="mloop-wrap">
    <svg ${e} role="img" aria-label="Star mascot cycling through mail, phone, laptop and wallet tasks"><ellipse cx="160" cy="238" rx="64" ry="8" fill="#1B2A4A" opacity=".08"/></svg>
    <span class="mloop-layer body-star">
      <svg ${e}><image href="${$("lingon","-hold")}" ${s}/></svg>
      ${l("mail")}${l("phone")}${l("laptop")}${l("wallet")}
      ${a(y([41.5,78.5],70.2,6.4,4.2,c.lingon.blush))}
      <span class="mloop-layer face face-happy"><span class="mloop-layer eyes">${a(h("happy",t))}</span>${a(v("happy",t))}</span>
      <span class="mloop-layer face face-talk"><span class="mloop-layer eyes">${a(h("idle",t))}</span><span class="mloop-layer mouth-talk">${a(`<ellipse cx="60" cy="70.2" rx="2.5" ry="2.9" fill="${t}"/>`)}</span></span>
      <span class="mloop-layer face face-focus"><span class="mloop-layer eyes">${a(`<g transform="translate(0 1)">${h("idle",t)}</g>`)}</span>${a(`<path d="M57.2 69.8 q2.8 1.4 5.6 0" stroke="${t}" stroke-width="2" fill="none" stroke-linecap="round"/>`)}</span>
    </span>
    <span class="mloop-layer spark"><svg ${e}><path d="M216 170 l2.6 6 6 2.6-6 2.6-2.6 6-2.6-6-6-2.6 6-2.6z" fill="var(--dark)"/></svg></span>
    <span class="mloop-layer spark s2"><svg ${e}><path d="M102 186 l2 4.4 4.4 2-4.4 2-2 4.4-2-4.4-4.4-2 4.4-2z" fill="var(--body)"/></svg></span>
  </span>
</span>`}function O(){const e=c.lingon,s="#1A1B22";return`
<svg class="mascot-laptop" viewBox="0 0 500 500" fill="none" role="img" aria-label="Belna agent working on a laptop">
  <defs>
    <filter id="work-floor-shadow" x="30" y="340" width="440" height="120" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>
  <ellipse cx="262" cy="410" rx="160" ry="22" fill="#15284B" opacity=".12" filter="url(#work-floor-shadow)"/>
  <ellipse cx="258" cy="404" rx="124" ry="15" fill="#15284B" opacity=".09"/>
  <g class="work-body">
    <image href="${$("lingon","-laptop")}" x="0" y="0" width="500" height="500"/>
    <g transform="translate(272.2 270.9) rotate(-5.5) scale(3.28 3.7) translate(-60 -63.5)">
      ${y([41.5,78.5],70.2,6.4,4.2,e.blush)}
      <g class="work-brows" stroke="${s}" stroke-width="1.7" stroke-linecap="round" fill="none">
        <path d="M45.4 57.2 q4.4 .6 8.2 2.6"/><path d="M66.4 59.8 q3.8 -2 8.2 -2.6"/>
      </g>
      <g class="eye-blink">${h("idle",s)}</g>
      <path d="M57.2 69.6 q2.8 1.6 5.6 0" stroke="${s}" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
  </g>
</svg>`}const D={partyhat:"translate(-2 7)",flower:"translate(-7 -1)"};function L(e="lingon",s=g){const t=c[e]||c.lingon,a=s.filter(i=>i!=="headphones"),l="#1A1B22",o="translate(272.2 270.9) rotate(-5.5) scale(3.28 3.7) translate(-60 -63.5)",n=(i,F,k)=>`<g transform="translate(${i} ${F}) scale(1.5)"><g class="mdesk-note ${k}"><path d="M0 0v-26l18 -6v25" stroke="${t.dark}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="-5" cy="1" rx="7" ry="5.4" fill="${t.dark}"/><ellipse cx="13" cy="-5" rx="7" ry="5.4" fill="${t.dark}"/></g></g>`;return`
<svg class="mascot-desk" viewBox="80 30 380 380" fill="none" aria-hidden="true">
  <ellipse cx="262" cy="408" rx="130" ry="14" fill="#15284B" opacity=".1"/>
  <g class="mdesk-body">
    <image href="${$(e,"-desk")}" x="0" y="0" width="500" height="500"/>
    <g transform="${o}">
      ${y([41.5,78.5],70.2,6.4,4.2,t.blush)}
      <g class="mdesk-eyes"><g class="eye-blink">${h("idle",l)}</g></g>
      <path class="mdesk-mouth" d="M57.2 69.6 q2.8 1.6 5.6 0" stroke="${l}" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="mdesk-outfit">${m(a,["eyes","neck"])}${a.filter(i=>D[i]).map(i=>`<g transform="${D[i]}">${E(i)}</g>`).join("")}</g>
    </g>
  </g>
  ${n(372,170,"n1")}${n(394,150,"n2")}${n(128,178,"n3")}
</svg>`}function P(e="lingon",s=44,t=g){return`<span class="mhead" aria-hidden="true"><span class="mhead-idle">${A(e,"idle",s,"mascot-look","",t)}</span><span class="mhead-work">${L(e,t)}</span></span>`}const w=new Map,Q=[];function T(e="lingon"){const s=c[e]?e:"lingon";return w.has(s)||w.set(s,Promise.all(["","-desk"].map(t=>{const a=new Image;return a.src=$(s,t),Q.push(a),a.decode().catch(()=>{})}))),w.get(s)}return{svg:A,logo:j,loop:S,laptop:O,desk:L,head:P,preload:T,wear:C,cleanOutfit:B,PALETTE:c,keys:Object.keys(c),OUTFITS:f,outfitKeys:Object.keys(f)}})();
