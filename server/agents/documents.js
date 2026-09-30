// Text extraction only: never execute document macros, formulas or external links.
const MAX_EXTRACTED=240000, MAX_EXPANDED=12*1024*1024;
async function officeFiles(bytes) {
  const {Unzip,UnzipInflate,strFromU8}=await import('fflate');
  const files={};let total=0,count=0,error;
  const unzip=new Unzip(file=>{
    if(++count>3000)throw new Error('Document has too many archive entries.');
    if(!/^(word\/(document|header\d*|footer\d*)\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml))$/.test(file.name))return;
    if(file.originalSize>MAX_EXPANDED)throw new Error('Expanded document is too large.');
    const chunks=[];let size=0;
    file.ondata=(e,data,final)=>{if(e){error=e;return;}size+=data.length;total+=data.length;if(total>MAX_EXPANDED)throw new Error('Expanded document is too large.');chunks.push(data);if(final){const merged=new Uint8Array(size);let at=0;for(const c of chunks){merged.set(c,at);at+=c.length;}files[file.name]=strFromU8(merged);}};
    file.start();
  });
  unzip.register(UnzipInflate);
  for(let i=0;i<bytes.length;i+=1024){unzip.push(bytes.subarray(i,i+1024),i+1024>=bytes.length);if(error)throw error;}
  if(Object.values(files).some(xml=>/<!DOCTYPE|<!ENTITY/i.test(xml)))throw new Error('Document entity declarations are not supported.');
  return files;
}
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
function richText(v){if(v==null)return '';if(typeof v!=='object')return String(v);return Object.entries(v).filter(([k])=>!k.startsWith('@_')).map(([k,x])=>k==='t'?String(x?.['#text']??x):array(x).map(richText).join('')).join('');}
async function extractDocument(bytes,{name='',mime=''}={}) {
  const ext=name.toLowerCase().split('.').pop();let text='',warnings=[],pages;
  if(ext==='pdf' || mime==='application/pdf') {
    const {getDocumentProxy}=await import('unpdf');
    const pdf=await getDocumentProxy(new Uint8Array(bytes),{isEvalSupported:false,useSystemFonts:false});
    try {
      warnings.push('Text extraction does not inspect images, charts or visual layout.');
      pages=pdf.numPages;const limit=Math.min(pages,150);
      for(let p=1;p<=limit && text.length<MAX_EXTRACTED;p++){const page=await pdf.getPage(p),content=await page.getTextContent();text+=`\n[Page ${p}]\n`+content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');page.cleanup();}
      if(pages>limit || text.length>=MAX_EXTRACTED)warnings.push('Extraction limited; some pages or text remain unread.');
      if(!text.replace(/\[Page \d+\]/g,'').trim())warnings.push('No readable text: this PDF needs OCR. Do not infer its contents.');
    } finally {await pdf.loadingTask.destroy();}
  } else if(['docx','xlsx'].includes(ext) || /wordprocessingml|spreadsheetml/.test(mime)) {
    const files=await officeFiles(new Uint8Array(bytes));
    const {XMLParser}=await import('fast-xml-parser');
    if(ext==='docx' || /wordprocessingml/.test(mime)){
      warnings.push('Text extraction does not inspect embedded images, charts or visual layout.');
      if(!files['word/document.xml'])throw new Error('Invalid Word document.');
      const parser=new XMLParser({preserveOrder:true,ignoreAttributes:true,parseTagValue:false,processEntities:true});
      const walk=nodes=>array(nodes).map(node=>typeof node==='object'?Object.entries(node).map(([k,v])=>k==='#text'?String(v):k==='w:tab'?'\t':k==='w:br'?'\n':walk(v)+(k==='w:p'?'\n':k==='w:tc'?'\t':'')).join(''):'').join('');
      text=Object.entries(files).filter(([k])=>k.startsWith('word/')).map(([k,v])=>`[${k}]\n${walk(parser.parse(v))}`).join('\n');
    } else {
      const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true});
      const shared=array(files['xl/sharedStrings.xml']?parser.parse(files['xl/sharedStrings.xml']).sst?.si:[]).map(richText);
      const sheets=array(files['xl/workbook.xml']?parser.parse(files['xl/workbook.xml']).workbook?.sheets?.sheet:[]);
      const rels=array(files['xl/_rels/workbook.xml.rels']?parser.parse(files['xl/_rels/workbook.xml.rels']).Relationships?.Relationship:[]);
      for(const [key,xml] of Object.entries(files).filter(([k])=>k.startsWith('xl/worksheets/')).sort()){
        const rel=rels.find(r=>('xl/'+String(r['@_Target']).replace(/^\/?xl\//,'').replace(/^\//,''))===key);
        const sheet=sheets.find(s=>s['@_r:id']===rel?.['@_Id']);
        text+=`\n[Sheet: ${sheet?.['@_name'] || key}]\n`;
        for(const row of array(parser.parse(xml).worksheet?.sheetData?.row))for(const cell of array(row.c)){
          const value=cell['@_t']==='s'?shared[Number(cell.v)]??'':cell['@_t']==='inlineStr'?richText(cell.is):String(cell.v??'');
          text+=`${cell['@_r'] || '?'}: ${value}${cell.f!=null?' [formula: '+String(cell.f?.['#text']??cell.f)+'; cached value, not recalculated]':''}\n`;
        }
        if(text.length>MAX_EXTRACTED)break;
      }
      if(!text.trim())throw new Error('No worksheets found.');
      warnings.push('Cell values are stored values; formulas are not recalculated. Dates may be Excel serial numbers. Charts and embedded images are not inspected.');
    }
  } else return null;
  const truncated=text.length>MAX_EXTRACTED;
  if(truncated)warnings.push('Text extraction truncated; remaining content is not verified.');
  return {text:text.slice(0,MAX_EXTRACTED),warnings,pages,truncated};
}
module.exports={extractDocument,MAX_EXTRACTED};
