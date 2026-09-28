// Geometry intersections and booleans as tools: an agent reads sections and
// tops of a print (or of geometry it is about to write) and combines solids
// without writing a script.
import {loadBundle,updatePlan} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell,translateShell} from './generate.mjs';
import {sectionGeometry,topAt} from '../geom/query.mjs';
import {booleanShell,BOOLEAN_OPERATIONS,BOOLEAN_OPERAND_SHAPES} from '../geom/boolean-solid.mjs';
import {loopArea} from '../region/region2d.mjs';
import {requireThat} from '../geom/tolerance.mjs';

const round=v=>Math.round(v*1e4)/1e4;
const INTERSECT_FIELDS=['geometry','part','sectionsAtZ','topsAtXY','includeLoops'];

// An assembly is queried as the union of its placed components.
function queryShell(r,geometry){
  if(geometry.shape!=='assembly')return buildShell(r,geometry);
  return booleanShell('union',geometry.parts.map(part=>translateShell(buildShell(r,part.geometry),part.xMm,part.yMm,part.zMm)));
}

// Horizontal planes give section loops (outer loops counterclockwise, holes
// clockwise); vertical lines give the highest surface crossing. Coordinates are
// the geometry's own, before the recipe's placement.
export async function intersectGeometry(geometry,{sectionsAtZ=[],topsAtXY=[],includeLoops=false}={}){
  requireThat(Array.isArray(sectionsAtZ)&&sectionsAtZ.every(Number.isFinite),'sectionsAtZ lists heights in millimetres.');
  requireThat(Array.isArray(topsAtXY)&&topsAtXY.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'topsAtXY lists [x, y] points in millimetres.');
  requireThat(sectionsAtZ.length+topsAtXY.length>0,'Ask for at least one section height or top point.');
  const shell=queryShell(await rhino(),geometry);
  const sections=sectionsAtZ.map(z=>{
    const {loops,nudgedByMm}=sectionGeometry(shell,z),areas=loops.map(loopArea);
    return {zMm:z,areaMm2:round(areas.reduce((a,b)=>a+b,0)),islands:areas.filter(a=>a>0).length,holes:areas.filter(a=>a<0).length,
      ...(nudgedByMm?{nudgedByMm}:{}),
      loops:loops.map((loop,i)=>({areaMm2:round(areas[i]),points:loop.length,
        boundsMm:{min:[0,1].map(a=>round(Math.min(...loop.map(p=>p[a])))),max:[0,1].map(a=>round(Math.max(...loop.map(p=>p[a]))))},
        ...(includeLoops?{pointsMm:loop.map(p=>p.map(round))}:{})}))};
  });
  const tops=topsAtXY.map(([x,y])=>{
    const top=topAt(shell,x,y);
    return top?{xyMm:[x,y],zMm:round(top.zMm),normal:top.normal.map(round),slopeDeg:round(top.slopeDeg),surface:top.patch}:{xyMm:[x,y],zMm:null};
  });
  return {boundsMm:{min:shell.bounds.min.map(round),max:shell.bounds.max.map(round)},sections,tops};
}

// Query a supplied geometry, or a print's geometry or one of its parts.
export async function intersectRequest(directory,request){
  requireThat(request&&typeof request==='object'&&Object.keys(request).every(k=>INTERSECT_FIELDS.includes(k)),`An intersect request has ${INTERSECT_FIELDS.join(', ')}.`);
  const {geometry,part,...query}=request;
  if(geometry)return intersectGeometry(geometry,query);
  requireThat(directory,'Name a print, or supply geometry to query.');
  const plan=(await loadBundle(directory,{program:false})).plan;
  const owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner,'Unknown part.');
  return intersectGeometry(owner.geometry,query);
}

// Wrap the current geometry (or one part) and a new operand in a boolean. The
// same operation again appends: a difference subtracts every later operand.
export async function combineGeometry(directory,request,{expectedRevision}={}){
  requireThat(request&&typeof request==='object'&&Object.keys(request).every(k=>['operation','operand','part'].includes(k)),'A combine request has operation, operand and part.');
  requireThat(BOOLEAN_OPERATIONS.includes(request.operation),`operation is one of ${BOOLEAN_OPERATIONS.join(', ')}.`);
  requireThat(BOOLEAN_OPERAND_SHAPES.includes(request.operand?.shape),`The operand is ${BOOLEAN_OPERAND_SHAPES.join(', ')} geometry.`);
  const state=await loadBundle(directory,{program:false});
  requireThat(typeof expectedRevision==='string'&&expectedRevision===state.revision,'This review is stale. Reload before combining geometry.');
  const plan=structuredClone(state.plan),owner=request.part?plan.geometry.parts?.find(p=>p.id===request.part):plan;
  requireThat(owner&&owner.geometry.shape!=='assembly','Select an assembly part with part.');
  const current=owner.geometry;
  requireThat(BOOLEAN_OPERAND_SHAPES.includes(current.shape),`Only ${BOOLEAN_OPERAND_SHAPES.join(', ')} geometry combines; text, heat-set and Gridfinity records are finished bodies.`);
  owner.geometry=current.shape==='boolean'&&current.operation===request.operation
    ?{...current,operands:[...current.operands,request.operand]}
    :{shape:'boolean',operation:request.operation,operands:[current,request.operand]};
  return updatePlan(directory,plan,state.revision);
}
