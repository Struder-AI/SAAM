// Original SAAM surface-wave implementation. Research and license provenance:
// ../BUILDER.md. No PrusaSlicer/OrcaSlicer or Grasshopper source is included.
import {referencePatch} from '../../../core/geom/reference-surface.mjs';
import {surfaceDerivatives} from '../../../core/geom/surface-derivatives.mjs';
import {offsetSurfaceRegion} from '../../../core/region/surface-offset.mjs';
import {intersect,difference,clipOpenPaths,union} from '../../../core/region/intersection.mjs';
import {regionArea,pointSegmentDistance} from '../../../core/region/region2d.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {requireThat,distance} from '../../../core/geom/tolerance.mjs';

export const WAVE_DEFAULTS={enabled:false,slices:[],lineSpacingMm:0.3,beadHeightMm:0.2,
  speedMmS:5,fanPercent:100,toleranceMm:0.01,sampleStepMm:0.5,propagationStepMm:0.1,
  maxWaves:1000,maxPoints:200000,maxEvaluations:2000000};

export function validateWaves(settings){
  requireThat(typeof settings.enabled==='boolean'&&Array.isArray(settings.slices),'Invalid wave-overhangs selection.');
  for(const key of ['lineSpacingMm','beadHeightMm','speedMmS','toleranceMm','sampleStepMm','propagationStepMm'])
    requireThat(Number.isFinite(settings[key])&&settings[key]>0,`Wave ${key} must be positive and finite.`);
  requireThat(Number.isFinite(settings.fanPercent)&&settings.fanPercent>=0&&settings.fanPercent<=100,'Wave fanPercent must be 0–100.');
  for(const key of ['maxWaves','maxPoints','maxEvaluations'])requireThat(Number.isSafeInteger(settings[key])&&settings[key]>0,`Wave ${key} must be a positive safe integer.`);
  requireThat(!settings.enabled||settings.slices.length>0,'Enable wave-overhangs with assigned spline slices and supported seeds.');
  const ids=new Set();
  for(const slice of settings.slices){
    requireThat(slice&&Object.keys(slice).sort().join()==='afterParts,beforeParts,domainUv,id,reason,seedUv,surface','Invalid wave slice fields.');
    requireThat(typeof slice.id==='string'&&/^[a-z][a-z0-9-]*$/.test(slice.id)&&!ids.has(slice.id),'Invalid or duplicate wave slice ID.');ids.add(slice.id);
    requireThat(typeof slice.reason==='string'&&slice.reason.trim().length>0,'Describe the wave seed support and material assignment.');
    for(const key of ['afterParts','beforeParts'])requireThat(Array.isArray(slice[key])&&slice[key].every(x=>x===null||typeof x==='string'),'Wave part dependencies must be arrays of component names or null for a single part.');
    for(const key of ['domainUv','seedUv'])requireThat(Array.isArray(slice[key])&&slice[key].length>0&&slice[key].every(loop=>Array.isArray(loop)&&loop.length>=3&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))),`Wave ${key} needs closed UV loops with finite pairs.`);
    if(Object.hasOwn(slice.surface??{},'patch'))requireThat(Object.keys(slice.surface).sort().join()==='part,patch'&&typeof slice.surface.patch==='string'&&(slice.surface.part===null||typeof slice.surface.part==='string'),'A native wave surface selects part and patch.');
    else {
      requireThat(slice.surface&&Object.keys(slice.surface).every(k=>['degreeU','degreeV','controlPoints','knotsU','knotsV'].includes(k)),'Unknown wave spline field.');
      referencePatch(slice.surface);
    }
  }
}

// Build continuous meanders using short surface connections. A connector must
// lie wholly in the assigned domain; proximity alone cannot authorize crossing
// a hole. Surface refinement measures its actual curved length.
export function connectWavePasses(patch,waves,domain,settings,lineWidthMm){
  const budget={evaluations:0,points:0},passes=[];
  const epsilon=1e-9,limit=Math.max(settings.lineSpacingMm,lineWidthMm)+settings.toleranceMm;
  const options={precisionMm:1e-10,origin:[patch.domainU[0],patch.domainV[0]]};
  const inside=(a,b)=>{
    if(distance(a,b)<=epsilon)return true;
    if(domain.some(loop=>loop.some((p,i)=>[a,b].every(q=>pointSegmentDistance(q,p,loop[(i+1)%loop.length])<=epsilon))))return true;
    const pieces=clipOpenPaths([[a,b]],domain,options);
    return pieces.some(p=>(distance(p[0],a)<=epsilon&&distance(p.at(-1),b)<=epsilon)||(distance(p[0],b)<=epsilon&&distance(p.at(-1),a)<=epsilon));
  };
  let pending=[],previousCount=0;
  for(const wave of waves){
    // A merged front needs both deposited branches. It cannot be appended to
    // one branch before the other branch has run.
    if(wave.paths.length<previousCount)pending=[];
    const available=wave.paths.map(path=>({path,wave:wave.index})),next=[];
    while(available.length){
      let best=null;
      for(const pass of pending)for(let index=0;index<available.length;index++)for(const reverse of [false,true]){
        const source=available[index].path,end=reverse?source.points.at(-1):source.points[0],uv=reverse?source.uv.at(-1):source.uv[0];
        const gap=distance(pass.points.at(-1),end);
        if(gap>limit||best&&gap>=best.gap||!inside(pass.endUv,uv))continue;
        best={pass,index,reverse,gap,uv};
      }
      if(!best){
        const item=available.shift(),path=item.path;
        const pass={points:[...path.points],normals:[...path.normals],endUv:path.uv.at(-1),fronts:[item.wave],connectors:[]};
        passes.push(pass);next.push(pass);continue;
      }
      const {pass,index,reverse,uv}=best,item=available.splice(index,1)[0];
      const connector=samplePath(patch,[pass.endUv,uv],settings,budget);
      const lengthMm=connector.points.slice(1).reduce((sum,p,i)=>sum+distance(p,connector.points[i]),0);
      if(lengthMm>limit){
        // A short XYZ chord can conceal a long surface route. Leave this front
        // separate instead of introducing an unbounded extruded connection.
        const path=item.path,newPass={points:[...path.points],normals:[...path.normals],endUv:path.uv.at(-1),fronts:[item.wave],connectors:[]};
        passes.push(newPass);next.push(newPass);continue;
      }
      pass.connectors.push({from:pass.endUv,to:uv,lengthMm});
      pass.points.push(...connector.points.slice(1));pass.normals.push(...connector.normals.slice(1));
      const points=reverse?item.path.points.toReversed():item.path.points,normals=reverse?item.path.normals.toReversed():item.path.normals;
      pass.points.push(...points.slice(1));pass.normals.push(...normals.slice(1));
      pass.endUv=reverse?item.path.uv[0]:item.path.uv.at(-1);pass.fronts.push(item.wave);
      pending=pending.filter(p=>p!==pass);next.push(pass);
    }
    pending=next;
    previousCount=wave.paths.length;
  }
  return {passes,report:{passes:passes.length,connectors:passes.flatMap(p=>p.connectors),...budget}};
}

// Physical chord refinement applies after UV booleans too: a straight UV edge
// is generally curved in XYZ. Retain pairs for diagnostics and software tests.
function samplePath(patch,path,settings,budget){
  const at=uv=>{
    requireThat(++budget.evaluations<=settings.maxEvaluations,`Wave exhausted maxEvaluations=${settings.maxEvaluations}; increase wave-overhangs.maxEvaluations.`);
    return surfaceDerivatives(patch,...uv.map((x,k)=>{
      const [lo,hi]=[patch.domainU,patch.domainV][k];
      return x>=lo-1e-9&&x<=hi+1e-9?Math.max(lo,Math.min(hi,x)):x;
    }));
  };
  const points=[],normals=[];
  const append=frame=>{requireThat(++budget.points<=settings.maxPoints,`Wave exhausted maxPoints=${settings.maxPoints}; increase wave-overhangs.maxPoints.`);points.push(frame.point);normals.push(frame.normal);};
  const refine=(a,b,fa,fb,depth=0)=>{
    const mid=a.map((v,k)=>(v+b[k])/2),fm=at(mid);
    if(distance(fa.point,fb.point)>settings.sampleStepMm||distance(fm.point,fa.point.map((v,k)=>(v+fb.point[k])/2))>settings.toleranceMm){
      requireThat(depth<30,'Wave curve subdivision cannot resolve the requested tolerance.');
      refine(a,mid,fa,fm,depth+1);refine(mid,b,fm,fb,depth+1);
    }else append(fb);
  };
  let frame=at(path[0]);append(frame);
  for(let i=1;i<path.length;i++){const next=at(path[i]);refine(path[i-1],path[i],frame,next);frame=next;}
  return {points,normals};
}

// Walk the boundary in its original cyclic order. Clipping an open outline
// against a polygon with the identical outline has ambiguous boundary ownership
// in polygon booleans and can discard whole front edges. Only stationary seed
// and domain edges are removed; an interior front is never cut by that test.
function frontPaths(covered,seed,domain,epsilon){
  const near=(p,loops)=>loops.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=epsilon));
  const paths=[];
  for(const loop of covered){
    const edges=[];
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],v=b.map((x,k)=>x-a[k]),length2=v[0]**2+v[1]**2;
      if(length2===0)continue;
      const mid=a.map((x,k)=>(x+b[k])/2);
      edges.push({p:a,q:b,keep:!near(mid,seed)&&!near(mid,domain)});
    }
    const gap=edges.findIndex(e=>!e.keep);
    let chain=[];
    for(let j=0;j<edges.length;j++){
      const edge=edges[(j+gap+1)%edges.length];
      if(edge.keep){if(!chain.length)chain.push(edge.p);chain.push(edge.q);}
      else if(chain.length){paths.push(chain);chain=[];}
    }
    if(chain.length)paths.push(chain);
  }
  return paths;
}

function sliverWidth(path,domain){
  // Only closed residual contours or a cap returning to the SAME domain edge
  // can be a collapsed band artefact. An ordinary straight front is retained.
  const uv=path.uv,closed=distance(uv[0],uv.at(-1))<1e-9;
  const cap=domain.some(loop=>loop.some((a,i)=>[uv[0],uv.at(-1)].every(p=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<1e-9)));
  if(!closed&&!cap)return Infinity;
  const points=path.points;
  const furthest=a=>points.reduce((best,p)=>distance(a,p)>distance(a,best)?p:best,points[0]);
  const a=furthest(points[0]),b=furthest(a),v=b.map((x,k)=>x-a[k]),len2=v.reduce((sum,x)=>sum+x*x,0);
  if(len2===0)return 0;
  return Math.max(...points.map(p=>{
    const t=Math.max(0,Math.min(1,v.reduce((sum,x,k)=>sum+x*(p[k]-a[k]),0)/len2));
    return distance(p,a.map((x,k)=>x+t*v[k]));
  }));
}

export function surfaceWaves(patch,domainUv,seedUv,settings){
  const precisionUv=1e-10,options={precisionMm:precisionUv,origin:[patch.domainU[0],patch.domainV[0]]};
  requireThat(domainUv.flat().every(p=>p.every((x,k)=>x>=[patch.domainU,patch.domainV][k][0]&&x<=[patch.domainU,patch.domainV][k][1])),
    'Wave slice domain exceeds its native spline chart.');
  const domain=union(domainUv,[],options),seed=intersect(seedUv,domain,options);
  requireThat(regionArea(seed)>0,'Wave seed has no material area inside the assigned slice.');
  const budget={evaluations:0,points:0},waves=[],sliverContours=[];
  let covered=seed,steps=0,boundaryStops=0,residualsUv=[],residualMaxSampleDiameterMm=0,residualRoundingBandUv=0;
  const stepCount=Math.max(1,Math.ceil(settings.lineSpacingMm/settings.propagationStepMm));
  const step=settings.lineSpacingMm/stepCount;
  const nearBoundary=(p,loops)=>loops.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=precisionUv*16));
  const roundingResiduals=remaining=>{
    // Integer intersection rounding can leave long, microscopic strips along
    // a curved rim. Accept only a residual wholly covered by a tiny expansion
    // of the reached region, and retain it as unresolved geometry in the report.
    // The area test only avoids this extra work during ordinary wave growth.
    if(!remaining.length||regionArea(remaining)>regionArea(domain)*1e-3)return false;
    let stretch=0,maxDiameter=0;
    for(const loop of [...covered,...remaining]){
      const samples=[];
      for(let i=0;i<loop.length;i++)for(const t of [0,.25,.5,.75]){
        requireThat(++budget.evaluations<=settings.maxEvaluations,`Wave exhausted maxEvaluations=${settings.maxEvaluations}; increase wave-overhangs.maxEvaluations.`);
        const uv=loop[i].map((x,k)=>x+t*(loop[(i+1)%loop.length][k]-x)),f=surfaceDerivatives(patch,...uv);
        stretch=Math.max(stretch,Math.hypot(...f.du)+Math.hypot(...f.dv));samples.push(f.point);
      }
      if(remaining.includes(loop))maxDiameter=Math.max(maxDiameter,Math.hypot(...[0,1,2].map(k=>Math.max(...samples.map(p=>p[k]))-Math.min(...samples.map(p=>p[k])))));
    }
    const band=settings.toleranceMm/stretch;
    const expanded=offsetRegion(covered,band,{precisionMm:precisionUv,arcToleranceMm:precisionUv});
    if(difference(remaining,expanded,options).length)return false;
    residualsUv=remaining;residualMaxSampleDiameterMm=maxDiameter;residualRoundingBandUv=band;return true;
  };
  const resolvedResiduals=remaining=>{
    if(roundingResiduals(remaining))return true;
    let maxDiameter=0;
    for(const loop of remaining){
      if(!loop.some(p=>nearBoundary(p,covered)))return false;
      const samples=[];
      for(let i=0;i<loop.length;i++)for(const t of [0,0.25,0.5,0.75]){
        requireThat(++budget.evaluations<=settings.maxEvaluations,`Wave exhausted maxEvaluations=${settings.maxEvaluations}; increase wave-overhangs.maxEvaluations.`);
        const uv=loop[i].map((x,k)=>x+t*(loop[(i+1)%loop.length][k]-x));
        samples.push(surfaceDerivatives(patch,...uv.map((x,k)=>Math.max([patch.domainU,patch.domainV][k][0],Math.min([patch.domainU,patch.domainV][k][1],x)))).point);
        if(samples.length>1&&distance(samples[0],samples.at(-1))>settings.toleranceMm)return false;
      }
      const span=Math.hypot(...[0,1,2].map(k=>Math.max(...samples.map(p=>p[k]))-Math.min(...samples.map(p=>p[k]))));
      if(span>settings.toleranceMm)return false;
      maxDiameter=Math.max(maxDiameter,span);
    }
    residualsUv=remaining;residualMaxSampleDiameterMm=maxDiameter;return true;
  };
  for(let n=0;n<settings.maxWaves;n++){
    const remaining=difference(domain,covered,options);
    if(!remaining.length||resolvedResiduals(remaining))break;
    const startArea=regionArea(covered);
    for(let k=0;k<stepCount;k++){
      const remainingBudget=settings.maxEvaluations-budget.evaluations;
      requireThat(remainingBudget>0,`Wave exhausted maxEvaluations=${settings.maxEvaluations}; increase wave-overhangs.maxEvaluations.`);
      const grown=offsetSurfaceRegion(patch,covered,step,{toleranceMm:settings.toleranceMm,
        maxStepMm:Math.min(settings.sampleStepMm,step),precisionUv,maxEvaluations:remainingBudget,constraintLoopsUv:domain});
      budget.evaluations+=grown.report.evaluations;boundaryStops+=grown.report.boundaryStops;steps++;
      covered=grown.loopsUv;
      if(!difference(domain,covered,options).length)break;
    }
    requireThat(regionArea(covered)>startArea+precisionUv*precisionUv,'Wave propagation cannot reach remaining material from the supplied seed; assign a seed on each disconnected island or revise the region.');
    // A completed advance has only the stationary rim left. Resolve numerical
    // residue before extracting fronts, so its strips never become toolpaths.
    if(roundingResiduals(difference(domain,covered,options)))break;
    const paths=frontPaths(covered,seed,domain,precisionUv*16);
    const sampled=paths.map(path=>({...samplePath(patch,path,settings,budget),uv:path})).filter(path=>{
      const widthMm=sliverWidth(path,domain);
      if(widthMm>settings.toleranceMm/4)return true;
      sliverContours.push({wave:n,uv:path.uv,widthMm});return false;
    });
    if(sampled.length)waves.push({index:n,paths:sampled});
  }
  const remaining=difference(domain,covered,options);
  requireThat(!remaining.length||resolvedResiduals(remaining),`Wave exhausted maxWaves=${settings.maxWaves}; increase wave-overhangs.maxWaves or assign seeds to unreachable regions.`);
  return {waves,report:{status:'experimental',waves:waves.length,propagationSteps:steps,...budget,boundaryStops,
    residualsUv,residualMaxSampleDiameterMm,residualRoundingBandUv,sliverContours,lineSpacingMm:settings.lineSpacingMm,method:'constrained-geodesic-wavefronts',physicalValidation:'not performed'}};
}

export function waveResults({plan,machine,placed,componentShells,modelResults}){
  const settings=plan.skills['wave-overhangs'];if(!settings.enabled)return [];
  const modelOps=modelResults.flatMap(r=>r.operations),results=[];
  const belongs=(op,part)=>part===null||op.id.startsWith(part+':')||plan.composition.regions.some(r=>r.id===op.regionId&&r.part===part);
  let previousSlice=[];
  for(const slice of settings.slices){
    let patch;
    if(Object.hasOwn(slice.surface,'patch')){
      const shell=componentShells?componentShells.get(slice.surface.part):placed;
      patch=shell?.patches?.find(p=>p.name===slice.surface.patch);
      requireThat(patch,'Wave slice needs an existing native spline patch; mesh geometry needs an independent spline reference.');
    }else {
      patch=referencePatch(slice.surface);
      patch={...patch,cp:Float64Array.from(patch.cp,(v,i)=>i%4===0?v+plan.placement.xMm*patch.cp[i+3]:i%4===1?v+plan.placement.yMm*patch.cp[i+2]:v)};
    }
    const generated=surfaceWaves(patch,slice.domainUv,slice.seedUv,settings),operations=[];
    const connected=connectWavePasses(patch,generated.waves,slice.domainUv,{...settings,
      maxEvaluations:settings.maxEvaluations-generated.report.evaluations,maxPoints:settings.maxPoints-generated.report.points},plan.process.lineWidthMm);
    requireThat(connected.passes.length===1,`Wave slice ${slice.id} needs ${connected.passes.length} separate passes with short in-domain turns; a continuous slice cannot contain branch restarts. Revise the domain/seed or the continuity requirement.`);
    let previous=[...previousSlice,...modelOps.filter(op=>slice.afterParts.some(part=>belongs(op,part))).map(op=>op.id)];
    for(const part of slice.afterParts)requireThat(modelOps.some(op=>belongs(op,part)),'Wave seed dependency has no deposited operations: '+part);
    for(const [index,pass] of connected.passes.entries()){
      const id=`wave-overhangs:${slice.id}:${index}`;
      let maxZ=-Infinity,maxSlopeDeg=0;
      const strokes=[pass].map(({points,normals})=>{
        for(let i=0;i<points.length;i++){maxZ=Math.max(maxZ,points[i][2]);maxSlopeDeg=Math.max(maxSlopeDeg,Math.acos(Math.min(1,Math.abs(normals[i][2])))*180/Math.PI);}
        return {role:'wave-front',points,speedMmS:settings.speedMmS,beadAreaMm2:plan.process.lineWidthMm*settings.beadHeightMm,closed:false};
      });
      requireThat(maxSlopeDeg<=(machine.nonplanar?.maxAngleDeg??0)+1e-7,'Wave surface exceeds the selected machine nonplanar angle limit.');
      operations.push({id,layerId:'wave-overhangs:'+slice.id,rank:results.length,layer:results.length,phase:'wave-overhangs',after:previous,strokes,order:'given',fanPercent:settings.fanPercent,
        clearanceZ:maxZ+plan.process.liftMm,travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>maxZ,constantClearanceZ:maxZ}});
      previous=[id];
    }
    requireThat(operations.length>0,'Wave slice contains no new deposition outside its seed.');
    previousSlice=previous;
    for(const part of slice.beforeParts){
      const successors=modelOps.filter(op=>belongs(op,part));
      requireThat(successors.length>0,'Wave successor has no deposited operations: '+part);
      for(const op of successors)(op.after??=[]).push(...previous);
    }
    results.push({id:'wave-overhangs:'+slice.id,operations,report:{slice:slice.id,reason:slice.reason,...generated.report,
      evaluations:generated.report.evaluations+connected.report.evaluations,points:generated.report.points+connected.report.points,continuity:connected.report}});
  }
  return results;
}
