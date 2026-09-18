// Author a normal editable vase recipe on an imported mesh. Geometry/source
// bytes stay owned by the bundle; this helper changes only skill settings.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadBundle,adjustBundle} from '../../../core/print/bundle.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {detectMeshSleeveInterval} from '../../../core/geom/mesh-sleeve.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {MESH_SLEEVE_SETTINGS} from './reference.mjs';
import {isTiledMotif,loopMotif,tileVaseMotif} from './motif.mjs';
import {validateVasePattern} from './paths.mjs';
import {layerHeights} from '../../full-fill/scripts/fill.mjs';

const keys=(value,allowed,label)=>requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),`Unknown or invalid ${label} options.`);
const same=isDeepStrictEqual;

export async function prepareMeshVase(directory,options={}, {expectedRevision}={}){
  keys(options,['meshSleeve','pattern','motif','loop','cellsPerTurn','courseRiseMm','tiltDeg','repeats','baseHeightMm','endTransition','detect'],'mesh vase');
  if(Object.hasOwn(options,'detect'))keys(options.detect,['marginMm','toleranceMm','sampleCount','maxSecondaryAreaFraction','zMinMm','zMaxMm'],'sleeve detection');
  // Generation uses the shared fit's 0.1% extraction allowance. Detection may
  // be stricter, but cannot accept a topology the persisted fit would reject.
  if(options.detect?.maxSecondaryAreaFraction!==undefined)requireThat(Number.isFinite(options.detect.maxSecondaryAreaFraction)
    &&options.detect.maxSecondaryAreaFraction>=0&&options.detect.maxSecondaryAreaFraction<=.001,
    'Mesh vase detection maxSecondaryAreaFraction must be between 0 and 0.001, matching the fitted sleeve extraction allowance; larger secondary features require another sleeve selection.');
  if(Object.hasOwn(options,'meshSleeve'))keys(options.meshSleeve,Object.keys(MESH_SLEEVE_SETTINGS),'meshSleeve');
  if(Object.hasOwn(options,'loop'))keys(options.loop,['widthCells','depthMm','samples','beadHeightMm','exterior'],'loop motif');
  const state=await loadBundle(directory,{program:false}),plan=state.plan;
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before preparing the mesh vase.');
  requireThat(plan.geometry.shape==='mesh','Mesh vase preparation selects one mesh print. For assemblies, configure the selected component with the normal adjustment tools.');
  requireThat(!plan.composition.regions.length&&!plan.composition.order.length&&!plan.composition.dependencies.length,
    'This print has an existing composition. Configure its vase region through normal adjustment tools; mesh preparation does not replace composition.');
  const initial=defaults(state.machine),wall=plan.skills['vase-wall'],disabled=[];
  for(const [name,settings] of Object.entries(plan.skills))if(settings.enabled&&!['vase-wall','full-fill'].includes(name)){
    requireThat(name==='draped-skin'&&same(settings,initial.skills[name]),
      `Mesh vase preparation cannot replace enabled ${name}. Disable it explicitly or configure the existing composition with normal adjustment tools.`);
    disabled.push(name);
  }
  const geometry=plan.geometry,mesh=makeMesh(geometry.vertices,geometry.triangles),low=mesh.bounds.min[2];
  const detected=detectMeshSleeveInterval(mesh,{marginMm:Math.min(Math.max(plan.process.lineWidthMm,plan.process.layerMm),(mesh.bounds.max[2]-low)/4),toleranceMm:wall.boundaryToleranceMm,...options.detect});
  const minimumBase=Math.max(plan.process.firstLayerMm+2*plan.process.layerMm,detected.rangeMm[0]-low);
  const baseHeight=options.baseHeightMm??(wall.enabled?wall.zStartMm:
    layerHeights(plan.process,0,minimumBase+plan.process.layerMm).find(z=>z>=minimumBase-1e-9));
  requireThat(Number.isFinite(baseHeight)&&baseHeight>=0,'baseHeightMm must be nonnegative.');
  const base=low+baseHeight,end=detected.rangeMm[1];
  requireThat(base>=detected.rangeMm[0]-1e-9,'baseHeightMm must reach the detected sleeve start; choose a taller base explicitly.');
  const firstHeight=baseHeight<1e-9?plan.process.firstLayerMm:plan.process.layerMm,start=base+firstHeight,span=end-start;
  requireThat(span>0,'The detected sleeve has no room above the selected base and first bead.');
  if(baseHeight===0&&plan.skills['full-fill'].enabled)requireThat(same(plan.skills['full-fill'],initial.skills['full-fill']),
    'Mesh vase preparation cannot discard customized full-fill settings. Disable full-fill explicitly before selecting a wall without a base.');
  const selectors=['pattern','motif','loop'].filter(k=>Object.hasOwn(options,k));
  requireThat(selectors.length<=1,'Select one pattern, motif or loop preset.');
  const meshSleeve={...MESH_SLEEVE_SETTINGS,...wall.meshSleeve,...options.meshSleeve};
  const layoutKeys=['cellsPerTurn','courseRiseMm','tiltDeg','repeats'];
  const preserve=!selectors.length&&wall.enabled;
  requireThat(!(preserve||Object.hasOwn(options,'pattern'))||!layoutKeys.some(k=>Object.hasOwn(options,k)),
    'Specify layout inside an explicit pattern, or select motif/loop to author a new tiled pattern.');
  let pattern,automaticCount=false;
  if(Object.hasOwn(options,'pattern'))pattern=structuredClone(options.pattern);
  else if(preserve)pattern=structuredClone(wall.pattern);
  else{
    const motif=Object.hasOwn(options,'motif')?options.motif:loopMotif({beadHeightMm:plan.process.layerMm,
      exterior:meshSleeve.contactSide==='outside'?'scalloped':'smooth',...options.loop});
    pattern={motif:structuredClone(motif),cellsPerTurn:options.cellsPerTurn??20,courseRiseMm:options.courseRiseMm??plan.process.layerMm,
      tiltDeg:options.tiltDeg??0,repeats:options.repeats??1};
    automaticCount=options.repeats===undefined;
  }
  validateVasePattern(pattern,'continuous');
  let authoredPoints=0;
  const endTransition=options.endTransition??(wall.enabled?wall.endTransition:'level');
  requireThat(['level','spiral'].includes(endTransition),'endTransition must be level or spiral.');
  if(pattern){
    const expanded=isTiledMotif(pattern)?tileVaseMotif(pattern):pattern;
    let minimum=Infinity,maximum=-Infinity;
    for(const path of expanded.paths)for(const p of path.points){minimum=Math.min(minimum,p[1]);maximum=Math.max(maximum,p[1]);}
    requireThat(minimum>=-1e-9,'The authored motif descends below its first bead; revise motif tilt or height.');
    if(automaticCount){
      pattern.repeats=Math.floor((span-maximum+1e-9)/expanded.advance[1])+1;
      requireThat(pattern.repeats>=1,'One complete motif course does not fit above the base; reduce its rise/height or choose a taller sleeve.');
    }
    requireThat(maximum+(pattern.repeats-1)*expanded.advance[1]<=span+1e-9,
      'The requested complete motif courses exceed the detected sleeve interval. Revise repeats or the selected interval explicitly; no path was trimmed.');
    authoredPoints=expanded.paths.reduce((n,p)=>n+p.points.length,0)*(pattern.repeats+(endTransition==='level'?2:0));
    requireThat(Number.isSafeInteger(authoredPoints),'The authored motif point count exceeds the safe integer range.');
  }
  const settings={enabled:true,part:null,zStartMm:baseHeight,zEndMm:end-low,endTransition,pathMode:'continuous',pattern,
    meshSleeve};
  const skills={'vase-wall':settings,'full-fill':{enabled:baseHeight>0}};
  for(const name of disabled)skills[name]={enabled:false};
  const updated=await adjustBundle(directory,{skills},{expectedRevision:state.revision});
  return {directory:updated.dir,revision:updated.revision,geometryHash:updated.geometryHash,geometryApproved:updated.geometryApproved,
    planApproved:updated.planApproved,settings:updated.plan.skills['vase-wall'],
    report:{detectedSleeve:detected,baseHeightMm:baseHeight,wallRangeMm:[start,end],automaticCourseCount:automaticCount,
      bodyCourses:pattern?.repeats??null,boundaryCourses:pattern&&endTransition==='level'?2:0,authoredPoints,
      baseEnabled:baseHeight>0,disabledDefaultSkills:disabled,sourceGeometryChanged:false,
      nextStep:'Review the recipe and use the normal check-path/Studio generation workflow; preparation creates no machine program or approval.'}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),directory=args.shift();
  requireThat(directory&&!directory.startsWith('--'),'Usage: node skills/vase-wall/scripts/prepare-mesh.mjs PRINT [--options options.json] [--expected-revision REVISION]');
  let options={},expectedRevision;
  while(args.length){
    const flag=args.shift(),value=args.shift();requireThat(value&&['--options','--expected-revision'].includes(flag),'Expected --options FILE or --expected-revision REVISION.');
    if(flag==='--options')options=JSON.parse(await readFile(resolve(value),'utf8'));else expectedRevision=value;
  }
  console.log(JSON.stringify(await prepareMeshVase(resolve(directory),options,{expectedRevision}),null,2));
}
