// Reconcile finite authored samples before their single physical-parameter law.
import {isDeepStrictEqual as same} from 'node:util';
import {constructionCurve,transferConstructionCurveSelection} from './construction-curves.mjs';
import {constructionScalarProfiles,readCurveProfiles,curveProfile} from './construction-profiles.mjs';

const pointFields=['points','poses','normals','frameSamples','chartPoints','referenceAlong'];
const edgeFields=['volumesMm3','segmentMetadata','heightsMm','widthsMm','flowMultipliers'];
// These values have only their segment's physical support. Other metadata is
// provenance, and cannot be converted to a positive interval by removing an edge.
const physicalMetadata=new Set(['surfaceNormal','beadWidthMm','speedMmS','beadHeightMm','normalHeightMm','normalGapMm','gapMm','beadAreaMm2','flowMultiplier','slopeDeg','volumeMm3']);
function chordParameters(points){
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(...points[i].map((value,k)=>value-points[i-1][k])));
  return lengths.map(length=>length/lengths.at(-1));
}
function increasing(values){return values.every((u,i)=>Number.isFinite(u)&&(!i||u>values[i-1]));}
function mappedParameter(source,physical,u){
  const state={i:1};while(state.i<source.length-1&&source[state.i]<u)state.i++;
  const i=state.i,t=(u-source[i-1])/(source[i]-source[i-1]);
  return physical[i-1]+t*(physical[i]-physical[i-1]);
}
function canonicalKeys(keys){
  const result=[];
  for(const key of keys){
    if(result.at(-1)?.[0]!==key[0])result.push(key);
    else if(result.at(-1)[1]!==key[1])return null;
  }
  return result;
}
function canonicalLaw(law){
  if(typeof law==='number')return law;
  const knots=canonicalKeys(law.knots);
  return knots?.every(([,value])=>value===knots[0][1])?knots[0][1]:{...law,knots};
}
function scalarDescends(values,a,b){
  const cuts=[a,...values.filter(([u])=>u>a&&u<b).map(([u])=>u),b],value=curveProfile(values,a);
  for(let i=1;i<cuts.length;i++){
    const from=cuts[i-1],to=cuts[i],mid=from+(to-from)/2;
    if(curveProfile(values,from)!==value||curveProfile(values,to)!==value)return false;
    const right=values.findIndex(([u])=>u>=to),left=values[Math.max(0,right-1)];
    // A nonconstant preparation interval can disappear only when it has no
    // represented interior AND the complete emitted law is certified below.
    if(left[1]!==values[Math.max(1,right)][1]&&mid!==from&&mid!==to)return false;
  }
  return true;
}
function correspondenceFailure(result,stroke,code,detail){
  const curve=stroke.sourceCurve??stroke.id,conflict={code,...detail};
  return Object.assign(Error('Trace '+result.id+' curve '+(curve??'?')+' has unrepresentable sampled correspondence: '+JSON.stringify(conflict)),
    {code:'AUTHORED_CORRESPONDENCE_UNREPRESENTABLE',curve,conflict});
}
function reconcileStroke(result,stroke,operation,assignment,closures){
  if(stroke.stationaryExtrusion||constructionCurve(stroke,operation.slice))return stroke;
  const before=chordParameters(stroke.points);
  if(increasing(before))return stroke;
  const fail=(code,detail={})=>{throw correspondenceFailure(result,stroke,code,detail);};
  const declared=assignment?.curves.find((curve,index)=>(curve.id??index)===(stroke.sourceCurve??stroke.id));
  if(!declared)fail('NO_COMPLETE_AUTHORED_CONTEXT');
  if(declared.widthRule)fail('PARALLEL_SOURCE_CORRESPONDENCE',{widthRule:declared.widthRule});
  const parameters=stroke.curveParameters,n=stroke.points.length,vary=stroke.profilePath?.vary??readCurveProfiles(declared.vary).vary??{};
  if(!parameters||parameters.length!==n||parameters[0]!==0||parameters.at(-1)!==1||!increasing(parameters))fail('SOURCE_CORRESPONDENCE_NOT_INCREASING');
  for(const key of pointFields)if(stroke[key]&&stroke[key].length!==n)fail('POINT_FIELD_LENGTH',{key});
  for(const key of edgeFields)if(stroke[key]&&stroke[key].length!==n-1)fail('EDGE_FIELD_LENGTH',{key});
  if(stroke.profilePath&&(!same(stroke.profilePath.vary,vary)||!same(stroke.profilePath.parameters,parameters)))fail('ORIGINAL_PROFILE_WITNESS_MISMATCH');
  const normalAt=i=>stroke.normals?.[i]??stroke.frameSamples?.[i]?.normal??stroke.segmentMetadata?.[Math.min(i,n-2)]?.surfaceNormal;
  const kept=[],edges=[],intervals=[];
  for(let start=0;start<n;){
    const group={end:start};while(group.end+1<n&&same(stroke.points[group.end],stroke.points[group.end+1]))group.end++;
    const end=group.end;
    if(start===end){kept.push(start);start++;continue;}
    const interval=[parameters[start],parameters[end]];
    for(let i=start+1;i<=end;i++){
      for(const key of pointFields)if(stroke[key]&&!same(stroke[key][start],stroke[key][i]))fail('POINT_FIELD_DISAGREEMENT',{key,interval,index:i,first:stroke[key][start],value:stroke[key][i]});
      if(!same(normalAt(start),normalAt(i)))fail('MATERIAL_NORMAL_DISAGREEMENT',{interval,index:i,first:normalAt(start),value:normalAt(i)});
      const volume=stroke.volumesMm3?.[i-1]??0*stroke.beadAreaMm2;
      if(volume!==0)fail('NONZERO_OR_UNKNOWN_MATERIAL_ON_ZERO_EDGE',{interval,edge:i-1,volume});
      const labels=Object.fromEntries(Object.entries(stroke.segmentMetadata?.[i-1]??{}).filter(([key])=>!physicalMetadata.has(key)));
      if(Object.keys(labels).length)fail('ZERO_SUPPORT_PROVENANCE',{interval,edge:i-1,labels});
      for(const [key,values] of Object.entries(vary))if(!scalarDescends(values,parameters[i-1],parameters[i]))fail('SCALAR_LAW_DOES_NOT_DESCEND',{key,interval:[parameters[i-1],parameters[i]],values});
    }
    const semantic=[...new Set(Object.values(vary).flatMap(values=>values.map(([u])=>u)).filter(u=>u>=interval[0]&&u<=interval[1]))];
    if(semantic.length>1)fail('MULTIPLE_AUTHORED_ALIAS_KEYS',{interval,semantic});
    const semanticIndex=semantic.length?parameters.indexOf(semantic[0]):-1;
    if(semantic.length&&(semanticIndex<start||semanticIndex>end))fail('AUTHORED_CUT_NOT_IN_CORRESPONDENCE',{interval,cut:semantic[0]});
    if(start===0&&end===n-1)fail('WHOLE_CURVE_STATIONARY',{interval});
    kept.push(start===0?0:end===n-1?n-1:semantic.length?semanticIndex:end);
    intervals.push(interval);start=end+1;
  }
  if(!intervals.length)fail('CHORD_PARAMETER_PRECISION',{detail:'Positive sampled edges do not have distinct physical parameters.'});
  for(let i=0;i<n-1;i++)if(!same(stroke.points[i],stroke.points[i+1]))edges.push(i);
  const candidate={...stroke,curveParameters:kept.map(i=>parameters[i])};
  for(const key of pointFields)if(stroke[key])candidate[key]=kept.map(i=>stroke[key][i]);
  for(const key of edgeFields)if(stroke[key])candidate[key]=edges.map(i=>stroke[key][i]);
  const after=chordParameters(candidate.points);
  if(!increasing(after))fail('QUOTIENT_CHORD_PARAMETER_PRECISION');
  for(const [j,i] of edges.entries()){
    if(before[i]!==after[j]||before[i+1]!==after[j+1])fail('SURVIVING_PHYSICAL_EDGE_CHANGED',{edge:i,newEdge:j});
    for(const [key,values] of Object.entries(vary)){
      const oldValue=curveProfile(values,(parameters[i]+parameters[i+1])/2),newValue=curveProfile(values,(candidate.curveParameters[j]+candidate.curveParameters[j+1])/2);
      if(oldValue!==newValue)fail('SURVIVING_SCALAR_MIDPOINT_CHANGED',{key,edge:i,oldValue,newValue});
    }
  }
  const mapped={};
  for(const [key,values] of Object.entries(vary)){
    const oldKeys=canonicalKeys(values.map(([u,value])=>[mappedParameter(parameters,before,u),value])),newKeys=canonicalKeys(values.map(([u,value])=>[mappedParameter(candidate.curveParameters,after,u),value]));
    if(!oldKeys||!newKeys||!same(oldKeys,newKeys))fail('AUTHORED_KEY_PHYSICAL_MAPPING_CHANGED',{key,oldKeys,newKeys});
    mapped[key]={interpolation:'linear',knots:oldKeys};
  }
  const oldLaws=constructionScalarProfiles(stroke,before,operation.process).profiles,newLaws=constructionScalarProfiles(candidate,after,operation.process).profiles,legacyScalarBranches=[];
  for(const [key,published,witnessKey,fallback] of [['rateMm3PerMm','rateMm3PerMm','ratesMm2',stroke.beadAreaMm2],['aspectRatio','aspectRatio','aspects',stroke.beadWidthMm/(stroke.beadHeightMm??operation.process.layerMm)],['speedMmS','speedMmS','speedsMmS',stroke.speedMmS]]){
    const reference=canonicalLaw(mapped[key]??oldLaws[published]),law=canonicalLaw(newLaws[published]);
    if(vary[key]){
      const values=stroke.points.slice(1).map((_,i)=>stroke.profilePath?.[witnessKey]?.[i]??stroke.segmentMetadata?.[i]?.[key]??fallback),constant=vary[key].every(([,value])=>value===vary[key][0][1])&&values.every(value=>value===vary[key][0][1]);
      if(!constant&&(!stroke.profilePath?.[witnessKey]||edges.some(i=>stroke.profilePath[witnessKey][i]!==values[i])))fail('SURVIVING_AUTHORED_WITNESS_VALUES_MISMATCH',{key});
    }
    if(!same(reference,law)||reference?.knots===null||law?.knots===null)fail('COMPLETE_PUBLICATION_SCALAR_LAW_CHANGED',{key,reference,law});
    if(!same(canonicalLaw(oldLaws[published]),law))legacyScalarBranches.push(key);
  }
  transferConstructionCurveSelection(stroke,candidate,operation.slice);
  closures.push({curve:stroke.sourceCurve??stroke.id,closedZeroEdges:n-candidate.points.length,sourceIntervals:intervals,legacyScalarBranches});
  return candidate;
}
export function reconcileAuthoredCorrespondence(result,assignment){
  if(result.report?.depositionFamily!=='trace')return result;
  const closures=[],operations=result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>reconcileStroke(result,stroke,operation,assignment,closures))}));
  return closures.length?{...result,operations,report:{...result.report,authoredCorrespondence:{closures}}}:result;
}
