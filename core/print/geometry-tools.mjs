// Geometry intersections and booleans as tools: an agent reads sections and
// tops of a print (or of geometry it is about to write) and combines solids
// without writing a script.
import {loadBundle,updatePlan} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell,translateShell} from '../geom/build.mjs';
import {topAt} from '../geom/query.mjs';
import {section,horizontalSlice,patchSlice,slicePoint,sliceNormal} from '../geom/slice.mjs';
import {sliceAssignment,validateSlices,sliceOwners,ownedLayers} from './slices.mjs';
import {booleanShell,BOOLEAN_OPERATIONS,BOOLEAN_OPERAND_SHAPES} from '../geom/boolean-solid.mjs';
import {loopArea} from '../region/region2d.mjs';
import {referencePatch} from '../geom/reference-surface.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {requireThat} from '../geom/tolerance.mjs';

const round=v=>Math.round(v*1e4)/1e4;
const INTERSECT_FIELDS=['geometry','part','sectionsAtZ','topsAtXY','surfaces','families','includeLoops'];

// An assembly is queried as the union of its placed components.
function queryShell(r,geometry){
  if(geometry.shape!=='assembly')return buildShell(r,geometry);
  return booleanShell('union',geometry.parts.map(part=>translateShell(buildShell(r,part.geometry),part.xMm,part.yMm,part.zMm)));
}

// Horizontal planes give section loops (outer loops counterclockwise, holes
// clockwise); vertical lines give the highest surface crossing. Coordinates are
// the geometry's own, before the recipe's placement.
export async function intersectGeometry(geometry,{sectionsAtZ=[],topsAtXY=[],surfaces=[],families=[],includeLoops=false}={}){
  requireThat(Array.isArray(sectionsAtZ)&&sectionsAtZ.every(Number.isFinite),'sectionsAtZ lists heights in millimetres.');
  requireThat(Array.isArray(topsAtXY)&&topsAtXY.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'topsAtXY lists [x, y] points in millimetres.');
  requireThat(Array.isArray(surfaces),'surfaces lists spline surfaces to intersect.');
  requireThat(Array.isArray(families),'families lists draft ordinary slice assignment patches.');
  requireThat(sectionsAtZ.length+topsAtXY.length+surfaces.length+families.length>0,'Ask for at least one section height, top point, surface or draft family.');
  const native=await rhino(),shell=queryShell(native,geometry);
  const sections=sectionsAtZ.map(z=>{
    const {loops,nudgedByMm}=section(shell,horizontalSlice(z)),areas=loops.map(loopArea);
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
  const surfaceRegions=surfaces.map(spec=>surfaceSection(shell,spec,includeLoops));
  const familyFindings=intersectDraftFamilies(shell,families,{native,includeLoops});
  return {boundsMm:{min:shell.bounds.min.map(round),max:shell.bounds.max.map(round)},sections,tops,surfaces:surfaceRegions,families:familyFindings};
}

export function intersectDraftFamilies(shell,drafts,{native,includeLoops=false}){
  if(!drafts.length)return [];
  const assignments=drafts.map((draft,i)=>sliceAssignment({id:`draft-${i}`,...draft}));
  requireThat(assignments.every(a=>!a.construction&&a.part===null),'Draft families use ordinary slices of the queried geometry; select a part in the outer request.');
  validateSlices({version:1,assignments},{parts:[],lineWidthMm:.4,firstLayerMm:.2});
  const shells=[[null,shell,true]],processes=assignments.map(a=>({firstLayerMm:.2,layerMm:.2,lineWidthMm:.4,...a.process}));
  const volumes=new Map(assignments.map(a=>[a.id,a.within.map(v=>v.kind==='geometry'?queryShell(native,v.geometry):null)]));
  const owners=sliceOwners(assignments,{shells,processes,volumes});
  return ownedLayers(owners,{shells}).map(({owner,family,layers,leader})=>({
    id:owner.assignment.id,owner:owner.id,principal:leader??owner.id,direction:family.direction,layerCount:layers.length,targetGapMm:family.pitchMm,translationStepMm:family.translationStepMm,gapMetric:family.gapMetric,
    fullCrossing:'checked at computed section boundaries',layers:layers.map(layer=>{
      const samples=layer.region.flat(),normals=samples.map(p=>sliceNormal(layer.slice,p));
      const step=layer.translationMm??(layer.referenceIndex===0||layer.index===0?family.firstTranslationMm??family.firstLayerMm:family.translationStepMm??family.pitchMm);
      const gaps=normals.map(n=>step*n.reduce((sum,v,i)=>sum+v*family.direction[i],0));
      return {index:layer.index,shared:layer.shared,loops:layer.region.length,sampleCount:samples.length,
        sampledThicknessMm:gaps.length?[Math.min(...gaps),Math.max(...gaps)]:null,nonpositiveGapSamples:gaps.filter(v=>v<=0).length,
        thicknessSampling:'section-boundary normals; first contact may taper further',
        ...(includeLoops?{loops:layer.region.map(loop=>({chart:loop,pointsMm:loop.map(p=>slicePoint(layer.slice,p))}))}:{})};
    })}));
}

// A spline surface (optionally shifted by offsetMm, as a stacked slice) cut by
// the part: the region of the surface inside it, in the surface's own (u,v).
function surfaceSection(shell,{offsetMm=[0,0,0],...spec},includeLoops){
  requireThat(Array.isArray(offsetMm)&&offsetMm.length===3&&offsetMm.every(Number.isFinite),'offsetMm is [x, y, z] in millimetres.');
  const shifted={...spec,controlPoints:spec.controlPoints?.map(row=>row.map(([x,y,z,w])=>w===undefined?[x+offsetMm[0],y+offsetMm[1],z+offsetMm[2]]:[x+offsetMm[0],y+offsetMm[1],z+offsetMm[2],w]))};
  const P={...referencePatch(shifted),name:'surface'},loops=section(shell,patchSlice(P)).loops,areas=loops.map(loopArea);
  return {domainUv:[P.domainU,P.domainV],areaUv:round(areas.reduce((a,b)=>a+b,0)),islands:areas.filter(a=>a>0).length,holes:areas.filter(a=>a<0).length,
    loops:loops.map((loop,i)=>({areaUv:round(areas[i]),points:loop.length,...(includeLoops?{uv:loop.map(p=>p.map(round)),pointsMm:loop.map(([u,v])=>evaluate(P,u,v,false).point.map(round))}:{})}))};
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
  requireThat(BOOLEAN_OPERAND_SHAPES.includes(current.shape)||Array.isArray(current.vertices)&&!current.base,`Only ${BOOLEAN_OPERAND_SHAPES.join(', ')} geometry combines; feature-modified records are finished bodies.`);
  owner.geometry=current.shape==='boolean'&&current.operation===request.operation
    ?{...current,operands:[...current.operands,request.operand]}
    :{shape:'boolean',operation:request.operation,operands:[current,request.operand]};
  return updatePlan(directory,plan,state.revision);
}
