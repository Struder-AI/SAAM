// Slice stages share one spatial Paath authority. Chart samples only retain
// correspondence for surface/gap queries and compatibility at admission.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';
import {mapSliceStrokes} from '../region/layer-strokes.mjs';
import {sliceGapCurves} from '../region/slice-gaps.mjs';
import {depositCurves} from '../path/deposition.mjs';
import {constructionScalarProfiles} from '../path/construction-profiles.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const channel=(values,parameters)=>values.every(value=>same(value,values[0]))?values[0]:
  {interpolation:'slerp',knots:values.map((value,i)=>[parameters[i],value])};
export function sliceCurveParameters(points){
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  requireThat(lengths.at(-1)>0&&lengths.every((value,i)=>!i||value>lengths[i-1]),'Slice Paath needs nonzero, distinct spatial segments.');
  return lengths.map(length=>length/lengths.at(-1));
}

export function emptySlicePaath(layer,{id,stackId=id}){
  const layerId=stackId+':layer:'+layer.index,surfaceId='surface:'+layerId,completionId='completion:slice:'+layerId;
  return {schema:'saampath/3',units:'mm',materialUnits:'mm3',sectionReference:'top',curves:{},
    layers:{[layerId]:{stackId,index:layer.index,sequence:layer.sequence??layer.ordinal??layer.index,surfaceId,completionId}},
    surfaces:{[surfaceId]:surfaceReferenceRecord(layer.slice)},processes:{},operations:{},
    completions:{[completionId]:{kind:'slice',members:[],after:[]}},planning:{},composition:{},summary:{},
    correspondence:{},operationMetadata:{}};
}

function explicitMappedCurve(curve){
  const {points,...metadata}=curve;
  const duplicate=points.length>1&&same(points[0],points.at(-1));
  if(!curve.closed||duplicate)return {points,...metadata,closed:curve.closed||duplicate};
  const result={...metadata,points:[...points,points[0]]};
  for(const key of ['chartPoints','normals','frameSamples','referenceAlong'])if(curve[key])result[key]=[...curve[key],curve[key][0]];
  if(curve.sourceParameters)result.sourceParameters=[...curve.sourceParameters,
    curve.sourceParameters[0]+(curve.sourceParameters.at(-1)>=curve.sourceParameters[0]?1:-1)];
  return result;
}

export function sliceStrokesPaath(groups,layer,options){
  const paath=emptySlicePaath(layer,options),layerId=Object.keys(paath.layers)[0],completion=paath.completions[paath.layers[layerId].completionId];
  for(const [group,strokes] of groups){
    if(!strokes.length)continue;
    const operationId=options.id+':'+layer.index+':'+group,localIds=new Map(),previousByGroup=new Map();
    const mapped=mapSliceStrokes(strokes,layer.slice,{frames:true,sampleStepMm:layer.settings.sampleStepMm});
    const courses=mapped.map((mappedCurve,index)=>{
      const explicit=explicitMappedCurve(mappedCurve),{points,...metadata}=explicit;
      const curveId=operationId+':curve:'+index,courseId=operationId+':course:'+index;
      const materialRole=metadata.materialRole??metadata.role;
      const role=layer.settings.roles?.[materialRole]??materialRole;
      const orderGroup=metadata.orderGroup??metadata.scanlineCell;
      paath.curves[curveId]={geometry:{kind:'polyline',points},profiles:{}};
      const parameters=sliceCurveParameters(points);
      paath.correspondence[curveId]={...metadata,role,parameters,sourceParameters:metadata.sourceParameters??parameters};
      if(metadata.id!==undefined){
        if(!localIds.has(metadata.id))localIds.set(metadata.id,[]);
        localIds.get(metadata.id).push(courseId);
      }
      const previous=orderGroup===undefined?null:previousByGroup.get(orderGroup);
      if(orderGroup!==undefined)previousByGroup.set(orderGroup,courseId);
      return {id:courseId,curveId,from:0,to:1,interruptible:metadata.interruptible??!layer.settings.continuous,
        directionRequired:metadata.directionRequired??orderGroup!==undefined,role,
        sourceCurve:metadata.sourceCurve??metadata.id??curveId,
        ...(metadata.closed?{seamRequired:metadata.seamRequired??false}:{}),
        ...(metadata.edge?{edge:metadata.edge}:{}),
        ...(orderGroup===undefined?{}:{orderGroup}),...(previous?{after:[previous]}:{}),
        ...(metadata.provenance?{provenance:{source:metadata.provenance}}:{})};
    });
    for(const [index,stroke] of mapped.entries())if(stroke.after!==undefined){
      requireThat(Array.isArray(stroke.after)&&stroke.after.every(id=>id!==stroke.id&&localIds.has(id)),'Slice course prerequisites must name local source curves.');
      courses[index].after=[...new Set([...(courses[index].after??[]),...stroke.after.flatMap(id=>localIds.get(id))])];
    }
    paath.operations[operationId]={id:operationId,kind:'deposit',layerId,processId:null,toolIndex:options.filament??0,
      interruptible:!layer.settings.continuous,
      after:[...(layer.settings.operationAfter?.all??[]),...(layer.settings.operationAfter?.[group]??[])],courses};
    paath.operationMetadata[operationId]={group};
    completion.members.push(operationId);
  }
  return paath;
}

export function combineSlicePaath(parts){
  requireThat(parts.length,'Combining Slice Paath needs at least one member value.');
  const result={...parts[0]};
  for(const key of ['curves','layers','surfaces','processes','operations','completions','correspondence','operationMetadata']){
    result[key]={};
    for(const part of parts)for(const [id,value] of Object.entries(part[key]??{})){
      if(key==='completions'&&result[key][id]){
        const prior=result[key][id];
        result[key][id]={...prior,members:[...new Set([...prior.members,...value.members])],after:[...new Set([...prior.after,...value.after])]};
      }else{
        requireThat(!Object.hasOwn(result[key],id)||same(result[key][id],value),'Slice Paath has conflicting '+key+' identity '+id+'.');
        result[key][id]=value;
      }
    }
  }
  return result;
}

export function conditionSlicePaath(paath,surface,{process:resolved,firstBedLayer,gap,flowMultiplier,widthMm},{filament=null}={}){
  requireThat(gap&&resolved,'Slice conditioning needs member process choices and a positive gap.');
  const processId='process:'+Object.keys(paath.layers)[0];
  const result={...paath,curves:{},correspondence:{},operations:{},processes:{...paath.processes,[processId]:resolved}},parameterMaps=new Map();
  const speedMmS=firstBedLayer?resolved.firstLayerSpeedMmS:resolved.planarSpeedMmS;
  for(const [id,curve] of Object.entries(paath.curves)){
    const source=paath.correspondence[id];
    // Canonical closure is explicit. Gap refinement transports the original
    // parameters together with chart and width channels; IDs remain unchanged.
    const input={...source,points:curve.geometry.points,closed:false,curveParameters:source.parameters??sliceCurveParameters(curve.geometry.points)};
    const [gapped]=sliceGapCurves([input],surface,gap);
    const [deposited]=depositCurves([{...gapped,speedMmS,flowMultiplier}],{widthMm,heightMm:resolved.layerMm,speedMmS});
    const parameters=sliceCurveParameters(deposited.points);
    const scalars=constructionScalarProfiles(deposited,parameters,resolved).profiles;
    const normals=gapped.normals??source.normals;
    requireThat(normals?.length===deposited.points.length,'Slice Paath needs aligned surface normals.');
    result.curves[id]={geometry:{kind:'polyline',points:deposited.points},profiles:{...curve.profiles,...scalars,
      toolAxis:curve.profiles.toolAxis??[0,0,1],materialNormal:channel(normals,parameters)}};
    const {points,...correspondence}=gapped;
    result.correspondence[id]={...correspondence,closed:source.closed,sourceParameters:gapped.sourceParameters??source.sourceParameters,
      parameters,...(source.closed?{seamRequired:source.seamRequired??false}:{})};
    parameterMaps.set(id,{from:gapped.curveParameters,to:parameters});
  }
  const transported=(curveId,u)=>{
    const map=parameterMaps.get(curveId);
    if(!map||same(map.from,map.to))return u;
    let i=1;while(i<map.from.length-1&&map.from[i]<u)i++;
    const fraction=(u-map.from[i-1])/(map.from[i]-map.from[i-1]);
    return map.to[i-1]+fraction*(map.to[i]-map.to[i-1]);
  };
  for(const [id,operation] of Object.entries(paath.operations))result.operations[id]={...operation,processId,toolIndex:filament??operation.toolIndex,
    courses:operation.courses.map(course=>({...course,from:transported(course.curveId,course.from),to:transported(course.curveId,course.to)}))};
  return result;
}

export function sliceBoundaryCurves(wallPaath){
  return Object.values(wallPaath.operations).flatMap(operation=>operation.courses.map(course=>{
    const geometry=wallPaath.curves[course.curveId].geometry,metadata=wallPaath.correspondence[course.curveId];
    const duplicate=same(geometry.points[0],geometry.points.at(-1));
    const result={...metadata,points:duplicate?geometry.points.slice(0,-1):geometry.points,closed:true};
    if(duplicate)for(const key of ['chartPoints','normals','frameSamples','referenceAlong','sourceParameters','parameters','curveParameters'])
      if(result[key])result[key]=result[key].slice(0,-1);
    return result;
  }));
}
