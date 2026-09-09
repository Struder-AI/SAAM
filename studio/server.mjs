import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');

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
export function createStudio(directory,{closeWhenIdle=false,idleMs=10_000}={}) {
  const dir=resolve(directory),token=randomBytes(24).toString('hex');
  // Resolved on the first request; the no-op catch keeps an unopened print
  // from raising an unhandled rejection before a request reports it.
  const opened=bundleFor(dir);opened.catch(()=>{});
  let queue=Promise.resolve();
  let idleTimer;
  function noteClientActivity() {
    if(!closeWhenIdle)return;
    clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>server.close(),idleMs);
  }
  const server=http.createServer(async(req,res)=>{
    noteClientActivity();
    const host=req.headers.host;
    if(!/^127\.0\.0\.1:\d+$/.test(host??'')){res.writeHead(403);res.end('Localhost only.');return;}
    const origin=`http://${host}`;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    const url=new URL(req.url,origin);
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try {
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/app.mjs','/playback.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      const bundle=await opened;
      if(req.method==='GET'&&url.pathname==='/api/state') {
        await queue;const fingerprint=await bundle.bundleFingerprint(dir);const state=await bundle.loadBundle(dir);
        if(fingerprint!==await bundle.bundleFingerprint(dir))throw new Error('The print is being updated.');
        delete state.code;delete state.dir;state.fingerprint=fingerprint;send(state);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/revision'){await queue;send({fingerprint:await bundle.bundleFingerprint(dir)});return;}
      if(req.method==='GET'&&url.pathname==='/api/gcode') {
        await queue;const state=await bundle.loadBundle(dir);
        if(!state.program)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(state.code);return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      let body='';for await(const chunk of req){body+=chunk; if(body.length>64_000)throw new Error('Request too large.');}
      const data=JSON.parse(body||'{}');
      const run=queue.then(async()=>{
        if(url.pathname==='/api/plan')await bundle.updatePlan(dir,data.plan,data.revision);
        else if(url.pathname==='/api/approve')await bundle.approve(dir,data);
        else if(url.pathname==='/api/generate')await bundle.generateBundle(dir,{development:data.development===true});
        else if(url.pathname==='/api/deliver') {
          const file=await bundle.deliver(dir),name=basename(file);
          res.writeHead(200,{'Content-Type':name.endsWith('.3mf')?'application/vnd.ms-package.3dmanufacturing-3dmodel+xml':'text/plain','Content-Disposition':`attachment; filename="${name}"`});res.end(await readFile(file));return;
        } else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent)send({error:error.message},400);else res.end();}
  });
  server.on('close',()=>clearTimeout(idleTimer));
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),closeWhenIdle=args.includes('--close-when-idle')||process.env.SAAM_STUDIO_CLOSE_WHEN_IDLE==='1';
  const dir=resolve(args.find(arg=>arg!=='--close-when-idle')??resolve(root,'Prints/s5-wedge-demo'));
  const bundle=await bundleFor(dir);
  await bundle.loadBundle(dir,{program:false});
  const server=createStudio(dir,{closeWhenIdle}),port=Number(process.env.SAAM_STUDIO_PORT??4321);
  server.listen(port,'127.0.0.1',()=>console.log(`SAAM Studio: http://127.0.0.1:${server.address().port}\nPrint: ${dir}${closeWhenIdle?'\nCloses after 10 seconds without a viewer request.':''}`));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
