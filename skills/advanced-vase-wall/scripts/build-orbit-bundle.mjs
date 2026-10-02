// Installed Slice/Trace adapter for the deterministic orbit skill. No core edits.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {orbitPrimaryPath} from './orbit.mjs';
export async function buildOrbitBundle(root,sourceDir,targetDir,options={}){
const allowed=['wallWidthMm','overlap','baseLayers','layerMm','beadWidthMm','speedMmS','stepMm','primaryStepMm'];
if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!allowed.includes(k)))throw Error('Unknown orbital wall options.');
const mod=p=>import(pathToFileURL(resolve(root,p)));
const [{createSectionQuery},{contourPath},{signedArea},{curveAssignment},{initBundle},{ordinarySliceAssignment}]=await Promise.all(['core/geom/query.mjs','core/geom/contour-path.mjs','core/geom/shell.mjs','core/print/curves.mjs','core/print/bundle.mjs','core/print/slice-settings.mjs'].map(mod));
const started=performance.now(),manifest=JSON.parse(await readFile(resolve(sourceDir,'plan.json'),'utf8'));
const {bundle,...plan}=manifest;const mesh=plan.geometry;if(mesh?.shape!=='mesh')throw Error('This adapter requires one imported mesh; orbitPrimaryPath also accepts other precomputed XYZ spirals.');
const layerMm=options.layerMm??plan.process.layerMm,beadWidthMm=options.beadWidthMm??plan.process.lineWidthMm,speedMmS=options.speedMmS??plan.process.planarSpeedMmS,wallWidthMm=options.wallWidthMm??2,overlap=options.overlap??.5,baseLayers=options.baseLayers??3,stepMm=options.stepMm??.06,primaryStepMm=options.primaryStepMm??.12;
for(const [name,value] of Object.entries({layerMm,beadWidthMm,speedMmS,wallWidthMm,stepMm,primaryStepMm}))if(!Number.isFinite(value)||value<=0)throw Error(`${name} must be positive.`);
if(!Number.isSafeInteger(baseLayers)||baseLayers<0)throw Error('baseLayers must be a nonnegative integer.');
if(!Number.isFinite(overlap)||overlap<0||overlap>=1||wallWidthMm<=beadWidthMm)throw Error('Overlap must be in [0,1), and wall width must exceed bead width.');
const baseHeightMm=baseLayers?plan.process.firstLayerMm+(baseLayers-1)*layerMm:0;
plan.process.layerMm=layerMm;plan.process.lineWidthMm=beadWidthMm;plan.process.planarSpeedMmS=speedMmS;
const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
for(const p of mesh.vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
const query=createSectionQuery({...mesh,kind:'triangle-mesh',bounds}),start=bounds.min[2]+baseHeightMm+(baseLayers?layerMm:plan.process.firstLayerMm),end=bounds.max[2],rise=layerMm;
if(end<=start)throw Error('Base and first wall bead exceed mesh height.');
const sections=[];let anchor=null;const turns=(end-start)/rise,totalCourses=Math.ceil(turns);
for(let i=0;i<=totalCourses;i++){
  const z=Math.min(end,start+i*rise),outers=query(z).loops.filter(l=>signedArea(l)>0);if(outers.length!==1)throw Error(`Primary spiral requires one outer contour at ${z}; found ${outers.length}.`);const outer=outers[0];
  const path=contourPath(outer,anchor);anchor??=path.seam;sections.push({z,path});
}
const primary=[];for(let c=0;c<totalCourses;c++){
  const a=sections[c],b=sections[c+1],fraction=(b.z-a.z)/rise,n=Math.ceil(Math.max(a.path.length,b.path.length)*fraction/primaryStepMm);
  for(let j=c?1:0;j<=n;j++){
    const f=j/n,u=c+fraction*f,pa=a.path.at(u),pb=b.path.at(u),p=pa.map((v,k)=>v+f*(pb[k]-v));
    const d=1e-5,aa=a.path.at(u-d),bb=a.path.at(u+d),dx=bb[0]-aa[0],dy=bb[1]-aa[1],h=Math.hypot(dx,dy);
    primary.push([p[0]-beadWidthMm/2*dy/h,p[1]+beadWidthMm/2*dx/h,a.z+f*(b.z-a.z)]);
  }
}
const primaryDone=performance.now(),r=orbitPrimaryPath(primary,{wallWidthMm,beadWidthMm,overlap,speedMmS,stepMm}),patternDone=performance.now();
const courses=[];let points=[r.points[0]],course=0;
for(let i=1;i<r.points.length;i++){
  const p=r.points[i];if(course<totalCourses-1&&p[2]>=start+(course+1)*rise){points.push(p);courses.push(points);points=[p];course++;}else points.push(p);
}
if(points.length>1)courses.push(points);
const body=ordinarySliceAssignment({id:'body',loops:2,fillDensity:1,solidTop:0,solidBottom:baseLayers,within:[{kind:'slab',fromMm:0,toMm:baseHeightMm}]});
plan.slices.assignments=[...(baseLayers?[body]:[]),curveAssignment({id:'orbit',sequence:true,repeat:{count:courses.length,translation:[0,0,0]},curves:courses.map((points,i)=>({points,closed:false,courses:[i],beadWidthMm,heightMm:i===0&&baseLayers===0?plan.process.firstLayerMm:layerMm,speedMmS,sampleStepMm:.4,toleranceMm:.02,role:'vase-wall'}))})];
plan.modulations={version:1,modifiers:[]};plan.composition={order:[],dependencies:[],filaments:plan.composition.filaments.filter(f=>!f.assignment||f.assignment==='body')};plan.experimental.substrateAdaptation=false;
await initBundle(targetDir,plan,{machineId:bundle.machine.id,sourcePath:resolve(sourceDir,'geometry/source.stl')});
await mkdir(resolve(targetDir,'authoring'),{recursive:true});
const report={wallWidthMm,beadWidthMm,overlap,baseLayers,layerMm,stepMm,primaryStepMm,primarySections:sections.length,primaryPoints:primary.length,wallCourses:courses.length,sourceBundle:sourceDir,sourceHash:mesh.source?.sha256,rangeMm:[start,end],timingsSeconds:{readAndPrimary:(primaryDone-started)/1000,orbit:(patternDone-primaryDone)/1000,bundle:(performance.now()-patternDone)/1000},...r.report};
await writeFile(resolve(targetDir,'authoring/orbit.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [root,source,target,optionsFile]=process.argv.slice(2);
  if(!target)throw Error('Usage: node build-orbit-bundle.mjs SAAM_ROOT SOURCE_BUNDLE NEW_BUNDLE [OPTIONS_JSON]');
  const options=optionsFile?JSON.parse(await readFile(optionsFile,'utf8')):{};
  console.log(JSON.stringify(await buildOrbitBundle(root,source,target,options),null,2));
}
