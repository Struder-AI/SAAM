import { VERSION, distance, requireThat, validatePlan, roofGeometry } from './model.mjs';
import { scanlineFill, loopArea } from '../../../core/region/region2d.mjs';
import { offsetRegion } from '../../../core/region/offset.mjs';
import { PathBuilder } from '../../../core/path/builder.mjs';
import { startupPosition, toolBounds } from '../../../core/machine/profile.mjs';

// Keep the bounded eight-point section construction; inset its result with the
// same material-region offset used by every other skill.
function course(roof,coreC,z,inset) {
  const {runMm:x,widthMm:y,a,b}=roof;
  const input=[[0,0],[x,0],[x,y],[0,y]],out=[];
  const f=p=>coreC+a*p[0]+b*p[1]-z;
  for(let i=0;i<input.length;i++) {
    const p=input[i],q=input[(i+1)%input.length],fp=f(p),fq=f(q);
    if(fp>=0)out.push(p);
    if((fp<0)!==(fq<0)) {const t=fp/(fp-fq);out.push(p.map((v,k)=>v+t*(q[k]-v)));}
  }
  return out.length>=3&&Math.abs(loopArea(out))>1e-8?(offsetRegion([out],-inset)[0]??[]):[];
}

export function generatePath(plan, machine) {
  validatePlan(plan, machine);
  const {geometry:g, placement:o, process:p, setup:s} = plan;
  // zAfterPrimeMm was recorded in pre-0.2.3 bundle snapshots.  It remains a
  // compatible read only; the current machine contract no longer primes or
  // levels as part of every job.
  const startupZ=machine.startup.zAfterStartupMm??machine.startup.zAfterPrimeMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const roof=roofGeometry(g),{slope,cosine,runMm,widthMm}=roof;
  const skinZ=p.skinNormalMm/cosine, coreBase=roof.c-p.skinLayers*skinZ, w=p.lineWidthMm;
  const partMaxZ=roof.maxHeightMm;
  const builder=new PathBuilder({start:startupPosition(machine,plan),process:p,machine,generatorVersion:VERSION});
  builder.motionBounds=toolBounds(machine,s.tool);
  // A new job recovers the previous SAAM job's final retraction once.
  builder.retracted=p.startupRetracted;
  const world=q=>[o.xMm+q[0],o.yMm+q[1],q[2]];
  const move=builder.move.bind(builder);
  const finishLayer=builder.finishLayer.bind(builder);
  function travel(q) {
    // Keep the bounded wedge's nearby-start policy and eight-point generator;
    // the shared builder owns travel, retraction and deposited-height tracking.
    builder.travelTo(world(q),{canTravelDirect:(from,to)=>
      !builder.retracted&&distance(from,to)<=p.combTravelMm});
  }
  function line(points,height,speed,role='fill') {
    travel(points[0]);
    for(const q of points.slice(1)) {const to=world(q);move(to,speed,distance(builder.position,to)*w*height,{role});}
  }
  builder.setContext('prime',0);
  builder.fan(0);
  line([[0,-4,p.firstLayerMm],[runMm,-4,p.firstLayerMm]],p.firstLayerMm,p.firstLayerSpeedMmS);
  builder.phase='planar';
  const zs=[];
  for(let i=0;;i++) {
    const z=p.firstLayerMm+i*p.layerMm;
    if(z>partMaxZ-p.skinLayers*skinZ+1e-9) break;
    if(!course(roof,coreBase,z,w/2).length)break;
    zs.push(z);
  }
  for(const [index,z] of zs.entries()) {
    builder.layer=index; const h=index===0?p.firstLayerMm:p.layerMm;
    const speed=index===0?p.firstLayerSpeedMmS:p.planarSpeedMmS;
    if(index===1) builder.fan(p.fanPercent);
    const perimeter=course(roof,coreBase,z,w/2),inside=course(roof,coreBase,z,1.5*w);
    const strokes=[{role:'perimeter',points:[...perimeter,perimeter[0]].map(q=>[...q,z])}];
    if(inside.length) {
      const fill=scanlineFill([inside],w,90,{originMm:[w/2,0]}),points=[];
      for(const [i,row] of fill.entries())for(const q of i%2?[row.to,row.from]:[row.from,row.to])points.push([...q,z]);
      if(points.length)strokes.push({role:'fill',points});
    }
    // Reverse the complete course on odd layers: start near the previous
    // course's end, reverse fill traversal and reverse perimeter winding.
    if(index%2){strokes.reverse();for(const stroke of strokes)stroke.points.reverse();}
    for(const stroke of strokes)line(stroke.points,h,speed,stroke.role);
    finishLayer();
  }
  const substrateHeight=(x,y)=>{
    // Use the downhill bead edge to account for finite-width perimeter support.
    const target=coreBase+roof.a*x+roof.b*y-w*slope/2;
    if(target<p.firstLayerMm) return 0;
    if(!zs.length)return 0;
    return Math.min(zs.at(-1),p.firstLayerMm+Math.floor((target-p.firstLayerMm+1e-9)/p.layerMm)*p.layerMm);
  };
  const transitionGaps=[];
  builder.phase='inclined';
  // Raster along the roof's steepest direction. A horizontal roof uses +X.
  const along=slope>1e-12?[roof.a/slope,roof.b/slope]:[1,0],across=[-along[1],along[0]];
  const footprint=[[0,0],[runMm,0],[runMm,widthMm],[0,widthMm]];
  const roofInset=offsetRegion([footprint],-w/2)[0];
  requireThat(roofInset,'Wedge roof footprint collapses at the selected bead width.');
  const insetMin=[0,1].map(axis=>Math.min(...roofInset.map(p=>p[axis])));
  const insetMax=[0,1].map(axis=>Math.max(...roofInset.map(p=>p[axis])));
  const projected=footprint.map(q=>q[0]*across[0]+q[1]*across[1]);
  const minV=Math.min(...projected),span=Math.max(...projected)-minV;
  const rows=Math.max(2,Math.ceil(span/w)),spacing=span/rows;
  const xy=(u,v)=>[along[0]*u+across[0]*v,along[1]*u+across[1]*v];
  const ranges=[];
  for(let row=0;row<rows;row++) {
    const v=minV+(row+.5)*spacing;let lo=-Infinity,hi=Infinity,valid=true;
    for(let axis=0;axis<2;axis++) {
      const low=insetMin[axis],high=insetMax[axis],offset=across[axis]*v,dir=along[axis];
      if(Math.abs(dir)<1e-12){if(offset<low-1e-9||offset>high+1e-9)valid=false;}
      else {const a=(low-offset)/dir,b=(high-offset)/dir;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
    }
    if(valid&&hi-lo>1e-4)ranges.push({row,v,lo,hi});
  }
  function sampledUs(start,end) {
    const nodes=[start,end];
    // Include every substrate step, then subdivide to at most 0.5 mm.
    if(slope>1e-12)for(const z of zs){const u=(z-coreBase+w*slope/2)/slope;if(u>start+1e-8&&u<end-1e-8)nodes.push(u);}
    nodes.sort((a,b)=>a-b);const us=[];
    for(let i=0;i<nodes.length-1;i++) {
      const count=Math.max(1,Math.ceil((nodes[i+1]-nodes[i])/0.5));
      for(let j=0;j<count;j++)us.push(nodes[i]+(nodes[i+1]-nodes[i])*j/count);
    }
    us.push(end);return us;
  }
  if(zs.length<2)builder.fan(p.fanPercent);
  let strokeCount=0;
  for(let k=1;k<=p.skinLayers;k++) {
    builder.layer=zs.length+k-1;
    const zAt=u=>coreBase+k*skinZ+u*slope;
    // A thin downhill end cannot hold every inner skin below the final
    // surface. Start each skin where it reaches first-layer height; later
    // skins therefore extend farther downhill than the earliest ones.
    let deposited=0;
    for(const [order,{v,lo,hi}] of (k%2?ranges:[...ranges].reverse()).entries()) {
      const start=slope>1e-12?Math.max(lo,(p.firstLayerMm-coreBase-k*skinZ)/slope):lo;
      if(start>=hi-1e-4||zAt(start)<p.firstLayerMm-1e-8)continue;
      const stroke=(k-1)*rows+order,us=sampledUs(start,hi),rowUs=strokeCount++%2?[...us].reverse():us;
      travel([...xy(rowUs[0],v),zAt(rowUs[0])]);
      for(let i=1;i<rowUs.length;i++) {
        const mid=(rowUs[i-1]+rowUs[i])/2,[x,y]=xy(mid,v);
        const gap=k===1?zAt(mid)-substrateHeight(x,y):skinZ;
        requireThat(gap>0 && gap<=skinZ+p.layerMm+w*slope/2+1e-6, 'Transition gap exceeds the substrate model.');
        if(k===1) transitionGaps.push(gap);
        const to=world([...xy(rowUs[i],v),zAt(rowUs[i])]);
        // Rectangular bead approximation: true 3D length times normal gap.
        // The first gap varies above the stairs; later skins are parallel.
        const volume=distance(builder.position,to)*spacing*gap*cosine;
        move(to,p.skinSpeedMmS,volume,{gapMm:gap,normalHeightMm:gap*cosine,stroke});
        deposited++;
      }
    }
    requireThat(deposited>0,`Sloped layer ${k} has no printable extent at the locked bead spacing.`);
    finishLayer();
  }
  builder.phase='finish';builder.park();
  builder.fan(0);
  return builder.toPath({boundsMm:{min:[o.xMm,o.yMm,0],max:[o.xMm+runMm,o.yMm+widthMm,partMaxZ]},planarLayers:zs.length,skinLayers:p.skinLayers,skinRows:rows,clearanceZMm:builder.clearanceZ(),
      minTransitionGapMm:transitionGaps.reduce((a,b)=>Math.min(a,b),Infinity),maxTransitionGapMm:transitionGaps.reduce((a,b)=>Math.max(a,b),-Infinity),
      clearance:'operator responsibility; not checked',physicalValidation:'not performed'});
}
