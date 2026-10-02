// Author a normal editable vase recipe on an imported mesh. Geometry/source
// bytes stay owned by the bundle; this helper authors common assignments.
import {isDeepStrictEqual} from 'node:util';
import {advancedVaseRecordRuntime} from './record.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const {validateSleevePattern}=advancedVaseRecordRuntime();
const MESH_SLEEVE_SETTINGS={fidelity:1,contactSide:'inside',circumferentialControls:12,heightControls:6,detailToleranceMm:.05};

const keys=(value,allowed,label)=>requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),`Unknown or invalid ${label} options.`);
const same=isDeepStrictEqual;

export async function prepareMeshVase(source,options={}, {Geometry,Toolpath}){
  const {makeMesh,detectMeshSleeveInterval,horizontalSlice,sliceFamily}=Geometry;
  const {defaultSlices,depositionAssignment}=Toolpath;
  keys(options,['meshSleeve','pattern','baseHeightMm','endTransition','detect'],'mesh vase');
  if(Object.hasOwn(options,'detect'))keys(options.detect,['marginMm','toleranceMm','sampleCount','maxSecondaryAreaFraction','zMinMm','zMaxMm'],'sleeve detection');
  // Generation uses the shared fit's 0.1% extraction allowance. Detection may
  // be stricter, but cannot accept a topology the persisted fit would reject.
  if(options.detect?.maxSecondaryAreaFraction!==undefined)requireThat(Number.isFinite(options.detect.maxSecondaryAreaFraction)
    &&options.detect.maxSecondaryAreaFraction>=0&&options.detect.maxSecondaryAreaFraction<=.001,
    'Mesh vase detection maxSecondaryAreaFraction must be between 0 and 0.001, matching the fitted sleeve extraction allowance; larger secondary features require another sleeve selection.');
  if(Object.hasOwn(options,'meshSleeve'))keys(options.meshSleeve,Object.keys(MESH_SLEEVE_SETTINGS),'meshSleeve');
  const plan=structuredClone(source);
  requireThat(plan.geometry.shape==='mesh','Mesh vase preparation selects one mesh print. For assemblies, configure the selected component with the normal adjustment tools.');
  requireThat(!plan.composition.order.length&&!plan.composition.dependencies.length,
    'This print has explicit ordering. Configure its sleeve assignment through normal adjustment tools; mesh preparation does not replace ordering.');
  const initial={slices:defaultSlices()},existing=plan.slices.assignments.filter(a=>a.construction==='sleeve');
  requireThat(existing.length<=1,'Mesh vase preparation needs one selected sleeve assignment.');
  const wall=existing[0]??depositionAssignment({construction:'sleeve',id:'wall'}),body=plan.slices.assignments.filter(a=>a.construction!=='sleeve');
  for(const [name,settings] of Object.entries(plan.skills??{}))if(settings.enabled){
    requireThat(false,
      `Mesh vase preparation cannot replace enabled ${name}. Disable it explicitly or configure the existing composition with normal adjustment tools.`);
  }
  const geometry=plan.geometry,mesh=makeMesh(geometry.vertices,geometry.triangles),low=mesh.bounds.min[2];
  const detected=detectMeshSleeveInterval(mesh,{marginMm:Math.min(Math.max(plan.process.lineWidthMm,plan.process.layerMm),(mesh.bounds.max[2]-low)/4),toleranceMm:wall.boundaryToleranceMm,...options.detect});
  const minimumBase=Math.max(plan.process.firstLayerMm+2*plan.process.layerMm,detected.rangeMm[0]-low);
  const baseHeight=options.baseHeightMm??(existing.length?wall.zStartMm:
    sliceFamily({base:horizontalSlice(0),pitchMm:plan.process.layerMm,firstLayerMm:plan.process.firstLayerMm},{min:[0,0,0],max:[0,0,minimumBase+plan.process.layerMm]}).layers.map(l=>l.slice.origin[2]).find(z=>z>=minimumBase-1e-9));
  requireThat(Number.isFinite(baseHeight)&&baseHeight>=0,'baseHeightMm must be nonnegative.');
  const base=low+baseHeight,end=detected.rangeMm[1];
  requireThat(base>=detected.rangeMm[0]-1e-9,'baseHeightMm must reach the detected sleeve start; choose a taller base explicitly.');
  const firstHeight=baseHeight<1e-9?plan.process.firstLayerMm:plan.process.layerMm,start=base+firstHeight,span=end-start;
  requireThat(span>0,'The detected sleeve has no room above the selected base and first bead.');
  if(baseHeight===0&&body.length)requireThat(same(body,initial.slices.assignments),
    'Mesh vase preparation cannot discard customized slice assignments. Remove them explicitly before selecting a wall without a base.');
  const meshSleeve={...MESH_SLEEVE_SETTINGS,...wall.meshSleeve,...options.meshSleeve};
  const pattern=structuredClone(Object.hasOwn(options,'pattern')?options.pattern:wall.pattern);
  validateSleevePattern(pattern,'continuous');
  let authoredPoints=0;
  const endTransition=options.endTransition??(existing.length?wall.endTransition:'level');
  requireThat(['level','spiral'].includes(endTransition),'endTransition must be level or spiral.');
  if(pattern){
    const expanded=pattern;
    let minimum=Infinity,maximum=-Infinity;
    for(const path of expanded.paths)for(const p of path.points){minimum=Math.min(minimum,p[1]);maximum=Math.max(maximum,p[1]);}
    requireThat(minimum>=-1e-9,'The authored pattern descends below its first bead; revise the explicit path heights.');
    requireThat(maximum+(pattern.repeats-1)*expanded.advance[1]<=span+1e-9,
      'The requested complete pattern courses exceed the detected sleeve interval. Revise repeats or the selected interval explicitly; no path was trimmed.');
    authoredPoints=expanded.paths.reduce((n,p)=>n+p.points.length,0)*(pattern.repeats+(endTransition==='level'?2:0));
    requireThat(Number.isSafeInteger(authoredPoints),'The authored pattern point count exceeds the safe integer range.');
  }
  const settings=depositionAssignment({...wall,zStartMm:baseHeight,zEndMm:end-low,endTransition,pathMode:'continuous',pattern,meshSleeve});
  // Slices own the base below the wall; a wall without a base leaves none.
  const slices={version:plan.slices.version,assignments:[...(baseHeight>0?(body.length?body:initial.slices.assignments):[]),settings]};
  return {assignments:slices.assignments,
    report:{detectedSleeve:detected,baseHeightMm:baseHeight,wallRangeMm:[start,end],
      bodyCourses:pattern?.repeats??null,boundaryCourses:pattern&&endTransition==='level'?2:0,authoredPoints,
      baseEnabled:baseHeight>0,sourceGeometryChanged:false,
      nextStep:'Review the recipe and use the normal check-path/Studio generation workflow; preparation creates no machine program or approval.'}};
}
