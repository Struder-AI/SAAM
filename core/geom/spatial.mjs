import {CHORD_TOLERANCE_MM} from '../dimensions.mjs';
// Authored spatial inputs may be solids, curves and points. Visibility is a
// presentation choice; every entry remains available to manufacturing.
import {requireThat} from './tolerance.mjs';
import {curvePoint} from './surface-curves.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {authoredNurbs} from './nurbs.mjs';
export {authoredNurbs} from './nurbs.mjs';

const point=(p,n=3)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);
export const spatialTemplate=()=>({shape:'spatial',solid:null,curves:[],points:[]});
export const solidGeometry=geometry=>geometry?.shape==='spatial'?geometry.solid:geometry;
export const replaceSolid=(geometry,solid)=>geometry?.shape==='spatial'?{...geometry,solid}:solid;

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
      // Repeated vertices are kept here; Trace drops them when it reads the curve.
      else requireThat(Array.isArray(input.points)&&input.points.length>=(entry.closed?3:2)&&input.points.every(p=>point(p,dimensions)),'Curve geometry needs finite points.');
      if(entry.uv)requireThat(input.reference&&['patch','slice','sleeve','surface'].includes(input.reference.kind),'UV geometry needs a surface reference.');
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
    const samples=sampleCurveIntervals({at:t=>({point:curvePoint(native,t)}),cuts:[0,1,...cuts],stepMm:1,toleranceMm:CHORD_TOLERANCE_MM});
    return {id:c.id,points:samples.map(s=>s.point)};
  });
  return {curves,points:geometry.points.filter(p=>p.visible).map(({id,point})=>({id,point}))};
}
