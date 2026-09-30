import {solidKernel,solidFromMesh,meshFromSolid} from '../../../core/geom/solid.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {topAt} from '../../../core/geom/query.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {heatSetFeature,dimensions,heatSetTemplate,heatSetDigest} from './feature.mjs';

export async function compileHeatSet(base,features,{buildGeometry,toleranceMm=0.01}={}){
  const normalized=features.map(heatSetFeature),shell=buildGeometry(base),kernel=await solidKernel();
  requireThat(normalized.length>0&&normalized.length<=40,'Choose 1–40 heat-set features.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&toleranceMm<=0.1,'Invalid heat-set tolerance.');
  const host=tessellateShell(shell,{toleranceMm});
  const underside=makeMesh(host.vertices.map(([x,y,z])=>[x,y,-z]),host.triangles.map(([a,b,c])=>[a,c,b]));
  let solid=solidFromMesh(kernel,host);
  try{
    for(const f of normalized){
      const {diameterMm,depthMm}=dimensions(f),[x,y,z]=f.positionMm,r=diameterMm/2;
      const bottom=f.entry==='bottom',end=bottom?z+depthMm:z-depthMm;
      requireThat(bottom?end<shell.bounds.max[2]-toleranceMm:end>shell.bounds.min[2]+toleranceMm,'Heat-set seat depth exceeds the host; reduce depth or choose a shorter insert.');
      // Check the selected planar insertion face normal to Z against the host.
      // Check
      // the mouth footprint rather than silently cutting an inaccessible cavity.
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,top=topAt(bottom?underside:shell,x+r*Math.cos(a),y+r*Math.sin(a));
        requireThat(top&&Math.abs(top.zMm-(bottom?-z:z))<=toleranceMm*2,'Heat-set mouth must lie on the selected flat exterior insertion face.');
      }
      const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(1-toleranceMm/r)));
      let cylinder=kernel.Manifold.cylinder(depthMm+toleranceMm*2,r,r,segments);
      const placed=cylinder.translate([x,y,bottom?z-toleranceMm*2:end]);cylinder.delete();cylinder=placed;
      try{const next=solid.subtract(cylinder);solid.delete();solid=next;}finally{cylinder.delete();}
    }
    const mesh=meshFromSolid(solid),record={...heatSetTemplate(),base:structuredClone(base),features:normalized,toleranceMm,vertices:mesh.vertices,triangles:mesh.triangles};
    record.compiledHash=heatSetDigest(record);return record;
  }finally{solid.delete();}
}
