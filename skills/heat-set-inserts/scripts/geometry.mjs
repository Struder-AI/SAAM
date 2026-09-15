import {solidKernel,solidFromMesh,meshFromSolid} from '../../../core/geom/solid.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {topAt} from '../../../core/geom/query.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {heatSetFeature,dimensions,heatSetTemplate,heatSetDigest} from './feature.mjs';

export async function compileHeatSet(base,features,{buildGeometry,toleranceMm=0.01}={}){
  const normalized=features.map(heatSetFeature),shell=buildGeometry(base),kernel=await solidKernel();
  requireThat(normalized.length>0&&normalized.length<=40,'Choose 1–40 heat-set features.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&toleranceMm<=0.1,'Invalid heat-set tolerance.');
  let solid=solidFromMesh(kernel,tessellateShell(shell,{toleranceMm}));
  try{
    for(const f of normalized){
      const {diameterMm,depthMm}=dimensions(f),[x,y,z]=f.positionMm,r=diameterMm/2;
      requireThat(z-depthMm>shell.bounds.min[2]+toleranceMm,'Blind heat-set hole needs material below its floor; increase host thickness or change depth.');
      // The initial capability is a planar insertion face normal to Z. Check
      // the mouth footprint rather than silently cutting an inaccessible cavity.
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,top=topAt(shell,x+r*Math.cos(a),y+r*Math.sin(a));
        requireThat(top&&Math.abs(top.zMm-z)<=toleranceMm*2,'Heat-set mouth must lie on a flat exterior insertion face normal to Z. Reorient the part first.');
      }
      const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(1-toleranceMm/r)));
      let cylinder=kernel.Manifold.cylinder(depthMm+toleranceMm*2,r,r,segments);
      const placed=cylinder.translate([x,y,z-depthMm]);cylinder.delete();cylinder=placed;
      try{const next=solid.subtract(cylinder);solid.delete();solid=next;}finally{cylinder.delete();}
    }
    const mesh=meshFromSolid(solid),record={...heatSetTemplate(),base:structuredClone(base),features:normalized,toleranceMm,vertices:mesh.vertices,triangles:mesh.triangles};
    record.compiledHash=heatSetDigest(record);return record;
  }finally{solid.delete();}
}
