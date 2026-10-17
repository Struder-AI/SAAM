// A solid authored as named NURBS patches: the agent writes the
// control nets and SAAM measures where they close. Nothing here is a template;
// every patch is exactly what the recipe says.
import {patchFromSurface,requireSplineDegree} from './nurbs.mjs';
import {makeShell} from './shell.mjs';
import {requireThat} from './tolerance.mjs';
import {loopArea,pointInRegion} from '../region/region2d.mjs';
import {prepareCurveLoops} from './curve-loops.mjs';
import {faceTrimRegion} from './surface-trim.mjs';
import {insideIntervals,curveCrossings} from './curve-ops.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

const PATCH_FIELDS=['name','degreeU','degreeV','controlPoints','knotsU','knotsV','trimLoops','normalSide'];

export const splineSolidTemplate=()=>({shape:'spline',patches:[]});

// Clamped uniform knots when a direction supplies none; a full vector
// (count + degree + 1 values) otherwise, as in the reference-surface contract.
export function clampedKnots(count,degree){
  requireSplineDegree(degree);
  return Array.from({length:count+degree+1},(_,i)=>i<=degree?0:i>=count?1:(i-degree)/(count-degree));
}

export function validateSplineSolid(geometry){
  requireThat(Object.keys(geometry).every(k=>['shape','patches'].includes(k)),'A spline solid has only shape and patches.');
  requireThat(Array.isArray(geometry.patches),'A spline solid needs a patches array.');
  const names=new Set();
  for(const patch of geometry.patches){
    requireThat(patch&&typeof patch==='object'&&Object.keys(patch).every(k=>PATCH_FIELDS.includes(k)),`Spline patch fields are ${PATCH_FIELDS.join(', ')}.`);
    requireThat(typeof patch.name==='string'&&/^[a-z0-9][a-z0-9-]*$/.test(patch.name)&&!names.has(patch.name),'Each spline patch needs a unique lowercase name.');
    names.add(patch.name);
    const net=patch.controlPoints,nu=net?.length,nv=net?.[0]?.length;
    requireThat(Array.isArray(net)&&net.every(row=>Array.isArray(row)&&row.length===nv),`Patch ${patch.name} needs a rectangular control net (rows along U, points along V).`);
    for(const [degree,count,axis] of [[patch.degreeU,nu,'U'],[patch.degreeV,nv,'V']]){
      requireSplineDegree(degree);
      requireThat(count>degree,`Patch ${patch.name}: degree${axis} must be less than its control count.`);
    }
    requireThat(net.every(row=>row.every(p=>Array.isArray(p)&&[3,4].includes(p.length)&&p.every(Number.isFinite)&&(p.length===3||p[3]>0))),
      `Patch ${patch.name}: control points are [x,y,z] or [x,y,z,weight] with a positive weight.`);
    for(const [knots,count,degree,axis] of [[patch.knotsU,nu,patch.degreeU,'U'],[patch.knotsV,nv,patch.degreeV,'V']]){
      if(knots===undefined||knots===null)continue;
      requireThat(Array.isArray(knots)&&knots.length===count+degree+1&&knots.every((v,i)=>Number.isFinite(v)&&(i===0||v>=knots[i-1]))&&knots[degree]<knots[count],
        `Patch ${patch.name}: knots${axis} needs ${count+degree+1} nondecreasing values (count + degree + 1).`);
    }
    requireThat(patch.normalSide===undefined||[1,-1].includes(patch.normalSide),`Patch ${patch.name}: normalSide must be 1 or -1.`);
    if(patch.trimLoops!==undefined)validateTrimLoops(patch,nu,nv);
  }
  return geometry;
}

// Trims are closed ordinary curves in the patch's native UV domain. Validate
// topology without a world-distance epsilon: UV coordinates have no mm scale.
function validateTrimLoops(patch,nu,nv){
  const domains=[[patch.knotsU??clampedKnots(nu,patch.degreeU),patch.degreeU,nu],[patch.knotsV??clampedKnots(nv,patch.degreeV),patch.degreeV,nv]].map(([knots,degree,count])=>[knots[degree],knots[count]]);
  requireThat(Array.isArray(patch.trimLoops)&&patch.trimLoops.length>0,`Patch ${patch.name}: trimLoops needs closed UV loops.`);
  const prepared=prepareCurveLoops(patch.trimLoops);
  for(const curve of prepared.loops.flat()){
    const intervals=insideIntervals(curve,domains.flatMap(([lo,hi],axis)=>[{axis,value:lo},{axis,value:hi}]),point=>domains.every(([lo,hi],k)=>point[k]>=lo&&point[k]<=hi));
    requireThat(intervals.length===1&&intervals[0][0]===curve.domain[0]&&intervals[0][1]===curve.domain[1],`Patch ${patch.name}: trim curves leave its UV domain.`);
    const multiplicities=new Map();for(const t of curve.knots)if(t>curve.domain[0]&&t<curve.domain[1])multiplicities.set(t,(multiplicities.get(t)??0)+1);
    requireThat([...multiplicities.values()].every(count=>count<curve.order),`Patch ${patch.name}: split disconnected NURBS trim spans into connected curves.`);
  }
  if(patch.trimLoops.some(loop=>!Array.isArray(loop))){
    const curves=prepared.loops.flat(),scale=Math.max(...domains.map(([lo,hi])=>hi-lo));
    const closed=curves.map(curve=>prepared.loops.some(loop=>loop.length===1&&loop[0]===curve));
    requireThat(!curveCrossings(curves,scale*ROUNDING_RELATIVE,closed).pairs.length,`Patch ${patch.name}: trim curves cross or touch.`);
  }
  const loops=faceTrimRegion(numericalPatch(patch)).map(loop=>{
    requireThat(Array.isArray(loop)&&loop.length>=3&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every((v,k)=>Number.isFinite(v)&&v>=domains[k][0]&&v<=domains[k][1])),`Patch ${patch.name}: trim vertices must be finite UV pairs inside its knot domain.`);
    const points=loop[0].every((v,k)=>v===loop.at(-1)[k])?loop.slice(0,-1):loop;
    requireThat(points.length>=3&&points.every((p,i)=>p.some((v,k)=>v!==points[(i+1)%points.length][k]))&&loopArea(points)!==0,`Patch ${patch.name}: trim loops need three distinct vertices and nonzero area.`);
    return points;
  });
  const segments=loops.flatMap((loop,l)=>loop.map((a,i)=>({a,b:loop[(i+1)%loop.length],l,i,n:loop.length})));
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j];
    if(a.l===b.l&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.n-1))continue;
    requireThat(!trimSegmentsMeet(a.a,a.b,b.a,b.b),`Patch ${patch.name}: trim loops must not cross or touch themselves or each other.`);
  }
  for(const loop of loops){
    const depth=loops.filter(other=>other!==loop&&pointInRegion(loop[0],[other])).length;
    requireThat((loopArea(loop)>0)===(depth%2===0),`Patch ${patch.name}: outer trim loops run counterclockwise and holes clockwise in UV.`);
  }
}
function trimSegmentsMeet(a,b,c,d){
  if([0,1].some(k=>Math.max(a[k],b[k])<Math.min(c[k],d[k])||Math.max(c[k],d[k])<Math.min(a[k],b[k])))return false;
  const abC=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),abD=(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);
  const cdA=(d[0]-c[0])*(a[1]-c[1])-(d[1]-c[1])*(a[0]-c[0]),cdB=(d[0]-c[0])*(b[1]-c[1])-(d[1]-c[1])*(b[0]-c[0]);
  return (abC===0||abD===0||Math.sign(abC)!==Math.sign(abD))&&(cdA===0||cdB===0||Math.sign(cdA)!==Math.sign(cdB));
}

// Control-net bounds: the surface lies inside its hull, so these contain it.
export function splineSolidBounds(geometry){
  if(!geometry.patches.length)return {min:[0,0,0],max:[0,0,0]};
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const patch of geometry.patches)for(const row of patch.controlPoints)for(const p of row)
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  return {min,max};
}

// Named Rhino surfaces as a shell; makeShell measures closure, which only
// solid operations require.
export function shellFromSurfaces(rhino, entries, name) {
  const patches = entries.map(entry => ({...patchFromSurface(entry.surface, entry.name),
    ...(entry.trimLoops===undefined?{}:{trimLoops:entry.trimLoops}),...(entry.normalSide===undefined?{}:{normalSide:entry.normalSide})}));
  const shell = makeShell(patches, { name });
  shell.surfaces = entries;
  return shell;
}

export function splineSolidShell(rhino,geometry,{native=true}={}){
  validateSplineSolid(geometry);
  if(!native)return makeShell(geometry.patches.map(numericalPatch),{name:'spline'});
  const entries=[];
  try{
    for(const patch of geometry.patches)entries.push({name:patch.name,surface:nurbsSurface(rhino,patch),trimLoops:patch.trimLoops,normalSide:patch.normalSide});
    return shellFromSurfaces(rhino,entries,'spline');
  }catch(error){for(const entry of entries)entry.surface.delete();throw error;}
}

// Numerical preparation reads the authored control nets directly. Native
// file/runtime objects are allocated only by the explicit native branch above.
function numericalPatch(patch){
  const nu=patch.controlPoints.length,nv=patch.controlPoints[0].length;
  const knotsU=Float64Array.from(patch.knotsU??clampedKnots(nu,patch.degreeU));
  const knotsV=Float64Array.from(patch.knotsV??clampedKnots(nv,patch.degreeV));
  return {name:patch.name,nu,nv,orderU:patch.degreeU+1,orderV:patch.degreeV+1,knotsU,knotsV,
    cp:Float64Array.from(patch.controlPoints.flatMap(row=>row.flatMap(([x,y,z,w=1])=>[x*w,y*w,z*w,w]))),
    domainU:[knotsU[patch.degreeU],knotsU[nu]],domainV:[knotsV[patch.degreeV],knotsV[nv]],
    ...(patch.trimLoops===undefined?{}:{trimLoops:patch.trimLoops}),...(patch.normalSide===undefined?{}:{normalSide:patch.normalSide})};
}

// openNURBS stores homogeneous points and omits the first and last knot.
function nurbsSurface(rhino,patch){
  const net=patch.controlPoints,nu=net.length,nv=net[0].length;
  const rational=net.some(row=>row.some(p=>p.length===4&&p[3]!==1));
  const surface=rhino.NurbsSurface.create(3,rational,patch.degreeU+1,patch.degreeV+1,nu,nv);
  try{
  const set=(list,knots)=>knots.slice(1,-1).forEach((v,i)=>list.set(i,v));
  set(surface.knotsU(),patch.knotsU??clampedKnots(nu,patch.degreeU));
  set(surface.knotsV(),patch.knotsV??clampedKnots(nv,patch.degreeV));
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    const [x,y,z,w=1]=net[i][j];
    surface.points().set(i,j,[x*w,y*w,z*w,w]);
  }
  requireThat(surface.isValid!==false,`Patch ${patch.name} is not a valid NURBS surface; check its knots.`);
  return surface;
  }catch(error){surface.delete();throw error;}
}
