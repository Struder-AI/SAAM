// Build and place ordinary geometry values. Saved extension meshes need only
// vertices and triangles here; feature recipes belong to their authors.
import {makeShell} from './shell.mjs';
import {shellFromSurfaces,splineSolidShell} from './spline-solid.mjs';
import {makeMesh,translateMesh,hasMesh} from './mesh.mjs';
import {booleanShell} from './boolean-solid.mjs';
import {requireThat} from './tolerance.mjs';
import {geometrySelections} from './selections.mjs';
import {translateSurfaceSolid} from './surface-topology.mjs';


export function buildShell(rhino, geometry, options) {
  return buildShells(rhino,[geometry],options)[0];
}

// One construction batch shares immutable source shapes, including components
// encountered first while building an assembly. No caller owns this cache.
export function buildShells(rhino,geometries,{material=false,native=true}={}){
  const cache=new Map(),owned=new Set();
  const build=geometry=>{
    if(cache.has(geometry))return cache.get(geometry);
    const shell=construct(geometry);cache.set(geometry,shell);return shell;
  };
  function construct(geometry){
    if(geometry?.solid||geometry?.shape==='spatial'){requireThat(geometry.solid,'This operation needs solid geometry.');return build(geometry.solid);}
    if(geometry.shape==='spline'){
      const shell=splineSolidShell(rhino,geometry,{native});
      for(const entry of shell.surfaces??[])owned.add(entry.surface);
      return shell;
    }
    if(geometry.shape==='boolean')return booleanShell(geometry.operation,constructionOperands(geometry).map(build),{composeDisjoint:!native});
    if(Array.isArray(geometry.vertices)&&Array.isArray(geometry.triangles)){
      return makeMesh(geometry.vertices,geometry.triangles);
    }
    if(geometry.shape==='assembly'&&material){
      return booleanShell('union',geometry.parts.map(part=>translateShell(build(part.geometry),part.xMm,part.yMm,part.zMm)),{composeDisjoint:!native});
    }
    if(geometry.shape==='assembly'&&hasMesh(geometry)) {
      const components=geometry.parts.map(part=>translateShell(build(part.geometry),part.xMm,part.yMm,part.zMm));
      const material=components.filter(component=>!component.empty);
      return {kind:'assembly',components,notes:components.flatMap((component,i)=>(component.notes??[]).map(note=>geometry.parts[i].id+': '+note)),empty:!material.length,bounds:material.length?{min:[0,1,2].map(i=>Math.min(...material.map(c=>c.bounds.min[i]))),max:[0,1,2].map(i=>Math.max(...material.map(c=>c.bounds.max[i])))}:{min:[0,0,0],max:[0,0,0]}};
    }
    if(geometry.shape==='assembly') {
      if(!native){
        const patches=geometry.parts.flatMap(part=>translateShell(build(part.geometry),part.xMm,part.yMm,part.zMm).patches.map(patch=>({...patch,name:part.id+'/'+patch.name})));
        return makeShell(patches,{name:'assembly'});
      }
      const entries=geometry.parts.flatMap(part=>build(part.geometry).surfaces.map(entry=>{
        const surface=entry.surface.duplicate();owned.add(surface);
        requireThat(surface.translate([part.xMm,part.yMm,part.zMm]),'Could not place native component.');
        return {name:part.id+'/'+entry.name,surface};
      }));
      return shellFromSurfaces(rhino,entries,'assembly');
    }
    throw new Error(`Unsupported geometry shape: ${geometry.shape}.`);
  }
  try{
    const results=geometries.map(build);
    if(!owned.size)return results;
    const retained=new Set(),seen=new Set();
    const keep=shell=>{
      if(seen.has(shell))return;seen.add(shell);
      for(const entry of shell.surfaces??[])retained.add(entry.surface);
      for(const child of shell.components??shell.operands??[])keep(child);
    };
    results.forEach(keep);
    for(const surface of owned)if(!retained.has(surface)){owned.delete(surface);surface.delete();}
    return results;
  }catch(error){for(const surface of owned)try{surface.delete();}catch{}throw error;}
}

// Material queries combine placed components, including nested assemblies.
// Ordinary construction retains its component/surface representation.
export function resolveMaterialGeometry(geometries){
  return buildShells(null,geometries,{material:true,native:false});
}

// Each request returns ordinary geometry in the requested frame. A replacement
// geometry (a within-volume) uses the selected component/partition's origin.
// Null selects the whole source, including an assembly, at the source origin.
export function resolveGeometrySelections(geometry,requests){
  const selections=geometrySelections(geometry);
  const selected=requests.map(({selection=null,geometry:replacement})=>{
    const source=selection===null?{geometry,xMm:0,yMm:0,zMm:0}:selections.get(selection);
    requireThat(source,`Unknown geometry selection ${selection}.`);
    return {geometry:replacement??source.geometry,offset:[source.xMm,source.yMm,source.zMm]};
  });
  const shells=buildShells(null,selected.map(s=>s.geometry),{native:false}),placed=new Map();
  return selected.map((selection,i)=>{
    const shell=shells[i],key=selection.offset.join(',');
    let frames=placed.get(shell);if(!frames){frames=new Map();placed.set(shell,frames);}
    if(!frames.has(key))frames.set(key,translateShell(shell,...selection.offset));
    return frames.get(key);
  });
}

// Translation shifts control points; the
// patches keep their parameterisation, so sections and surface solves are
// unaffected apart from the translation.
export function translateShell(shell, dx, dy, dz = 0) {
  if(shell.kind==='surface-solid')return translateSurfaceSolid(shell,[dx,dy,dz]);
  if(shell.kind==='triangle-mesh'){
    return translateMesh(shell,dx,dy,dz);
  }
  if(shell.kind==='boolean')return booleanShell(shell.operation,shell.operands.map(s=>translateShell(s,dx,dy,dz)),{composeDisjoint:true});
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
  return moved;
}


// Evaluate associative source operations together, before constructing any
// intermediate trimmed boundaries. Difference subtracts all later operands.
function constructionOperands(geometry){
  const operation=geometry.operation,operands=[];
  function append(value,first=false){
    const source=value.solid??value;
    if(source.shape==='boolean'&&(source.operation===operation&&(operation!=='difference'||first)||operation==='difference'&&!first&&source.operation==='union')){
      source.operands.forEach((operand,i)=>append(operand,first&&i===0));
    }else operands.push(value);
  }
  geometry.operands.forEach((operand,i)=>append(operand,i===0));return operands;
}
