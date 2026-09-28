// A solid authored as named, untrimmed NURBS patches: the agent writes the
// control nets and SAAM checks that they close. Nothing here is a template;
// every patch is exactly what the recipe says.
import {patchFromSurface} from './nurbs.mjs';
import {makeShell,assertClosed} from './shell.mjs';
import {requireThat} from './tolerance.mjs';

const PATCH_FIELDS=['name','degreeU','degreeV','controlPoints','knotsU','knotsV'];

export const splineSolidTemplate=()=>({shape:'spline',patches:[]});

// Clamped uniform knots when a direction supplies none; a full vector
// (count + degree + 1 values) otherwise, as in the reference-surface contract.
export const clampedKnots=(count,degree)=>Array.from({length:count+degree+1},(_,i)=>i<=degree?0:i>=count?1:(i-degree)/(count-degree));

export function validateSplineSolid(geometry){
  requireThat(Object.keys(geometry).every(k=>['shape','patches'].includes(k)),'A spline solid has only shape and patches.');
  requireThat(Array.isArray(geometry.patches)&&geometry.patches.length>=1,'A spline solid needs at least one patch.');
  const names=new Set();
  for(const patch of geometry.patches){
    requireThat(patch&&typeof patch==='object'&&Object.keys(patch).every(k=>PATCH_FIELDS.includes(k)),`Spline patch fields are ${PATCH_FIELDS.join(', ')}.`);
    requireThat(typeof patch.name==='string'&&/^[a-z0-9][a-z0-9-]*$/.test(patch.name)&&!names.has(patch.name),'Each spline patch needs a unique lowercase name.');
    names.add(patch.name);
    const net=patch.controlPoints,nu=net?.length,nv=net?.[0]?.length;
    requireThat(Array.isArray(net)&&net.every(row=>Array.isArray(row)&&row.length===nv),`Patch ${patch.name} needs a rectangular control net (rows along U, points along V).`);
    for(const [degree,count,axis] of [[patch.degreeU,nu,'U'],[patch.degreeV,nv,'V']])
      requireThat(Number.isInteger(degree)&&degree>=1&&degree<=5&&count>degree,`Patch ${patch.name}: degree${axis} must be 1–5 and less than its control count.`);
    requireThat(net.every(row=>row.every(p=>Array.isArray(p)&&[3,4].includes(p.length)&&p.every(Number.isFinite)&&(p.length===3||p[3]>0))),
      `Patch ${patch.name}: control points are [x,y,z] or [x,y,z,weight] with a positive weight.`);
    for(const [knots,count,degree,axis] of [[patch.knotsU,nu,patch.degreeU,'U'],[patch.knotsV,nv,patch.degreeV,'V']]){
      if(knots===undefined||knots===null)continue;
      requireThat(Array.isArray(knots)&&knots.length===count+degree+1&&knots.every((v,i)=>Number.isFinite(v)&&(i===0||v>=knots[i-1]))&&knots[degree]<knots[count],
        `Patch ${patch.name}: knots${axis} needs ${count+degree+1} nondecreasing values (count + degree + 1).`);
    }
  }
  return geometry;
}

// Authoring helper for scripts, demos and the starter recipe; it writes the
// same patches an agent would. A rectangular block whose top follows a grid
// of control heights, rows along X and columns along Y. Top control points sit
// on the Greville abscissae, so the footprint is exactly runMm by widthMm and
// the ruled sides share the top's boundary curves.
export function splineBlock({runMm,widthMm,heightsMm}){
  const nu=heightsMm.length,nv=heightsMm[0].length,pu=Math.min(3,nu-1),pv=Math.min(3,nv-1);
  const greville=(count,degree)=>{const k=clampedKnots(count,degree);return Array.from({length:count},(_,i)=>k.slice(i+1,i+degree+1).reduce((a,b)=>a+b,0)/degree);};
  const x=greville(nu,pu).map(g=>g*runMm),y=greville(nv,pv).map(g=>g*widthMm);
  const wall=(points,degree)=>({degreeU:degree,degreeV:1,controlPoints:points.map(([px,py,h])=>[[px,py,0],[px,py,h]])});
  return {shape:'spline',patches:[
    {name:'top',degreeU:pu,degreeV:pv,controlPoints:x.map((px,i)=>y.map((py,j)=>[px,py,heightsMm[i][j]]))},
    {name:'bottom',degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,widthMm,0]],[[runMm,0,0],[runMm,widthMm,0]]]},
    {name:'front',...wall(x.map((px,i)=>[px,0,heightsMm[i][0]]),pu)},
    {name:'right',...wall(y.map((py,j)=>[runMm,py,heightsMm[nu-1][j]]),pv)},
    {name:'back',...wall(x.map((px,i)=>[px,widthMm,heightsMm[i][nv-1]]),pu)},
    {name:'left',...wall(y.map((py,j)=>[0,py,heightsMm[0][j]]),pv)}
  ]};
}

export const splineBox=({runMm,widthMm,heightMm})=>splineBlock({runMm,widthMm,heightsMm:[[heightMm,heightMm],[heightMm,heightMm]]});

// A tube written as four spline patches that share one periodic cubic basis
// around the axis: the exterior, the bore and the two annular ends ruled
// between them. radiusAt(angle, t) gives the exterior control radius at
// height fraction t on a clamped cubic grid of `rows` controls (linear when
// rows is 2). Uniform cubic B-splines sit slightly inside their control
// circle, so control radii are scaled to put the curve's knots on the radius.
export function splineTube({columns,rows=2,heightMm,boreRadiusMm,radiusAt}){
  const degreeV=Math.min(3,rows-1),vKnots=clampedKnots(rows,degreeV);
  const grevilleV=j=>vKnots.slice(j+1,j+degreeV+1).reduce((a,b)=>a+b,0)/degreeV;
  const onCurve=(4+2*Math.cos(2*Math.PI/columns))/6;
  const ring=(radius,z,i)=>{const a=2*Math.PI*(i%columns)/columns,r=radius/onCurve;return [r*Math.cos(a),r*Math.sin(a),z];};
  const around=Array.from({length:columns+3},(_,i)=>i);
  const knotsU=Array.from({length:columns+7},(_,i)=>i-3);
  const outer=around.map(i=>Array.from({length:rows},(_,j)=>ring(radiusAt(2*Math.PI*(i%columns)/columns,grevilleV(j)),heightMm*grevilleV(j),i)));
  const bore=around.map(i=>[ring(boreRadiusMm,0,i),ring(boreRadiusMm,heightMm,i)]);
  return {shape:'spline',patches:[
    {name:'outer',degreeU:3,degreeV,knotsU,controlPoints:outer},
    {name:'bore',degreeU:3,degreeV:1,knotsU,controlPoints:bore},
    {name:'bottom',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][0],outer[k][0]])},
    {name:'top',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][1],outer[k][rows-1]])}]};
}
// Control-net bounds: the surface lies inside its hull, so these contain it.
export function splineSolidBounds(geometry){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const patch of geometry.patches)for(const row of patch.controlPoints)for(const p of row)
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  return {min,max};
}

// Named Rhino surfaces as a shell; closure is verified by makeShell and
// enforced by the caller's assertClosed.
export function shellFromSurfaces(rhino, entries, name) {
  const patches = entries.map(entry => patchFromSurface(entry.surface, entry.name));
  const shell = makeShell(patches, { name });
  shell.surfaces = entries;
  return shell;
}

export function splineSolidShell(rhino,geometry){
  validateSplineSolid(geometry);
  const entries=geometry.patches.map(patch=>({name:patch.name,surface:nurbsSurface(rhino,patch)}));
  return assertClosed(shellFromSurfaces(rhino,entries,'spline'));
}

// openNURBS stores homogeneous points and omits the first and last knot.
function nurbsSurface(rhino,patch){
  const net=patch.controlPoints,nu=net.length,nv=net[0].length;
  const rational=net.some(row=>row.some(p=>p.length===4&&p[3]!==1));
  const surface=rhino.NurbsSurface.create(3,rational,patch.degreeU+1,patch.degreeV+1,nu,nv);
  const set=(list,knots)=>knots.slice(1,-1).forEach((v,i)=>list.set(i,v));
  set(surface.knotsU(),patch.knotsU??clampedKnots(nu,patch.degreeU));
  set(surface.knotsV(),patch.knotsV??clampedKnots(nv,patch.degreeV));
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    const [x,y,z,w=1]=net[i][j];
    surface.points().set(i,j,[x*w,y*w,z*w,w]);
  }
  requireThat(surface.isValid!==false,`Patch ${patch.name} is not a valid NURBS surface; check its knots.`);
  return surface;
}
