import rhino3dm from 'rhino3dm';
import { hash, requireThat, wedgeMesh } from './model.mjs';

let runtime;
export const rhino = () => runtime ??= rhino3dm();
export async function createGeometry(parameters) {
  const r=await rhino(), meshData=wedgeMesh(parameters), doc=new r.File3dm();
  doc.applicationName='SAAM'; doc.applicationDetails='Wedge demo 0.1.0';
  doc.settings().modelUnitSystem=r.UnitSystem.Millimeters;
  // Exact planar profile extruded across the width; no mesh approximation
  // is used for the native solid. The mesh below is only its display proxy.
  const g=parameters, high=g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180);
  const curve=new r.PolylineCurve([[0,0,0],[g.runMm,0,0],[g.runMm,high,0],[0,g.baseMm,0],[0,0,0]]);
  const solid=r.Extrusion.create(curve,g.widthMm,true);
  requireThat(solid?.isSolid,'Rhino could not create the capped wedge.');
  // Map the XY profile to XZ; extrusion +Z becomes -Y, then translate.
  solid.transform(r.Transform.rotationVectors([0,0,1],[0,-1,0],[0,0,0]));
  solid.transform(r.Transform.translationXYZ(0,g.widthMm,0));
  const attrs=new r.ObjectAttributes();attrs.name='wedge';attrs.setUserString('saam:geometry',hash(parameters));
  const solidId=doc.objects().add(solid,attrs);
  // Named exact ruled surfaces give maker and agent a stable shared face.
  const features=[];
  for(const [i,indices] of meshData.faces.entries()) {
    const [a,b,c,d]=indices.map(j=>meshData.vertices[j]);
    const surface=r.NurbsSurface.createRuledSurface(new r.LineCurve(a,b),new r.LineCurve(d,c));
    const attr=new r.ObjectAttributes();attr.name=meshData.labels[i];attr.setUserString('saam:feature',meshData.labels[i]);
    const id=doc.objects().add(surface,attr);
    features.push({id:meshData.labels[i],objectId:id,faceIndex:i,geometryVersion:hash(parameters)});
  }
  const bytes=doc.toByteArray();
  const reopened=r.File3dm.fromByteArray(bytes);
  requireThat(reopened && reopened.objects().count===7 && reopened.objects().get(0).geometry().isSolid,'3DM round-trip verification failed.');
  const result={bytes,descriptor:{schema:'saam-wedge-geometry/1',parameters,geometryVersion:hash(parameters),fileHash:hash(bytes),solidId,features,...meshData}};
  reopened.destroy();doc.destroy();
  return result;
}
export async function verifyGeometry(bytes,descriptor) {
  requireThat(hash(bytes)===descriptor.fileHash,'Geometry file changed; geometry approval is stale.');
  const r=await rhino(), doc=r.File3dm.fromByteArray(bytes);
  requireThat(doc && doc.objects().count===7,'Invalid wedge 3DM.');
  requireThat(doc.objects().get(0).geometry().isSolid,'Wedge must be a closed solid.');
  requireThat(doc.objects().get(0).attributes().getUserString('saam:geometry')===hash(descriptor.parameters),'Geometry parameters do not match the 3DM.');
  doc.destroy();
}
