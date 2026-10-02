import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {wingDesign,wingDefaults} from './wing/design.mjs';
import {wingPreview} from './wing/construct.mjs';
import {airfoilCatalog} from './wing/airfoils.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const files=new Set(['index.html','app.mjs','style.css','renderer.mjs']);

export async function startWingWorkspace({port=0,directory=resolve(process.env.SAAM_DATA??'Prints','wing-workspace')}={}){
  await mkdir(directory,{recursive:true});
  const saved=join(directory,'design.json');
  const loaded=await readFile(saved,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const state={design:loaded?wingDesign(JSON.parse(loaded)):wingDesign(wingDefaults),job:null};
  const send=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(res,{error:'Cross-origin requests are not accepted.'},403);
      if(req.method==='GET'&&url.pathname==='/api/airfoils')return send(res,airfoilCatalog());
      if(req.method==='GET'&&url.pathname==='/api/design')return send(res,{design:state.design,preview:wingPreview(state.design),job:state.job});
      if(req.method==='GET'&&url.pathname==='/api/job')return send(res,state.job);
      if(req.method==='POST'&&['/api/design','/api/wing/preview','/api/wing/export'].includes(url.pathname)){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const request=JSON.parse(Buffer.concat(chunks).toString()),design=wingDesign(request.design),preview=wingPreview(design,{interactive:url.pathname==='/api/wing/preview'});
        if(url.pathname==='/api/wing/preview')return send(res,{design,preview});
        if(url.pathname==='/api/design'){
          state.design=design;await writeFile(saved,JSON.stringify(design,null,2));return send(res,{design,preview});
        }
        if(state.job&&!['complete','failed'].includes(state.job.stage))return send(res,{error:'An export is already running.'},409);
        const id=randomUUID(),out=join(directory,'set-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+id.slice(0,6));
        state.job={id,stage:'starting',directory:out,completed:0,total:preview.pieces.length,bundles:[]};
        const worker=new Worker(new URL('./export-worker.mjs',import.meta.url),{workerData:{design,directory:out}});
        worker.on('message',message=>{if(state.job.id===id)state.job={...state.job,...message};});
        worker.on('error',error=>{if(state.job.id===id)state.job={...state.job,stage:'failed',error:error.message};});
        worker.on('exit',code=>{if(state.job.id===id&&!['complete','failed'].includes(state.job.stage))state.job={...state.job,stage:'failed',error:'Export worker exited before completing ('+code+').'};});
        return send(res,state.job,202);
      }
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(req.method!=='GET'||!files.has(name))return send(res,{error:'Not found'},404);
      const content=await readFile(join(root,'wing',name));
      res.writeHead(200,{'Content-Type':({'.html':'text/html','.css':'text/css','.mjs':'text/javascript'})[extname(name)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
    }catch(error){send(res,{error:error.message},400);}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,directory};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),portAt=args.indexOf('--port'),dirAt=args.indexOf('--directory');
  const workspace=await startWingWorkspace({port:portAt<0?0:Number(args[portAt+1]),...(dirAt<0?{}:{directory:resolve(args[dirAt+1])})});
  console.log(JSON.stringify({event:'workspace-ready',workspace:'wing',url:workspace.url,directory:workspace.directory}));
}
