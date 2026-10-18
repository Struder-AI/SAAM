// One finite tangent neighborhood, certified from the native rational control
// net. Requested physical reach determines extent; failed proofs never resize it.
import {bezierPieces} from './surface-intersection.mjs';
import {restrictBezierNet} from './bezier-net.mjs';
import {extendSurface} from './surface-extend.mjs';
import {prepareSurfaceOffset} from './surface-offset.mjs';
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],neg=a=>[-a[1],-a[0]],sub=(a,b)=>add(a,neg(b));
function mul(a,b){const values=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...values),Math.max(...values)];}
const times=(a,k)=>mul(a,[k,k]),divide=(a,b)=>mul(a,[1/b[1],1/b[0]]);
const plus=(a,b)=>a.map((value,k)=>add(value,b[k])),minus=(a,b)=>a.map((value,k)=>sub(value,b[k]));
const scaled=(a,t)=>a.map(value=>mul(value,t));
const crossed=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
const projected=(a,n)=>a.reduce((sum,value,k)=>add(sum,times(value,n[k])),[0,0]);
const upper=a=>Math.hypot(...a.map(value=>Math.max(Math.abs(value[0]),Math.abs(value[1]))));
const lower=a=>Math.hypot(...a.map(([lo,hi])=>Math.max(lo,0,-hi)));
const choose=[[1],[1,1],[1,2,1],[1,3,3,1]];
function finding(code,message,details){throw Object.assign(Error(message),{code,...details});}

function differentiated(net,axis,span){
  const degree=(axis===0?net.length:net[0].length)-1;
  if(!degree)return [[[0,0,0,0]]];
  if(axis===0)return net.slice(1).map((row,i)=>row.map((point,j)=>point.map((value,k)=>(value-net[i][j][k])*degree/span)));
  return net.map(row=>row.slice(1).map((point,j)=>point.map((value,k)=>(value-row[j][k])*degree/span)));
}
function nativeJet(piece,bounds){
  const origin=piece.net[0][0].slice(0,3).map(value=>value/piece.net[0][0][3]);
  const weightScale=Math.max(...piece.net.flat().map(point=>point[3]));
  const nets=new Map([['0:0',piece.net.map(row=>row.map(point=>[...point.slice(0,3).map((value,k)=>(value-origin[k]*point[3])/weightScale),point[3]/weightScale]))]]);
  const h=new Map(),jet=new Map(),spans=[piece.u[1]-piece.u[0],piece.v[1]-piece.v[0]],uv=[piece.u,piece.v].map(([lo],k)=>bounds[k].map(value=>(value-lo)/spans[k]));
  for(let order=0;order<=3;order++)for(let a=0;a<=order;a++){
    const b=order-a,key=a+':'+b;
    if(order)nets.set(key,a?differentiated(nets.get((a-1)+':'+b),0,spans[0]):differentiated(nets.get('0:'+(b-1)),1,spans[1]));
    const controls=restrictBezierNet(nets.get(key),uv).flat(),guard=ROUNDING_MM/(spans[0]**a*spans[1]**b);
    h.set(key,[0,1,2,3].map(k=>{
      const values=controls.map(point=>point[k]),error=k===3?ROUNDING_RELATIVE/(spans[0]**a*spans[1]**b):guard;
      return [Math.min(...values)-error,Math.max(...values)+error];
    }));
    const value=h.get(key).slice(0,3),weight=h.get('0:0')[3];
    if(!(weight[0]>0))finding('SURFACE_EXTENSION_UNRESOLVED','Surface neighborhood cannot bound positive rational weights.',{boundsUv:bounds});
    for(let i=0;i<=a;i++)for(let j=0;j<=b;j++)if(i!==a||j!==b){
      const term=scaled(jet.get(i+':'+j),times(h.get((a-i)+':'+(b-j))[3],choose[a][i]*choose[b][j]));
      for(let k=0;k<3;k++)value[k]=sub(value[k],term[k]);
    }
    jet.set(key,value.map(interval=>divide(interval,weight)));
  }
  jet.set('0:0',jet.get('0:0').map((interval,k)=>add(interval,[origin[k],origin[k]])));
  return jet;
}
function extendedJet(piece,bounds,domains){
  const clamped=bounds.map(([lo,hi],k)=>[Math.max(domains[k][0],Math.min(domains[k][1],lo)),Math.max(domains[k][0],Math.min(domains[k][1],hi))]);
  const jet=nativeJet(piece,clamped),delta=bounds.map((interval,k)=>sub(interval,clamped[k])),outside=bounds.map((interval,k)=>interval[1]<=domains[k][0]||interval[0]>=domains[k][1]);
  // A cell is on one side of every join. Interior directions have zero shift.
  for(let k=0;k<2;k++)if(!outside[k])delta[k]=[0,0];
  const U=plus(jet.get('1:0'),scaled(jet.get('1:1'),delta[1])),V=plus(jet.get('0:1'),scaled(jet.get('1:1'),delta[0]));
  const zero=[[0,0],[0,0],[0,0]],UU=outside[0]?zero:plus(jet.get('2:0'),scaled(jet.get('2:1'),delta[1]));
  const VV=outside[1]?zero:plus(jet.get('0:2'),scaled(jet.get('1:2'),delta[0]));
  return {U,V,UU,UV:jet.get('1:1'),VV};
}
function offsetTangents(jet,depth){
  const {U,V,UU,UV,VV}=jet,A=crossed(U,V),length=[lower(A),upper(A)];
  if(!(length[0]>0))return null;
  const N=A.map(interval=>divide(interval,length));
  const derivative=Ai=>scaled(minus(Ai,scaled(N,Ai.reduce((sum,value,k)=>add(sum,mul(value,N[k])),[0,0]))),[1/length[1],1/length[0]]);
  const Nu=derivative(plus(crossed(UU,V),crossed(U,UV))),Nv=derivative(plus(crossed(UV,V),crossed(U,VV)));
  return {U:plus(U,scaled(Nu,depth)),V:plus(V,scaled(Nv,depth)),base:A};
}
function cellsFor(patch,bounds){
  const pieces=bezierPieces(patch),domains=[patch.domainU,patch.domainV];
  const cuts=domains.map((domain,k)=>[bounds[k][0],...new Set(pieces.flatMap(piece=>k===0?piece.u:piece.v).filter(value=>value>bounds[k][0]&&value<bounds[k][1])),bounds[k][1]].sort((a,b)=>a-b));
  const cells=[];
  for(let i=1;i<cuts[0].length;i++)for(let j=1;j<cuts[1].length;j++){
    const uv=[[cuts[0][i-1],cuts[0][i]],[cuts[1][j-1],cuts[1][j]]],mid=uv.map(([lo,hi],k)=>Math.max(domains[k][0],Math.min(domains[k][1],(lo+hi)/2)));
    const piece=pieces.find(piece=>mid[0]>=piece.u[0]&&mid[0]<=piece.u[1]&&mid[1]>=piece.v[0]&&mid[1]<=piece.v[1]);
    requireThat(piece,'Surface neighborhood has no native knot cell.');cells.push({bounds:uv,piece});
  }
  return cells;
}
function certify(patch,bounds,depthRange,toleranceMm,{directionPieces=null,tightness=1,maxInverse=[Infinity,Infinity]}={}){
  const domains=[patch.domainU,patch.domainV],extent=domains.map((domain,k)=>[Math.min(domain[0],bounds[k][0]),Math.max(domain[1],bounds[k][1])]);
  const surface=extendSurface(patch,extent),pending=cellsFor(patch,bounds).map(cell=>({...cell,depth:depthRange})),result={inverse:[0,0],cells:0};
  while(pending.length){
    const cell=pending.pop(),jet=extendedJet(cell.piece,cell.bounds,domains),exact=tightness?offsetTangents(jet,cell.depth):null;
    const direction=directionPieces?.find(piece=>piece.u[0]===cell.piece.u[0]&&piece.v[0]===cell.piece.v[0]);
    const field=direction?extendedJet(direction,cell.bounds,domains):null;
    const loose=field?{U:plus(jet.U,scaled(field.U,cell.depth)),V:plus(jet.V,scaled(field.V,cell.depth))}:null;
    const tangents=loose?(tightness===0?loose:exact?{U:plus(scaled(loose.U,[1-tightness,1-tightness]),scaled(exact.U,[tightness,tightness])),
      V:plus(scaled(loose.V,[1-tightness,1-tightness]),scaled(exact.V,[tightness,tightness]))}:null):exact;
    const mid=cell.bounds.map(([lo,hi])=>lo+(hi-lo)/2),sample=surface.at(...mid),normal=sample.normal;
    if(!normal)finding('SURFACE_EXTENSION_SINGULAR','Surface continuation has a singular tangent.',{boundsUv:cell.bounds});
    const area=tangents?crossed(tangents.U,tangents.V):null;
    const centre=tangents?crossIntervalsCentre(tangents.U,tangents.V):null,axis=directionPieces&&centre?centre:normal;
    const projection=area?projected(area,axis):[-Infinity,Infinity],guard=ROUNDING_RELATIVE*upper(jet.U)*upper(jet.V);
    const inverse=projection[0]>guard?[upper(tangents.V)/projection[0],upper(tangents.U)/projection[0]]:null;
    if(inverse&&inverse.every((value,k)=>value<=maxInverse[k])){
      result.inverse[0]=Math.max(result.inverse[0],inverse[0]);
      result.inverse[1]=Math.max(result.inverse[1],inverse[1]);result.cells++;continue;
    }
    if(!directionPieces&&projection[1]<-guard)finding('SURFACE_OFFSET_FOLD','Normal offset crosses a focal fold in the required neighborhood.',{boundsUv:cell.bounds,normalRangeMm:cell.depth});
    const sizes=[upper(jet.U)*(cell.bounds[0][1]-cell.bounds[0][0]),upper(jet.V)*(cell.bounds[1][1]-cell.bounds[1][0]),cell.depth[1]-cell.depth[0]];
    const dimension=sizes.indexOf(Math.max(...sizes)),range=dimension===2?cell.depth:cell.bounds[dimension],cut=range[0]+(range[1]-range[0])/2;
    if(Math.max(...sizes)<=toleranceMm||!(cut>range[0]&&cut<range[1]))finding(inverse?'SURFACE_EXTENSION_EXTENT':'SURFACE_EXTENSION_UNRESOLVED',
      inverse?'Required offset reach cannot be certified inside the finite tangent neighborhood.':
        'Required surface neighborhood regularity is unresolved at print resolution.',{boundsUv:cell.bounds,normalRangeMm:cell.depth});
    for(const interval of [[range[0],cut],[cut,range[1]]])pending.push({...cell,
      ...(dimension===2?{depth:interval}:{bounds:cell.bounds.map((old,k)=>k===dimension?interval:old)})});
  }
  return result;
}
function crossIntervalsCentre(U,V){
  const a=U.map(([lo,hi])=>(lo+hi)/2),b=V.map(([lo,hi])=>(lo+hi)/2),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],size=Math.hypot(...n);
  return size?n.map(value=>value/size):null;
}
const prepared=new WeakMap();
export function surfaceNeighborhood(patch,{reachMm,normalRangeMm=[0,0],boundsUv=null,periodicU=false,tightness=1,toleranceMm=PRINT_RESOLUTION_MM}={}){
  requireThat(patch?.cp&&Number.isFinite(reachMm)&&reachMm>=0&&Array.isArray(normalRangeMm)&&normalRangeMm.length===2&&normalRangeMm.every(Number.isFinite)&&normalRangeMm[0]<=normalRangeMm[1]&&Number.isFinite(toleranceMm)&&toleranceMm>0,
    'Surface neighborhood needs a native patch, finite reach, ordered offset depths and positive accuracy.');
  const domains=[patch.domainU,patch.domainV],requested=boundsUv??domains;
  requireThat(Number.isFinite(tightness)&&tightness>=0&&tightness<=1&&requested.length===2&&requested.every(interval=>interval.length===2&&interval.every(Number.isFinite)&&interval[1]>interval[0]),
    'Required neighborhood needs finite chart bounds and offset tightness from 0 to 1.');
  const key=JSON.stringify([reachMm,normalRangeMm,requested,periodicU,tightness,toleranceMm]);
  if(!prepared.has(patch))prepared.set(patch,new Map());const cache=prepared.get(patch);if(cache.has(key))return cache.get(key);
  const base=certify(patch,requested,[0,0],toleranceMm);
  const padding=base.inverse.map((value,k)=>periodicU&&k===0?0:2*(reachMm+toleranceMm)*value);
  const bounds=requested.map(([lo,hi],k)=>[lo-padding[k],hi+padding[k]]);
  const field=tightness<1?prepareSurfaceOffset({patch,periodicU}).offsetPatch(1):null;
  const directionPatch=field?{...field,cp:Float64Array.from(field.cp,(value,k)=>k%4===3?value:value-patch.cp[k])}:null;
  const proof=certify(patch,bounds,[Math.min(0,normalRangeMm[0]),Math.max(0,normalRangeMm[1])],toleranceMm,
    {directionPieces:directionPatch?bezierPieces(directionPatch):null,tightness,
      maxInverse:padding.map((value,k)=>periodicU&&k===0?Infinity:value/(reachMm+toleranceMm))});
  const referenceBoundsUv=domains.map((domain,k)=>[Math.min(domain[0],bounds[k][0]),Math.max(domain[1],bounds[k][1])]);
  const result={surface:extendSurface(patch,referenceBoundsUv),boundsUv:bounds,referenceBoundsUv,report:{continuation:'tangent',reachMm,normalRangeMm,tightness,cells:base.cells+proof.cells,toleranceMm}};
  cache.set(key,result);return result;
}
