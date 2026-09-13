import {supportSurface,supportSurfaceSection,supportBoundaryAt} from '../../../core/geom/support-surface.mjs';
import {offsetSurfaceSection} from '../../../core/region/section-offset.mjs';
import {layerHeights} from '../../full-fill/scripts/fill.mjs';
import {requireThat,distance} from '../../../core/geom/tolerance.mjs';
import {lineSpacing} from '../../../core/path/spacing.mjs';

export const RIMMING_DEFAULTS={enabled:false,spacingFactor:1,surfaces:[],sampleStepMm:0.5,toleranceMm:0.01,minFeatureMm:0.2,maxPoints:100000};
export function validateRimming(settings){
  requireThat(typeof settings.enabled==='boolean'&&Array.isArray(settings.surfaces),'Invalid rimming selection.');
  for(const key of ['sampleStepMm','toleranceMm','minFeatureMm'])requireThat(Number.isFinite(settings[key])&&settings[key]>0,`Rimming ${key} must be positive.`);
  requireThat(Number.isSafeInteger(settings.maxPoints)&&settings.maxPoints>0,'Rimming maxPoints must be a positive safe integer.');
  requireThat(!settings.enabled||settings.surfaces.length>0,'Enabled rimming needs explicitly assigned surfaces.');
  const ids=new Set();
  for(const s of settings.surfaces){
    requireThat(s&&Object.keys(s).sort().join()==='baseEdge,basePart,controlPoints,degreeU,degreeV,id,outwardSide,reason,supportedEdge,supportedPart','Invalid rimming surface fields.');
    requireThat(typeof s.id==='string'&&/^[a-z][a-z0-9-]*$/.test(s.id)&&!ids.has(s.id),'Invalid or duplicate rim ID.');ids.add(s.id);
    for(const key of ['reason','baseEdge','supportedEdge'])requireThat(typeof s[key]==='string'&&s[key].trim().length>0,`Rimming ${key} must describe the assigned edge or rationale.`);
    requireThat([1,-1].includes(s.outwardSide),'Rimming outwardSide must be 1 or -1 relative to the spline normal.');
    requireThat([s.basePart,s.supportedPart].every(p=>p===null||typeof p==='string'),'Invalid rimming component reference.');
    supportSurface(s);
    if(s.baseEdge==='bed')requireThat(s.controlPoints.every(row=>row[0][2]===0),'A bed-based rim must put its base control edge at Z=0.');
  }
}

const extent=op=>op.strokes.reduce((b,s)=>{for(const p of s.points){b.min=Math.min(b.min,p[2]);b.max=Math.max(b.max,p[2]);}return b;},{min:Infinity,max:-Infinity});

// Both public skills use this producer and the same source surface/width.
// Differences are confined to the offset vector and resulting motion geometry.
export function rimmingResults({plan,modelResults,mode='horizontal',skillId='rimming-planar'}){
  const settings=plan.skills[skillId];if(!settings?.enabled)return [];
  // Shared validatePlan owns the settings contract. Check derived sections and
  // dependencies here only after they have actually been constructed.
  const results=[],process=plan.process,width=process.lineWidthMm;
  const modelOps=modelResults.flatMap(r=>r.operations);
  const extents=new Map(),extentOf=op=>{
    if(!extents.has(op))extents.set(op,extent(op));
    return extents.get(op);
  };
  const belongs=(op,part)=>part===null||op.id.startsWith(part+':')||plan.composition.regions.some(r=>r.id===op.regionId&&r.part===part);
  for(const spec of settings.surfaces){
    const patch=supportSurface(spec,plan.placement),operations=[],baseMax=Math.max(...spec.controlPoints.map(row=>row[0][2]));
    const topMin=Math.min(...spec.controlPoints.map(row=>row.at(-1)[2]));
    // Control-edge bounds conservatively cover the entire spline boundary.
    // Include atomic operations crossing the base height, not just those ending
    // below it: the whole base edge must exist before ANY rim deposition.
    const baseOps=spec.baseEdge==='bed'?[]:modelOps.filter(op=>belongs(op,spec.basePart)&&extentOf(op).min<=baseMax+1e-7);
    if(spec.baseEdge!=='bed')requireThat(baseOps.length>0,'Edge-based rim needs earlier model operations on its named base component.');
    let previous=baseOps.map(op=>op.id),pointCount=0;
    const baseHeights=new Map(),baseHeight=u=>{
      if(!baseHeights.has(u))baseHeights.set(u,supportBoundaryAt(patch,u,'base')[2]);
      return baseHeights.get(u);
    };
    const report={surface:spec.id,mode,baseEdge:spec.baseEdge,supportedEdge:spec.supportedEdge,reason:spec.reason,layers:0,points:0,
      minOffsetZMm:Infinity,maxOffsetZMm:-Infinity,referenceTopMm:patch.bounds.max[2],printedTopMm:-Infinity,
      physicalValidation:'not performed',boundaryMatching:'Agent-assigned spline boundaries; no general CAD edge-matching proof.'};
    report.ordering='Complete the entire base edge before starting the rim; complete the entire rim before starting supported operations. Ready operations weave by physical height; rim pairs retain increasing original section height.';
    for(const z of layerHeights(process,0,patch.bounds.max[2])){
      if(z<=patch.bounds.min[2]+1e-8)continue;
      const chains=supportSurfaceSection(patch,z,{minFeatureMm:settings.minFeatureMm}),strokes=[];
      for(const chain of chains)for(const [track,offset] of [width/2,width/2+lineSpacing(width,settings)].entries()){
        const samples=offsetSurfaceSection(patch,chain,offset,{mode,side:spec.outwardSide,toleranceMm:settings.toleranceMm,maxStepMm:settings.sampleStepMm,maxPoints:settings.maxPoints-pointCount});
        if(samples.length<2)continue;
        pointCount+=samples.length;requireThat(pointCount<=settings.maxPoints,`Rim ${spec.id} exhausted maxPoints=${settings.maxPoints}; increase ${skillId}.maxPoints.`);
        const volumes=[];
        for(let i=1;i<samples.length;i++){
          const a=samples[i-1],b=samples[i];
          const baseA=baseHeight(a.u),baseB=baseHeight(b.u);
          // Partial first layers above curved base edges retain their local gap.
          // Normal-offset mode keeps this nominal bead model for comparison;
          // shifted endpoints/height are reported rather than silently corrected.
          const nominal=z<=process.firstLayerMm+1e-8?process.firstLayerMm:process.layerMm;
          const height=(Math.min(nominal,Math.max(0,z-baseA))+Math.min(nominal,Math.max(0,z-baseB)))/2;
          volumes.push(distance(a.point,b.point)*width*height);
        }
        for(const s of samples){report.minOffsetZMm=Math.min(report.minOffsetZMm,s.point[2]-s.reference[2]);report.maxOffsetZMm=Math.max(report.maxOffsetZMm,s.point[2]-s.reference[2]);report.printedTopMm=Math.max(report.printedTopMm,s.point[2]);}
        strokes.push({role:track===0?'rim-inner':'rim-outer',points:samples.map(s=>s.point),volumesMm3:volumes,speedMmS:z<=process.firstLayerMm+1e-8?process.firstLayerSpeedMmS:process.planarSpeedMmS,closed:false});
      }
      if(!strokes.length)continue;
      const maxZ=strokes.reduce((m,s)=>s.points.reduce((v,p)=>Math.max(v,p[2]),m),z);
      const id=skillId+':'+spec.id+':'+report.layers;
      operations.push({id,layerId:mode==='horizontal'?'planar:'+z:id,rank:z,layer:Math.round((z-process.firstLayerMm)/process.layerMm),phase:skillId,
        after:previous,strokes,order:'given',travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>maxZ+process.liftMm},clearanceZ:maxZ+process.liftMm});
      previous=[id];report.layers++;
    }
    requireThat(operations.length>0,`Rim ${spec.id} has no printable sections; inspect its height and control net.`);
    // Completion is a whole-rim prerequisite, including for a nonhorizontal
    // supported edge. Never release its lower portions while the rim is pending.
    for(const op of modelOps){
      if(!belongs(op,spec.supportedPart))continue;
      if(spec.supportedPart===null&&extentOf(op).max<topMin-1e-7)continue;
      (op.after??=[]).push(operations.at(-1).id);
    }
    report.points=pointCount;results.push({id:skillId+':'+spec.id,operations,report});
  }
  return results;
}

export const rimmingPlanarResults=options=>rimmingResults({...options,mode:'horizontal',skillId:'rimming-planar'});
