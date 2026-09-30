import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {solidKernel,meshFromSolid} from '../../../core/geom/solid.mjs';

const sources=['unsupported.step','membrane.step','stepped Reduction.step','Bore Support.step'];
// This is an inventory of analytic entities in the supplied examples, not a
// STEP importer. No header text or entity names are interpreted as instructions.
export async function referenceInventory(){
  const result=[];
  for(const name of sources){
    const path=fileURLToPath(new URL('../references/'+encodeURIComponent(name),import.meta.url)),text=await readFile(path,'utf8');
    const points=[...text.matchAll(/CARTESIAN_POINT\('[^']*',\(([^)]+)\)\)/g)].map(m=>m[1].split(',').map(Number));
    const radii=[...new Set([...text.matchAll(/CYLINDRICAL_SURFACE\('[^']*',#\d+,([^)]+)\)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
    result.push({name,sha256:createHash('sha256').update(text).digest('hex'),radiiMm:radii,zLevelsMm:[...new Set(points.map(p=>p[2]))].sort((a,b)=>a-b),boundsMm:{min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))}});
  }
  return result;
}
export async function referenceControl(){
  const refs=await referenceInventory(),control=refs[0],kernel=await solidKernel(),{min,max}=control.boundsMm;
  const size=max.map((v,i)=>v-min[i]),R=control.radiiMm.at(-1),r=control.radiiMm[0],shoulder=-min[2];
  const block=kernel.Manifold.cube(size),wide=kernel.Manifold.cylinder(shoulder,R,R,128),wideAt=wide.translate([size[0]/2,size[1]/2,0]);wide.delete();
  const narrow=kernel.Manifold.cylinder(size[2],r,r,128),narrowAt=narrow.translate([size[0]/2,size[1]/2,0]);narrow.delete();
  const tool=wideAt.add(narrowAt),model=block.subtract(tool);block.delete();wideAt.delete();narrowAt.delete();tool.delete();
  try{const mesh=meshFromSolid(model);return {shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};}finally{model.delete();}
}
