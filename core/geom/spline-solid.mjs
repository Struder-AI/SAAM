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
      requireThat(Number.isInteger(degree)&&degree>=1&&count>degree,`Patch ${patch.name}: degree${axis} must be positive and less than its control count.`);
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
