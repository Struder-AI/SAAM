// A layer-independent interior-ball witness for intersecting native solids.
// Mesh distances use their original triangles; NURBS surface exclusion uses
// rational derivative bounds, never a presentation tessellation. Failure to find
// a witness resolves spatial features to program precision, not a print grid.
import {containsPoint,prepareSolidBoundsQuery,interiorCentersWithin} from '../../geom/query.mjs';
import {createMeshDistanceQuery} from '../../geom/mesh-distance.mjs';
import {evaluate,gradientBound} from '../../geom/nurbs.mjs';
import {dot} from '../../geom/frame.mjs';
import {PROGRAM_STEP_MM,ROUNDING_MM} from '../../dimensions.mjs';

const boxDistance=(point,box)=>Math.hypot(...point.map((v,k)=>Math.max(box.min[k]-v,0,v-box.max[k])));
const ballQueries=new WeakMap();
const solidBalls=geometry=>{
  if(!ballQueries.has(geometry))ballQueries.set(geometry,buildSolidBalls(geometry));
  return ballQueries.get(geometry);
};

function patchBalls(patch){
  const fields=[0,1,2,3].map(k=>Float64Array.from({length:patch.nu*patch.nv},(_,i)=>patch.cp[4*i+k]));
  const roots=[];
  for(let i=patch.orderU-1;i<patch.nu;i++)for(let j=patch.orderV-1;j<patch.nv;j++){
    const u=[patch.knotsU[i],patch.knotsU[i+1]],v=[patch.knotsV[j],patch.knotsV[j+1]];
    if(u[0]===u[1]||v[0]===v[1])continue;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let wMin=Infinity;
    for(let a=i-patch.orderU+1;a<=i;a++)for(let b=j-patch.orderV+1;b<=j;b++){
      const q=4*(a*patch.nv+b),w=patch.cp[q+3];wMin=Math.min(wMin,w);
      for(let k=0;k<3;k++){const x=patch.cp[q+k]/w;min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);}
    }
    const gradients=fields.map(f=>gradientBound(patch,f,{u,v}));
    const speeds=[0,1,2].map(k=>['u','v'].map(axis=>(gradients[k][axis]+Math.max(Math.abs(min[k]),Math.abs(max[k]))*gradients[3][axis])/wMin));
    roots.push({u,v,min,max,speeds});
  }
  const clear=(node,point,radius)=>{
    if(boxDistance(point,node)>radius)return true;
    const u=(node.u[0]+node.u[1])/2,v=(node.v[0]+node.v[1])/2;
    node.point??=evaluate(patch,u,v,false).point;
    if(Math.hypot(...point.map((x,k)=>x-node.point[k]))<=radius)return false;
    const half=node.speeds.map(([a,b])=>a*(node.u[1]-node.u[0])/2+b*(node.v[1]-node.v[0])/2);
    const tight={min:node.point.map((x,k)=>Math.max(node.min[k],x-half[k])),max:node.point.map((x,k)=>Math.min(node.max[k],x+half[k]))};
    if(boxDistance(point,tight)>radius)return true;
    if(Math.hypot(...half)<=PROGRAM_STEP_MM)return false;
    if(!node.children){
      const axis=Math.hypot(...node.speeds.map(s=>s[0]))*(node.u[1]-node.u[0])>=Math.hypot(...node.speeds.map(s=>s[1]))*(node.v[1]-node.v[0])?'u':'v';
      const middle=axis==='u'?u:v;
      if(middle===node[axis][0]||middle===node[axis][1])return false;
      node.children=[{...tight,u:node.u,v:node.v,speeds:node.speeds,[axis]:[node[axis][0],middle]},
        {...tight,u:node.u,v:node.v,speeds:node.speeds,[axis]:[middle,node[axis][1]]}];
    }
    return node.children.every(child=>clear(child,point,radius));
  };
  return (point,radius)=>roots.every(root=>clear(root,point,radius));
}

// 1: ball inside; -1: ball outside; 0: it meets a boundary. Boolean answers
// are conservative: interior boundaries of a union may return 0, never 1.
function buildSolidBalls(geometry){
  if(geometry.kind==='chart-prism')return null;
  if(geometry.kind==='boolean'){
    const operands=geometry.operands.map(solidBalls);if(operands.some(q=>!q))return null;
    return (point,radius)=>{
      const values=operands.map(query=>query(point,radius));
      if(geometry.operation==='union')return values.includes(1)?1:values.every(v=>v===-1)?-1:0;
      if(geometry.operation==='intersection')return values.includes(-1)?-1:values.every(v=>v===1)?1:0;
      return values[0]===-1||values.slice(1).includes(1)?-1:values[0]===1&&values.slice(1).every(v=>v===-1)?1:0;
    };
  }
  const surface={meshDistance:null,patches:null};
  if(geometry.kind==='triangle-mesh')surface.meshDistance=createMeshDistanceQuery(geometry);
  else if(geometry.patches)surface.patches=geometry.patches.map(patchBalls);
  else return null;
  return (point,radius)=>{
    if(geometry.empty||boxDistance(point,geometry.bounds)>radius)return -1;
    if(surface.meshDistance&&surface.meshDistance(point,Math.max(radius,ROUNDING_MM))<=radius)return 0;
    if(surface.patches&&!surface.patches.every(clear=>clear(point,radius)))return 0;
    return containsPoint(geometry,point)?1:-1;
  };
}

export function prepareSharedInterior({solids,slabs=[]}){
  const supported=g=>g.kind==='boolean'?g.operands.every(supported):g.kind==='triangle-mesh'||Array.isArray(g.patches);
  if(!solids.every(supported))return {supported:false};
  const required=new Set(),excluded=new Set();
  function constrain(g,inside=true){
    const values=inside?required:excluded;if(values.has(g))return;values.add(g);
    if(g.kind!=='boolean')return;
    if(inside&&g.operation==='intersection'||!inside&&g.operation==='union')for(const operand of g.operands)constrain(operand,inside);
    else if(inside&&g.operation==='difference'){constrain(g.operands[0]);for(const operand of g.operands.slice(1))constrain(operand,false);}
  }
  solids.forEach(g=>constrain(g));let queries=null,boxes=null;
  const bounds={min:[0,1,2].map(k=>Math.max(...solids.map(s=>s.bounds.min[k]))),max:[0,1,2].map(k=>Math.min(...solids.map(s=>s.bounds.max[k])))};
  for(const {fromMm,toMm,axis=[0,0,1]} of slabs){
    const k=axis.findIndex(v=>Math.abs(v)===1);
    if(k>=0&&axis.every((v,i)=>i===k||v===0)){
      bounds.min[k]=Math.max(bounds.min[k],axis[k]>0?fromMm:-toMm);
      bounds.max[k]=Math.min(bounds.max[k],axis[k]>0?toMm:-fromMm);
    }
  }
  return {supported:true,find(depthMm){
    const radius=Math.max(ROUNDING_MM,depthMm/2-ROUNDING_MM),min=bounds.min.map(x=>x+radius),max=bounds.max.map(x=>x-radius);
    if(min.some((x,k)=>x>max[k]))return null;
    for(const negative of excluded)for(const positive of required)if(interiorCentersWithin(positive,negative,radius))return null;
    if(!queries){
      queries=solids.map(solidBalls);boxes=solids.map(prepareSolidBoundsQuery);
      for(const {fromMm,toMm,axis=[0,0,1]} of slabs)queries.push((point,radius)=>{
        const h=dot(axis,point),r=radius*Math.hypot(...axis);
        return h-r>=fromMm-ROUNDING_MM&&h+r<=toMm+ROUNDING_MM?1:h+r<fromMm||h-r>toMm?-1:0;
      });
    }
    const pending=[{min,max}];
    while(pending.length){
      const box=pending.pop(),point=box.min.map((x,k)=>(x+box.max[k])/2),half=box.max.map((x,k)=>(x-box.min[k])/2),reach=Math.hypot(...half);
      if(boxes.some(query=>query(box)===-1))continue;
      if(queries.every(query=>query(point,radius)===1))return point;
      if(queries.some(query=>query(point,reach)===-1))continue;
      if(radius>reach&&queries.some(query=>query(point,radius-reach)!==1))continue;
      const width=half.map(x=>2*x),axis=width.indexOf(Math.max(...width));
      if(width[axis]<=PROGRAM_STEP_MM)continue;
      const middle=point[axis];if(middle===box.min[axis]||middle===box.max[axis])continue;
      const lower={min:box.min,max:box.max.slice()},upper={min:box.min.slice(),max:box.max};lower.max[axis]=middle;upper.min[axis]=middle;
      pending.push(upper,lower);
    }
    return null;
  }};
}
