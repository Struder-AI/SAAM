import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildCover,initialDesign} from './model.mjs';
import {encodeRepairSTL} from '../../core/geom/mesh-repair.mjs';
import {initBundle,proposedPlan} from '../../core/print/bundle.mjs';
import {loadMachine,centeredPlacement} from '../../core/machine/profile.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(root,'../..');
export async function handoff(result,machineId='bambu-h2d',directory){
 const machine=loadMachine(machineId),plan=await proposedPlan(machineId);
 plan.geometry=result.geometry;plan.skills['draped-skin'].enabled=false;
 plan.placement=centeredPlacement(machine,plan.setup.tool,{runMm:result.width,widthMm:result.height});
 if(result.design.treatment.startsWith('two-color')){
  if(!(result.previewMaterials??result.geometry.materialParts)?.some(p=>p.id.startsWith('text/')))throw Error('Two-color printing needs at least one visible label.');
  if(plan.output!=='bambu-gcode'||!plan.setup.bambu?.filaments||plan.setup.bambu.filaments.length<2)throw Error('Two-color geometry is ready. Configure two logical filaments in SAAM first, or download the material parts to assign colors in another slicer.');
  plan.composition.regions=result.design.treatment==='two-color-flush'?[{id:'plate',part:'plate',filament:0,zStartMm:0,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:null},{id:'labels',part:'labels',filament:1,zStartMm:0,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:null}]:[{id:'plate',part:'base',filament:0,zStartMm:0,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:null},...result.geometry.materialParts.filter(p=>p.id.startsWith('text/')).map((p,i)=>({id:`label-${i+1}`,part:p.id,filament:1,zStartMm:0,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:null}))];
 }
 const dir=directory??resolve(repo,'Prints',`light-switch-cover-${randomUUID().slice(0,8)}`);
 await initBundle(dir,plan,{machineId});
 await writeFile(resolve(dir,'HANDOFF.md'),`# Light switch cover print notes\n\nOrientation: face ${result.printFace}.\nLettering: ${result.design.treatment}.\nRear pocket depth: ${result.design.rearPocketDepth} mm.\n\n${result.warnings.map(note=>'− '+note).join('\n')}\n\nReview support placement, geometry, settings and the exact toolpath in SAAM Studio before confirmation and export.\n`);
 await writeFile(resolve(dir,'cover-design.json'),JSON.stringify(result.design,null,2)+'\n');
 return {directory:dir,notesFile:resolve(dir,'HANDOFF.md'),printNotes:result.warnings,command:`node studio/server.mjs --toolkit open-print "${dir}" --no-open`,approvals:'none'};
}
export async function startWorkspace(port=0,{storageDirectory=resolve(root,'.local')}={}){
 const local=storageDirectory;await mkdir(local,{recursive:true});
 let startup=initialDesign;try{startup=JSON.parse(await readFile(resolve(local,'current-design.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const token=randomBytes(24).toString('hex');let queue=Promise.resolve(),latest=null;
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 const server=createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost');
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   if(req.headers.host!==`127.0.0.1:${server.address().port}`){json(403,{error:'Invalid local host.'});return;}
   if(req.method==='GET'){
    if(url.pathname==='/api/config'){json(200,{token,initialDesign:startup,catalog:JSON.parse(await readFile(resolve(root,'catalog.json'),'utf8'))});return;}
    const files={'/':'index.html','/app.mjs':'app.mjs','/gallery.mjs':'gallery.mjs','/style.css':'style.css'};
    const file=files[url.pathname];if(!file){json(404,{error:'Not found'});return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(resolve(root,file)));return;
   }
   if(req.method!=='POST'){json(405,{error:'Method not supported'});return;}
   if(req.headers['x-workspace-token']!==token){json(403,{error:'Invalid workspace session.'});return;}
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)throw Error('Design request too large.');}
   const payload=JSON.parse(raw);
   if(url.pathname==='/api/build'){
    const result=await serial(async()=>{const built=await buildCover(payload);await writeFile(resolve(local,'current-design.json.tmp'),JSON.stringify(built.design,null,2)+'\n');await rename(resolve(local,'current-design.json.tmp'),resolve(local,'current-design.json'));startup=built.design;return built;});const id=randomUUID();latest={id,result};
    const g=result.geometry;const materials=(result.previewMaterials??g.materialParts)?.map(p=>({id:p.id,vertices:(p.geometry??g.base).vertices,triangles:(p.geometry??g.base).triangles}))??[];
    json(200,{...result,geometry:undefined,previewMesh:undefined,previewMaterials:undefined,mesh:{vertices:(result.previewMesh??g).vertices,triangles:(result.previewMesh??g).triangles},materials,id});return;
   }
   if(!latest||payload.id!==latest.id)throw Error('Preview is stale. Build the current design first.');
   const current=latest;
   if(url.pathname==='/api/stl'){
    const part=payload.part?(current.result.previewMaterials??current.result.geometry.materialParts)?.find(p=>p.id===payload.part):null;
    if(payload.part&&!part)throw Error('Unknown material part.');
    const geometry=part?(part.geometry??current.result.geometry.base):(current.result.previewMesh??current.result.geometry);
    res.writeHead(200,{'Content-Type':'model/stl','Content-Disposition':'attachment; filename="switch-cover.stl"'});res.end(encodeRepairSTL(geometry));return;
   }
   if(url.pathname==='/api/handoff'){if(!['bambu-h2d','bambu-x1-carbon','ultimaker-s5'].includes(payload.machineId))throw Error('Unknown machine.');json(200,await serial(()=>handoff(current.result,payload.machineId)));return;}
   json(404,{error:'Not found'});
  }catch(error){json(400,{error:error.message});}
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await startWorkspace(Number(process.env.SAAM_COVER_PORT??61452));console.log(JSON.stringify({event:'light-switch-covers-ready',url:`http://127.0.0.1:${server.address().port}`}));
}
