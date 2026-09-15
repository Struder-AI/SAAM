// Local nominal material occupied by a completed operation. This is a height
// field over a footprint, not a swept nozzle/head or reconstructed bead model.
import {clipOpenPaths} from '../region/intersection.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {TOLERANCE,requireThat} from '../geom/tolerance.mjs';
import {SegmentIndex} from '../region/region2d.mjs';

export function materialRegion(loops,{heightAt,maxZ,sampleStepMm=0.5,index=null}) {
  requireThat(Number.isFinite(maxZ)&&sampleStepMm>0&&Number.isFinite(sampleStepMm),'Material needs a finite maximum height and positive sampling step.');
  const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const loop of loops)for(const p of loop)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  let footprint;
  return {maxZ,blocksSegment(from,to){
    if(maxZ<=Math.min(from[2],to[2])+TOLERANCE.plane)return false;
    if([0,1].some(i=>Math.max(from[i],to[i])<min[i]-TOLERANCE.plane||Math.min(from[i],to[i])>max[i]+TOLERANCE.plane))return false;
    index??=new SegmentIndex(loops);
    const boxMin=[0,1].map(i=>Math.min(from[i],to[i])-TOLERANCE.plane),
      boxMax=[0,1].map(i=>Math.max(from[i],to[i])+TOLERANCE.plane);
    const edges=index.inBox(boxMin,boxMax).filter(([a,b])=>[0,1].every(i=>Math.max(a[i],b[i])>=boxMin[i]&&Math.min(a[i],b[i])<=boxMax[i]));
    // With no boundary in the segment's box, membership is constant along it.
    // Reuse the comb index; reserve clipping for possible boundary crossings.
    if(!edges.length&&!index.contains(from))return false;
    // Include boundary contact, including collinear travel. The expansion is
    // numerical predicate slack, not an extra process clearance or bead width.
    if(edges.length)footprint??=offsetRegion(loops,TOLERANCE.plane,{precisionMm:TOLERANCE.plane/10});
    const dx=to[0]-from[0],dy=to[1]-from[1],length2=dx*dx+dy*dy;
    const blocked=(x,y,t)=>{
      const z=heightAt?heightAt(x,y):maxZ;
      return !Number.isFinite(z)||z>from[2]+(to[2]-from[2])*t+TOLERANCE.plane;
    };
    if(length2<1e-18){
      // A tiny clipping probe preserves point/vertical queries at boundaries.
      const inside=!edges.length||clipOpenPaths([[[from[0]-TOLERANCE.plane,from[1]],[from[0]+TOLERANCE.plane,from[1]]]],footprint).length>0;
      return inside&&(blocked(from[0],from[1],0)||blocked(to[0],to[1],1));
    }
    const spans=edges.length?clipOpenPaths([[from.slice(0,2),to.slice(0,2)]],footprint):[[from,to]];
    for(const span of spans){
      const a=span[0],b=span.at(-1);
      const steps=heightAt?Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/sampleStepMm)):1;
      for(let i=0;i<=steps;i++){
        const x=a[0]+(b[0]-a[0])*i/steps,y=a[1]+(b[1]-a[1])*i/steps;
        const t=Math.max(0,Math.min(1,((x-from[0])*dx+(y-from[1])*dy)/length2));
        if(blocked(x,y,t))return true;
      }
    }
    return false;
  }};
}
