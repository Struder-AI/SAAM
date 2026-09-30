import {solidKernel,solidFromMesh,meshFromSolid} from '../../../core/geom/solid.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {difference} from '../../../core/region/boolean.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {holeFeature,holeSupportTemplate,holeSupportDigest} from './record.mjs';
import {detectHoles,circularHole} from './detect.mjs';

export async function compileHoleSupport(base,features,process,{buildGeometry,toleranceMm=0.02}={}){
  requireThat(Array.isArray(features)&&features.length>0&&features.length<=40,'Choose 1-40 hole_support treatments.');
  requireThat(process&&Object.values(process).every(v=>Number.isFinite(v)&&v>0),'Hole support needs positive finite layer and bead dimensions.');
  const shell=buildGeometry(base),normalized=features.map(holeFeature),candidates=detectHoles(shell,{layerMm:process.layerMm}),kernel=await solidKernel();
  requireThat(!shell.planarDetails,'Apply hole_support to a plain host before other local deposition features.');
  let solid=solidFromMesh(kernel,tessellateShell(shell,{toleranceMm}));
  try{
    for(const f of normalized){
      const [x,y,z]=f.centerMm,r=f.boreRadiusMm,R=f.counterboreRadiusMm,w=process.holeLineWidthMm,h=process.layerMm;
      requireThat(candidates.some(c=>Math.hypot(c.centerMm[0]-x,c.centerMm[1]-y)<0.05&&Math.abs(c.centerMm[2]-z)<0.05&&Math.abs(c.boreRadiusMm-r)<0.05&&Math.abs(c.counterboreRadiusMm-R)<0.05),'Selected hole no longer matches a bed-facing counterbore. Rescan the current geometry.');
      requireThat(R-r>2*w,'Counterbore needs room for bridge anchors or a removable support flange.');
      requireThat(normalized.every(other=>other===f||Math.hypot(other.centerMm[0]-x,other.centerMm[1]-y)>R+other.counterboreRadiusMm+4*w),'Hole treatment footprints overlap; treat separated counterbores only.');
      requireThat(z+3*h<shell.bounds.max[2],'The narrow bore needs at least four layers above its shoulder.');
      const lastBore=sectionGeometry(shell,z+3.5*h).loops.map(loop=>circularHole(loop)).filter(Boolean);
      requireThat(lastBore.some(c=>Math.hypot(c.center[0]-x,c.center[1]-y)<0.05&&Math.abs(c.radius-r)<0.05),'The narrow bore must continue unchanged through all four transition layers.');
      requireThat(Math.abs((z-process.firstLayerMm)/h-Math.round((z-process.firstLayerMm)/h))<1e-5,'Counterbore shoulder must align with the layer grid.');
      const n=Math.max(48,Math.ceil(Math.PI/Math.acos(1-toleranceMm/R)));
      const circle=radius=>Array.from({length:n},(_,i)=>[x+radius*Math.cos(i*2*Math.PI/n),y+radius*Math.sin(i*2*Math.PI/n)]);
      const anchor=[circle(R+2*w),circle(R+2*toleranceMm).reverse()];
      requireThat(regionArea(difference(anchor,sectionGeometry(shell,z-0.0001).loops))<0.001,'The counterbore needs a continuous two-bead supporting rim; move the hole or enlarge the host.');
      const cylinder=(height,radius,zLow=0)=>{const local=kernel.Manifold.cylinder(height,radius,radius,n),placed=local.translate([x,y,zLow]);local.delete();return placed;};
      const add=tool=>{try{const next=solid.add(tool);solid.delete();solid=next;}finally{tool.delete();}};
      if(f.strategy==='bore-support'){
        // The contact radius overlaps the first bore bead, whose footprint is
        // [r,r+w], by the chosen fraction. The hollow stem follows the STEP sleeve.
        const inner=r-1.5*w,outer=r+f.overlap*w,flange=R-Math.max(w,1);
        requireThat(inner>w&&flange>outer+w,'Bore is too small for the removable sleeve and flange.');
        const tube=cylinder(z,outer),voidSolid=cylinder(z+2*h,inner,-h),sleeve=tube.subtract(voidSolid);tube.delete();voidSolid.delete();
        add(sleeve);
        const foot=cylinder(process.firstLayerMm,flange),voidFoot=cylinder(process.firstLayerMm+2*h,inner,-h),ring=foot.subtract(voidFoot);foot.delete();voidFoot.delete();add(ring);
      }else{
        const count=f.strategy==='membrane'?1:3;
        for(let stage=0;stage<count;stage++){
          if(f.strategy==='membrane'){add(cylinder(h,R+w,z));continue;}
          if(f.strategy==='stepped-reduction'){
            // Strictly nest successive apertures with at most 0.003 mm extra
            // clearance, avoiding coincident tangent edges in Float32 output.
            const tangentR=r+(3-stage)*Math.min(0.001,toleranceMm/10);
            const planePad=0.00001,cutHeight=h+2*planePad;
            const slot=kernel.Manifold.cube([2*(R+w),2*tangentR,cutHeight],true),slotAt=slot.translate([0,0,h/2]);slot.delete();
            const square=kernel.Manifold.cube([2*tangentR,2*tangentR,cutHeight],true),squareAt=square.translate([0,0,h/2]);square.delete();
            let opening=stage===0?slotAt:squareAt;
            if(stage===0)squareAt.delete();else slotAt.delete();
            if(stage===2){const rotated=opening.rotate([0,0,45]),octagon=opening.intersect(rotated);opening.delete();rotated.delete();opening=octagon;}
            const turned=opening.rotate([0,0,f.angleDeg]),placed=turned.translate([x,y,z+stage*h]);opening.delete();turned.delete();
            const limit=cylinder(cutHeight,R,z+stage*h-planePad),cut=placed.intersect(limit);placed.delete();limit.delete();
            const opened=solid.subtract(cut);solid.delete();solid=opened;
            cut.delete();
          }
        }
      }
    }
    // Collapse boolean slivers below the Float32 output's coordinate resolution
    // before the shared mesh ingestion check; bound displacement to 0.00001 mm.
    const simplified=solid.simplify(0.00001);solid.delete();solid=simplified;
    const mesh=meshFromSolid(solid),record={...holeSupportTemplate(),base:structuredClone(base),features:normalized,process:structuredClone(process),toleranceMm,vertices:mesh.vertices,triangles:mesh.triangles};
    record.compiledHash=holeSupportDigest(record);return record;
  }finally{solid.delete();}
}
