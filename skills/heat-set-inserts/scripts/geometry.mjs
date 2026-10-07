import {heatSetFeature,dimensions,heatSetTemplate} from './feature.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

export async function compileHeatSet(base,features,{buildGeometry,constructSolids,topAt,toleranceMm=0.01}={}){
  requireThat([buildGeometry,constructSolids,topAt].every(value=>typeof value==='function'),
    'Heat-set needs Geometry buildGeometry, constructSolids and topAt operations.');
  const normalized=features.map(heatSetFeature),shell=buildGeometry(base);
  requireThat(normalized.length>0,'Choose at least one heat-set feature.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Invalid heat-set tolerance.');
  let solid=shell;
    for(const f of normalized){
      const {diameterMm,depthMm}=dimensions(f),[x,y,z]=f.positionMm,r=diameterMm/2;
      requireThat(z-depthMm>shell.bounds.min[2]+toleranceMm,'Blind heat-set hole needs material below its floor; increase host thickness or change depth.');
      // The initial capability is a planar insertion face normal to Z. Check
      // the mouth footprint rather than silently cutting an inaccessible cavity.
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,top=topAt(shell,x+r*Math.cos(a),y+r*Math.sin(a));
        requireThat(top&&Math.abs(top.zMm-z)<=toleranceMm*2,'Heat-set mouth must lie on a flat exterior insertion face normal to Z. Reorient the part first.');
      }
      const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-toleranceMm/r))));
      const cylinder={operation:'translate',geometry:{operation:'cylinder',heightMm:depthMm+toleranceMm*2,radiusMm:r,segments},offset:[x,y,z-depthMm]};
      solid={operation:'difference',operands:[solid,cylinder]};
    }
    const [mesh]=await constructSolids([solid],{toleranceMm});
    requireThat(mesh,'Heat-set operation produced an empty solid.');
    return {...heatSetTemplate(),base:structuredClone(base),features:normalized,toleranceMm,vertices:mesh.vertices,triangles:mesh.triangles};
}
