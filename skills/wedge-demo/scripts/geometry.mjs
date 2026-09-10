import { hash, requireThat, wedgeMesh, roofGeometry } from './model.mjs';
import { makeMesh } from '../../../core/geom/mesh.mjs';

export async function createGeometry(parameters) {
  const mesh=wedgeMesh(parameters),roof=roofGeometry(parameters);
  const validated=makeMesh(mesh.vertices,mesh.faces,{name:'wedge'});
  const geometryVersion=hash(parameters);
  const features=[...new Set(mesh.labels)].map(id=>({id,objectId:hash({geometryVersion,id}).slice(0,32),
    faceIndices:mesh.labels.flatMap((label,i)=>label===id?[i]:[]),geometryVersion}));
  const native={schema:'saam-native-geometry/1',units:'mm',geometry:{shape:'mesh',vertices:mesh.vertices,triangles:mesh.faces}};
  const bytes=Buffer.from(JSON.stringify(native));
  return {bytes,descriptor:{schema:'saam-wedge-geometry/1',nativeFile:'model.mesh.json',parameters,geometryVersion,
    fileHash:hash(bytes),nativeForm:'indexed triangle mesh; eight corners, six planar faces',features,boundsMm:validated.bounds,
    roof:{a:roof.a,b:roof.b,c:roof.c,angleDeg:roof.angleDeg,minHeightMm:roof.minHeightMm,maxHeightMm:roof.maxHeightMm},...mesh}};
}

export async function verifyGeometry(bytes,descriptor) {
  requireThat(hash(bytes)===descriptor.fileHash,'Geometry file changed; geometry approval is stale.');
  if(!descriptor.nativeFile) {
    // Read-only verification for explicit upgrade of pre-mesh bundles.
    const r=await (await import('rhino3dm')).default(),doc=r.File3dm.fromByteArray(bytes);
    try {
      requireThat(doc&&doc.objects().count===7&&doc.objects().get(0).geometry().isSolid,'Invalid legacy wedge 3DM.');
      requireThat(doc.objects().get(0).attributes().getUserString('saam:geometry')===hash(descriptor.parameters),'Geometry parameters do not match the 3DM.');
    } finally {doc?.destroy();}
    return;
  }
  requireThat(descriptor.nativeFile==='model.mesh.json','Unsupported wedge native geometry.');
  const expected=await createGeometry(descriptor.parameters);
  requireThat(hash(bytes)===hash(expected.bytes),'Native mesh differs from the eight-point wedge.');
  requireThat(hash(descriptor)===hash(expected.descriptor),'Mesh display/identity differs from the native reviewed geometry.');
}
