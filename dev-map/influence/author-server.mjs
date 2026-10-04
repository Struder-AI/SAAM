// The authoring server (plans/dev-maps.md milestone 5): the influence viewer served from this
// checkout, accepting the positions the owner drags boxes to and writing them as authored data
// (placement.mjs): map 0's nodes to the authored set's architecture.json, every other box to the
// set's layout.json, each file replaced atomically.
//
//   node dev-map/cli.mjs --set 030-influence serve [--port 8768]
//
// It draws the view once on start, so the drawing matches the layout files, then serves view/:
//   GET  /api/layout     every authored position, MAP → BOX → {x,y}
//   POST /api/positions  {"map":PATH,"set":{BOX:{x,y}|null}}  null returns a box to the solver
//   POST /api/reset      {"map":PATH}  a submap back to its solved layout, redrawn
//   POST /api/rebuild    redraw the view from the stored model and the layout files
// A redraw changes the view's stamp and open viewers reload. It listens on loopback only and
// accepts only same-origin JSON posts, so another site open in the browser cannot write.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,relative,extname,sep} from 'node:path';
import {readPlacement,writePositions,resetMap} from './placement.mjs';

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.css':'text/css; charset=utf-8','.png':'image/png'};
const LIMIT=1<<20;

export async function serve({port=8768,files,view,set,log=console.error}) {
  const rel=file=>relative(files.repo,file).replaceAll('\\','/');
  const {buildGeneratedView}=await import('../lib/generated-view.mjs');
  // Redraws run one at a time; a request arriving during one waits for the next.
  let drawing=Promise.resolve(),last=null;
  const redraw=()=>drawing=drawing.catch(()=>{}).then(async()=>{
    const started=Date.now(),v=await buildGeneratedView({repo:files.repo});
    last=v.placement;
    log(`drew ${v.pages} pages in ${Date.now()-started} ms; ${v.placement?.applied??0} authored positions applied${v.placement?.missing.length?`, ${v.placement.missing.length} not found (map 0 lists them)`:''}`);
    return v;});
  await redraw();
  // Writes are serialised too: each reads the files fresh and replaces them whole.
  let writing=Promise.resolve();
  const exclusive=fn=>{const run=writing.catch(()=>{}).then(fn);writing=run;return run;};
  const layout=()=>({mode:'server',set,files:[rel(resolve(files.authored,'architecture.json')),rel(files.layout)],
    maps:readPlacement(files).maps,missing:last?.missing.length??0});

  const hosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`]);
  const send=(res,code,body,type='application/json; charset=utf-8')=>{
    res.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  const body=req=>new Promise((done,fail)=>{let size=0;const parts=[];
    req.on('data',d=>{size+=d.length;if(size>LIMIT){fail(Error('request too large'));req.destroy();}else parts.push(d);});
    req.on('end',()=>{try{done(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{fail(Error('request body is not JSON'));}});
    req.on('error',fail);});

  const handle=async(req,res)=>{
    if(!hosts.has(req.headers.host??''))return send(res,421,{error:'unexpected host'});
    const url=new URL(req.url,`http://${req.headers.host}`),path=decodeURIComponent(url.pathname);
    if(path.startsWith('/api/')) {
      if(req.method==='GET'&&path==='/api/layout')return send(res,200,layout());
      if(req.method!=='POST')return send(res,405,{error:'method not allowed'});
      const origin=req.headers.origin;
      if(origin&&!hosts.has(origin.replace(/^http:\/\//,'')))return send(res,403,{error:'cross-origin write refused'});
      if(!/^application\/json\b/.test(req.headers['content-type']??''))return send(res,415,{error:'send application/json'});
      const input=await body(req);
      if(path==='/api/positions') {
        const wrote=await exclusive(()=>writePositions({...files,map:input.map,set:input.set}));
        log(`placed on ${input.map}: ${Object.entries(input.set).map(([box,p])=>`${box} ${p?`(${p.x}, ${p.y})`:'→ solved'}`).join('; ')} → ${wrote.join(', ')}`);
        return send(res,200,{ok:true,wrote,...layout()});
      }
      if(path==='/api/reset') {
        const wrote=await exclusive(()=>resetMap({...files,map:input.map}));
        log(`reset ${input.map} to its solved layout${wrote.length?` → ${wrote.join(', ')}`:' (nothing placed)'}`);
        await redraw();
        return send(res,200,{ok:true,wrote,...layout()});
      }
      if(path==='/api/rebuild'){await redraw();return send(res,200,{ok:true,...layout()});}
      return send(res,404,{error:'no such endpoint'});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'method not allowed'});
    const file=resolve(view,'.'+(path.endsWith('/')?path+'index.html':path));
    if(file!==view&&!file.startsWith(view+sep))return send(res,403,{error:'outside the view'});
    try{if(!(await stat(file)).isFile())throw Error();}catch{return send(res,404,'not found','text/plain; charset=utf-8');}
    return send(res,200,await readFile(file),TYPES[extname(file)]??'application/octet-stream');
  };
  const listener=(req,res)=>handle(req,res).catch(error=>send(res,400,{error:error.message}));
  // Loopback on both families: a browser may resolve localhost to either.
  const servers=[];
  for(const host of ['127.0.0.1','::1']) {
    const server=createServer(listener);
    const ok=await new Promise(done=>{server.once('error',error=>{if(host==='127.0.0.1')throw error;done(false);});server.listen(port,host,()=>done(true));});
    if(ok)servers.push(server);
  }
  log(`authoring ${set} at http://localhost:${port}/ · drops save to ${layout().files.join(' and ')} · ctrl+c stops`);
  await new Promise(done=>{const stop=()=>{for(const s of servers)s.close();done();};process.once('SIGINT',stop);process.once('SIGTERM',stop);});
}
