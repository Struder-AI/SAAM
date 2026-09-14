// Offline authoring: bound rail minima over carrier XY and gimbal angles.
// Translation in Z raises all carriages equally, so minima occur at tip Z=0.
import {tiltyGeometry,gimbalRotation,tiltyInverse} from '../../core/machine/tilty.mjs';
import {constrainedJog} from '../../core/machine/jog.mjs';
import {loadMachine} from '../../core/machine/profile.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],neg=a=>[-a[1],-a[0]],sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>{const p=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...p),Math.max(...p)];};
const scale=(a,b)=>mul(a,[b,b]),sq=a=>[a[0]<=0&&a[1]>=0?0:Math.min(a[0]**2,a[1]**2),Math.max(a[0]**2,a[1]**2)];
const sin=a=>[Math.sin(a[0]),Math.sin(a[1])],cos=a=>[Math.min(Math.cos(a[0]),Math.cos(a[1])),a[0]<=0&&a[1]>=0?1:Math.max(Math.cos(a[0]),Math.cos(a[1]))];
const dot=(e,p)=>add(scale(p[0],e[0]),scale(p[1],e[1])),radius2=p=>add(sq(p[0]),sq(p[1]));
// Every pose in a box is contained by this interval relaxation. Omitting the
// Jacobian enlarges the domain; witnesses still pass the complete owning model.
export function railBoxLowerBound(g,box,index){
  const [x,y,a,b]=box,C=[x,y],sa=sin(a),ca=cos(a),sb=sin(b),cb=cos(b),one=v=>[v,v];
  const tool=[scale(sb,g.toolLengthMm),scale(mul(sa,cb),-g.toolLengthMm),scale(mul(ca,cb),g.toolLengthMm)];
  if(tool[2][1]<g.toolLengthMm*Math.cos(g.maxTiltDeg*Math.PI/180)-1e-9)return Infinity;
  if(radius2(C)[0]>(g.towerRadiusMm-g.platformRadiusMm)**2+1e-8||radius2([sub(x,tool[0]),sub(y,tool[1])])[0]>g.towerRadiusMm**2+1e-8)return Infinity;
  const rear=g.towers.map(e=>{const u=e[0]*g.rearRadiusMm,v=e[1]*g.rearRadiusMm,l=g.rearLengthMm;
    return [add(scale(cb,u),scale(sb,l)),add(add(scale(mul(sa,sb),u),scale(ca,v)),scale(mul(sa,cb),-l)),add(add(scale(mul(ca,sb),-u),scale(sa,v)),scale(mul(ca,cb),l))];});
  const dz=[],ht=[],out=[];
  const vertical=(p,L)=>{const q=sub(one(L*L),radius2(p)),reserve=L*Math.sin(g.marginDeg*Math.PI/180);if(q[1]<reserve**2-1e-8)return null;return [Math.sqrt(Math.max(reserve**2,q[0])),Math.sqrt(Math.max(0,q[1]))];};
  for(let i=0;i<3;i++){
    const e=g.towers[i],r=g.towerRadiusMm-g.platformRadiusMm,main=vertical([sub(x,one(e[0]*r)),sub(y,one(e[1]*r))],g.rodLengthMm);if(!main)return Infinity;dz.push(main);out.push(sub(one(r),dot(e,C)));
    const p=[add(x,rear[i][0]),add(y,rear[i][1])];if(radius2(p)[0]>g.towerRadiusMm**2+1e-8)return Infinity;
    const tilt=vertical([sub(p[0],one(e[0]*g.towerRadiusMm)),sub(p[1],one(e[1]*g.towerRadiusMm))],g.tiltRodLengthMm);if(!tilt)return Infinity;ht.push(add(rear[i][2],tilt));
    if(add(tool[2],main)[0]>g.railMaxMm||add(tool[2],ht[i])[0]>g.railMaxMm)return Infinity;
  }
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){
    const plate=sub(mul(out[i],rear[j][2]),mul(dz[i],sub(dot(g.towers[i],rear[j]),one(g.platformRadiusMm))));
    const railOffset=sub(one(g.towerRadiusMm*(g.towers[i][0]*g.towers[j][0]+g.towers[i][1]*g.towers[j][1])-g.platformRadiusMm),dot(g.towers[i],C));
    const carriage=sub(mul(out[i],ht[j]),mul(dz[i],railOffset));
    if(plate[1]<-1e-4||carriage[1]<-1e-4)return Infinity;
  }
  // Inside its own arm plane, a tilt carriage cannot be below its main one.
  const mainFloor=g.toolLengthMm*Math.cos(g.maxTiltDeg*Math.PI/180)+Math.sqrt(Math.max(0,g.rodLengthMm**2-4*(g.towerRadiusMm-g.platformRadiusMm)**2));
  return Math.max(mainFloor,tool[2][0]+(index<3?dz[index][0]:Math.max(dz[index-3][0],ht[index-3][0])))-1e-6;
}
function railMinimum(g,index,{toleranceMm=1,maxCells=500000}={}){
  const rad=Math.PI/180,r=g.towerRadiusMm-g.platformRadiusMm,limit=g.maxTiltDeg*rad;
  const pose=x=>{const R=gimbalRotation(x[2],x[3]);return tiltyInverse(g,{tcp:[x[0]-g.toolLengthMm*R[0][2],x[1]-g.toolLengthMm*R[1][2],0],rotation:R});};
  const height=s=>[...s.mainHeights,...s.tiltHeights][index];let upper=Infinity,witness=null,cells=0;
  const consider=x=>{const s=pose(x);if(s.valid&&height(s)<upper){upper=height(s);witness={tcp:s.tcp,pitchDeg:x[2]/rad,tiltDeg:x[3]/rad,mainHeights:s.mainHeights,tiltHeights:s.tiltHeights};}return s;};
  // The existing jog controller supplies feasible upper bounds; interval
  // subdivision supplies conservative lower bounds, independent of sampling.
  const seeds=[[0,0,0,0]];for(let i=0;i<6;i++){const a=i*Math.PI/3;seeds.push([100*Math.cos(a),100*Math.sin(a),0,0]);}
  for(const seed of seeds){const s=consider(seed);if(!s.valid)continue;
    const evaluate=x=>{const p=pose(x.slice(1)),margins=[...p.margins,x[0]-height(p)];return {valid:p.valid&&margins.at(-1)>=-1e-7,margins};};
    const from=[height(s),...seed],result=constrainedJog({from,target:[0,...seed],axis:0,scales:[1,1,1,g.toolLengthMm+g.rearLengthMm,g.toolLengthMm+g.rearLengthMm],evaluate});consider(result.values.slice(1));
  }
  const heap=[];
  const push=n=>{let i=heap.length;heap.push(n);while(i){const p=(i-1)>>1;if(heap[p].lower<=n.lower)break;heap[i]=heap[p];i=p;}heap[i]=n;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].lower<heap[j].lower)j++;if(heap[j].lower>=last.lower)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
  const inspect=box=>{cells++;const lower=railBoxLowerBound(g,box,index);if(lower>=upper)return;consider(box.map(v=>(v[0]+v[1])/2));if(lower<upper)push({box,lower});};
  inspect([[-r,r],[-r,r],[-limit,limit],[-limit,limit]]);
  while(heap.length&&upper-heap[0].lower>toleranceMm&&cells<maxCells){
    const {box}=pop(),widths=box.map((v,i)=>(v[1]-v[0])*(i<2?1:g.toolLengthMm+g.rearLengthMm)),i=widths.indexOf(Math.max(...widths)),mid=(box[i][0]+box[i][1])/2;
    for(const range of [[box[i][0],mid],[mid,box[i][1]]]){const next=[...box];next[i]=range;inspect(next);}
  }
  const lower=Math.min(upper,heap[0]?.lower??upper);
  return {lowerBoundMm:lower,reachableMm:upper,gapMm:upper-lower,cells,witness,minimumMm:Math.floor(lower*10)/10};
}
export function lowerRailLimits(config,options){
  const g=tiltyGeometry({...config,railMinMm:0,tiltRailMinMm:[0,0,0]}),rails=[0,1,2,3,4,5].map(i=>railMinimum(g,i,options));
  if(rails.some(r=>!Number.isFinite(r.lowerBoundMm)||!Number.isFinite(r.reachableMm)||r.gapMm>(options?.toleranceMm??1)))throw Error('Rail bounds did not converge to the requested tolerance');
  return {railMinMm:Math.min(...rails.slice(0,3).map(r=>r.minimumMm)),tiltRailMinMm:rails.slice(3).map(r=>r.minimumMm),rails};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(lowerRailLimits(loadMachine('tilty').kinematicModel),null,2));
