import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const files=new Map([
  ['/',new URL('./index.html',import.meta.url)],
  ...['viewer.mjs','worker.mjs'].map(n=>['/'+n,new URL('./'+n,import.meta.url)]),
  ['/core/machine/split-delta.mjs',new URL('../../core/machine/split-delta.mjs',import.meta.url)],
  ['/core/export/split-delta-player.mjs',new URL('../../core/export/split-delta-player.mjs',import.meta.url)],
  ['/machines/split-delta.json',new URL('../../machines/split-delta.json',import.meta.url)]
]);
export function createViewerServer({previewFile=null,dobotPreviewFile=null,studyFile=null}={}){
  const routes=new Map(files);
  for(const name of ['dobot.html','dobot-viewer.mjs'])routes.set('/'+name,new URL('./'+name,import.meta.url));
  routes.set('/core/machine/dobot-kinematics.mjs',new URL('../../core/machine/dobot-kinematics.mjs',import.meta.url));
  if(previewFile)routes.set('/preview.sdgcode',resolve(previewFile));
  if(dobotPreviewFile)routes.set('/dobot-preview.json',resolve(dobotPreviewFile));
  if(studyFile){routes.set('/path-study.json',resolve(studyFile));for(const tilt of [40,45])routes.set(`/compact-${tilt}.sdgcode`,resolve(dirname(studyFile),`compact-${tilt}.sdgcode`));}
  return createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'),file=routes.get(url.pathname);
    if(req.method!=='GET'||!file){res.writeHead(404);res.end('Not found');return;}
    try{const data=await readFile(file),name=typeof file==='string'?file:file.pathname;res.writeHead(200,{'Content-Type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'"});res.end(data);}catch{res.writeHead(500);res.end('Viewer asset unavailable');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--preview'),d=process.argv.indexOf('--dobot-preview'),s=process.argv.indexOf('--study'),server=createViewerServer({previewFile:i>=0?process.argv[i+1]:null,dobotPreviewFile:d>=0?process.argv[d+1]:null,studyFile:s>=0?process.argv[s+1]:null});server.listen(Number(process.env.SPLIT_DELTA_PORT??0),'127.0.0.1',()=>console.log(`Standalone split-delta viewer: http://127.0.0.1:${server.address().port}${i>=0?'/?preview=1':''}\nDobot model: http://127.0.0.1:${server.address().port}/dobot.html${d>=0?'?preview=1':''}\nKeep this terminal running. Ctrl+C stops only this viewer.`));
}
