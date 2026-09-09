import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadBundle, updatePlan, approve, generateBundle, deliver, root, bundleFingerprint } from '../skills/wedge-demo/scripts/bundle.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export function createStudio(directory) {
  const dir=resolve(directory),token=randomBytes(24).toString('hex');
  let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
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
      if(req.method==='GET'&&url.pathname==='/api/state') {
        await queue;const fingerprint=await bundleFingerprint(dir);const state=await loadBundle(dir);
        if(fingerprint!==await bundleFingerprint(dir))throw new Error('The print is being updated.');
        delete state.code;delete state.dir;state.fingerprint=fingerprint;send(state);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/revision'){await queue;send({fingerprint:await bundleFingerprint(dir)});return;}
      if(req.method==='GET'&&url.pathname==='/api/gcode') {
        await queue;const state=await loadBundle(dir);
        if(!state.program)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(state.code);return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      let body='';for await(const chunk of req){body+=chunk; if(body.length>64_000)throw new Error('Request too large.');}
      const data=JSON.parse(body||'{}');
      const run=queue.then(async()=>{
        if(url.pathname==='/api/plan')await updatePlan(dir,data.plan,data.revision);
        else if(url.pathname==='/api/approve')await approve(dir,data);
        else if(url.pathname==='/api/generate')await generateBundle(dir,{development:data.development===true});
        else if(url.pathname==='/api/deliver') {
          const file=await deliver(dir);res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="wedge.gcode"'});res.end(await readFile(file));return;
        } else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent)send({error:error.message},400);else res.end();}
  });
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dir=resolve(process.argv[2]??resolve(root,'Prints/s5-wedge-demo'));
  await loadBundle(dir,{program:false});
  const server=createStudio(dir),port=Number(process.env.SAAM_STUDIO_PORT??4321);
  server.listen(port,'127.0.0.1',()=>console.log(`SAAM Studio: http://127.0.0.1:${server.address().port}\nPrint: ${dir}`));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
