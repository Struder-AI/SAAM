import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
// Shared seeded fronts: constrained surface-distance propagation, chart
// clipping, physical mapping and short in-domain connections. Original SAAM
// implementation; research provenance: skills/wave-overhangs/BUILDER.md.
import {surfaceDerivatives as nativeDerivatives} from '../geom/surface-derivatives.mjs';
import {evaluatedSurfaceDerivatives} from '../geom/evaluated-surface.mjs';
import {surfaceChartBounds} from './surface-operations.mjs';
import {offsetSurfaceRegion,strokeSurfaceRegion,UV_ROUNDING,UV_GRID} from './surface-offset.mjs'; // uv rounding and boolean grid
import {intersect,difference,clipOpenPaths,union} from './intersection.mjs';
import {regionArea,pointSegmentDistance,pointInRegion} from './region2d.mjs';
import {offsetRegion} from './offset.mjs';
import {mapSliceStroke} from './layer-strokes.mjs';


// Front order consumes an explicit authored/prepared seed on any regular chart.
export function frontLayerStrokes(layer,{seedUv,lineSpacingMm,propagationStepMm,sampleStepMm,toleranceMm,lineWidthMm}){
  requireThat(Array.isArray(seedUv),'Front order needs a prepared seed region.');
  const domains=surfaceChartBounds(layer.slice,layer.region.flat());
  const patch=layer.slice.patch??{...layer.slice,domainU:domains[0],domainV:domains[1]},domain=layer.region;
  const settings={lineSpacingMm,propagationStepMm,sampleStepMm,toleranceMm};
  const seed=seedUv;
  const generated=seededSurfaceFronts(patch,domain,intersect(seed,domain),settings);
  const connected=connectSurfacePasses(patch,generated.waves,domain,settings,lineWidthMm);
  return {curves:connected.passes.map(pass=>({id:pass.id,after:pass.after,interruptible:false,role:'fill',closed:false,points:pass.chartPoints,fillFamily:{spacingMm:lineSpacingMm}})),report:{...generated.report,continuity:connected.report,seed:layer.seedSource??'authored'},seed};
}

const surfaceDerivatives=(surface,u,v)=>surface.cp?nativeDerivatives(surface,u,v):evaluatedSurfaceDerivatives(surface,u,v);

// Build continuous meanders using short surface connections. A connector must
// lie wholly in the assigned domain; proximity alone cannot authorize crossing
// a hole. Surface refinement measures its actual curved length.
export function connectSurfacePasses(patch,waves,domain,settings,lineWidthMm){
  const budget={evaluations:0,points:0},passes=[];
  const epsilon=UV_ROUNDING,limit=Math.max(settings.lineSpacingMm,lineWidthMm)+settings.toleranceMm;
  const options={precisionMm:UV_GRID,origin:[patch.domainU[0],patch.domainV[0]]};
  const inside=(a,b)=>{
    if(distance(a,b)<=epsilon)return true;
    if(domain.some(loop=>loop.some((p,i)=>[a,b].every(q=>pointSegmentDistance(q,p,loop[(i+1)%loop.length])<=epsilon))))return true;
    const pieces=clipOpenPaths([[a,b]],domain,options);
    return pieces.some(p=>(distance(p[0],a)<=epsilon&&distance(p.at(-1),b)<=epsilon)||(distance(p[0],b)<=epsilon&&distance(p.at(-1),a)<=epsilon));
  };
  function joining(pass,path){
    let best=null;
    for(const reverse of [false,true]){
      const end=reverse?path.points.at(-1):path.points[0],uv=reverse?path.uv.at(-1):path.uv[0],gap=distance(pass.points.at(-1),end);
      if(gap>limit||best&&gap>=best.gap||!inside(pass.endUv,uv))continue;
      best={pass,reverse,gap,uv};
    }
    if(!best)return null;
    const connector=mapFrontPath(patch,[pass.endUv,best.uv],settings);
    budget.evaluations+=connector.report.evaluations;budget.points+=connector.report.points;
    const lengthMm=connector.points.slice(1).reduce((sum,p,i)=>sum+distance(p,connector.points[i]),0);
    return lengthMm<=limit?{...best,connector,lengthMm}:null;
  }
  let previous=[];
  for(const wave of waves){
    const current=wave.paths.map(path=>({path,parents:[],children:[]}));
    // A checked depositing join proves the sole branch directly. Detailed
    // lineage bands are needed only when that proof fails or branches occur.
    if(previous.length===1&&current.length===1)current[0].join=joining(previous[0].pass,current[0].path);
    // Retain causal branches, not one blanket wave barrier. A constrained
    // physical band cannot infer a parent across a hole in the chart.
    for(const before of previous){
      if(current[0]?.join){before.children=[current[0]];current[0].parents=[before];continue;}
      const band=strokeSurfaceRegion(patch,[{closed:false,points:before.path.uv}],
        (wave.index-before.wave)*settings.lineSpacingMm+settings.toleranceMm,
        {toleranceMm:settings.toleranceMm,maxStepMm:settings.sampleStepMm,constraintLoopsUv:domain});
      budget.evaluations+=band.report.evaluations;
      before.children=[];
      for(const item of current)if(clipOpenPaths([item.path.uv],band.loopsUv,options).some(path=>path.some((p,i)=>i&&distance(p,path[i-1])>epsilon))){
        item.parents.push(before);before.children.push(item);
      }
    }
    for(const item of current){
      const parent=item.parents.length===1?item.parents[0]:null;
      // Stop a meander at either a split or a merge, so a sibling waits only
      // for the shared prefix and a merged front waits for every branch.
      const best=item.join??(parent&&parent.children.length===1?joining(parent.pass,item.path):null);
      if(!best){
        const path=item.path,pass={id:'front-'+passes.length,after:[...new Set(item.parents.map(parent=>parent.pass.id))],
          points:[...path.points],normals:[...path.normals],chartPoints:[...path.chartPoints],frameSamples:[...path.frameSamples],endUv:path.uv.at(-1),fronts:[wave.index],connectors:[]};
        passes.push(pass);item.pass=pass;continue;
      }
      const {pass,reverse,uv,connector,lengthMm}=best;
      pass.connectors.push({from:pass.endUv,to:uv,lengthMm});
      pass.points.push(...connector.points.slice(1));pass.normals.push(...connector.normals.slice(1));
      pass.chartPoints.push(...connector.chartPoints.slice(1));pass.frameSamples.push(...connector.frameSamples.slice(1));
      const points=reverse?item.path.points.toReversed():item.path.points,normals=reverse?item.path.normals.toReversed():item.path.normals;
      pass.points.push(...points.slice(1));pass.normals.push(...normals.slice(1));
      for(const key of ['chartPoints','frameSamples'])pass[key].push(...(reverse?item.path[key].toReversed():item.path[key]).slice(1));
      pass.endUv=reverse?item.path.uv[0]:item.path.uv.at(-1);pass.fronts.push(wave.index);item.pass=pass;
    }
    previous=current.map(item=>({...item,wave:wave.index}));
  }
  return {passes,report:{passes:passes.length,connectors:passes.flatMap(p=>p.connectors),...budget}};
}

// Shared physical mapping retains chart samples and surface normals for
// connection diagnostics; it does not assign a machine tool pose.
function mapFrontPath(patch,path,settings) {
  const mapped=mapSliceStroke({points:path,closed:false},patch,{sampleStepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm,frames:true});
  return {points:mapped.points,normals:mapped.normals,chartPoints:mapped.chartPoints,frameSamples:mapped.frameSamples,report:mapped.mappingReport};
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
  const uv=path.uv,closed=distance(uv[0],uv.at(-1))<UV_ROUNDING;
  const cap=domain.some(loop=>loop.some((a,i)=>[uv[0],uv.at(-1)].every(p=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<UV_ROUNDING)));
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

export function seededSurfaceFronts(patch,domainUv,seedUv,settings){
  const precisionUv=UV_GRID,options={precisionMm:precisionUv,origin:[patch.domainU[0],patch.domainV[0]]};
  requireThat(domainUv.flat().every(p=>p.every((x,k)=>x>=[patch.domainU,patch.domainV][k][0]&&x<=[patch.domainU,patch.domainV][k][1])),
    'Wave slice domain exceeds its native spline chart.');
  const domain=union(domainUv,[],options),seed=intersect(seedUv,domain,options);
  if(!regionArea(seed))return {waves:[],report:{notes:['Front fill has no seed inside the assigned slice; fill was omitted.'],residualsUv:domain}};
  const budget={evaluations:0,points:0},waves=[],sliverContours=[];
  let covered=seed,steps=0,boundaryStops=0,residualsUv=[],residualMaxSampleDiameterMm=0,residualRoundingBandUv=0;
  const stepCount=Math.max(1,Math.ceil(settings.lineSpacingMm/settings.propagationStepMm));
  const step=settings.lineSpacingMm/stepCount;
  const nearBoundary=(p,loops)=>loops.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=precisionUv*16));
  const roundingResiduals=remaining=>{
    // Integer intersection rounding can leave long, microscopic strips along
    // a curved rim. Accept only a residual wholly covered by a tiny expansion
    // of the reached region, and retain it as unresolved geometry in the report.
    // The area test only avoids this extra work during ordinary wave growth; its
    // thousandth of the domain is a work-skipping fraction, not a tolerance.
    if(!remaining.length||regionArea(remaining)>regionArea(domain)*1e-3)return false;
    let stretch=0,maxDiameter=0;
    for(const loop of [...covered,...remaining]){
      const samples=[];
      for(let i=0;i<loop.length;i++)for(const t of [0,.25,.5,.75]){
        budget.evaluations++;
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
        budget.evaluations++;
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
  // Waves run until the slice is covered or its residue is resolved, however
  // many that takes. Every front must enlarge the covered area, so a front that
  // stops advancing reports that cause instead of spending a fixed wave count.
  for(let n=0;;n++){
    const remaining=difference(domain,covered,options);
    if(!remaining.length||resolvedResiduals(remaining))break;
    const startArea=regionArea(covered);
    for(let k=0;k<stepCount;k++){
      const grown=offsetSurfaceRegion(patch,covered,step,{toleranceMm:settings.toleranceMm,
        maxStepMm:Math.min(settings.sampleStepMm,step),precisionUv,constraintLoopsUv:domain});
      budget.evaluations+=grown.report.evaluations;boundaryStops+=grown.report.boundaryStops;steps++;
      covered=grown.loopsUv;
      if(!difference(domain,covered,options).length)break;
    }
    if(regionArea(covered)<=startArea+precisionUv*precisionUv){
      residualsUv=difference(domain,covered,options);break;
    }
    // A completed advance has only the stationary rim left. Resolve numerical
    // residue before extracting fronts, so its strips never become toolpaths.
    if(roundingResiduals(difference(domain,covered,options)))break;
    const paths=frontPaths(covered,seed,domain,precisionUv*16);
    const sampled=paths.map(path=>{const mapped=mapFrontPath(patch,path,settings);budget.evaluations+=mapped.report.evaluations;budget.points+=mapped.report.points;return {...mapped,uv:path};}).filter(path=>{
      const widthMm=sliverWidth(path,domain);
      if(widthMm>settings.toleranceMm/4)return true;
      sliverContours.push({wave:n,uv:path.uv,widthMm});return false;
    });
    if(sampled.length)waves.push({index:n,paths:sampled});
  }
  return {waves,report:{status:'experimental',waves:waves.length,propagationSteps:steps,...budget,boundaryStops,
    residualsUv,...(residualsUv.length?{notes:['Front fill stopped before reaching remaining material; reached fronts were retained.']}:{}),residualMaxSampleDiameterMm,residualRoundingBandUv,sliverContours,lineSpacingMm:settings.lineSpacingMm,method:'constrained-geodesic-wavefronts',physicalValidation:'not performed'}};
}

