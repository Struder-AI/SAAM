import {solidKernel,solidFromMesh,meshFromSolid} from '../../../core/geom/solid.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {topAt,sectionGeometry} from '../../../core/geom/query.mjs';
import {loopArea,pointInRegion} from '../../../core/region/region2d.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {heatSetFeature,dimensions,heatSetTemplate,heatSetDigest} from './feature.mjs';

// A frustum between two explicit world-Z heights, built directly in world
// space so callers never have to reason about the kernel's own local frame
// (radiusLow always sits at its own z=0) once the bore can point either way.
function frustumBetween(kernel,zA,radiusA,zB,radiusB,segments){
  const lowZ=Math.min(zA,zB),height=Math.abs(zB-zA);
  const [radiusLow,radiusHigh]=zA<=zB?[radiusA,radiusB]:[radiusB,radiusA];
  const built=kernel.Manifold.cylinder(height,radiusLow,radiusHigh,segments);
  const placed=built.translate([0,0,lowZ]);built.delete();
  return placed;
}

export async function compileHeatSet(base,features,{buildGeometry,toleranceMm=0.01}={}){
  const normalized=features.map(heatSetFeature),shell=buildGeometry(base),kernel=await solidKernel();
  requireThat(normalized.length>0&&normalized.length<=40,'Choose 1–40 heat-set features.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&toleranceMm<=0.1,'Invalid heat-set tolerance.');
  let solid=solidFromMesh(kernel,tessellateShell(shell,{toleranceMm}));
  try{
    for(const f of normalized){
      const {diameterMm,depthMm,chamferDepthMm,chamferAngleDeg}=dimensions(f),[x,y,z]=f.positionMm,r=diameterMm/2;
      // sign is the world-Z direction the bore travels from its mouth into the
      // host: -1 for the default top-Z insertion face, +1 when the insert is
      // pressed in from the host's flat lowest face instead.
      const sign=f.insertionSide==='bottom'?1:-1,farZ=z+sign*depthMm;
      if(f.throughHole){
        const clears=sign<0?farZ<=shell.bounds.min[2]+toleranceMm:farZ>=shell.bounds.max[2]-toleranceMm;
        requireThat(clears,`Through heat-set hole ${f.id} must reach the opposite exterior face; increase depth or host thickness.`);
      }else{
        const hasFloor=sign<0?farZ>shell.bounds.min[2]+toleranceMm:farZ<shell.bounds.max[2]-toleranceMm;
        requireThat(hasFloor,`Blind heat-set hole ${f.id} needs material below its floor; increase host thickness, change depth, or set throughHole.`);
      }
      // The initial capability is a planar insertion face normal to Z. Check
      // the mouth footprint rather than silently cutting an inaccessible cavity.
      if(f.insertionSide==='bottom'){
        requireThat(Math.abs(z-shell.bounds.min[2])<=toleranceMm*2,`Bottom-insertion heat-set mouth ${f.id} must lie on the host's flat lowest exterior face; reorient or reposition otherwise.`);
        const {loops}=sectionGeometry(shell,z+toleranceMm*4),solidLoops=loops.filter(loop=>loopArea(loop)>0),holeLoops=loops.filter(loop=>loopArea(loop)<0);
        for(let i=0;i<16;i++){
          const a=i*Math.PI/8,p=[x+r*Math.cos(a),y+r*Math.sin(a)];
          requireThat(pointInRegion(p,solidLoops)&&!holeLoops.some(loop=>pointInRegion(p,[loop])),`Heat-set mouth ${f.id} must lie on a flat exterior insertion face. Reorient the part first.`);
        }
      }else{
        for(let i=0;i<16;i++){
          const a=i*Math.PI/8,top=topAt(shell,x+r*Math.cos(a),y+r*Math.sin(a));
          requireThat(top&&Math.abs(top.zMm-z)<=toleranceMm*2,`Heat-set mouth ${f.id} must lie on a flat exterior insertion face normal to Z. Reorient the part first.`);
        }
      }
      const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(1-toleranceMm/r)));
      const worldAt=s=>z+sign*s; // s = distance from the mouth, growing into the host
      const mouthPad=toleranceMm*2,farPad=f.throughHole?toleranceMm*2:0;
      const wideR=chamferDepthMm>0?r+chamferDepthMm*Math.tan(chamferAngleDeg*Math.PI/180):r;
      let tool=frustumBetween(kernel,worldAt(depthMm+farPad),r,worldAt(chamferDepthMm),r,segments);
      if(chamferDepthMm>0){
        const taper=frustumBetween(kernel,worldAt(chamferDepthMm),r,worldAt(0),wideR,segments);
        const merged=tool.add(taper);tool.delete();taper.delete();tool=merged;
      }
      const mouthExtension=frustumBetween(kernel,worldAt(0),wideR,worldAt(-mouthPad),wideR,segments);
      {const merged=tool.add(mouthExtension);tool.delete();mouthExtension.delete();tool=merged;}
      const placed=tool.translate([x,y,0]);tool.delete();tool=placed;
      try{const next=solid.subtract(tool);solid.delete();solid=next;}finally{tool.delete();}
    }
    const mesh=meshFromSolid(solid),record={...heatSetTemplate(),base:structuredClone(base),features:normalized,toleranceMm,vertices:mesh.vertices,triangles:mesh.triangles};
    record.compiledHash=heatSetDigest(record);return record;
  }finally{solid.delete();}
}
