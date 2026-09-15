// Geometry-only triangle index shared by explicit mesh repair and its checks.
import {subtract as sub,dot,cross} from './tolerance.mjs';
import {separatedTriangles} from './mesh.mjs';

export function closestTrianglePoint(p,a,b,c) {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3)return b;
  const mix=(a,b,t)=>a.map((v,k)=>v+t*(b[k]-v));
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0)return mix(a,b,d1/(d1-d3));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0)return mix(a,c,d2/(d2-d6));
  const va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0)return mix(b,c,(d4-d3)/(d4-d3+d5-d6));
  const den=1/(va+vb+vc),v=vb*den,w=vc*den;
  return a.map((x,k)=>x+ab[k]*v+ac[k]*w);
}

// Closed triangle intersection, excluding only the actual shared vertex/edge.
// Coplanar overlap uses projected segment and containment tests.
export function trianglesContact(pa,pb,sharedPoints=[]) {
  if(!sharedPoints.length)return !separatedTriangles(pa,pb);
  const eps=1e-9,n=cross(sub(pa[1],pa[0]),sub(pa[2],pa[0])),length=Math.hypot(...n);
  if(length<1e-12)return true;
  const normal=n.map(v=>v/length),dist=pb.map(p=>dot(sub(p,pa[0]),normal));
  if(dist.every(d=>d>eps)||dist.every(d=>d< -eps))return false;
  const allowed=p=>sharedPoints.some(q=>Math.hypot(...sub(p,q))<=eps);
  if(sharedPoints.length===3)return true;
  const coplanar=dist.every(d=>Math.abs(d)<=eps);
  if(sharedPoints.length===2){
    if(!coplanar)return false;
    const edge=sub(sharedPoints[1],sharedPoints[0]),a=pa.find(p=>!allowed(p)),b=pb.find(p=>!allowed(p));
    return !a||!b||dot(cross(edge,sub(a,sharedPoints[0])),cross(edge,sub(b,sharedPoints[0])))>0;
  }
  if(sharedPoints.length===1){const other=dist.filter((_,i)=>!allowed(pb[i]));if(other.every(d=>d>eps)||other.every(d=>d< -eps))return false;}
  if(coplanar){
    const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),project=p=>p.filter((_,k)=>k!==axis),a=pa.map(project),b=pb.map(project);
    const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const strictInside=(p,t)=>{const s=t.map((a,i)=>orient(a,t[(i+1)%3],p));return s.every(v=>v>eps)||s.every(v=>v< -eps);};
    if(a.some(p=>strictInside(p,b))||b.some(p=>strictInside(p,a)))return true;
    // Centroids cover identical triangles and coincident edges on the same side.
    const center=t=>[0,1].map(k=>(t[0][k]+t[1][k]+t[2][k])/3);
    if(strictInside(center(a),b)||strictInside(center(b),a))return true;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const p=a[i],q=a[(i+1)%3],r=b[j],s=b[(j+1)%3],o1=orient(p,q,r),o2=orient(p,q,s),o3=orient(r,s,p),o4=orient(r,s,q);
      if(((o1>eps&&o2< -eps)||(o1< -eps&&o2>eps))&&((o3>eps&&o4< -eps)||(o3< -eps&&o4>eps)))return true;
      for(const [v,w,c,point]of [[p,q,r,pb[j]],[p,q,s,pb[(j+1)%3]],[r,s,p,pa[i]],[r,s,q,pa[(i+1)%3]]]){
        if(Math.abs(orient(v,w,c))<=eps&&c.every((x,k)=>x>=Math.min(v[k],w[k])-eps&&x<=Math.max(v[k],w[k])+eps)&&!allowed(point))return true;
      }
    }
    return false;
  }
  const edgeHit=(p,q,t)=>{
    // For triangles meeting at one vertex, a positive-length intersection must
    // reach an opposite edge. Testing incident edges merely rediscovers the
    // shared endpoint with ill-conditioned barycentrics near parallel planes.
    if(sharedPoints.length===1&&(allowed(p)||allowed(q)))return false;
    const e1=sub(t[1],t[0]),e2=sub(t[2],t[0]),d=sub(q,p),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)return false;
    const s=sub(p,t[0]),u=dot(s,h)/det;if(u< -eps||u>1+eps)return false;
    const r=cross(s,e1),v=dot(d,r)/det;if(v< -eps||u+v>1+eps)return false;
    const f=dot(e2,r)/det;if(f< -eps||f>1+eps)return false;
    const hit=p.map((x,k)=>x+f*d[k]);
    // In a noncoplanar pair sharing an edge, the planes meet only on that edge.
    if(sharedPoints.length===2)return false;
    return !allowed(hit);
  };
  return pa.some((p,i)=>edgeHit(p,pa[(i+1)%3],pb))||pb.some((p,i)=>edgeHit(p,pb[(i+1)%3],pa));
}

export function checkAdjacentContacts({vertices,triangles}) {
  let candidates=0;const allowance=Math.max(2000000,triangles.length*100);
  const incident=vertices.map(()=>[]);triangles.forEach((t,i)=>t.forEach(v=>incident[v].push(i)));
  for(const [i,t]of triangles.entries())for(const j of new Set(t.flatMap(v=>incident[v]))){
    if(j<=i)continue;if(++candidates>allowance)throw Error('Adjacent-contact work budget exceeded; too many incident faces.');const other=triangles[j],shared=t.filter(v=>other.includes(v)).map(v=>vertices[v]);
    if(trianglesContact(t.map(v=>vertices[v]),other.map(v=>vertices[v]),shared))throw new Error('Repair has intersecting adjacent triangles beyond their shared vertex or edge.');
  }
}

export function triangleIndex(vertices,triangles) {
  const boxes=triangles.map((t,i)=>({i,min:[0,1,2].map(k=>Math.min(...t.map(v=>vertices[v][k]))),max:[0,1,2].map(k=>Math.max(...t.map(v=>vertices[v][k])))}));
  function build(items) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const b of items)for(let k=0;k<3;k++){min[k]=Math.min(min[k],b.min[k]);max[k]=Math.max(max[k],b.max[k]);}
    if(items.length<=12)return {min,max,items};
    const spans=max.map((v,k)=>v-min[k]),axis=spans.indexOf(Math.max(...spans));
    items.sort((a,b)=>a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis]);
    const middle=items.length>>1;return {min,max,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
  }
  const root=build(boxes);
  const boxDistance=(p,b)=>p.reduce((s,v,k)=>s+Math.max(b.min[k]-v,0,v-b.max[k])**2,0);
  function nearest(p) {
    let distance2=Infinity,point=null;
    function visit(b){
      if(boxDistance(p,b)>distance2)return;
      if(b.items){for(const item of b.items){if(boxDistance(p,item)>distance2)continue;const q=closestTrianglePoint(p,...triangles[item.i].map(i=>vertices[i]));const d=dot(sub(p,q),sub(p,q));if(d<distance2){distance2=d;point=q;}}}
      else {const first=boxDistance(p,b.left)<boxDistance(p,b.right)?b.left:b.right;visit(first);visit(first===b.left?b.right:b.left);}
    }
    visit(root);return {point,distance:Math.sqrt(distance2)};
  }
  return {nearest,bounds:{min:root.min,max:root.max}};
}
