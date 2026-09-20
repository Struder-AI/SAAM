import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {catalog,parseDat,metrics} from './airfoils.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(root,'../../..');
export async function startPrototype(port=0){
  const airfoils=await Promise.all(catalog.map(async f=>{const profile=parseDat(await readFile(resolve(root,'data',f.id+'.dat'),'utf8'));return {...f,profile,...metrics(profile)};}));
  const files=new Set(['index.html','style.css','app.mjs','model.mjs','airfoils.mjs','render.mjs']);
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      const path=new URL(req.url,'http://localhost').pathname;
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      if(path==='/api/airfoils'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(airfoils));return;}
      const name=path==='/'?'index.html':path.slice(1),file=path==='/studio/camera.mjs'?resolve(repo,'studio/camera.mjs'):files.has(name)?resolve(root,name):null;
      if(!file){res.writeHead(404);res.end('Not found');return;}
      res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css'})[extname(file)]+'; charset=utf-8');res.end(await readFile(file));
    }catch(error){res.writeHead(500);res.end('Unable to load prototype.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await startPrototype(Number(process.env.SAAM_WING_PORT||61451));console.log(JSON.stringify({event:'wing-prototype-ready',url:`http://127.0.0.1:${server.address().port}`,scope:'Design preview only'}));
}
