// Choose the exterior ribbon from actual adjacent material, independent of winding.
import {controlCurve} from './curve-controls.mjs';
import {prepareRibbon} from './curve-ribbon.mjs';
import {evaluateCurve,nurbsCurveRecord} from './nurbs.mjs';
import {containsPoint} from './query.mjs';
import {resolveMaterialGeometry} from './build.mjs';
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {sampleSpatialCurve,trimSpatialCurve} from './spatial-curve.mjs';
import {prepareSolidDistance,solidNormal} from './solid-distance.mjs';
import {dot,cross} from './tolerance.mjs';

export async function ribbon({geometry=null,curve,vertical=[0,0,1],depthMm,materialSide=null}){
  requireThat(Number.isFinite(depthMm),'Ribbon depth must be finite.');
  const native=controlCurve(curve);
  const prepared=prepareRibbon({curve:native,closed:curve.closed,vertical});
  const result=(offset,side,closed=curve.closed)=>({curves:offset.pieces.map(p=>({closed:closed&&offset.folds===0,nurbs:{degree:p.order-1,knots:Array.from(p.knots),controlPoints:Array.from({length:p.n},(_,i)=>[0,1,2].map(k=>p.cp[i*4+k]/p.cp[i*4+3])),weights:Array.from({length:p.n},(_,i)=>p.cp[i*4+3])}})),report:{depthMm,side,folds:offset.folds}});
  if(geometry===null)return result(prepared.ribbon(depthMm),null);
  requireThat(depthMm>0&&[-1,1].includes(materialSide),'Material ribbon needs positive depth and an adjacent material side.');
  const [solid]=await resolveMaterialGeometry([geometry]);
  const length=Math.hypot(...vertical),axis=vertical.map(v=>v/length),probe=Math.min(depthMm/16,2*PRINT_RESOLUTION_MM);
  const [start,end]=native.domain,span=end-start;
  const sideAt=t=>{
    const at=evaluateCurve(native,t),d=at.derivative,right=[d[1]*axis[2]-d[2]*axis[1],d[2]*axis[0]-d[0]*axis[2],d[0]*axis[1]-d[1]*axis[0]],size=Math.hypot(...right);
    requireThat(size>ROUNDING_MM,'Selected edge is parallel to the ribbon advance direction.');
    // Near a steep crease, a rounding-scale probe can miss its material wedge.
    // Grow only within the requested physical offset before using face normals.
    for(let lateral=probe;lateral<=depthMm;lateral*=2)for(let advance=probe;advance<=depthMm;advance*=2)for(const along of [materialSide,-materialSide]){
      const a=at.point.map((v,k)=>v+lateral*right[k]/size+along*advance*axis[k]);
      const b=at.point.map((v,k)=>v-lateral*right[k]/size+along*advance*axis[k]);
      const r=containsPoint(solid,a),l=containsPoint(solid,b);
      if(r!==l)return r?-1:1;
    }
    return 0;
  };
  const samples=sampleSpatialCurve({closed:curve.closed,nurbs:nurbsCurveRecord(native)},
    {toleranceMm:PRINT_RESOLUTION_MM/4,sampleStepMm:depthMm}).samples;
  const intervals=[],state={boundary:null};
  for(let i=1;i<samples.length;i++){
    const from=samples[i-1].t,to=samples[i].t,t=start+(from+to)/2*span,chosen={side:sideAt(t)},last=intervals.at(-1);
    if(!chosen.side){
      if(!state.boundary)state.boundary=(await prepareSolidDistance(geometry,{toleranceMm:PRINT_RESOLUTION_MM/4})).prepared;
      const at=evaluateCurve(native,t),nearest=solidNormal(state.boundary,at.point),projection=dot(nearest.normal,cross(at.derivative,axis));
      requireThat(nearest.distanceMm<=PRINT_RESOLUTION_MM&&Math.abs(projection)>ROUNDING_MM,'Selected edge has no unique exterior in its advance plane; select an exposed edge or another advance direction.');
      chosen.side=Math.sign(projection);
    }
    if(last&&last.side===chosen.side)last.to=to;else intervals.push({from,to,side:chosen.side});
  }
  const curves=[],sourceCurves=[],pieces=[];let folds=0;
  for(const interval of intervals){
    const portion=trimSpatialCurve({closed:curve.closed,nurbs:nurbsCurveRecord(native)},[interval.from,interval.to]);
    const offset=prepareRibbon({curve:controlCurve(portion),closed:portion.closed,vertical}).ribbon(interval.side*depthMm);
    const built=result(offset,interval.side,portion.closed);folds+=offset.folds;
    for(const [i,part] of built.curves.entries()){
      curves.push(part);
      const kept=offset.pieces[i],a=(kept.domain[0]-start)/span,b=(kept.domain[1]-start)/span;
      sourceCurves.push(trimSpatialCurve({closed:curve.closed,nurbs:nurbsCurveRecord(native)},[a,b]));
      // Polyline selection ranges use arc length; control interpolation retains
      // its own knot parameter, so convert only the reported source interval.
      const parameter=t=>{
        if(curve.nurbs)return t;
        const points=curve.closed?[...curve.points,curve.points[0]]:curve.points,lengths=[0];
        for(let j=1;j<points.length;j++)lengths.push(lengths.at(-1)+Math.hypot(...points[j].map((v,k)=>v-points[j-1][k])));
        const index=Math.min(points.length-2,Math.floor(t*(points.length-1))),fraction=t*(points.length-1)-index;
        return (lengths[index]+fraction*(lengths[index+1]-lengths[index]))/lengths.at(-1);
      };
      pieces.push({side:interval.side,sourceRange:[parameter(a),parameter(b)]});
    }
  }
  return {curves,sourceCurves,report:{depthMm,side:intervals.length===1?intervals[0].side:null,folds,pieces}};
}
