import http from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { viewerLifetime } from './lifetime.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');
// Explicit browser module allowlist; no generic repository/file serving.
const playerModules=new Set(['studio/source-player.mjs','studio/source-worker.mjs','studio/move-store.mjs',
  'core/export/griffin.mjs','core/export/gcode-lines.mjs','core/export/bambu-player.mjs',
  'core/export/dobot-player.mjs','core/export/dobot-lua-subset.mjs','core/machine/rules.mjs','core/geom/tolerance.mjs']);

// Studio reviews whatever print it is opened on. A bundle names its own schema,
// and that selects its geometry/recipe adapter. Both adapters use the single
// workflow implementation in core/print/workflow.mjs.
const bundles={
  'saam-wedge-plan/1':()=>import('../skills/wedge-demo/scripts/bundle.mjs'),
  'saam-shell-plan/1':()=>import('../core/print/bundle.mjs')
};
export async function bundleFor(directory) {
  const plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
  const load=bundles[plan.schema];
  if(!load)throw new Error(`This print uses ${plan.schema??'an unknown plan format'}, which Studio cannot review.`);
  return load();
}
// A selected plan, export or delivery file reopens its owning print bundle.
// Standalone foreign programs need an interpreter contract before review.
export async function printDirectory(input) {
  if(typeof input!=='string'||!input.trim()||input.length>4096)throw new Error('Choose a saved print folder or a file inside it.');
  let dir=await realpath(isAbsolute(input)?input:resolve(root,input));
  if(!(await stat(dir)).isDirectory())dir=dirname(dir);
  for(let depth=0;depth<4;depth++){
    try{await bundleFor(dir);return dir;}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
  throw new Error('No SAAM print bundle found. Open the saved print folder containing plan.json, geometry and machine.json. Standalone G-code/3MF import is not supported.');
}
export async function listPrints(libraryRoot) {
  const prints=[];
  async function walk(dir,depth){
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(entries.some(e=>e.name==='plan.json'&&e.isFile())){
      try{const plan=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8')),machine=JSON.parse(await readFile(resolve(dir,'machine.json'),'utf8'));
        if(bundles[plan.schema])prints.push({path:dir,name:basename(dir),machine:machine.name,modified:(await stat(resolve(dir,'plan.json'))).mtime.toISOString()});
      }catch{/* One damaged bundle must not hide the other prints. */}
      return;
    }
    if(depth<3)for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))await walk(resolve(dir,entry.name),depth+1);
  }
  await walk(resolve(libraryRoot),0);return prints.sort((a,b)=>b.modified.localeCompare(a.modified));
}
export function createStudio(directory,{startupMs=60_000,disconnectMs=3_000,libraryRoot=resolve(root,'Prints')}={}) {
  let dir=resolve(directory);
  const token=randomBytes(24).toString('hex');
  const printId=()=>createHash('sha256').update(dir).digest('hex');
  // Resolved on the first request; the no-op catch keeps an unopened print
  // from raising an unhandled rejection before a request reports it.
  let opened=bundleFor(dir);opened.catch(()=>{});
  let queue=Promise.resolve();
  const openPrint=async input=>{
    const next=await printDirectory(input),adapter=await bundleFor(next);
    await adapter.loadBundle(next,{program:false});
    dir=next;opened=Promise.resolve(adapter);
  };
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;
    if(!/^127\.0\.0\.1:\d+$/.test(host??'')){res.writeHead(403);res.end('Localhost only.');return;}
    const origin=`http://${host}`;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    const url=new URL(req.url,origin);
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try {
      if(req.method==='GET'&&url.pathname==='/api/viewer'){
        if(url.searchParams.get('token')!==token||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        lifetime.attach(res);return;
      }
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/viewer-session.mjs','/app.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/prints'){send({prints:await listPrints(libraryRoot)});return;}
      await queue;
      const readDir=dir,readId=printId();
      const bundle=await opened;
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const fingerprint=await bundle.bundleFingerprint(readDir);const state=await bundle.loadBundle(readDir,{program:'source'});
        if(fingerprint!==await bundle.bundleFingerprint(readDir)||readDir!==dir)throw new Error('The print is being updated.');
        delete state.code;delete state.dir;state.printName=basename(readDir);state.printId=readId;state.fingerprint=readId+fingerprint;send(state);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/revision'){send({fingerprint:readId+await bundle.bundleFingerprint(readDir)});return;}
      if(req.method==='GET'&&['/api/program','/api/gcode'].includes(url.pathname)) {
        const fingerprint=await bundle.bundleFingerprint(readDir);
        const state=await bundle.loadBundle(readDir,{program:'source',sourceFile:url.searchParams.get('file')??undefined});
        if(readDir!==dir)throw new Error('The open print changed. Reload before continuing.');
        if(fingerprint!==await bundle.bundleFingerprint(readDir))throw new Error('The print is being updated.');
        for(const [name,value] of [['printId',readId],['revision',state.revision],['exportHash',state.exportHash]]){
          if(url.searchParams.has(name)&&url.searchParams.get(name)!==value)throw new Error('The reviewed program changed. Reload before continuing.');
        }
        if(!state.program||state.programError)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(state.code);return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      let body='';for await(const chunk of req){body+=chunk; if(body.length>64_000)throw new Error('Request too large.');}
      const data=JSON.parse(body||'{}');
      const run=queue.then(async()=>{
        if(data.printId&&data.printId!==printId())throw new Error('The open print changed. Reload before continuing.');
        const current=await opened;
        if(url.pathname==='/api/open'){
          await openPrint(data.path);
        }
        else if(url.pathname==='/api/plan')await current.updatePlan(dir,data.plan,data.revision);
        else if(url.pathname==='/api/approve')await current.approve(dir,data);
        else if(url.pathname==='/api/generate')await current.generateBundle(dir,{development:data.development===true});
        else if(url.pathname==='/api/deliver') {
          const file=await current.deliver(dir),name=basename(file);
          const contentType=name.endsWith('.3mf')?'application/vnd.ms-package.3dmanufacturing-3dmodel+xml':name.endsWith('.zip')?'application/zip':'text/plain';
          res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':`attachment; filename="${name}"`});res.end(await readFile(file));return;
        } else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent)send({error:error.message},400);else res.end();}
  });
  // Local adapters reopen through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.openPrint=input=>{
    const run=queue.then(()=>openPrint(input));
    queue=run.catch(()=>{});return run;
  };
  const lifetime=viewerLifetime(server,{startupMs,disconnectMs});
  server.shutdown=lifetime.shutdown;
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  // Retain the old flag as a harmless alias: viewer-owned shutdown is universal.
  const args=process.argv.slice(2);
  const dir=resolve(args.find(arg=>arg!=='--close-when-idle')??resolve(root,'Prints/s5-wedge-demo'));
  const bundle=await bundleFor(dir);
  await bundle.loadBundle(dir,{program:false});
  const server=createStudio(dir),port=Number(process.env.SAAM_STUDIO_PORT??0);
  server.listen(port,'127.0.0.1',()=>console.log(`SAAM Studio: http://127.0.0.1:${server.address().port}\nPrint: ${dir}\nOpen within 60 seconds. Closes 3 seconds after the last viewer disconnects.`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.shutdown());
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
