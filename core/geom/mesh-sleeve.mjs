// Smooth open reference sleeves estimated from validated closed mesh geometry.
// This is a fit, not a mesh repair or replacement of printable source geometry.
import {createSectionQuery} from './query.mjs';
import {contourPath} from './contour-path.mjs';
import {basisFunctions,findSpan,evaluate} from './nurbs.mjs';
import {leastSquares} from './least-squares.mjs';
import {loopArea,pointInRegion} from '../region/region2d.mjs';
import {union} from '../region/intersection.mjs';
import {requireThat,distance} from './tolerance.mjs';

const wrap=u=>((u%1)+1)%1;
function basisRow(knots,count,u,periodicCount=count){
  const span=findSpan(knots,count,4,u),local=basisFunctions(knots,span,u,4),row=Array(periodicCount).fill(0);
  for(let i=0;i<4;i++)row[(span-3+i)%periodicCount]+=local[i];
  return row;
}

function sleeveCut(cut,z,{toleranceMm,maxSecondaryAreaFraction},allowCollapsed=false){
  const outers=cut.loops.filter(loop=>loopArea(loop)>0).sort((a,b)=>loopArea(b)-loopArea(a));
  if(outers.length===0||loopArea(outers[0])<=toleranceMm*toleranceMm){
    if(allowCollapsed)return null;
    throw new Error(`Mesh sleeve outer boundary collapses at Z ${z} mm; exclude the pole or cap transition.`);
  }
  const outer=outers[0],secondaryOuters=outers.slice(1),secondaryArea=secondaryOuters.reduce((sum,loop)=>sum+loopArea(loop),0);
  requireThat(secondaryArea<=loopArea(outer)*maxSecondaryAreaFraction,
    `Mesh sleeve needs one dominant outer boundary at Z ${z} mm; disconnected, branching sections exceed maxSecondaryAreaFraction.`);
  const holes=cut.loops.filter(loop=>loopArea(loop)<0&&pointInRegion(loop[0],[outer]));
  const bores=holes.filter(hole=>-loopArea(hole)>loopArea(outer)*maxSecondaryAreaFraction);
  requireThat(bores.length<=1,`Mesh sleeve has multiple substantial bores at Z ${z} mm; choose a single sleeve.`);
  return {outer,holes,bores,secondaryOuters,secondaryArea,poreArea:holes.filter(hole=>!bores.includes(hole)).reduce((sum,loop)=>sum-loopArea(loop),0)};
}

// Authoring-time proposal only. Generation must use the returned interval as
// explicit recipe bounds; this function never changes an existing toolpath.
export function detectMeshSleeveInterval(mesh,{
  marginMm=.4,toleranceMm=.02,sampleCount=25,maxSecondaryAreaFraction=.001,
  zMinMm=mesh?.bounds?.min[2],zMaxMm=mesh?.bounds?.max[2]
}={}){
  requireThat(mesh?.kind==='triangle-mesh','Mesh sleeve detection requires validated triangle-mesh geometry.');
  requireThat(Number.isFinite(zMinMm)&&Number.isFinite(zMaxMm)&&zMaxMm>zMinMm&&zMinMm>=mesh.bounds.min[2]&&zMaxMm<=mesh.bounds.max[2],
    'Mesh sleeve detection needs a nonempty height interval within the mesh.');
  requireThat(Number.isFinite(marginMm)&&marginMm>0&&marginMm<(zMaxMm-zMinMm)/2,'Mesh sleeve marginMm must be positive and less than half the selected height.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Mesh sleeve section toleranceMm must be positive.');
  requireThat(Number.isInteger(sampleCount)&&sampleCount>=3&&sampleCount<=257,'Mesh sleeve sampleCount must be an integer from 3 to 257.');
  requireThat(Number.isFinite(maxSecondaryAreaFraction)&&maxSecondaryAreaFraction>=0&&maxSecondaryAreaFraction<=.05,
    'Mesh sleeve maxSecondaryAreaFraction must be between zero and 0.05.');
  const query=createSectionQuery(mesh),cache=new Map();
  let maxSecondaryAreaMm2=0,maxPoreAreaMm2=0;
  function inspect(z){
    if(cache.has(z))return cache.get(z);
    const result=sleeveCut(query(z),z,{toleranceMm,maxSecondaryAreaFraction},true);
    if(result){maxSecondaryAreaMm2=Math.max(maxSecondaryAreaMm2,result.secondaryArea);maxPoreAreaMm2=Math.max(maxPoreAreaMm2,result.poreArea);}
    cache.set(z,result);return result;
  }
  const heights=Array.from({length:sampleCount},(_,i)=>zMinMm+(zMaxMm-zMinMm)*i/(sampleCount-1)),valid=heights.map(z=>Boolean(inspect(z)));
  const first=valid.indexOf(true),last=valid.lastIndexOf(true);
  requireThat(first>=0&&last>first,'Mesh has no sampled noncollapsed sleeve interval; choose a different region or finer detection sampling.');
  requireThat(valid.slice(first,last+1).every(Boolean),'Mesh has multiple usable height intervals separated by a collapsed section; select one sleeve explicitly.');
  function end(boundary,index,sign){
    if(inspect(boundary))return boundary;
    const firstProposal=boundary+sign*marginMm;
    if(inspect(firstProposal))return firstProposal;
    // Refine only the cap bracket already established by the coarse scan.
    let bad=boundary,good=heights[index];
    while(Math.abs(good-bad)>marginMm){
      const mid=(bad+good)/2;
      if(inspect(mid))good=mid;else bad=mid;
    }
    return good;
  }
  const start=end(zMinMm,first,1),finish=end(zMaxMm,last,-1);
  requireThat(finish-start>marginMm,'Detected sleeve is too short after excluding collapsed caps.');
  return {rangeMm:[start,finish],report:{method:'sampled-dominant-sections',sourceRangeMm:[zMinMm,zMaxMm],
    excludedBottomMm:start-zMinMm,excludedTopMm:zMaxMm-finish,marginMm,toleranceMm,sampleCount,
    maxSecondaryAreaFraction,maxSecondaryAreaMm2,maxPoreAreaMm2,sectionQueries:cache.size}};
}

export function fitMeshSleeve(mesh,{
  zMinMm=mesh?.bounds?.min[2],zMaxMm=mesh?.bounds?.max[2],
  circumferentialControls=12,heightControls=6,circumferentialSamples=96,heightSamples=25,
  toleranceMm=0.02,maxSectionPoints=16384,maxSecondaryAreaFraction=0.001
}={}){
  requireThat(mesh?.kind==='triangle-mesh','Mesh sleeve fitting requires validated triangle-mesh geometry.');
  requireThat(Number.isFinite(zMinMm)&&Number.isFinite(zMaxMm)&&zMaxMm>zMinMm&&zMinMm>=mesh.bounds.min[2]&&zMaxMm<=mesh.bounds.max[2],
    'Mesh sleeve fitting needs a nonempty height interval within the mesh.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Mesh sleeve section toleranceMm must be positive.');
  requireThat(Number.isFinite(maxSecondaryAreaFraction)&&maxSecondaryAreaFraction>=0&&maxSecondaryAreaFraction<=.05,
    'Mesh sleeve maxSecondaryAreaFraction must be between zero and 0.05.');
  for(const [name,count,min,max] of [['circumferentialControls',circumferentialControls,4,64],['heightControls',heightControls,4,64],
    ['circumferentialSamples',circumferentialSamples,16,1024],['heightSamples',heightSamples,4,257],['maxSectionPoints',maxSectionPoints,16,100000]])
    requireThat(Number.isInteger(count)&&count>=min&&count<=max,`Mesh sleeve ${name} must be an integer from ${min} to ${max}.`);
  requireThat(circumferentialSamples>=2*circumferentialControls&&heightSamples>=heightControls,
    'Mesh sleeve fitting needs at least twice as many circumferential samples as controls and at least as many height samples as controls.');
  const sectionQuery=createSectionQuery(mesh),sourceCache=new Map(),fittedCache=new Map();
  const spanMm=zMaxMm-zMinMm;
  // The anchor remains outside the whole mesh and is translated with the part.
  // A fixed direction avoids choosing a new arbitrary triangle seam per ring.
  const anchor=[mesh.bounds.max[0]+Math.max(1,mesh.bounds.max[0]-mesh.bounds.min[0]),(mesh.bounds.min[1]+mesh.bounds.max[1])/2];
  let sourceQueries=0,seenSolid=false,seenHollow=false,maxSecondaryAreaMm2=0,maxSecondaryLoops=0,maxPoreAreaMm2=0;
  function sourceSectionAt(z){
    requireThat(Number.isFinite(z)&&z>=zMinMm-1e-9&&z<=zMaxMm+1e-9,'Sleeve section height is outside the fitted interval.');
    z=Math.max(zMinMm,Math.min(zMaxMm,z));
    if(sourceCache.has(z))return sourceCache.get(z);
    const cut=sectionQuery(z),{outer,holes,bores,secondaryOuters,secondaryArea,poreArea}=sleeveCut(cut,z,{toleranceMm,maxSecondaryAreaFraction});
    seenHollow ||=bores.length>0;seenSolid ||=bores.length===0;sourceQueries++;
    maxSecondaryAreaMm2=Math.max(maxSecondaryAreaMm2,secondaryArea);maxSecondaryLoops=Math.max(maxSecondaryLoops,secondaryOuters.length);maxPoreAreaMm2=Math.max(maxPoreAreaMm2,poreArea);
    const value={...cut,outer,holes,bores,secondaryOuters,curve:contourPath(outer,anchor),classification:bores.length?'hollow-sleeve':'solid-envelope'};
    if(sourceCache.size>=64)sourceCache.delete(sourceCache.keys().next().value);
    sourceCache.set(z,value);return value;
  }
  const n=circumferentialControls,nu=n+3,nv=heightControls;
  const knotsU=Float64Array.from({length:nu+4},(_,i)=>(i-3)/n);
  const knotsV=Float64Array.from({length:nv+4},(_,i)=>i<=3?0:i>=nv?1:(i-3)/(nv-3));
  const us=Array.from({length:circumferentialSamples},(_,i)=>i/circumferentialSamples);
  const vs=Array.from({length:heightSamples},(_,i)=>i/(heightSamples-1));
  const solveU=leastSquares(us.map(u=>basisRow(knotsU,nu,u,n)));
  const solveV=leastSquares(vs.map(v=>basisRow(knotsV,nv,v)));
  // Product-grid sampling permits two separable QR solves for the exact tensor
  // least-squares solution, instead of one much larger dense normal system.
  const samples=vs.map(v=>{const curve=sourceSectionAt(zMinMm+v*spanMm).curve;return us.map(u=>curve.at(u));});
  const ringControls=samples.map(ring=>[0,1].map(k=>solveU(ring.map(p=>p[k]))));
  const controlXY=Array.from({length:n},(_,i)=>[0,1].map(k=>solveV(ringControls.map(row=>row[k][i]))));
  const cp=new Float64Array(nu*nv*4);
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    // Greville abscissae reproduce z(v) exactly, so queries stay at actual Z.
    const v=(knotsV[j+1]+knotsV[j+2]+knotsV[j+3])/3;
    cp.set([controlXY[i%n][0][j],controlXY[i%n][1][j],zMinMm+v*spanMm,1],(i*nv+j)*4);
  }
  const patch={name:'mesh-reference-sleeve',nu,nv,orderU:4,orderV:4,knotsU,knotsV,cp,domainU:[0,1],domainV:[0,1]};
  const pointAt=(u,z)=>{
    requireThat(Number.isFinite(u)&&Number.isFinite(z)&&z>=zMinMm-1e-9&&z<=zMaxMm+1e-9,'Sleeve point parameters must be finite and within the fitted height interval.');
    const p=evaluate(patch,wrap(u),Math.max(0,Math.min(1,(z-zMinMm)/spanMm)),false).point;
    p[2]=z;return p;
  };
  let sumSquared=0,maxResidual=0;
  for(let j=0;j<vs.length;j++)for(let i=0;i<us.length;i++){
    const residual=distance(samples[j][i],pointAt(us[i],zMinMm+vs[j]*spanMm).slice(0,2));
    sumSquared+=residual*residual;maxResidual=Math.max(maxResidual,residual);
  }
  // A single U grid serves every height. This polynomial, uniform periodic
  // cubic has second-derivative controls n²(P[i+2]-2P[i+1]+P[i]). Positive
  // B-spline weights in both directions bound ||d²XY/du²|| by their largest
  // norm. Linear interpolation on an interval h then errs by at most M*h²/8.
  // Independently adaptive rings can switch vertices at adjacent heights,
  // injecting discontinuities into otherwise smooth contour correspondence.
  let secondDerivativeBound=0;
  for(let i=0;i<n;i++)for(let j=0;j<nv;j++){
    const second=[0,1].map(k=>n*n*(controlXY[(i+2)%n][k][j]-2*controlXY[(i+1)%n][k][j]+controlXY[i][k][j]));
    secondDerivativeBound=Math.max(secondDerivativeBound,Math.hypot(...second));
  }
  const sectionSegments=n*Math.max(1,Math.ceil(Math.sqrt(secondDerivativeBound/(8*toleranceMm))/n));
  requireThat(sectionSegments<=maxSectionPoints,'Fitted sleeve section exceeds maxSectionPoints; no complete section was produced.');
  const sectionChordBoundMm=secondDerivativeBound/(8*sectionSegments*sectionSegments);
  function sectionAt(z){
    if(fittedCache.has(z))return fittedCache.get(z);
    const loop=Array.from({length:sectionSegments},(_,i)=>pointAt(i/sectionSegments,z).slice(0,2));
    const area=loopArea(loop),normalized=union([loop],[],{precisionMm:1e-7});
    requireThat(area>toleranceMm*toleranceMm&&normalized.length===1&&loopArea(normalized[0])>0&&Math.abs(loopArea(normalized[0])-area)<Math.max(1e-5,area*1e-8),
      'Fitted mesh sleeve collapsed, crossed itself or reversed; use more fit controls or a simpler nonbranching sleeve interval.');
    const value={loops:[loop],requestedZ:z,zMm:z,nudgedByMm:0,outer:loop,holes:[],curve:contourPath(loop,anchor)};
    if(fittedCache.size>=64)fittedCache.delete(fittedCache.keys().next().value);
    fittedCache.set(z,value);return value;
  }
  // Validate newly constructed fit sections where the fit is constrained.
  for(const v of vs)sectionAt(zMinMm+v*spanMm);
  return {patch,pointAt,sectionAt,sourceSectionAt,rangeMm:[zMinMm,zMaxMm],
    report:{kind:'periodic-cubic-least-squares',circumferentialControls,heightControls,circumferentialSamples,heightSamples,
      toleranceMm,maxSecondaryAreaFraction,sectionSegments,sectionChordBoundMm,rmsFitResidualMm:Math.sqrt(sumSquared/(us.length*vs.length)),maxSampledFitResidualMm:maxResidual,
      get sourceClassification(){return seenHollow?(seenSolid?'closed-vessel-with-base':'hollow-sleeve'):'solid-envelope';},
      get maxSecondaryAreaMm2(){return maxSecondaryAreaMm2;},get maxSecondaryLoops(){return maxSecondaryLoops;},get maxPoreAreaMm2(){return maxPoreAreaMm2;},
      get sourceSectionQueries(){return sourceQueries;}}};
}
