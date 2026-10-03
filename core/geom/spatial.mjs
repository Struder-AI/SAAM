// Authored spatial inputs may be solids, curves and points. Visibility is a
// presentation choice; every entry remains available to manufacturing.
import {requireThat} from './tolerance.mjs';
import {curvePoint} from './surface-curves.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';

const point=(p,n=3)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);
export const spatialTemplate=()=>({shape:'spatial',solid:null,curves:[],points:[]});
export const solidGeometry=geometry=>geometry?.shape==='spatial'?geometry.solid:geometry;
export const replaceSolid=(geometry,solid)=>geometry?.shape==='spatial'?{...geometry,solid}:solid;

export function authoredNurbs(record,dimension=3){
  requireThat(record&&Object.keys(record).every(k=>['degree','knots','controlPoints','weights'].includes(k)),'Unexpected NURBS curve fields.');
  const {degree,knots,controlPoints,weights}=record;
  requireThat(Number.isInteger(degree)&&degree>=1&&Array.isArray(controlPoints)&&controlPoints.length>degree&&controlPoints.every(p=>point(p,dimension)),'NURBS needs a degree and finite control points.');
  const n=controlPoints.length,order=degree+1;
  requireThat(Array.isArray(knots)&&knots.length===n+order&&knots.every((k,i)=>Number.isFinite(k)&&(!i||k>=knots[i-1]))&&knots[n]>knots[degree],'NURBS needs a full increasing knot domain.');
  requireThat(weights===undefined||Array.isArray(weights)&&weights.length===n&&weights.every(w=>Number.isFinite(w)&&w>0),'NURBS weights must be positive.');
  return {n,order,knots:Float64Array.from(knots),domain:[knots[degree],knots[n]],cp:Float64Array.from(controlPoints.flatMap((p,i)=>{const w=weights?.[i]??1;return [p[0]*w,p[1]*w,(p[2]??0)*w,w];}))};
}

export function validateSpatial(geometry){
  requireThat(geometry&&Object.keys(geometry).sort().join()==='curves,points,shape,solid'&&geometry.shape==='spatial','Spatial geometry needs solid, curves and points.');
  requireThat(geometry.solid===null||geometry.solid&&geometry.solid.shape!=='spatial','Spatial solid must be ordinary geometry or null.');
  const ids=new Set();
  for(const kind of ['curves','points']){
    requireThat(Array.isArray(geometry[kind]),`Geometry ${kind} must be a list.`);
    for(const entry of geometry[kind]){
      requireThat(entry&&typeof entry.id==='string'&&/^[a-z][a-z0-9-]*$/.test(entry.id)&&!ids.has(entry.id),'Geometry entries need unique stable IDs.');ids.add(entry.id);
      requireThat(typeof entry.visible==='boolean','Geometry visibility must be boolean.');
      if(kind==='points'){
        requireThat(Object.keys(entry).sort().join()==='id,point,visible'&&point(entry.point),'Point geometry needs finite XYZ.');continue;
      }
      requireThat(Object.keys(entry).every(k=>['id','visible','points','nurbs','uv','closed'].includes(k))&&typeof entry.closed==='boolean','Invalid curve geometry fields.');
      requireThat(['points','nurbs','uv'].filter(k=>entry[k]!==undefined).length===1,'Curve geometry needs exactly one spatial definition.');
      const input=entry.uv??entry,dimensions=entry.uv?2:3;
      if(input.nurbs)authoredNurbs(input.nurbs,dimensions);
      else {
        requireThat(Array.isArray(input.points)&&input.points.length>=(entry.closed?3:2)&&input.points.every(p=>point(p,dimensions)),'Curve geometry needs finite points.');
        requireThat(input.points.every((p,i)=>!i||p.some((v,k)=>v!==input.points[i-1][k]))&&(!entry.closed||input.points[0].some((v,k)=>v!==input.points.at(-1)[k])),'Curve points must not repeat consecutive vertices or the implicit closed endpoint.');
      }
      if(entry.uv)requireThat(input.reference&&['patch','slice','sleeve'].includes(input.reference.kind),'UV geometry needs a surface reference.');
    }
  }
  return geometry;
}

// Derived UV curves depend on recipe-produced surfaces and stay hidden until
// toolpath generation. XYZ polylines are exact; NURBS use the shared sampler.
export function spatialPreview(geometry){
  validateSpatial(geometry);
  const curves=geometry.curves.filter(c=>c.visible&&!c.uv).map(c=>{
    if(c.points)return {id:c.id,points:c.closed?[...c.points,c.points[0]]:c.points};
    const native=authoredNurbs(c.nurbs),cuts=[...native.knots].filter(t=>t>native.domain[0]&&t<native.domain[1]).map(t=>(t-native.domain[0])/(native.domain[1]-native.domain[0]));
    const samples=sampleCurveIntervals({at:t=>({point:curvePoint(native,t)}),cuts:[0,1,...cuts],stepMm:1,toleranceMm:.02});
    return {id:c.id,points:samples.map(s=>s.point)};
  });
  return {curves,points:geometry.points.filter(p=>p.visible).map(({id,point})=>({id,point}))};
}
