// Shared Studio view preparation for numerical Slice receivers. No computation
// is rerun to replace the retained value, and no scheduled moves are invented.
import {sliceReceiverSchemas,isSliceContextReference,verifySliceNumericalContext,resolveSliceNumericalContext} from '../contracts/slice-receivers.mjs';
import {prepareSurfaceReference} from '../geom/surface-record.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';

export const isSliceReceiver=value=>Object.hasOwn(sliceReceiverSchemas,value?.schema??'');
export const sliceReceiverType=value=>sliceReceiverSchemas[value?.schema];
export function sliceContextReferences(value){
  const result=new Map();
  function visit(value){if(isSliceContextReference(value)){result.set(value.valueId,value);return;}if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);}
  visit(value);return [...result.values()];
}
export async function readSliceReceiverContexts(selected,query,bindings={}){
  const entries=new Map(),records=[],bound={...bindings},pending=sliceContextReferences(selected.value.context);let rows;
  for(let index=0;index<pending.length;index++){
    const ref=pending[index];if(entries.has(ref.valueId))continue;
    let id=bound[ref.valueId];
    if(!id){
      rows??=await query({flowId:selected.flowId});
      const candidates=rows.filter(row=>row.status==='complete'&&row.valueId===ref.valueId&&row.typeId==='flow-value'&&row.implementationSchema==='saam-slice-numerical-context/1'&&row.bundleId===selected.bundleId).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.id.localeCompare(b.id));
      id=candidates[0]?.id;if(!id)throw Error('The exact Slice numerical context is unavailable.');bound[ref.valueId]=id;
    }
    const record=await query({id});
    if(record.status!=='complete'||record.valueId!==ref.valueId||record.typeId!=='flow-value'||record.flowId!==selected.flowId||record.bundleId!==selected.bundleId)throw Error('The exact Slice numerical context is unavailable or mismatched.');
    const encoding=record.artifact?.encoding??'json',entry=verifySliceNumericalContext(record.value,ref.valueId,{encoding});entries.set(ref.valueId,{entry,encoding});records.push(record);pending.push(...sliceContextReferences(entry.value));
  }
  return {entries,records,bindings:bound};
}
function* receivedCurves(value){
  const r=value.receiver;
  if(value.schema==='saam-slice-prepared-fill/1'){
    for(const [role,loops] of [['owned',r.region],['interior',r.preparedLayout.interior],['solid',r.preparedLayout.solidRegion],['sparse',r.preparedLayout.sparseRegion]])
      for(const points of loops)yield {role,closed:true,points,chart:true};
    for(const stroke of r.preparedLayout.walls)yield {...stroke,chart:true};
  }else if(value.schema==='saam-slice-mapping-receiver/1'){
    for(const stroke of r.strokes)yield {...stroke,chart:!stroke.surfaceSamples};
  }else for(const stroke of r.curves??r.strokes)yield stroke;
}
const vector=(a,b)=>a.map((n,k)=>n-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const length=Math.hypot(...v);return length>0?v.map(n=>n/length):null;};
export function buildSliceReceiverView(value,{lookup,cursor=0,maxEdges=512}={}){
  if(!isSliceReceiver(value))throw Error('Unknown Slice receiver representation.');
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(maxEdges)||maxEdges<1||maxEdges>4096)throw Error('Invalid Slice drawing page.');
  const context=(ref,kind)=>{
    if(!isSliceContextReference(ref))throw Error('The exact Slice '+kind+' context is unavailable.');
    const found=lookup(ref.valueId),entry=verifySliceNumericalContext(found?.entry??found,ref.valueId,{encoding:found?.encoding??'json'});
    if(entry.kind!==kind)throw Error('Slice numerical context kind mismatch.');
    return resolveSliceNumericalContext(ref,lookup);
  };
  const chartRequired=['saam-slice-prepared-fill/1','saam-slice-mapping-receiver/1'].includes(value.schema);
  const surface=chartRequired?prepareSurfaceReference(context(value.context.surface,'surface')):null;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],segments=[],frames=[],sections=[],locals=[],groups=new Map(),mappingEvidence=[];
  let totalEdges=0,shownEdges=0,curveIndex=0;
  const bound=p=>{if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('Slice graphic needs finite received XYZ points.');for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}return p;};
  for(const curve of receivedCurves(value)){
    const samples=curve.surfaceSamples,source=samples??curve.points;
    if(!Array.isArray(source))throw Error('Slice curve has no admitted points or producer samples.');
    const point=i=>bound(samples?samples[i].point:curve.chart?evaluateSurface(surface,source[i]).point:source[i]);
    const count=source.length,edges=count>1?count-1+(curve.closed?1:0):0,role=curve.materialRole??curve.role??'curve';
    groups.set(role,(groups.get(role)??0)+1);
    if(curve.mappingReport&&mappingEvidence.length<32)mappingEvidence.push({curve:curveIndex,report:curve.mappingReport});
    // Bounds use every received sample, without a second all-points array.
    for(let i=0;i<count;i++)point(i);
    for(let i=0;i<edges;i++){
      const edge=totalEdges++,j=(i+1)%count;
      if(edge<cursor||shownEdges>=maxEdges)continue;
      const a=point(i),b=point(j);
      if(curve.chart){
        // These are finite chart-edge drawing samples, not mapping witnesses.
        const uvA=source[i],uvB=source[j];segments.push(Array.from({length:5},(_,step)=>bound(evaluateSurface(surface,uvA.map((n,k)=>n+(uvB[k]-n)*step/4)).point)));
      }else segments.push([a,b]);
      shownEdges++;
      const normal=curve.normals?.[i]??curve.frameSamples?.[i]?.normal??samples?.[i]?.normal??curve.segmentMetadata?.[i]?.surfaceNormal;
      if(normal&&frames.length<24){
        // frameSamples.point is a chart anchor; the received XYZ sample anchors
        // its displayed geometric basis. These are not commanded tool axes.
        const frame=curve.frameSamples?.[i],basis=frame?[frame.u,frame.v,frame.normal]:[normal];
        frames.push({curve:curveIndex,sample:i,point:a,basis});
        for(const axis of basis)segments.push([a,a.map((n,k)=>n+axis[k]*.5)]);
      }
      if(value.schema==='saam-slice-prepared-strokes/1'&&locals.length<24){
        const metadata=curve.segmentMetadata?.[i],width=metadata?.beadWidthMm??curve.beadWidthMm,height=metadata?.beadHeightMm??curve.beadHeightMm,length=Math.hypot(...vector(b,a));
        const area=curve.beadAreaMm2??(length>0&&curve.volumesMm3?.[i]!==undefined?curve.volumesMm3[i]/length:undefined);
        const local={curve:curveIndex,segment:i,role,point:a,...(width!==undefined?{widthMm:width}:{}),...(height!==undefined?{heightMm:height}:{}),...(curve.speedMmS!==undefined?{speedMmS:curve.speedMmS}:{}),...(curve.volumesMm3?.[i]!==undefined?{volumeMm3:curve.volumesMm3[i]}:{}),...(area!==undefined?{derivedRateMm3PerMm:area}:{}),...(width>0&&height>0?{derivedAspectRatio:width/height}:{})};
        locals.push(local);
        const tangent=unit(vector(b,a)),across=normal&&tangent?unit(cross(normal,tangent)):null;
        if(across&&width>0&&height>0){
          const corner=(side,depth)=>a.map((n,k)=>n+side*across[k]*width/2-depth*normal[k]*height),corners=[corner(-1,0),corner(1,0),corner(1,1),corner(-1,1)];
          sections.push({curve:curveIndex,segment:i,corners});for(let k=0;k<4;k++)segments.push([corners[k],corners[(k+1)%4]]);
        }
      }
    }
    curveIndex++;
  }
  const next=cursor+shownEdges<totalEdges?cursor+shownEdges:null,complete=cursor===0&&shownEdges===totalEdges;
  const meaning=chartRequired?'Derived chart-edge samples; chart units are not physical millimetres. No continuous mapping/contact proof.':value.schema==='saam-slice-gap-receiver/1'?'Received XYZ polylines and geometric frames; approximation follows each retained mapping report. No printed-material contact proof.':'Received unscheduled deposited strokes; finite section ticks and rate/aspect readouts are derived from retained dimensions/material. No Paath parameter laws or playback order.';
  return {kind:'slice-receiver',schema:value.schema,identity:value.identity,segments,frames,sections,locals,groups:[...groups].map(([role,curves])=>({role,curves})),mappingEvidence,
    bounds:min.every(Number.isFinite)?{min,max}:{min:[0,0,0],max:[1,1,1]},coverage:{complete,cursor,next,totalCurves:curveIndex,totalEdges,shownEdges,shownFrames:frames.length,shownSections:sections.length,meaning}};
}
