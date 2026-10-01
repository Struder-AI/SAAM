// Build and place ordinary geometry values. Saved extension meshes need only
// vertices and triangles here; feature recipes belong to their authors.
import {makeShell,assertClosed} from './shell.mjs';
import {shellFromSurfaces,splineSolidShell} from './spline-solid.mjs';
import {makeMesh,translateMesh} from './mesh.mjs';
import {booleanShell} from './boolean-solid.mjs';
import {requireThat} from './tolerance.mjs';
import {geometrySelections} from './selections.mjs';
import {rhino} from './runtime.mjs';

export const hasMesh=geometry=>!!geometry&&((Array.isArray(geometry.vertices)||geometry.shape==='boolean')||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry))));

export function buildShell(rhino, geometry) {
  return buildShapes(rhino,[geometry])[0];
}

// One construction batch shares immutable source shapes, including components
// encountered first while building an assembly. No caller owns this cache.
function buildShapes(rhino,geometries){
  const cache=new Map();
  const build=geometry=>{
    if(cache.has(geometry))return cache.get(geometry);
    const shell=construct(geometry);cache.set(geometry,shell);return shell;
  };
  function construct(geometry){
    if(geometry.shape==='spline')return splineSolidShell(rhino,geometry);
    if(geometry.shape==='boolean')return booleanShell(geometry.operation,geometry.operands.map(build));
    if(Array.isArray(geometry.vertices)&&Array.isArray(geometry.triangles)){
      return makeMesh(geometry.vertices,geometry.triangles);
    }
    if(geometry.shape==='assembly'&&hasMesh(geometry)) {
      const components=geometry.parts.map(part=>translateShell(build(part.geometry),part.xMm,part.yMm,part.zMm));
      return {kind:'assembly',components,bounds:{min:[0,1,2].map(i=>Math.min(...components.map(c=>c.bounds.min[i]))),max:[0,1,2].map(i=>Math.max(...components.map(c=>c.bounds.max[i])))}};
    }
    if(geometry.shape==='assembly') {
      const entries=geometry.parts.flatMap(part=>build(part.geometry).surfaces.map(entry=>{
        const surface=entry.surface.duplicate();
        requireThat(surface.translate([part.xMm,part.yMm,part.zMm]),'Could not place native component.');
        return {name:part.id+'/'+entry.name,surface};
      }));
      return assertClosed(shellFromSurfaces(rhino,entries,'assembly'));
    }
    throw new Error(`Unsupported geometry shape: ${geometry.shape}.`);
  }
  return geometries.map(build);
}

// Each request returns ordinary geometry in the requested frame. A replacement
// geometry (a within-volume) uses the selected component/partition's origin.
// Null selects the whole source, including an assembly, at the source origin.
export async function resolveGeometrySelections(geometry,requests,{offset=[0,0,0]}={}){
  const selections=geometrySelections(geometry);
  const selected=requests.map(({selection=null,geometry:replacement})=>{
    const source=selection===null?{geometry,xMm:0,yMm:0,zMm:0}:selections.get(selection);
    requireThat(source,`Unknown geometry selection ${selection}.`);
    return {geometry:replacement??source.geometry,offset:[source.xMm+offset[0],source.yMm+offset[1],source.zMm+offset[2]]};
  });
  const shells=buildShapes(await rhino(),selected.map(s=>s.geometry)),placed=new Map();
  return selected.map((selection,i)=>{
    const shell=shells[i],key=selection.offset.join(',');
    let frames=placed.get(shell);if(!frames){frames=new Map();placed.set(shell,frames);}
    if(!frames.has(key))frames.set(key,translateShell(shell,...selection.offset));
    return frames.get(key);
  });
}

// Placement moves the whole shell onto the bed by shifting control points; the
// patches keep their parameterisation, so sections and surface solves are
// unaffected apart from the translation.
export function translateShell(shell, dx, dy, dz = 0) {
  if(shell.kind==='triangle-mesh'){
    return translateMesh(shell,dx,dy,dz);
  }
  if(shell.kind==='boolean')return booleanShell(shell.operation,shell.operands.map(s=>translateShell(s,dx,dy,dz)));
  if(shell.kind==='assembly')return {...shell,components:shell.components.map(s=>translateShell(s,dx,dy,dz)),bounds:{min:shell.bounds.min.map((v,i)=>v+[dx,dy,dz][i]),max:shell.bounds.max.map((v,i)=>v+[dx,dy,dz][i])}};
  const patches = shell.patches.map(patch => {
    const cp = Float64Array.from(patch.cp);
    for (let i = 0; i < cp.length; i += 4) {
      const w = cp[i + 3];
      cp[i] += dx * w;
      cp[i + 1] += dy * w;
      cp[i + 2] += dz * w;
    }
    return { ...patch, cp };
  });
  const moved = makeShell(patches, { name: shell.name });
  moved.surfaces = shell.surfaces;
  return assertClosed(moved);
}

