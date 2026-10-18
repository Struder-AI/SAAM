// A Boolean constructs the boundary once, on the original rational surfaces.
// Face-pair intersections carry both parameterizations of one shared curve.
// Classification operates on face regions; no interior surface is tessellated.
import {evaluate} from './nurbs.mjs';
import {sewSurfaceBoundary} from './surface-topology.mjs';
import {separatingSurfacePlane} from './surface-support.mjs';
import {surfaceBoundaryPair,surfaceInside,outwardSigns} from '../region/section.mjs';
import {union,intersect,difference} from '../region/intersection.mjs';
import {patchDomain,faceTrimRegion,planarFaceRegion,retainFaceTrimCurves,segmentTrimSpans,nameOperandFaces} from './surface-trim.mjs';
import {surfacePlane,surfaceCorrespondence,correspondingSourceLoops,correspondingSurfaceCharts,projectCoincidentChart,curveCorrespondence} from './surface-coincidence.mjs';
import {surfaceSegmentCurves} from './surface-curves.mjs';
import {requireThat,dot,distance,cross,normalize} from './tolerance.mjs';
import {BOOLEAN_TOLERANCE_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {loopArea,regionArea} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';

function ignorePhase(){}

export function nativeSurfaceSolid(solid){
  return Array.isArray(solid?.patches)&&solid.kind!=='boolean';
}

export function constructSurfaceBoolean(operation,operands,{seedMm=.4,fuzzyMm=0,onPhase=ignorePhase}={}){
  const toleranceMm=BOOLEAN_TOLERANCE_MM;
  requireThat(['union','difference','intersection'].includes(operation),'Unknown surface Boolean operation.');
  requireThat(operands.length>=2&&operands.every(nativeSurfaceSolid),'Surface Booleans need at least two native surface solids.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(seedMm)&&seedMm>0,'Surface Boolean tolerances must be positive.');
  for(const solid of operands)requireThat(!solid.closure?.unmatched.length,'Surface Booleans need closed input solids.');
  // Curve approximation and boundary matching share the Boolean accuracy budget.
  const chordMm=toleranceMm/4,sewingMm=toleranceMm/2,coincidenceMm=Math.max(ROUNDING_MM,fuzzyMm);
  // Supporting planes prove absence of common interior. Coincident faces
  // still participate; a zero-area contact needs no transverse trace.
  const separationPlanes=operands.map((a,i)=>operands.map((b,j)=>j>i?separatingSurfacePlane(a,b):null));
  const volumeOverlap=operands.map((_,i)=>operands.map((__,j)=>i===j||!(j>i?separationPlanes[i][j]:separationPlanes[j][i])));
  const signs=operands.map(outwardSigns);
  const faces=nameOperandFaces(operands.map(solid=>solid.patches)).map(face=>({...face,sign:signs[face.operand].get(face.patch),hull:surfaceHull(face.patch),
    pairs:new Map(),coincident:[],kept:[]}));
  const phase={};
  const reportPhase=event=>{Object.assign(phase,event);onPhase({...phase});};
  const reportDiscovery=event=>reportPhase(event);
  const curves=[],contacts=[],discovery=[],closedSubResolution={loops:0,areaMm2:0};
  for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j];
    if(a.operand===b.operand||!hullsOverlap(a.hull,b.hull,coincidenceMm))continue;
    reportPhase({stage:1,first:i,second:j});
    const coincidence=coincidentFaces(a.patch,b.patch,chordMm,coincidenceMm);
    if(coincidence){
      a.coincident.push({other:b,loops:coincidence.a,aligned:coincidence.aligned,mapping:coincidence.toB,planar:coincidence.planar});
      b.coincident.push({other:a,loops:coincidence.b,aligned:coincidence.aligned,mapping:coincidence.toA,planar:coincidence.planar});
      continue;
    }
    if(!volumeOverlap[a.operand][b.operand])continue;
    reportPhase({stage:2,first:i,second:j});
    const pair=surfaceBoundaryPair(a.patch,b.patch,a.sign,b.sign,{chordMm,seedMm,planarChordMm:chordMm,complete:true,onDiscovery:reportDiscovery});
    if(pair.discovery)discovery.push({first:i,second:j,...pair.discovery});
    rememberPieces(a,b.operand,pair.a);rememberPieces(b,a.operand,pair.b);
    contacts.push(...(pair.points??[]).map(point=>({...point,a:i,b:j})));
    for(const piece of pair.a){
      requireThat(!piece.ends?.some(end=>['tangent','stalled','missed-boundary'].includes(end)),
        `Surface Boolean intersection ${a.patch.name}/${b.patch.name} did not close (${piece.ends?.join(', ')}).`);
      curves.push({a:i,b:j,closed:piece.closed,points:piece.vertices.map(vertex=>vertex.point),
        uvA:piece.vertices.map(vertex=>vertex.uv),uvB:piece.vertices.map(vertex=>vertex.partnerUv)});
    }
  }
  shareCoincidentCharts(faces,curves,coincidenceMm);
  for(const face of faces){
    reportPhase({stage:3,first:faces.indexOf(face),second:0});
    const domain=faceTrimRegion(face.patch,{toleranceMm:chordMm});
    const masks=operands.map((solid,i)=>{
      if(i===face.operand)return {minus:domain,plus:[]};
      if(solid.empty||!hullsOverlap(face.hull,solid.bounds))return {minus:[],plus:[]};
      const inside=volumeOverlap[face.operand][i]?surfaceInside(face.patch,solid,{chordMm,seedMm,boundaryPieces:face.pairs.get(i)??[]}).loops:[];
      const same=face.coincident.filter(item=>item.other.operand===i);
      const covering=mergeRegions(same.map(item=>item.loops));
      const outsideCoincidence=difference(intersect(domain,inside),covering);
      const ordinary=same.length?closePlanarSlivers(face.patch,outsideCoincidence,chordMm,closedSubResolution):outsideCoincidence;
      const minus=mergeRegions([ordinary,...same.filter(item=>item.aligned*face.sign*item.other.sign>0).map(item=>item.loops)]);
      const plus=mergeRegions([ordinary,...same.filter(item=>item.aligned*face.sign*item.other.sign<0).map(item=>item.loops)]);
      return {minus:intersect(domain,minus),plus:intersect(domain,plus)};
    });
    const minus=booleanRegions(operation,masks.map(mask=>mask.minus));
    const plus=booleanRegions(operation,masks.map(mask=>mask.plus));
    const retained=[{loops:difference(minus,plus),sign:face.sign},{loops:difference(plus,minus),sign:-face.sign}];
    // A coincident physical face has one owner. Earlier retained regions, not
    // merely earlier source faces, determine which part has already survived.
    for(const result of retained){
      if(face.coincident.length)result.loops=closePlanarSlivers(face.patch,result.loops,chordMm,closedSubResolution);
      if(!result.loops.length)continue;
      const previous=face.coincident.filter(item=>faces.indexOf(item.other)<faces.indexOf(face));
      for(const item of previous)for(const kept of item.other.kept){
        const overlap=projectFaceLoops(item.other.patch,kept.loops,face.patch,chordMm,coincidenceMm);
        result.loops=difference(result.loops,overlap);
      }
      if(face.coincident.length)result.loops=closePlanarSlivers(face.patch,result.loops,chordMm,closedSubResolution);
      if(result.loops.length)face.kept.push(result);
    }
  }
  const unchanged=unchangedOperand(faces,operands,chordMm);
  const patches=unchanged>=0?faces.filter(face=>face.operand===unchanged).map(face=>({...face.patch,name:face.name,normalSide:face.sign})):faces.flatMap((face,i)=>face.kept.map(kept=>({...face.patch,name:face.name,
    trimLoops:retainFaceTrimCurves(face.patch,kept.loops,{toleranceMm:sewingMm/2}),normalSide:kept.sign,sourceFace:i,sourceName:face.patch.sourceName??face.patch.name,
    boundaryCurves:[...(face.patch.boundaryCurves??[]),...curves.flatMap(curve=>curve.charts.filter(chart=>chart.face===i).map(chart=>({points:curve.points,uv:chart.uv})))]})));
  const bounds=patches.length?combinedBounds(operation,operands):{min:[0,0,0],max:[0,0,0]};
  reportPhase({stage:4,first:0,second:0});
  const original=unchanged>=0?operands[unchanged]:null;
  const topology=original?.topology??sewSurfaceBoundary(patches,original?[]:curves,{toleranceMm:sewingMm});
  requireThat(!topology.unmatched.length,`Surface Boolean boundary has ${topology.unmatched.length} unmatched or inconsistently oriented edges (${JSON.stringify(topology.unmatched.slice(0,3))}).`);
  return {kind:'surface-solid',name:'surface Boolean',operation,patches,bounds,empty:patches.length===0,
    intersections:original?.intersections??(original?[]:curves),contacts,topology,closure:{unmatched:topology.unmatched},
    construction:{method:'native-surface-boolean',toleranceMm,chordMm,sewingMm,seedMm,fuzzyMm,sourceFaces:faces.length,faces:patches.length,closedSubResolution,discovery,separationPlanes:separationPlanes.flat().filter(Boolean)}};
}

// If classification retained one complete operand, its existing boundary is
// the result. Re-trimming it against discarded faces only introduces seams.
function unchangedOperand(faces,operands,chordMm){
  return operands.findIndex((_,operand)=>faces.every(face=>{
    if(face.operand!==operand)return !face.kept.length;
    if(face.kept.length!==1||face.kept[0].sign!==face.sign)return false;
    const domain=faceTrimRegion(face.patch,{toleranceMm:chordMm}),kept=face.kept[0].loops;
    return !difference(domain,kept).length&&!difference(kept,domain).length;
  }));
}

// A curve crossing one chart also bounds a coincident chart. Transfer every
// image before sewing, including periodic seam images, so one shared curve
// has all of its incident face charts rather than an independent native copy.
function shareCoincidentCharts(faces,curves,coincidenceMm){
  for(const curve of curves){
    subdivideCoincidentCurve(curve,faces);
    curve.charts=[{face:curve.a,uv:curve.uvA},{face:curve.b,uv:curve.uvB}];
    for(const chart of curve.charts.slice()){
      const face=faces[chart.face];
      for(const coincidence of face.coincident){
        if(!coincidence.mapping&&!coincidence.planar)continue;
        const target=faces.indexOf(coincidence.other),patch=coincidence.other.patch;
        const images=coincidence.mapping?correspondingSurfaceCharts(chart.uv,coincidence.mapping):[projectCoincidentChart(curve.points,patch,{toleranceMm:coincidenceMm})];
        for(const uv of images){
          if(!uv.some((point,i)=>i&&point&&uv[i-1]&&segmentTrimSpans(uv[i-1],point,patchDomain(patch)).length))continue;
          const duplicate=curve.charts.some(prior=>prior.face===target&&prior.uv.every((point,i)=>point&&uv[i]?point.every((value,k)=>
            Math.abs(value-uv[i][k])<=ROUNDING_RELATIVE*((k?patch.domainV:patch.domainU)[1]-(k?patch.domainV:patch.domainU)[0])):point===uv[i]));
          if(!duplicate)curve.charts.push({face:target,uv});
        }
      }
    }
  }
}

// Bounded local correspondence images need samples where a source curve
// crosses their cell edges; no chart is extrapolated outside its proved cell.
function subdivideCoincidentCurve(curve,faces){
  const points=[],uvA=[],uvB=[];
  for(let i=1;i<curve.points.length;i++){
    const cuts=[0,1];
    for(const [face,parameters] of [[faces[curve.a],curve.uvA],[faces[curve.b],curve.uvB]]){
      const first=parameters[i-1],last=parameters[i];
      for(const coincidence of face.coincident)for(const image of coincidence.mapping?.images??[]){
        if(!image.sourceDomains)continue;
        for(const [axis,domain] of image.sourceDomains.entries())for(const value of domain){
          const t=(value-first[axis])/(last[axis]-first[axis]);
          if(t>0&&t<1)cuts.push(t);
        }
      }
    }
    for(const t of [...new Set(cuts)].sort((x,y)=>x-y).slice(i===1?0:1)){
      points.push(curve.points[i-1].map((value,k)=>value+t*(curve.points[i][k]-value)));
      uvA.push(curve.uvA[i-1].map((value,k)=>value+t*(curve.uvA[i][k]-value)));
      uvB.push(curve.uvB[i-1].map((value,k)=>value+t*(curve.uvB[i][k]-value)));
    }
  }
  curve.points=points;curve.uvA=uvA;curve.uvB=uvB;
}

function rememberPieces(face,operand,pieces){
  if(!face.pairs.has(operand))face.pairs.set(operand,[]);
  face.pairs.get(operand).push(...pieces);
}

function mergeRegions(regions){
  const state={loops:[]};
  for(const loops of regions)if(loops.length)state.loops=union(state.loops,loops);
  return state.loops;
}

function booleanRegions(operation,regions){
  if(operation==='union')return mergeRegions(regions);
  if(operation==='difference')return difference(regions[0],mergeRegions(regions.slice(1)));
  const state={loops:regions[0]};
  for(const loops of regions.slice(1))state.loops=intersect(state.loops,loops);
  return state.loops;
}

function surfaceHull(patch){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<patch.cp.length;i+=4)for(let k=0;k<3;k++){
    const coordinate=patch.cp[i+k]/patch.cp[i+3];min[k]=Math.min(min[k],coordinate);max[k]=Math.max(max[k],coordinate);
  }
  return {min,max};
}

function hullsOverlap(a,b,toleranceMm=ROUNDING_MM){
  return a.min.every((low,k)=>low<=b.max[k]+toleranceMm&&b.min[k]<=a.max[k]+toleranceMm);
}

function combinedBounds(operation,solids){
  if(operation==='difference')return structuredClone(solids[0].bounds);
  const boxes=solids.filter(solid=>!solid.empty).map(solid=>solid.bounds);
  if(!boxes.length)return {min:[0,0,0],max:[0,0,0]};
  if(operation==='union')return {min:[0,1,2].map(k=>Math.min(...boxes.map(box=>box.min[k]))),max:[0,1,2].map(k=>Math.max(...boxes.map(box=>box.max[k])))};
  const min=[0,1,2].map(k=>Math.max(...boxes.map(box=>box.min[k])));
  return {min,max:[0,1,2].map(k=>Math.max(min[k],Math.min(...boxes.map(box=>box.max[k]))))};
}


function coincidentFaces(a,b,toleranceMm,coincidenceMm){
  const correspondence=surfaceCorrespondence(a,b,{toleranceMm:coincidenceMm});
  if(correspondence){
    if(correspondence.complete&&!a.trimLoops&&!b.trimLoops)return {a:patchDomain(a),b:patchDomain(b),aligned:correspondence.orientation,
      toB:correspondence,toA:surfaceCorrespondence(b,a,{toleranceMm:coincidenceMm})};
    const aLoops=faceTrimRegion(a,{toleranceMm}),bLoops=faceTrimRegion(b,{toleranceMm});
    const reverse=surfaceCorrespondence(b,a,{toleranceMm:coincidenceMm});
    return {a:intersect(aLoops,correspondingSourceLoops(bLoops,correspondence)),
      b:intersect(bLoops,correspondingSourceLoops(aLoops,reverse)),aligned:correspondence.orientation,toB:correspondence,toA:reverse};
  }
  const planeA=surfacePlane(a),planeB=surfacePlane(b);
  if(!planeA||!planeB||Math.abs(Math.abs(dot(planeA.normal,planeB.normal))-1)>ROUNDING_RELATIVE||
    Math.abs(dot(planeA.normal,planeB.point.map((v,k)=>v-planeA.point[k])))>coincidenceMm)return null;
  const aRegion=intersect(faceTrimRegion(a,{toleranceMm}),projectFaceLoops(b,faceTrimRegion(b,{toleranceMm}),a,toleranceMm,coincidenceMm));
  const bRegion=intersect(faceTrimRegion(b,{toleranceMm}),projectFaceLoops(a,faceTrimRegion(a,{toleranceMm}),b,toleranceMm,coincidenceMm));
  return {a:aRegion,b:bRegion,aligned:dot(planeA.normal,planeB.normal)>0?1:-1,planar:true};
}

// A coplanar boundary is mapped geometrically, retaining the target's own UV
// units. Projection residuals and chord error are physical millimetres.
function projectFaceLoops(source,loops,target,toleranceMm,coincidenceMm=ROUNDING_MM){
  const correspondence=surfaceCorrespondence(source,target,{toleranceMm:coincidenceMm});
  if(correspondence){
    if(correspondence.complete&&!source.trimLoops&&!target.trimLoops&&!difference(patchDomain(source),loops).length&&!difference(loops,patchDomain(source)).length)return patchDomain(target);
    return correspondingSourceLoops(loops,surfaceCorrespondence(target,source,{toleranceMm:coincidenceMm}));
  }
  const e=evaluate(target,(target.domainU[0]+target.domainU[1])/2,(target.domainV[0]+target.domainV[1])/2);
  const frame={origin:e.point,x:normalize(e.du),y:cross(e.normal,normalize(e.du)),normal:e.normal};
  const sourceRegion=planarFaceRegion(source,loops,frame,toleranceMm);
  const targetLoops=faceTrimRegion(target,{toleranceMm}),targetRegion=planarFaceRegion(target,targetLoops,frame,toleranceMm);
  const overlap=intersect(sourceRegion,targetRegion);
  if(!overlap.length)return [];
  const remaining=difference(targetRegion,overlap);
  if(!remaining.length||!offsetRegion(remaining,-BOOLEAN_TOLERANCE_MM/4).length)return targetLoops;
  const world=uv=>frame.origin.map((v,k)=>v+uv[0]*frame.x[k]+uv[1]*frame.y[k]);
  const affine=affinePlaneUv(target,world(overlap[0][0]));
  if(affine)return overlap.map(loop=>loop.map(uv=>affinePlaneUv(target,world(uv))));
  // A bounded planar prism supplies only native plane intersections. This
  // handles polar cap charts without projecting outside their UV domain.
  const prism=planarRegionPrism(source,loops,sourceRegion,frame);
  return intersect(targetLoops,surfaceInside(target,prism,{chordMm:toleranceMm,seedMm:.4}).loops);
}

// Extrude the native planar face, including its exact rational boundary.
// Clipping against a polygonal copy of the target's own curved boundary
// creates inward strips; the target's native chart supplies that boundary.
function planarRegionPrism(source,loops,physical,frame){
  const points=physical.flat(),low=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),high=[0,1].map(k=>Math.max(...points.map(p=>p[k])));
  const depth=Math.hypot(high[0]-low[0],high[1]-low[1]),plane=surfacePlane(source);
  const orientation=dot(plane.normal,frame.normal)>0?1:-1;
  const movedControls=sign=>{
    const cp=Float64Array.from(source.cp);
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=sign*depth*frame.normal[k]*cp[i+3];
    return cp;
  };
  const caps=[-1,1].map(sign=>({...source,name:'prism-cap-'+sign,cp:movedControls(sign),trimLoops:loops,normalSide:sign*orientation}));
  const curves=[];
  for(const loop of loops)for(let i=0;i<loop.length;i++){
    for(const curve of surfaceSegmentCurves(source,loop[i],loop[(i+1)%loop.length])){
      const first=Array.from(curve.cp.slice(0,3),value=>value/curve.cp[3]);
      if(Array.from({length:curve.n},(_,j)=>Math.hypot(...[0,1,2].map(k=>curve.cp[j*4+k]/curve.cp[j*4+3]-first[k]))).every(value=>value<=ROUNDING_MM))continue;
      const opposite=curves.findIndex(other=>curveCorrespondence(curve,other)===-1);
      if(opposite>=0)curves.splice(opposite,1);else curves.push(curve);
    }
  }
  const walls=curves.map((curve,i)=>({name:'prism-wall-'+i,nu:curve.n,nv:2,orderU:curve.order,orderV:2,
    knotsU:curve.knots,knotsV:[-depth,-depth,depth,depth],domainU:curve.domain,domainV:[-depth,depth],normalSide:orientation,
    cp:Float64Array.from(Array.from({length:curve.n},(_,j)=>{
      const h=curve.cp.slice(j*4,j*4+4);
      return [-1,1].flatMap(sign=>[...h.slice(0,3).map((value,k)=>value+sign*depth*frame.normal[k]*h[3]),h[3]]);
    }).flat())}));
  const patches=[...caps,...walls],world=patches.flatMap(p=>Array.from({length:p.cp.length/4},(_,i)=>[0,1,2].map(k=>p.cp[i*4+k]/p.cp[i*4+3])));
  return {name:'native planar face prism',patches,empty:false,bounds:{min:[0,1,2].map(k=>Math.min(...world.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...world.map(p=>p[k])))}};
}
// Coplanar chord arrangements can leave slivers far below print resolution.
// Close them at their native plane's physical scale and report the removed area.
function closePlanarSlivers(patch,loops,chordMm,report){
  const plane=surfacePlane(patch);if(!plane)return loops;
  const e=evaluate(patch,(patch.domainU[0]+patch.domainU[1])/2,(patch.domainV[0]+patch.domainV[1])/2);
  const frame={origin:e.point,x:normalize(e.du),y:cross(e.normal,normalize(e.du)),normal:e.normal};
  const physical=planarFaceRegion(patch,loops,frame,chordMm);
  if(physical.length&&!offsetRegion(physical,-BOOLEAN_TOLERANCE_MM/4).length){
    report.loops+=loops.length;report.areaMm2+=Math.abs(regionArea(physical));return [];
  }
  return loops.filter((loop,i)=>{
    const points=physical[i];
    if(offsetRegion(union([points],[]),-BOOLEAN_TOLERANCE_MM/4).length)return true;
    report.loops++;report.areaMm2+=Math.abs(loopArea(points));return false;
  });
}
function affinePlaneUv(patch,point){
  if(patch.nu!==2||patch.nv!==2||patch.orderU!==2||patch.orderV!==2)return null;
  const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV,e=evaluate(patch,u0,v0);
  const end=evaluate(patch,u1,v1,false).point;
  if(distance(end,e.point.map((v,k)=>v+e.du[k]*(u1-u0)+e.dv[k]*(v1-v0)))>ROUNDING_MM)return null;
  const delta=point.map((v,k)=>v-e.point[k]),aa=dot(e.du,e.du),ab=dot(e.du,e.dv),bb=dot(e.dv,e.dv),det=aa*bb-ab*ab;
  if(Math.abs(det)<=ROUNDING_MM**4)return null;
  return [u0+(dot(delta,e.du)*bb-dot(delta,e.dv)*ab)/det,v0+(dot(delta,e.dv)*aa-dot(delta,e.du)*ab)/det];
}
