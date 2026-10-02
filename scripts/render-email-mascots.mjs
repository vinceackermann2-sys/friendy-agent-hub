// Render the same mascot the app uses into PNGs supported by email clients.
import puppeteer from 'puppeteer';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const browser = await puppeteer.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.setViewport({width:240,height:240,deviceScaleFactor:1});
  await page.setContent('<html><body style="margin:0"></body></html>');
  await page.addScriptTag({content:readFileSync(resolve('app/mascot.js'),'utf8')});
  mkdirSync(resolve('public/lingon/mascot'),{recursive:true});
  for (const color of ['lingon','blueberry','moss','sun','rose']) {
    const sprite = readFileSync(resolve(`app/mascot/star-${color}.webp`)).toString('base64');
    await page.evaluate(({color,sprite}) => {
      document.body.innerHTML = Mascot.svg(color,'happy',240).replace(`/lingon/mascot/star-${color}.webp`,`data:image/webp;base64,${sprite}`);
    },{color,sprite});
    await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=el.getAttribute('href');})));});
    await page.screenshot({path:resolve(`public/lingon/mascot/email-${color}.png`),omitBackground:true});
  }
} finally { await browser.close(); }
