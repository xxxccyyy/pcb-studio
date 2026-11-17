// Optional loopback preview: node server.mjs [port]. The HTML also opens directly.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream';

const defaultRoot=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.css':'text/css; charset=utf-8'};
const inside=(root,target)=>{const rel=path.relative(root,target);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};

export function createPreviewServer({root=defaultRoot}={}){
  const canonicalRoot=realpath(root);
  return http.createServer(async(req,res)=>{
    const end=(code,message)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:message);};
    try{
      // Loopback binding alone does not stop DNS rebinding or cross-site reads.
      const port=req.socket.localPort, host=req.headers.host;
      const allowed=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
      if(!allowed.has(host)||(req.headers.origin&&!allowed.has(req.headers.origin.replace(/^http:\/\//,'')))
          ||(req.headers.origin&&!req.headers.origin.startsWith('http://'))
          ||req.headers['sec-fetch-site']==='cross-site'){
        end(403,'forbidden origin');return;
      }
      res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');end(405,'method not allowed');return;}
      let pathname;
      try{pathname=decodeURIComponent((req.url||'/').split('?')[0]).replace(/\\/g,'/');}
      catch{end(400,'invalid path encoding');return;}
      if(!pathname.startsWith('/')||pathname.includes('\0')){end(400,'invalid path');return;}
      if(pathname==='/') pathname='/index.html';
      const base=await canonicalRoot,target=path.resolve(base,'.'+pathname);
      if(!inside(base,target)||pathname.split('/').some(p=>p.startsWith('.')&&p!=='.'&&p!=='..')){end(403,'forbidden');return;}
      const actual=await realpath(target);
      if(!inside(base,actual)){end(403,'forbidden');return;}
      const info=await stat(actual);
      if(!info.isFile()){end(404,'not found');return;}
      const etag=`W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      res.setHeader('ETag',etag);res.setHeader('Cache-Control','no-cache');res.setHeader('X-Content-Type-Options','nosniff');
      if((req.headers['if-none-match']||'').split(',').map(s=>s.trim()).some(s=>s===etag||s==='*')){res.writeHead(304);res.end();return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(actual).toLowerCase()]||'application/octet-stream','Content-Length':info.size});
      if(req.method==='HEAD'){res.end();return;}
      pipeline(createReadStream(actual),res,error=>{if(error)res.destroy(error);});
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      end(error.code==='ENOENT'||error.code==='ENOTDIR'?404:error.code==='EACCES'||error.code==='EPERM'?403:500,'unable to serve file');
    }
  });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const port=process.argv[2]==null?8931:Number(process.argv[2]);
  if(!Number.isInteger(port)||port<0||port>65535){console.error('Port must be an integer from 0 to 65535');process.exitCode=1;}
  else{
    const server=createPreviewServer();
    server.on('error',error=>{console.error('Preview server: '+error.message);process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>console.log(`PCB 工具已就绪: http://127.0.0.1:${server.address().port}`));
  }
}
