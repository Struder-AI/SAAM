// Geometry-only triangle index shared by explicit mesh repair and its checks.
import {subtract as sub,dot,cross} from './tolerance.mjs';
import {separatedTriangles,MESH_DEGENERATE_MM2} from './mesh.mjs';
import {nearestBoxQuery,triangleBoxes} from './triangle-bvh.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE,FLOAT64_EPSILON} from '../dimensions.mjs';

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
// Coplanar overlap uses projected segment and containment tests. Like the mesh contract
// (mesh.mjs) it certifies with rounding guards: a distance (mm) for coplanar, touching
// and inside, and a dimensionless one for the segment crossing solve of noncoplanar
// pairs.
export function trianglesContact(pa,pb,sharedPoints=[]) {
  if(!sharedPoints.length)return !separatedTriangles(pa,pb);
  const eps=ROUNDING_MM,slack=ROUNDING_RELATIVE,n=cross(sub(pa[1],pa[0]),sub(pa[2],pa[0])),length=Math.hypot(...n);
  if(length<MESH_DEGENERATE_MM2)return true;
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
    // Signed distance (mm) of c from the projected line ab.
    const orient=(a,b,c)=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/(Math.hypot(b[0]-a[0],b[1]-a[1])||1);
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
    // Rounding guard: a segment within this sine of the triangle plane runs parallel to it.
    const e1=sub(t[1],t[0]),e2=sub(t[2],t[0]),d=sub(q,p),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<=slack*Math.hypot(...e1)*Math.hypot(...e2)*Math.hypot(...d))return false;
    const s=sub(p,t[0]),u=dot(s,h)/det;if(u< -slack||u>1+slack)return false;
    const r=cross(s,e1),v=dot(d,r)/det;if(v< -slack||u+v>1+slack)return false;
    const f=dot(e2,r)/det;if(f< -slack||f>1+slack)return false;
    const hit=p.map((x,k)=>x+f*d[k]);
    // In a noncoplanar pair sharing an edge, the planes meet only on that edge.
    if(sharedPoints.length===2)return false;
    return !allowed(hit);
  };
  return pa.some((p,i)=>edgeHit(p,pa[(i+1)%3],pb))||pb.some((p,i)=>edgeHit(p,pb[(i+1)%3],pa));
}

// Adjacent triangles that fold onto each other beyond their shared vertex or edge are
// reported, not refused: a section absorbs the zero-width fold.
export function adjacentContacts({vertices,triangles}) {
  const incident=vertices.map(()=>[]),contacts={count:0,pairs:[]};triangles.forEach((t,i)=>t.forEach(v=>incident[v].push(i)));
  for(const [i,t]of triangles.entries())for(const j of new Set(t.flatMap(v=>incident[v]))){
    if(j<=i)continue;const other=triangles[j],shared=t.filter(v=>other.includes(v)).map(v=>vertices[v]);
    if(trianglesContact(t.map(v=>vertices[v]),other.map(v=>vertices[v]),shared)){contacts.count++;if(contacts.pairs.length<20)contacts.pairs.push([i,j]);}
  }
  return contacts;
}

// Nearest surface point queries over triangles given as index triples.
export function triangleIndex(vertices,triangles) {
  const boxes=triangleBoxes(vertices,triangles),query=nearestBoxQuery(boxes),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<triangles.length;i++)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],boxes[6*i+k]);bounds.max[k]=Math.max(bounds.max[k],boxes[6*i+3+k]);}
  function nearest(p) {
    let point=null,best=Infinity;
    query(p,i=>{const q=closestTrianglePoint(p,...triangles[i].map(v=>vertices[v])),d=dot(sub(p,q),sub(p,q));if(d<best){best=d;point=q;}return d;});
    return {point,distance:Math.sqrt(best)};
  }
  return {nearest,bounds};
}

// A convex quadrilateral is split by its old/new diagonal, projected along both
// faces' normals summed so a flat sliver projects through its neighbour. A sliver
// corner exactly on the old diagonal is the limit case. Their projected intersection induces four paired affine triangles. Only the two lifted centre
// points differ, so their distance bounds the entire old/new patch. Comparing its
// square to the remaining reference allowance is exact; the displayed value rounds
// upward before subsequent edits consume it, so it cannot reset the budget.
export function diagonalPatchBound(xyz,exact,h,t,v,w,allowanceMm){
  if(!(allowanceMm>0))return null;
  const subtractExact=(a,b)=>a.map((x,k)=>x-b[k]),normSquaredExact=v=>v.reduce((s,x)=>s+x*x,0n),exactRatio=(a,b)=>{if(a===0n)return 0;const sa=Math.max(0,a.toString(2).length-53),sb=Math.max(0,b.toString(2).length-53);return Number(a>>BigInt(sa))/Number(b>>BigInt(sb))*2**(sa-sb);};
  const [H,T,V,W]=[h,t,v,w].map(exact.vertex),u=subtractExact(T,H),z=subtractExact(W,V),r=subtractExact(V,H),A=3*h,B=3*t,C=3*v,D=3*w,ux=xyz[B]-xyz[A],uy=xyz[B+1]-xyz[A+1],uz=xyz[B+2]-xyz[A+2],vx=xyz[C]-xyz[A],vy=xyz[C+1]-xyz[A+1],vz=xyz[C+2]-xyz[A+2],wx=xyz[D]-xyz[A],wy=xyz[D+1]-xyz[A+1],wz=xyz[D+2]-xyz[A+2],normal=[uy*vz-uz*vy+wy*uz-wz*uy,uz*vx-ux*vz+wz*ux-wx*uz,ux*vy-uy*vx+wx*uy-wy*ux],drop=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),i=(drop+1)%3,j=(drop+2)%3;
  const cross=(a,b)=>a[i]*b[j]-a[j]*b[i];let d=cross(u,z),a=cross(r,z),b=cross(r,u);
  if(d<0n){d=-d;a=-a;b=-b;}if(d===0n||a<=0n||a>=d||b<0n||b>d)return null;
  const delta=H.map((x,k)=>(x-V[k])*d+u[k]*a-z[k]*b),square=normSquaredExact(delta),allowance=exact.number(allowanceMm),bound=allowance*allowance*d*d;
  if(square>=bound)return null;
  const distance=allowanceMm*Math.sqrt(exactRatio(square,bound));
  return square===0n?0:distance+Math.max(Number.MIN_VALUE,Math.abs(distance)*(FLOAT64_EPSILON*16));
}
