// Rasterize the existing Belna vector mark into an opaque App Store icon.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const size = 1024, pixels = Buffer.alloc((size * 3 + 1) * size);
const shapes = [ [[100,0],[126.9,68.556872],[100,95.44588],[73.1,68.556872]], [[0,99.992568],[68.56,73.11296],[95.46,99.992568],[68.56,126.892176]], [[200,99.992568],[131.44,73.11296],[104.54,99.992568],[131.44,126.892176]], [[100,104.546384],[124.18,128.72],[75.82,128.72]] ];
function inside(x,y,points) {
  let hit = false;
  for (let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if ((a[1]>y)!==(b[1]>y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
  let hit=0;
  for(const dx of [.25,.75]) for(const dy of [.25,.75]) if(shapes.some(points=>inside((x+dx-172)/3.4,(y+dy-293)/3.4,points)))hit++;
  const alpha=hit/4,offset=y*(size*3+1)+1+x*3;
  [74,127,212].forEach((value,i)=>pixels[offset+i]=Math.round(value*alpha+[246,246,247][i]*(1-alpha)));
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data) {
  const label=Buffer.from(type),all=Buffer.concat([label,data]),out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length);all.copy(out,4);
  let crc=0xffffffff;for(const byte of all)crc=crcTable[(crc^byte)&255]^(crc>>>8);
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
writeFileSync(new URL('../native/apple/Belna/Assets.xcassets/AppIcon.appiconset/AppIcon.png',import.meta.url),png);
console.log('Generated opaque 1024×1024 Belna app icon.');
