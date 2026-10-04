// Explicit blob field -> manufacturing mesh conversion; slicing and Studio use the mesh.
import {solidKernel,preciseSolidMesh} from './solid.mjs';
import {makeMesh} from './mesh.mjs';
import {prepareBlobField,evaluateBlobField,blobFieldBounds} from './blob-field.mjs';
import {BLOB_FIELD_COMPILER,validateBlobFieldExtraction,blobFieldDigest} from './blob-field-record.mjs';
import {requireThat} from './tolerance.mjs';

// The extraction grid follows edgeMm and the points' extent; there is no work
// budget, so a fine edgeMm over a large field is slow rather than refused.
export async function compileBlobField(field,{edgeMm}={}){
  field=structuredClone(field);
  const prepared=prepareBlobField(field),{min,max}=blobFieldBounds(field);
  const extraction={compiler:BLOB_FIELD_COMPILER,edgeMm};validateBlobFieldExtraction(extraction);
  // Extract in a padded box and clip to the material bounds: the bed plane cut
  // becomes an exact flat base instead of the extractor's grid cap. The lattice
  // is offset from the clipping planes so no lattice edge lies on one.
  const padding=2*edgeMm,phase=[.173,.317,.419].map(v=>v*edgeMm);
  const bounds={min:min.map((v,a)=>v-padding+phase[a]),max:max.map((v,a)=>v+padding+phase[a])};
  const kernel=await solidKernel();let raw,box,solid;
  try{
    raw=kernel.Manifold.levelSet(point=>evaluateBlobField(prepared,point).value-field.threshold,bounds,edgeMm,0,-1);
    const cube=kernel.Manifold.cube(max.map((v,a)=>v-min[a]));try{box=cube.translate(min);}finally{cube.delete();}
    solid=raw.intersect(box);
    requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'Blob field extraction is empty or invalid; raise strengths or reaches, or lower edgeMm.');
    const {vertices,triangles}=preciseSolidMesh(solid);
    makeMesh(vertices,triangles);
    const record={shape:'blob-field',field,extraction,vertices,triangles};
    return {...record,compiledHash:blobFieldDigest(record)};
  }finally{solid?.delete();box?.delete();raw?.delete();}
}
