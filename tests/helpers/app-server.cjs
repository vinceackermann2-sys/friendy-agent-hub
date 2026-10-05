const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
async function startAppServer(port=0){
  const root=path.resolve(__dirname,'../../app');
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/lingon\//,'/');
    const file=path.resolve(root,'.'+(['/','/app'].includes(pathname)?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(file)] || 'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={startAppServer};
if(require.main===module)startAppServer(Number(process.env.PORT || 8000)).then(x=>console.log('App test server: '+x.base));
