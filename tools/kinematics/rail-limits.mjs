// Conservative lower rail limits for the current Tilty geometry. This is an
// authoring calculation, not a renderer or per-frame workspace sampler.
import {tiltyGeometry,gimbalRotation,tiltyInverse} from '../../core/machine/tilty.mjs';
import {mv} from '../../core/machine/rigid.mjs';
import {loadMachine} from '../../core/machine/profile.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Extrema of distance from a disk center over an intersection of disks occur
// at boundary intersections or at a radial extremum on an exposed circle arc.
function diskCandidates(disks){
  const points=[],inside=p=>disks.every(c=>(p[0]-c[0])**2+(p[1]-c[1])**2<=c[2]**2+1e-7);
  const add=p=>{if(inside(p))points.push(p);};
  for(const c of disks)for(const [x,y] of [[c[2],0],[-c[2],0],[0,c[2]],[0,-c[2]]])add([c[0]+x,c[1]+y]);
  for(let i=0;i<disks.length;i++)for(let j=i+1;j<disks.length;j++){
    const a=disks[i],b=disks[j],dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);
    if(d<1e-9||d>a[2]+b[2]||d<Math.abs(a[2]-b[2]))continue;
    const t=(a[2]**2-b[2]**2+d*d)/(2*d),h=Math.sqrt(Math.max(0,a[2]**2-t*t)),x=a[0]+dx*t/d,y=a[1]+dy*t/d;
    for(const s of [-1,1])add([x-s*dy*h/d,y+s*dx*h/d]);
  }
  for(const a of disks)for(const b of disks){const dx=a[0]-b[0],dy=a[1]-b[1],d=Math.hypot(dx,dy);if(d>1e-9)add([a[0]+dx*a[2]/d,a[1]+dy*a[2]/d]);}
  return points;
}

function railMinimum(config,tiltIndex,{toleranceMm=.02,maxCells=100000}={}){
  // Remove old lower stops while deriving what travel the mechanism can use.
  const g=tiltyGeometry({...config,railMinMm:0,tiltRailMinMm:[0,0,0]}),rad=Math.PI/180,cone=Math.cos(g.maxTiltDeg*rad);
  const reserve=g.marginDeg*rad,mainRadius=g.rodLengthMm*Math.cos(reserve),tiltRadius=g.tiltRodLengthMm*Math.cos(reserve);
  const mainLowerBoundMm=g.toolLengthMm*cone+g.rodLengthMm*Math.sin(reserve);
  const tiltFloor=(g.toolLengthMm+g.rearLengthMm)*cone-g.rearRadiusMm*Math.sin(g.maxTiltDeg*rad);
  const rearNorm=Math.hypot(g.rearLengthMm,g.rearRadiusMm),tipRearNorm=Math.hypot(g.toolLengthMm+g.rearLengthMm,g.rearRadiusMm);
  let upper=Infinity,witness=null,cells=0;
  const heap=[];
  const push=n=>{let i=heap.length;heap.push(n);while(i){const p=(i-1)>>1;if(heap[p].lower<=n.lower)break;heap[i]=heap[p];i=p;}heap[i]=n;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].lower<heap[j].lower)j++;if(heap[j].lower>=last.lower)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
  function inspect(lo,hi){
    cells++;
    const leastAbs=i=>lo[i]<=0&&hi[i]>=0?0:Math.min(Math.abs(lo[i]),Math.abs(hi[i]));
    if(Math.cos(leastAbs(0))*Math.cos(leastAbs(1))<cone)return;
    const a=(lo[0]+hi[0])/2,b=(lo[1]+hi[1])/2,R=gimbalRotation(a,b),delta=(hi[0]-lo[0]+hi[1]-lo[1])/2;
    // ||Rx(a)Ry(b)-Rx(a0)Ry(b0)|| <= |a-a0|+|b-b0|.
    // Inflate each moving-anchor disk by the corresponding center uncertainty.
    const uncertainty=rearNorm*delta,rear=g.towers.map(e=>mv(R,[e[0]*g.rearRadiusMm,e[1]*g.rearRadiusMm,g.rearLengthMm]));
    const disks=inflate=>[...g.towers.map(e=>[e[0]*(g.towerRadiusMm-g.platformRadiusMm),e[1]*(g.towerRadiusMm-g.platformRadiusMm),mainRadius]),
      ...g.towers.map((e,i)=>[e[0]*g.towerRadiusMm-rear[i][0],e[1]*g.towerRadiusMm-rear[i][1],tiltRadius+inflate])];
    const expanded=disks(uncertainty),points=diskCandidates(expanded);if(!points.length)return;
    let lower=Infinity;
    for(const i of [tiltIndex]){
      const center=expanded[i+3],distance=Math.max(...points.map(p=>Math.hypot(p[0]-center[0],p[1]-center[1])))+uncertainty;
      const z=Math.max(tiltFloor,g.toolLengthMm*R[2][2]+rear[i][2]-tipRearNorm*delta);
      lower=Math.min(lower,z+Math.sqrt(Math.max((g.tiltRodLengthMm*Math.sin(reserve))**2,g.tiltRodLengthMm**2-distance**2)));
    }
    if(R[2][2]>=cone-1e-12){
      const candidates=diskCandidates(disks(0));
      if(candidates.length){const mean=[0,1].map(i=>candidates.reduce((sum,p)=>sum+p[i],0)/candidates.length);
        for(const p of candidates){const xy=p.map((v,i)=>v+(mean[i]-v)*1e-9),tcp=[xy[0]-g.toolLengthMm*R[0][2],xy[1]-g.toolLengthMm*R[1][2],0];
          const s=tiltyInverse(g,{tcp,rotation:R});if(!s.valid)continue;
          const h=s.tiltHeights[tiltIndex];if(h<upper){upper=h;witness={tcp,pitchDeg:a/rad,tiltDeg:b/rad,tiltHeights:s.tiltHeights};}
        }
      }
    }
    if(lower<upper)push({lo,hi,lower});
  }
  const limit=g.maxTiltDeg*rad;inspect([-limit,-limit],[limit,limit]);
  while(heap.length&&upper-heap[0].lower>toleranceMm&&cells<maxCells){const n=pop(),i=n.hi[0]-n.lo[0]>=n.hi[1]-n.lo[1]?0:1,m=(n.lo[i]+n.hi[i])/2,hi=[...n.hi],lo=[...n.lo];hi[i]=m;lo[i]=m;inspect(n.lo,hi);inspect(lo,n.hi);}
  const lower=Math.min(upper,heap[0]?.lower??upper);
  return {mainLowerBoundMm,tiltLowerBoundMm:lower,tiltReachableMm:upper,gapMm:upper-lower,cells,witness,
    railMinMm:Math.floor(mainLowerBoundMm*10)/10,tiltRailMinMm:Math.floor(lower*10)/10};
}

export function lowerRailLimits(config,options){
  const rails=[0,1,2].map(i=>railMinimum(config,i,options));
  if(rails.some(r=>!Number.isFinite(r.tiltLowerBoundMm)||!Number.isFinite(r.tiltReachableMm)||r.gapMm>(options?.toleranceMm??.02)))throw Error('Could not bound Tilty lower travel to the requested tolerance');
  return {mainLowerBoundMm:rails[0].mainLowerBoundMm,railMinMm:rails[0].railMinMm,tiltRailMinMm:rails.map(r=>r.tiltRailMinMm),rails};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(lowerRailLimits(loadMachine('tilty').kinematicModel),null,2));
