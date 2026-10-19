// Native construction stays interruptible; numerical failures yield to recovery.
import {executeGeometrySync} from './execution.mjs';
import {evaluate} from './nurbs.mjs';
import {translateSurfaceSolid} from './surface-topology.mjs';
import {distance,dot,normalize,requireThat} from './tolerance.mjs';
import {nativeSurfaceSolid} from './surface-boolean-kernel.mjs';
export {nativeSurfaceSolid};
import {BOOLEAN_TOLERANCE_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

export function surfaceBoolean(operation,operands,{seedMm=.4,signal,progress}={}){
  requireThat(['union','difference','intersection'].includes(operation),'Unknown surface Boolean operation.');
  requireThat(operands.length>=2&&operands.every(nativeSurfaceSolid),'Surface Booleans need at least two native surface solids.');
  requireThat(Number.isFinite(seedMm)&&seedMm>0,'Surface Boolean discovery spacing must be positive.');
  for(const solid of operands)requireThat(!solid.closure?.unmatched.length,'Surface Booleans need closed input solids.');
  signal?.throwIfAborted();
  const options={seedMm},execution={signal,progress};
  const attempts=[];
  const source=operands.map(numericalOperand);
  const original=attemptBoolean(operation,source,options,execution);
  if(original.result)return inheritReports(original.result,operands);
  attempts.push({method:'original',...original.failure});
  const fuzzy=attemptBoolean(operation,source,{...options,fuzzyMm:BOOLEAN_TOLERANCE_MM/4},execution);
  if(fuzzy.result)return recoveredResult(fuzzy.result,operands,attempts,{method:'fuzzy',fuzzyMm:BOOLEAN_TOLERANCE_MM/4});
  attempts.push({method:'fuzzy',...fuzzy.failure});
  const directions=recoveryDirections(source,original.failure.facePair),extent=combinedExtent(source),state={distanceMm:BOOLEAN_TOLERANCE_MM,level:0};
  while(state.distanceMm<=extent){
    for(const direction of directions.slice(0,Math.min(directions.length,2+state.level))){
      signal?.throwIfAborted();
      // Every proposal starts from the authored operands. Retries never drift.
      const adjustments=source.map((_,i)=>i?{operand:i,translationMm:direction.map(value=>value*state.distanceMm*i/(source.length-1))}:null).filter(Boolean);
      const shifted=source.map((solid,i)=>i?translatedOperand(solid,adjustments[i-1].translationMm):solid);
      if(removesAllOverlap(source,shifted))continue;
      const attempt=attemptBoolean(operation,shifted,options,execution);
      if(attempt.result)return recoveredResult(attempt.result,operands,attempts,{method:'perturbation',adjustments,maxDisplacementMm:state.distanceMm});
      attempts.push({method:'perturbation',maxDisplacementMm:state.distanceMm,...attempt.failure});
    }
    state.distanceMm*=2;state.level++;
  }
  const error=new Error(`Native surface Boolean could not construct a closed boundary. ${original.failure.message}`);
  error.code='SURFACE_BOOLEAN_RECOVERY_FAILED';error.attempts=attempts;throw error;
}

function numericalOperand(solid){const {surfaces,...value}=solid;return value;}
function inheritReports(result,operands){
  const notes=[...new Set([...(result.notes??[]),...operands.flatMap(solid=>solid.notes??[])])];
  const recoveries=operands.flatMap(solid=>solid.construction?.recoveries??[]);
  return {...result,notes,construction:{...result.construction,recoveries}};
}
function recoveredResult(result,operands,attempts,recovery){
  const inherited=inheritReports(result,operands);
  const record={...recovery,attempts:attempts.length+1,originalFailure:attempts[0].message};
  const detail=recovery.method==='fuzzy'?`matched near-coincident regions within ${recovery.fuzzyMm} mm`:
    `translated ${recovery.adjustments.map(item=>`operand ${item.operand} by [${item.translationMm.join(', ')}] mm`).join('; ')} (maximum ${recovery.maxDisplacementMm} mm)`;
  const warning=`Boolean ${result.operation} automatically recovered: ${detail}. ${record.originalFailure}`;
  return {...inherited,notes:[...inherited.notes,warning],construction:{...inherited.construction,recoveries:[...inherited.construction.recoveries,record]}};
}

function attemptBoolean(operation,operands,options,execution){
  try{return {result:executeGeometrySync('surface-boolean',{operation,operands,options},{...execution,subject:'Native surface Boolean'})};}
  catch(error){
    if(error.geometryFailure!=='calculation'||error.code==='GEOMETRY_MEMORY_EXHAUSTED')throw error;
    const phase=error.progress;
    const message=error.message+' ('+attemptPhase(phase,operands)+').';
    return {failure:{code:error.code??'SURFACE_BOOLEAN_NUMERICAL',message,...(phase&&(phase.stage===1||phase.stage===2)?{facePair:[phase.first,phase.second]}:{})}};
  }
}
function attemptPhase(phase,operands){
  const faces=operands.flatMap(solid=>solid.patches),first=faces[phase?.first]?.name,second=faces[phase?.second]?.name;
  if(phase?.stage===1)return 'coincidence '+first+'/'+second;
  if(phase?.stage===2)return 'intersection '+first+'/'+second+'; pending '+phase.pending+', curves '+phase.curves+', visited '+phase.visited;
  if(phase?.stage===3)return 'classification '+first;
  return phase?.stage===4?'boundary sewing':'calculation initialization';
}

function translatedOperand(solid,offset){
  if(solid.kind==='surface-solid')return translateSurfaceSolid(solid,offset);
  const patches=solid.patches.map(patch=>{
    const cp=Float64Array.from(patch.cp);
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=offset[k]*cp[i+3];
    return {...patch,cp};
  });
  return {...solid,patches,bounds:{min:solid.bounds.min.map((value,k)=>value+offset[k]),max:solid.bounds.max.map((value,k)=>value+offset[k])}};
}
function recoveryDirections(solids,facePair=[]){
  const result=[],remember=direction=>{
    if(Math.hypot(...direction)<=ROUNDING_MM)return;
    const unit=normalize(direction);
    if(!result.some(prior=>dot(prior,unit)>1-ROUNDING_RELATIVE))result.push(unit);
  };
  const rememberNormal=patch=>{
    const normal=evaluate(patch,(patch.domainU[0]+patch.domainU[1])/2,(patch.domainV[0]+patch.domainV[1])/2).normal;
    if(normal){remember(normal);remember(normal.map(value=>-value));}
  };
  // A failed face pair identifies useful directions before generic proposals.
  // In particular, an axial translation cannot separate coincident side walls.
  const faces=solids.flatMap(solid=>solid.patches);
  for(const index of facePair)if(faces[index])rememberNormal(faces[index]);
  const center=solid=>solid.bounds.min.map((value,k)=>(value+solid.bounds.max[k])/2);
  const first=center(solids[0]);
  for(const solid of solids.slice(1))remember(first.map((value,k)=>value-center(solid)[k]));
  remember([1,Math.SQRT2,Math.sqrt(3)]);remember([-1,-Math.SQRT2,-Math.sqrt(3)]);
  for(const patch of faces)rememberNormal(patch);
  for(const axis of [[1,0,0],[0,1,0],[0,0,1]]){remember(axis);remember(axis.map(value=>-value));}
  return result;
}
function combinedExtent(solids){
  const min=[0,1,2].map(k=>Math.min(...solids.map(solid=>solid.bounds.min[k])));
  const max=[0,1,2].map(k=>Math.max(...solids.map(solid=>solid.bounds.max[k])));
  return distance(min,max);
}
function boxesOverlap(a,b){return a.min.every((value,k)=>value<b.max[k]&&b.min[k]<a.max[k]);}
function removesAllOverlap(source,shifted){
  for(let i=0;i<source.length;i++)for(let j=i+1;j<source.length;j++)
    if(boxesOverlap(source[i].bounds,source[j].bounds)&&!boxesOverlap(shifted[i].bounds,shifted[j].bounds))return true;
  return false;
}
