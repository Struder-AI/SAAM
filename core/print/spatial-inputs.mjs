// Persistence separates authored geometry from deposition settings. Engines
// receive resolved values at compilation; no technique owns another geometry store.
import {spatialTemplate,validateSpatial,solidGeometry} from '../geom/spatial.mjs';
import {requireThat} from '../geom/tolerance.mjs';

const curveKeys=['points','nurbs','uv','closed'];
export function normalizeSpatialPlan(plan){
  const original=plan.geometry,spatial=original?.shape==='spatial'?original:{...spatialTemplate(),solid:original??null};
  const curves=new Map(spatial.curves.map(c=>[c.id,c])),points=new Map(spatial.points.map(p=>[p.id,p]));
  const assignments=plan.slices?.assignments?.map(a=>{
    if(a.construction==='curves')return {...a,curves:a.curves.map((c,i)=>{
      const id=c.geometry??`${a.id}-curve-${i+1}`,inline=curveKeys.some(k=>Object.hasOwn(c,k));
      if(inline){
        const prior=curves.get(id),shape=Object.fromEntries(curveKeys.filter(k=>Object.hasOwn(c,k)).map(k=>[k,c[k]]));
        const retained=['points','nurbs','uv'].some(k=>Object.hasOwn(c,k))?{closed:prior?.closed}:prior;
        curves.set(id,{...retained,id,visible:prior?.visible??!c.uv,...shape});
      }
      requireThat(curves.has(id),`Trace references missing geometry ${id}.`);
      return {...Object.fromEntries(Object.entries(c).filter(([k])=>!curveKeys.includes(k)&&k!=='geometry')),geometry:id};
    })};
    if(a.construction==='inject')return {...a,points:a.points.map((p,i)=>{
      const id=p.geometry??`${a.id}-point-${i+1}`;
      if(Object.hasOwn(p,'point'))points.set(id,{id,point:p.point,visible:points.get(id)?.visible??true});
      requireThat(points.has(id),`Inject references missing geometry ${id}.`);
      const {point,...settings}=p;return {...settings,geometry:id};
    })};
    return a;
  });
  if(original&&original.shape!=='spatial'&&!curves.size&&!points.size)return plan;
  const geometry={...spatial,curves:[...curves.values()],points:[...points.values()]};validateSpatial(geometry);
  return {...plan,geometry,...(assignments?{slices:{...plan.slices,assignments}}:{})};
}

export function resolveSpatialPlan(plan){
  if(plan.geometry?.shape!=='spatial')return plan;
  const geometry=validateSpatial(plan.geometry),curves=new Map(geometry.curves.map(c=>[c.id,c])),points=new Map(geometry.points.map(p=>[p.id,p]));
  const assignments=plan.slices?.assignments?.map(a=>{
    if(a.construction==='curves')return {...a,curves:a.curves.map(c=>{
      if(!Object.hasOwn(c,'geometry'))return c;
      const entry=curves.get(c.geometry);requireThat(entry,`Trace references missing geometry ${c.geometry}.`);
      const {id,visible,...shape}=entry,{geometry:reference,...settings}=c;return {...shape,...settings};
    })};
    if(a.construction==='inject')return {...a,points:a.points.map(p=>{
      if(!Object.hasOwn(p,'geometry'))return p;
      const entry=points.get(p.geometry);requireThat(entry,`Inject references missing geometry ${p.geometry}.`);
      const {geometry:reference,...settings}=p;return {point:entry.point,...settings};
    })};
    return a;
  });
  const {geometry:spatial,...rest}=plan;
  return {...rest,...(geometry.solid?{geometry:geometry.solid}:{}),...(assignments?{slices:{...plan.slices,assignments}}:{})};
}

function manufacturingGeometry(geometry){
  if(!geometry)return geometry;
  if(geometry.shape==='spatial')return {...geometry,solid:manufacturingGeometry(geometry.solid),
    curves:geometry.curves.map(({visible,...curve})=>structuredClone(curve)),
    points:geometry.points.map(({visible,...point})=>structuredClone(point))};
  if(geometry.shape==='boolean'){
    const {displayOperand,...solid}=geometry;
    return {...solid,operands:geometry.operands.map(manufacturingGeometry)};
  }
  if(geometry.shape==='assembly')return {...geometry,
    parts:geometry.parts.map(part=>({...part,geometry:manufacturingGeometry(part.geometry)}))};
  if(geometry.shape==='text')return {...structuredClone(geometry),base:manufacturingGeometry(geometry.base),
    materialParts:geometry.materialParts.map(part=>({...part,geometry:manufacturingGeometry(part.geometry)}))};
  if(geometry.shape==='heat-set')return {...structuredClone(geometry),base:manufacturingGeometry(geometry.base)};
  return structuredClone(geometry);
}

function manufacturingVolume(volume){
  return volume.kind==='geometry'?{...volume,geometry:manufacturingGeometry(volume.geometry)}:structuredClone(volume);
}

// The recipe values besides geometry that change the placed manufacturing geometry.
export function placementInput(plan){
  return {placement:plan.placement??null,
    spatialInstructions:(plan.slices?.assignments??[]).filter(a=>a.repeat?.translation||a.within?.length).map(a=>({
      ...(a.repeat?.translation?{repeat:a.repeat}:{}),...(a.within?.length?{within:a.within.map(manufacturingVolume)}:{})})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}

export {solidGeometry};
