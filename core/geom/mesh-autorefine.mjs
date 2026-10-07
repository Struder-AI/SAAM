// SPIKE (plans/0.3.7.md "Retire CGAL"): SAAM's own solid reconstruction in
// JavaScript, mirroring reconstruct() in core/geom/native/mesh-repair.cpp. Not
// wired into repair; scratch quality.
// Exactness: an input coordinate is a double, an integer on a 2^-S lattice. Every
// constructed point is defined by input primitives (edge x plane, three planes,
// two coplanar edges) and held as homogeneous BigInt coordinates (X,Y,Z,W) on that
// lattice, deduplicated by exact value. Predicates run a double filter with an
// error bound that covers the rounded approximation of constructed points, then
// BigInt. Coplanar overlapping triangles share one 2D triangulation, so their
// common pieces are identical triangles and opposed copies cancel.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {closestTrianglePoint} from './mesh-spatial.mjs';
import {separatedTriangles} from './mesh.mjs';

const babs=x=>x<0n?-x:x,bsign=x=>x>0n?1:x<0n?-1:0;
function gcd(a,b){a=babs(a);b=babs(b);while(b){const r=a%b;a=b;b=r;}return a;}
export const COUNT={nodes:0,items:0};const llround=x=>x<0?-Math.round(-x):Math.round(x);
const logStart=performance.now(),log=process.env.AUTOREFINE_LOG?m=>console.error(`${((performance.now()-logStart)/1000).toFixed(2)}s ${m}`):()=>{};

// Packed AABB hierarchy over boxes [minx,miny,minz,maxx,maxy,maxz] per item.
function bvh(boxes,count){
  const order=Uint32Array.from({length:count},(_,i)=>i),nb=[],nf=[],nc=[],nl=[],nr=[];
  function build(first,n){
    const id=nf.length,b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(let i=first;i<first+n;i++){const o=order[i]*6;for(let k=0;k<3;k++){if(boxes[o+k]<b[k])b[k]=boxes[o+k];if(boxes[o+3+k]>b[3+k])b[3+k]=boxes[o+3+k];}}
    nb.push(...b);nf.push(first);nc.push(n);nl.push(-1);nr.push(-1);if(n<=8)return id;
    let axis=0;for(let k=1;k<3;k++)if(b[3+k]-b[k]>b[3+axis]-b[axis])axis=k;
    const h=n>>1,key=x=>boxes[x*6+axis]+boxes[x*6+3+axis];
    // nth_element: the first h items have keys at most the rest.
    let lo=first,hi=first+n-1;const nth=first+h;
    while(lo<hi){const pivot=key(order[(lo+hi)>>1]);let i=lo,j=hi;
      while(i<=j){while(key(order[i])<pivot)i++;while(key(order[j])>pivot)j--;if(i<=j){const s=order[i];order[i]=order[j];order[j]=s;i++;j--;}}
      if(nth<=j)hi=j;else if(nth>=i)lo=i;else break;}
    const l=build(first,h),r=build(first+h,n-h);nl[id]=l;nr[id]=r;nc[id]=0;return id;
  }
  if(count)build(0,count);
  function queryBox(b,visit){const stack=count?[0]:[];while(stack.length){const n=stack.pop(),o=n*6;COUNT.nodes++;
    if(b[0]>nb[o+3]||b[3]<nb[o]||b[1]>nb[o+4]||b[4]<nb[o+1]||b[2]>nb[o+5]||b[5]<nb[o+2])continue;
    if(nl[n]<0){for(let j=nf[n],e=j+nc[n];j<e;j++)visit(order[j]);}else stack.push(nl[n],nr[n]);}}
  function querySegment(a,c,margin,visit){const stack=count?[0]:[];while(stack.length){const n=stack.pop();
    if(!segmentMeetsBox(a,c,nb,n*6,margin))continue;
    if(nl[n]<0){for(let j=nf[n],e=j+nc[n];j<e;j++)visit(order[j]);}else stack.push(nl[n],nr[n]);}}
  return {queryBox,querySegment};
}
// Every pair i<j of overlapping (closed) boxes. Boxes far larger than typical
// (cut caps) would inflate every node above them; they query the hierarchy of the
// others and meet each other directly.
function overlappingPairs(boxes,n,visit){
  const diag=new Float64Array(n);for(let t=0;t<n;t++){const o=6*t;diag[t]=boxes[o+3]-boxes[o]+boxes[o+4]-boxes[o+1]+boxes[o+5]-boxes[o+2];}
  const bigLimit=16*Float64Array.from(diag).sort()[n>>1],small=[],big=[];for(let t=0;t<n;t++)(diag[t]>bigLimit?big:small).push(t);
  const smallBoxes=new Float64Array(small.length*6);small.forEach((t,k)=>smallBoxes.set(boxes.subarray(6*t,6*t+6),6*k));
  const tree=bvh(smallBoxes,small.length);log(`pairs: ${big.length} large of ${n}`);
  const test=(i,j)=>{const bi=6*i,bj=6*j;if(boxes[bi]>boxes[bj+3]||boxes[bj]>boxes[bi+3]||boxes[bi+1]>boxes[bj+4]||boxes[bj+1]>boxes[bi+4]||boxes[bi+2]>boxes[bj+5]||boxes[bj+2]>boxes[bi+5])return;visit(i,j);};
  for(const i of small)tree.queryBox(boxes.subarray(6*i,6*i+6),k=>{const j=small[k];if(j>i)test(i,j);});
  for(const b of big){tree.queryBox(boxes.subarray(6*b,6*b+6),k=>{const j=small[k];test(Math.min(b,j),Math.max(b,j));});for(const c of big)if(c>b)test(b,c);}
}
function segmentMeetsBox(a,b,box,o,margin){
  let lo=0,hi=1;
  for(let k=0;k<3;k++){const d=b[k]-a[k],min=box[o+k]-margin,max=box[o+3+k]+margin;
    if(d===0){if(a[k]<min||a[k]>max)return false;continue;}
    let t0=(min-a[k])/d,t1=(max-a[k])/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false;}
  return true;
}

// ---------------- exact point store and predicates ----------------
function createStore(vertices){
  const px=[],py=[],pz=[],pd=[],X=[],Y=[],Z=[],W=[],keys=new Map(),stats={exact3:0,exact2:0,filtered3:0,filtered2:0,constructed:0};
  const lattice=v=>{let x=v,s=0;while(!Number.isInteger(x)){x*=2;s++;}return [x,s];};
  let S=0;for(const p of vertices){for(const v of p){const s=lattice(v)[1];if(s>S)S=s;}px.push(p[0]);py.push(p[1]);pz.push(p[2]);pd.push(0);}
  const SB=BigInt(S),scale=2**S,big=v=>{const [x,s]=lattice(v);return BigInt(x)<<BigInt(S-s);};
  const exact=i=>{if(W[i]===undefined){X[i]=big(px[i]);Y[i]=big(py[i]);Z[i]=big(pz[i]);W[i]=1n;}};
  const approx=(v,w)=>Number((v<<64n)/w)/18446744073709551616/scale;
  function push(x,y,z,w){const i=px.length;X[i]=x;Y[i]=y;Z[i]=z;W[i]=w;const a=approx(x,w),b=approx(y,w),c=approx(z,w);
    px.push(a);py.push(b);pz.push(c);pd.push(Math.max(Math.abs(a),Math.abs(b),Math.abs(c))*2**-50+2**-(60+S));return i;}
  const store={px,py,pz,pd,X,Y,Z,W,S,stats,exact,
    // Input vertices that constructed points may coincide with.
    register(i){exact(i);const k=`${X[i]},${Y[i]},${Z[i]},1`;if(!keys.has(k))keys.set(k,i);},
    add(x,y,z,w){if(w<0n){x=-x;y=-y;z=-z;w=-w;}if(w===0n)throw Error('Degenerate construction');const g=gcd(gcd(gcd(x,y),z),w);if(g>1n){x/=g;y/=g;z/=g;w/=g;}
      const k=`${x},${y},${z},${w}`,known=keys.get(k);if(known!==undefined)return known;stats.constructed++;const i=push(x,y,z,w);keys.set(k,i);return i;},
    // A temporary or lattice point that is never shared (ray ends, super vertices).
    raw(x,y,z,w=1n){if(w<0n){x=-x;y=-y;z=-z;w=-w;}return push(x,y,z,w);},
    integerPoint(p){return store.raw(BigInt(p[0])<<SB,BigInt(p[1])<<SB,BigInt(p[2])<<SB,1n);},
  };
  function exact3(a,b,c,d){
    stats.exact3++;exact(a);exact(b);exact(c);exact(d);
    if(W[a]===1n&&W[b]===1n&&W[c]===1n&&W[d]===1n){
      const ux=X[b]-X[a],uy=Y[b]-Y[a],uz=Z[b]-Z[a],vx=X[c]-X[a],vy=Y[c]-Y[a],vz=Z[c]-Z[a],wx=X[d]-X[a],wy=Y[d]-Y[a],wz=Z[d]-Z[a];
      return bsign(ux*(vy*wz-vz*wy)+uy*(vz*wx-vx*wz)+uz*(vx*wy-vy*wx));
    }
    const r=[a,b,c,d].map(i=>[X[i],Y[i],Z[i],W[i]]),m=(p,q,i,j)=>p[i]*q[j]-p[j]*q[i];
    const det=m(r[0],r[1],0,1)*m(r[2],r[3],2,3)-m(r[0],r[1],0,2)*m(r[2],r[3],1,3)+m(r[0],r[1],0,3)*m(r[2],r[3],1,2)
      +m(r[0],r[1],1,2)*m(r[2],r[3],0,3)-m(r[0],r[1],1,3)*m(r[2],r[3],0,2)+m(r[0],r[1],2,3)*m(r[2],r[3],0,1);
    return -bsign(det);
  }
  // sign of det(b-a, c-a, d-a) (CGAL::orientation(a,b,c,d)).
  store.orient3d=function(a,b,c,d){
    if(a===b||a===c||a===d||b===c||b===d||c===d)return 0;
    const ax=px[a],ay=py[a],az=pz[a],ux=px[b]-ax,uy=py[b]-ay,uz=pz[b]-az,vx=px[c]-ax,vy=py[c]-ay,vz=pz[c]-az,wx=px[d]-ax,wy=py[d]-ay,wz=pz[d]-az;
    const m1=vy*wz,m2=vz*wy,m3=vz*wx,m4=vx*wz,m5=vx*wy,m6=vy*wx,det=ux*(m1-m2)+uy*(m3-m4)+uz*(m5-m6);
    let bound=1e-15*(Math.abs(ux)*(Math.abs(m1)+Math.abs(m2))+Math.abs(uy)*(Math.abs(m3)+Math.abs(m4))+Math.abs(uz)*(Math.abs(m5)+Math.abs(m6)));
    const del=Math.max(pd[a],pd[b],pd[c],pd[d]);
    if(del>0){const lu=Math.abs(ux)+Math.abs(uy)+Math.abs(uz),lv=Math.abs(vx)+Math.abs(vy)+Math.abs(vz),lw=Math.abs(wx)+Math.abs(wy)+Math.abs(wz);bound+=8*del*(lu*lv+lv*lw+lu*lw)+24*del*del*(lu+lv+lw)+64*del*del*del;}
    if(det>bound){stats.filtered3++;return 1;}if(det<-bound){stats.filtered3++;return -1;}
    return exact3(a,b,c,d);
  };
  // 2D orientation in the plane that drops axis k, coordinates (k+1, k+2).
  store.orient2dAxis=[0,1,2].map(k=>{
    const U=[px,py,pz][(k+1)%3],V=[px,py,pz][(k+2)%3],XU=[X,Y,Z][(k+1)%3],XV=[X,Y,Z][(k+2)%3];
    return (a,b,c)=>{
      if(a===b||b===c||a===c)return 0;
      const ax=U[a],ay=V[a],bx=U[b]-ax,by=V[b]-ay,cx=U[c]-ax,cy=V[c]-ay,l=bx*cy,r=by*cx,det=l-r;
      let bound=1e-15*(Math.abs(l)+Math.abs(r));const del=Math.max(pd[a],pd[b],pd[c]);
      if(del>0)bound+=4*del*(Math.abs(bx)+Math.abs(by)+Math.abs(cx)+Math.abs(cy))+16*del*del;
      if(det>bound){stats.filtered2++;return 1;}if(det<-bound){stats.filtered2++;return -1;}
      stats.exact2++;exact(a);exact(b);exact(c);
      if(W[a]===1n&&W[b]===1n&&W[c]===1n)return bsign((XU[b]-XU[a])*(XV[c]-XV[a])-(XV[b]-XV[a])*(XU[c]-XU[a]));
      const au=XU[a],av=XV[a],aw=W[a],bu=XU[b],bv=XV[b],bw=W[b],cu=XU[c],cv=XV[c],cw=W[c];
      return bsign(au*(bv*cw-bw*cv)-av*(bu*cw-bw*cu)+aw*(bu*cv-bv*cu));
    };
  });
  // Exact comparison of one coordinate (array A of X/Y/Z) of two points.
  store.compareCoordinate=(A,p,q)=>{exact(p);exact(q);return bsign(A[p]*W[q]-A[q]*W[p]);};
  return store;
}

// ---------------- constructions from input primitives ----------------
function createConstructions(store,vertices,triangles){
  const {X,Y,Z,W}=store,planes=new Map(),cache=new Map();
  function plane(t){let p=planes.get(t);if(p)return p;const [a,b,c]=triangles[t];store.exact(a);store.exact(b);store.exact(c);
    const ux=X[b]-X[a],uy=Y[b]-Y[a],uz=Z[b]-Z[a],vx=X[c]-X[a],vy=Y[c]-Y[a],vz=Z[c]-Z[a],n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    p={n,d:n[0]*X[a]+n[1]*Y[a]+n[2]*Z[a]};planes.set(t,p);return p;}
  function axis(t){const n=plane(t).n.map(babs);return n[0]>=n[1]&&n[0]>=n[2]?0:n[1]>=n[2]?1:2;}
  // Edge uv (input vertices) meets the plane of triangle f.
  function edgeFace(u,v,f){const key=`e${Math.min(u,v)},${Math.max(u,v)}f${f}`;let id=cache.get(key);if(id!==undefined)return id;
    const {n,d}=plane(f);store.exact(u);store.exact(v);const ou=n[0]*X[u]+n[1]*Y[u]+n[2]*Z[u]-d,ov=n[0]*X[v]+n[1]*Y[v]+n[2]*Z[v]-d;
    const p=edgeFaceRaw(u,v,f);id=store.add(p.X,p.Y,p.Z,p.W);cache.set(key,id);return id;}
  function edgeFaceRaw(u,v,f){const {n,d}=plane(f);store.exact(u);store.exact(v);const ou=n[0]*X[u]+n[1]*Y[u]+n[2]*Z[u]-d,ov=n[0]*X[v]+n[1]*Y[v]+n[2]*Z[v]-d,s=ou-ov<0n?-1n:1n;
    return {u,v,f,X:s*(ou*X[v]-ov*X[u]),Y:s*(ou*Y[v]-ov*Y[u]),Z:s*(ou*Z[v]-ov*Z[u]),W:s*(ou-ov)};}
  // Three planes meet.
  function threePlanes(a,b,c){const s=[a,b,c].sort((x,y)=>x-y),key=`f${s}`;let id=cache.get(key);if(id!==undefined)return id;
    const [p,q,r]=s.map(plane),det=(m)=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const rows=[p,q,r],w=det(rows.map(x=>x.n)),col=k=>det(rows.map(x=>x.n.map((v,j)=>j===k?x.d:v)));
    id=store.add(col(0),col(1),col(2),w);cache.set(key,id);return id;}
  // Two coplanar edges uv, wx cross (2D, dropping axis k).
  function twoEdges(u,v,w,x,k){const e1=[Math.min(u,v),Math.max(u,v)],e2=[Math.min(w,x),Math.max(w,x)],key=`x${e1<e2?[e1,e2]:[e2,e1]}`;let id=cache.get(key);if(id!==undefined)return id;
    for(const i of [u,v,w,x])store.exact(i);const A=[X,Y,Z][(k+1)%3],B=[X,Y,Z][(k+2)%3],c2=(p0,p1,q0,q1)=>p0*q1-p1*q0;
    const num=c2(A[w]-A[u],B[w]-B[u],A[x]-A[w],B[x]-B[w]),den=c2(A[v]-A[u],B[v]-B[u],A[x]-A[w],B[x]-B[w]);
    id=store.add(X[u]*den+(X[v]-X[u])*num,Y[u]*den+(Y[v]-Y[u])*num,Z[u]*den+(Z[v]-Z[u])*num,den);cache.set(key,id);return id;}
  return {plane,axis,edgeFace,edgeFaceRaw,threePlanes,twoEdges};
}

// ---------------- pairwise intersections ----------------
// Per triangle: segments {a,b,line} with line {plane:t} or {edge:[u,v]}, isolated
// points, and coplanar overlap groups (union-find).
function intersectAll(store,vertices,triangles,build,{stopAtFirst=false,dirty=null}={}){
  const n=triangles.length,{px,py,pz,orient3d}=store,boxes=new Float64Array(n*6);
  for(let t=0;t<n;t++){const [a,b,c]=triangles[t];boxes.set([Math.min(px[a],px[b],px[c]),Math.min(py[a],py[b],py[c]),Math.min(pz[a],pz[b],pz[c]),Math.max(px[a],px[b],px[c]),Math.max(py[a],py[b],py[c]),Math.max(pz[a],pz[b],pz[c])],t*6);}
  // Double planes of input triangles: det = n.(p-a) with |error| <= 2e-15 |u|1 |v|1 |p-a|1, else orient3d.
  const plane=new Float64Array(n*4);
  for(let t=0;t<n;t++){const [a,b,c]=triangles[t],ux=px[b]-px[a],uy=py[b]-py[a],uz=pz[b]-pz[a],vx=px[c]-px[a],vy=py[c]-py[a],vz=pz[c]-pz[a];
    plane[4*t]=uy*vz-uz*vy;plane[4*t+1]=uz*vx-ux*vz;plane[4*t+2]=ux*vy-uy*vx;plane[4*t+3]=2e-15*(Math.abs(ux)+Math.abs(uy)+Math.abs(uz))*(Math.abs(vx)+Math.abs(vy)+Math.abs(vz));}
  const side=(t,p)=>{const T=triangles[t],a=T[0];if(p===a||p===T[1]||p===T[2])return 0;const wx=px[p]-px[a],wy=py[p]-py[a],wz=pz[p]-pz[a],o=4*t,det=plane[o]*wx+plane[o+1]*wy+plane[o+2]*wz,bound=plane[o+3]*(Math.abs(wx)+Math.abs(wy)+Math.abs(wz));
    return det>bound?1:det<-bound?-1:orient3d(a,T[1],T[2],p);};
  const candidates=[];overlappingPairs(boxes,n,test);
  function test(i,j){if(dirty&&!dirty[i]&&!dirty[j])return;const A=triangles[i];
      const B=triangles[j],a0=A[0],a1=A[1],a2=A[2],b0=B[0],b1=B[1],b2=B[2];
      const s0=side(i,b0),s1=side(i,b1),s2=side(i,b2);
      if((s0>0&&s1>0&&s2>0)||(s0<0&&s1<0&&s2<0))return;
      const r0=side(j,a0),r1=side(j,a1),r2=side(j,a2);
      if((r0>0&&r1>0&&r2>0)||(r0<0&&r1<0&&r2<0))return;
      const coplanar=s0===0&&s1===0&&s2===0;
      if(!coplanar){
        // Non-shared vertices strictly on one side of the other plane: the pair meets only in shared vertices.
        const inA=v=>v===a0||v===a1||v===a2,inB=v=>v===b0||v===b1||v===b2,shared=(inB(a0)?1:0)+(inB(a1)?1:0)+(inB(a2)?1:0);
        if(shared===2)return;
        if(shared===1){let pa=1,pb=1;if(!inB(a0))pa*=r0;if(!inB(a1))pa*=r1;if(!inB(a2))pa*=r2;if(!inA(b0))pb*=s0;if(!inA(b1))pb*=s1;if(!inA(b2))pb*=s2;if(pa>0||pb>0)return;}}
      candidates.push(i,j,coplanar?1:0);
  }
  log(`candidates ${candidates.length/3} ${JSON.stringify(COUNT)}`);
  if(!stopAtFirst)for(let c=0;c<candidates.length;c+=3)for(const t of [candidates[c],candidates[c+1]])for(const v of triangles[t])store.register(v);
  log('registered');
  const segs=new Map(),points=new Map(),parent=new Map(),stats={candidatePairs:candidates.length/3,segmentPairs:0,pointPairs:0,coplanarOverlaps:0,coplanarTouches:0};
  const root=x=>{let r=x;while(parent.has(r)&&parent.get(r)!==r)r=parent.get(r);return r;};
  const addSeg=(t,s)=>{const l=segs.get(t);if(l)l.push(s);else segs.set(t,[s]);},addPoint=(t,p)=>{if(triangles[t].includes(p))return;const l=points.get(t);if(l)l.push(p);else points.set(t,[p]);};
  const {X,Y,Z,W}=store;
  for(let c=0;c<candidates.length;c+=3){
    const i=candidates[c],j=candidates[c+1],A=triangles[i],B=triangles[j];
    if(candidates[c+2]){
      const k=build.axis(i),o=store.orient2dAxis[k],sa=o(...A),sb=o(...B);
      const separated=(P,sp,Q)=>{for(let e=0;e<3;e++){if(Q.every(v=>o(P[e],P[(e+1)%3],v)*sp<=0))return true;}return false;};
      if(!separated(A,sa,B)&&!separated(B,sb,A)){if(stopAtFirst)return {any:true};stats.coplanarOverlaps++;const ri=root(i),rj=root(j);if(ri!==rj){parent.set(ri,rj);if(!parent.has(rj))parent.set(rj,rj);}continue;}
      const inside=(p,T,s)=>[0,1,2].every(e=>o(T[e],T[(e+1)%3],p)*s>=0);let touched=false;
      for(const v of B)if(!A.includes(v)&&inside(v,A,sa)){addPoint(i,v);touched=true;}
      for(const v of A)if(!B.includes(v)&&inside(v,B,sb)){addPoint(j,v);touched=true;}
      if(touched){if(stopAtFirst)return {any:true};stats.coplanarTouches++;}continue;
    }
    const sB=B.map(v=>orient3d(A[0],A[1],A[2],v)),sA=A.map(v=>orient3d(B[0],B[1],B[2],v));
    // Candidate endpoints stay unregistered until they bound the result.
    const cut=(T,s,f)=>{const out=[];for(let k=0;k<3;k++){if(s[k]===0){store.exact(T[k]);out.push({id:T[k],X:X[T[k]],Y:Y[T[k]],Z:Z[T[k]],W:1n});}const m=(k+1)%3;if(s[k]*s[m]<0)out.push(build.edgeFaceRaw(T[k],T[m],f));}return out;};
    const pa=cut(A,sA,j),pb=cut(B,sB,i);if(!pa.length||!pb.length)continue;
    const na=build.plane(i).n,nb=build.plane(j).n,d=[na[1]*nb[2]-na[2]*nb[1],na[2]*nb[0]-na[0]*nb[2],na[0]*nb[1]-na[1]*nb[0]];
    const f=p=>d[0]*p.X+d[1]*p.Y+d[2]*p.Z,cmp=(p,q)=>{if(p===q||(p.id!==undefined&&p.id===q.id))return 0;const l=f(p)*q.W,r=f(q)*p.W;return l<r?-1:l>r?1:0;};
    pa.sort(cmp);pb.sort(cmp);const a0=pa[0],a1=pa[pa.length-1],b0=pb[0],b1=pb[pb.length-1];
    const lo=cmp(a0,b0)>=0?a0:b0,hi=cmp(a1,b1)<=0?a1:b1,order=cmp(lo,hi);
    if(order>0)continue;
    const id=p=>p.id??build.edgeFace(p.u,p.v,p.f);
    if(order===0){if(stopAtFirst){if(lo.id!==undefined&&A.includes(lo.id)&&B.includes(lo.id))continue;return {any:true};}const p=id(lo);if(A.includes(p)&&B.includes(p))continue;addPoint(i,p);addPoint(j,p);stats.pointPairs++;continue;}
    if(stopAtFirst)return {any:true};const a=id(lo),b=id(hi);addSeg(i,{a,b,line:{plane:j}});addSeg(j,{a,b,line:{plane:i}});stats.segmentPairs++;
  }
  return {segs,points,parent,root,stats};
}

// ---------------- 2D constrained triangulation of one plane group ----------------
// members: coplanar input triangles (one, or several overlapping). Returns refined
// 3D triangles (global point ids), each oriented as the member that contains it.
function triangulateGroup(store,triangles,build,members,segs,points,superPoints,stats){
  const G=members[0],k=build.axis(G),o=store.orient2dAxis[k],{pd}=store,U=[store.px,store.py,store.pz][(k+1)%3],V=[store.px,store.py,store.pz][(k+2)%3];
  const cons=[],seen=new Set(),pset=new Set();
  const addCons=(a,b,line)=>{if(a===b)return;const key=a<b?`${a},${b}`:`${b},${a}`;if(seen.has(key))return;seen.add(key);cons.push({a,b,line});pset.add(a);pset.add(b);};
  for(const m of members){const t=triangles[m];for(let e=0;e<3;e++)addCons(t[e],t[(e+1)%3],{edge:[t[e],t[(e+1)%3]]});
    for(const s of segs.get(m)??[])addCons(s.a,s.b,s.line);for(const p of points.get(m)??[])pset.add(p);}
  const box=(a,b)=>{const m=Math.max(pd[a],pd[b])+1e-300;return [Math.min(U[a],U[b])-m,Math.min(V[a],V[b])-m,Math.max(U[a],U[b])+m,Math.max(V[a],V[b])+m];};
  for(const c of cons)c.box=box(c.a,c.b);
  // Proper crossings become points defined by the two lines.
  for(let x=0;x<cons.length;x++)for(let y=x+1;y<cons.length;y++){const c1=cons[x],c2=cons[y],b1=c1.box,b2=c2.box;
    if(b1[0]>b2[2]||b2[0]>b1[2]||b1[1]>b2[3]||b2[1]>b1[3])continue;
    if(c1.a===c2.a||c1.a===c2.b||c1.b===c2.a||c1.b===c2.b)continue;
    const o1=o(c1.a,c1.b,c2.a),o2=o(c1.a,c1.b,c2.b);if(o1*o2>=0)continue;
    const o3=o(c2.a,c2.b,c1.a),o4=o(c2.a,c2.b,c1.b);if(o3*o4>=0)continue;
    const l1=c1.line,l2=c2.line;let p;
    if(l1.plane!==undefined&&l2.plane!==undefined)p=build.threePlanes(G,l1.plane,l2.plane);
    else if(l1.plane!==undefined)p=build.edgeFace(l2.edge[0],l2.edge[1],l1.plane);
    else if(l2.plane!==undefined)p=build.edgeFace(l1.edge[0],l1.edge[1],l2.plane);
    else p=build.twoEdges(l1.edge[0],l1.edge[1],l2.edge[0],l2.edge[1],k);
    pset.add(p);stats.crossings++;
  }
  const pts=[...pset];
  // Split constraints at the points on them (collinear overlaps, T-junctions).
  const sub=[];
  for(const c of cons){const b=c.box,on=[];
    for(const p of pts){if(p===c.a||p===c.b||U[p]<b[0]||U[p]>b[2]||V[p]<b[1]||V[p]>b[3])continue;if(o(c.a,c.b,p)!==0)continue;on.push(p);}
    if(!on.length){sub.push([c.a,c.b]);continue;}
    const A=store.compareCoordinate([store.X,store.Y,store.Z][(k+1)%3],c.a,c.b)!==0?[store.X,store.Y,store.Z][(k+1)%3]:[store.X,store.Y,store.Z][(k+2)%3];
    const dir=store.compareCoordinate(A,c.a,c.b);
    const between=on.filter(p=>store.compareCoordinate(A,c.a,p)===dir&&store.compareCoordinate(A,p,c.b)===dir).sort((p,q)=>-store.compareCoordinate(A,p,q)*dir);
    let prev=c.a;for(const p of between){sub.push([prev,p]);prev=p;}sub.push([prev,c.b]);
  }
  // Incremental triangulation inside a super triangle; half-edge map a*K+b -> triangle.
  const gid=[...superPoints[k],...pts],local=new Map(gid.map((g,i)=>[g,i])),K=2**21,T=[],he=new Map(),vt=[];
  const og=(a,b,c)=>o(gid[a],gid[b],gid[c]);
  const addTri=(a,b,c)=>{const t=T.length;T.push([a,b,c]);he.set(a*K+b,t);he.set(b*K+c,t);he.set(c*K+a,t);vt[a]=vt[b]=vt[c]=t;return t;};
  const delTri=t=>{const [a,b,c]=T[t];for(const key of [a*K+b,b*K+c,c*K+a])if(he.get(key)===t)he.delete(key);T[t]=null;};
  addTri(0,1,2);let last=0,seed=12345;const rand=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  for(let p=3;p<gid.length;p++){
    let t=last;for(let steps=0;;steps++){if(steps>1e6)throw Error('Point location does not terminate');const tri=T[t],r=Math.floor(rand()*3);let moved=false;
      for(let e=0;e<3;e++){const u=tri[(r+e)%3],v=tri[(r+e+1)%3];if(og(u,v,p)<0){t=he.get(v*K+u);moved=true;break;}}if(!moved)break;}
    const [a,b,c]=T[t],s=[og(a,b,p),og(b,c,p),og(c,a,p)],zeros=s.filter(x=>x===0).length;
    if(zeros>1)throw Error('Duplicate point in triangulation');
    if(zeros===0){delTri(t);addTri(a,b,p);addTri(b,c,p);last=addTri(c,a,p);continue;}
    const e=s.indexOf(0),u=T[t][e],v=T[t][(e+1)%3],w=T[t][(e+2)%3],nt=he.get(v*K+u),x=T[nt].find(q=>q!==u&&q!==v);
    delTri(t);delTri(nt);addTri(u,p,w);addTri(p,v,w);addTri(v,p,x);last=addTri(p,u,x);
  }
  const triangulate=poly=>{poly=[...poly];
    while(poly.length>3){let found=false;
      for(let i=0;i<poly.length&&!found;i++){const p=poly[(i+poly.length-1)%poly.length],c=poly[i],q=poly[(i+1)%poly.length];
        if(og(p,c,q)<=0)continue;
        if(poly.some(r=>r!==p&&r!==c&&r!==q&&og(p,c,r)>=0&&og(c,q,r)>=0&&og(q,p,r)>=0))continue;
        addTri(p,c,q);poly.splice(i,1);found=true;}
      if(!found)throw Error('Cavity polygon has no ear');}
    if(og(poly[0],poly[1],poly[2])<=0)throw Error('Degenerate cavity triangle');addTri(poly[0],poly[1],poly[2]);};
  for(const [ga,gb] of sub){const a=local.get(ga),b=local.get(gb);
    if(he.has(a*K+b)||he.has(b*K+a))continue;
    let t=vt[a],start=null;for(let steps=0;steps<100000;steps++){const tri=T[t],i=tri.indexOf(a),x=tri[(i+1)%3],y=tri[(i+2)%3];
      if(og(a,x,b)>0&&og(a,y,b)<0){start=[t,x,y];break;}t=he.get(a*K+y);}
    if(!start){const P=i=>[store.px[gid[i]],store.py[gid[i]],store.pz[gid[i]]].map(v=>+v.toFixed(4)).join(' ');
      const fan=[];let t=vt[a];for(let s=0;s<20;s++){const tri=T[t];if(!tri){fan.push('dead');break;}const i=tri.indexOf(a);fan.push(`[${P(tri[(i+1)%3])}|${P(tri[(i+2)%3])}] ${og(a,tri[(i+1)%3],b)},${og(a,tri[(i+2)%3],b)}`);t=he.get(a*K+tri[(i+2)%3]);if(t===vt[a])break;}
      throw Error(`Constraint start not found: a=${P(a)} b=${P(b)} k=${k} members=${members} fan=${fan.join(' ; ')}`);}
    let [t0,v,u]=start;const L=[a,u],R=[a,v];delTri(t0);
    for(let steps=0;;steps++){if(steps>1e6)throw Error('Constraint walk does not terminate');const nt=he.get(u*K+v),w=T[nt].find(q=>q!==u&&q!==v);delTri(nt);
      if(w===b)break;const s=og(a,b,w);if(s===0)throw Error('Vertex on constraint');if(s>0){L.push(w);u=w;}else{R.push(w);v=w;}}
    triangulate([a,b,...L.slice(1).reverse()]);triangulate([...R,b]);
  }
  // Each triangle belongs to every member containing its three corners.
  const info=members.map(m=>{const t=triangles[m],s=o(...t),e=s>0?t:[t[0],t[2],t[1]];return {m,s,e,box:[Math.min(...t.map(v=>U[v])),Math.min(...t.map(v=>V[v])),Math.max(...t.map(v=>U[v])),Math.max(...t.map(v=>V[v]))]};});
  const out=[];
  for(const tri of T){if(!tri||tri[0]<3||tri[1]<3||tri[2]<3)continue;const g=tri.map(i=>gid[i]);
    const lo=[Math.min(...g.map(v=>U[v])),Math.min(...g.map(v=>V[v]))],hi=[Math.max(...g.map(v=>U[v])),Math.max(...g.map(v=>V[v]))];
    for(const {m,s,e,box} of info){if(lo[0]>box[2]+1e-9||hi[0]<box[0]-1e-9||lo[1]>box[3]+1e-9||hi[1]<box[1]-1e-9)continue;
      if(g.every(p=>o(e[0],e[1],p)>=0&&o(e[1],e[2],p)>=0&&o(e[2],e[0],p)>=0))out.push({t:s>0?g:[g[0],g[2],g[1]],source:m});}
  }
  return out;
}

// ---------------- closing opposed sheets (port of closeOpposedSheets) ----------------
function segSeg2(p1,q1,p2,q2){
  const d1=[0,1,2].map(k=>q1[k]-p1[k]),d2=[0,1,2].map(k=>q2[k]-p2[k]),r=[0,1,2].map(k=>p1[k]-p2[k]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const a=dot(d1,d1),e=dot(d2,d2),f=dot(d2,r);let s,t;
  if(a<=1e-300&&e<=1e-300){s=t=0;}else if(a<=1e-300){s=0;t=Math.min(1,Math.max(0,f/e));}
  else{const c=dot(d1,r);if(e<=1e-300){t=0;s=Math.min(1,Math.max(0,-c/a));}else{const b=dot(d1,d2),den=a*e-b*b;s=den>0?Math.min(1,Math.max(0,(b*f-c*e)/den)):0;t=(b*s+f)/e;
    if(t<0){t=0;s=Math.min(1,Math.max(0,-c/a));}else if(t>1){t=1;s=Math.min(1,Math.max(0,(b-c)/a));}}}
  const x=[0,1,2].map(k=>p1[k]+d1[k]*s-p2[k]-d2[k]*t);return dot(x,x);
}
function triangleDistance2(A,B){
  if(!separatedTriangles(A,B))return 0;let d=Infinity;
  for(const [P,Q] of [[A,B],[B,A]])for(const p of P){const q=closestTrianglePoint(p,...Q);d=Math.min(d,(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2);}
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)d=Math.min(d,segSeg2(A[i],A[(i+1)%3],B[j],B[(j+1)%3]));return d;
}
export function closeOpposedSheets(vertices,triangles,closeMm){
  const out={method:'opposed-sheet-plane/1',toleranceMm:closeMm,groups:0,faces:0,movedVertices:0,unmovedVertices:0,maxDisplacementMm:0},points=vertices.map(p=>[...p]);
  if(!(closeMm>0))return {points,closing:out};
  const n=triangles.length,normal=new Float64Array(3*n),area=new Float64Array(n),boxes=new Float64Array(6*n),incident=vertices.map(()=>[]);
  for(let f=0;f<n;f++){const [a,b,c]=triangles[f].map(i=>vertices[i]),u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const x=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...x);normal.set(l>0?x.map(q=>q/l):x,3*f);area[f]=l/2;
    for(let k=0;k<3;k++){boxes[6*f+k]=Math.min(a[k],b[k],c[k])-closeMm;boxes[6*f+3+k]=Math.max(a[k],b[k],c[k])+closeMm;}
    for(const i of triangles[f])incident[i].push(f);}
  const N=f=>normal.subarray(3*f,3*f+3),dot=(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2];
  const withinPlane=(f,g)=>{for(const [p,q] of [[f,g],[g,f]]){const np=N(p),o=vertices[triangles[p][0]];for(const v of triangles[q]){const x=vertices[v];if(Math.abs(np[0]*(x[0]-o[0])+np[1]*(x[1]-o[1])+np[2]*(x[2]-o[2]))>closeMm)return false;}}return true;};
  const parent=Int32Array.from({length:n},(_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;},seeded=new Uint8Array(n);
  overlappingPairs(boxes,n,(f,g)=>{
    if(normal[3*f]*normal[3*g]+normal[3*f+1]*normal[3*g+1]+normal[3*f+2]*normal[3*g+2]>=0)return;const T=triangles[f],S=triangles[g];if(T[0]===S[0]||T[0]===S[1]||T[0]===S[2]||T[1]===S[0]||T[1]===S[1]||T[1]===S[2]||T[2]===S[0]||T[2]===S[1]||T[2]===S[2])return;
    if(!withinPlane(f,g)||triangleDistance2(triangles[f].map(i=>vertices[i]),triangles[g].map(i=>vertices[i]))>closeMm*closeMm)return;
    parent[root(f)]=root(g);seeded[f]=seeded[g]=1;});
  for(const faces of incident)for(let a=0;a<faces.length;a++)for(let b=a+1;b<faces.length;b++)
    if(seeded[faces[a]]&&seeded[faces[b]]&&withinPlane(faces[a],faces[b]))parent[root(faces[a])]=root(faces[b]);
  const groups=new Map(),groupArea=new Map();
  for(let f=0;f<n;f++)if(seeded[f]){const r=root(f);if(!groups.has(r)){groups.set(r,[]);groupArea.set(r,0);}groups.get(r).push(f);groupArea.set(r,groupArea.get(r)+area[f]);}
  const order=[...groups.keys()].sort((a,b)=>groupArea.get(a)!==groupArea.get(b)?groupArea.get(b)-groupArea.get(a):a-b);
  const owner=new Int32Array(n).fill(-1),planes=[];
  let reach=0;for(const p of vertices)for(const v of p)reach=Math.max(reach,Math.abs(v));
  const e=reach>0?Math.floor(Math.log2(reach))+1:0,q=e+5+Math.ceil(Math.log2(1/closeMm)),grid=50-e-q;
  for(const r of order){const members=groups.get(r);let best=members[0];for(const f of members)if(area[f]>area[best])best=f;
    const sum=[0,0,0],centre=[0,0,0];let weight=0;
    for(const f of members){const w=dot(N(f),N(best))>=0?area[f]:-area[f];for(let k=0;k<3;k++){sum[k]+=w*N(f)[k];centre[k]+=area[f]*(vertices[triangles[f][0]][k]+vertices[triangles[f][1]][k]+vertices[triangles[f][2]][k])/3;}weight+=area[f];}
    const len=Math.hypot(...sum),unit=sum.map(v=>v/len),at=centre.map(v=>v/weight);
    const a=Math.abs(unit[0])>=Math.abs(unit[1])&&Math.abs(unit[0])>=Math.abs(unit[2])?0:Math.abs(unit[1])>=Math.abs(unit[2])?1:2,i=(a+1)%3,j=(a+2)%3;
    const si=llround(-unit[i]/unit[a]*2**q),sj=llround(-unit[j]/unit[a]*2**q),t=llround((at[a]-si*2**-q*at[i]-sj*2**-q*at[j])*2**(grid+q));
    const kIndex=planes.length;planes.push({k:a,i,j,si,sj,t});
    const near=g=>triangles[g].every(v=>{const x=vertices[v];return Math.abs(unit[0]*(x[0]-at[0])+unit[1]*(x[1]-at[1])+unit[2]*(x[2]-at[2]))<=closeMm;});
    const queue=[];for(const f of members)if(owner[f]<0&&near(f)){owner[f]=kIndex;queue.push(f);}
    if(!queue.length)continue;out.groups++;
    while(queue.length){const f=queue.pop();out.faces++;for(const v of triangles[f])for(const g of incident[v])if(owner[g]<0&&near(g)){owner[g]=kIndex;queue.push(g);}}
  }
  const vertexGroup=new Int32Array(vertices.length).fill(-1);
  for(let f=0;f<n;f++)if(owner[f]>=0)for(const v of triangles[f])if(vertexGroup[v]<0||owner[f]<vertexGroup[v])vertexGroup[v]=owner[f];
  for(let v=0;v<vertices.length;v++){if(vertexGroup[v]<0)continue;const pl=planes[vertexGroup[v]],p=vertices[v];
    const si=pl.si*2**-q,sj=pl.sj*2**-q,off=(p[pl.k]-si*p[pl.i]-sj*p[pl.j]-pl.t*2**(-grid-q))/(1+si*si+sj*sj),x=[0,0,0];
    const onGrid=(c,s,y)=>{if(s===0){x[c]=p[c];return 0;}const m=llround(y*2**grid);x[c]=m*2**-grid;return m;};
    const mi=onGrid(pl.i,pl.si,p[pl.i]+off*si),mj=onGrid(pl.j,pl.sj,p[pl.j]+off*sj);x[pl.k]=(pl.si*mi+pl.sj*mj+pl.t)*2**(-grid-q);
    const move=Math.hypot(x[0]-p[0],x[1]-p[1],x[2]-p[2]);
    if(move>closeMm){out.unmovedVertices++;continue;}if(move>0){points[v]=x;out.movedVertices++;out.maxDisplacementMm=Math.max(out.maxDisplacementMm,move);}
  }
  return {points,closing:out};
}

// ---------------- refinement: exact arrangement of the triangle soup ----------------
// Whether any pair of triangles meets beyond shared vertices and edges (pairs
// with a dirty triangle only, when given).
export function anyIntersection(vertices,triangles,dirty=null){
  const store=createStore(vertices);return intersectAll(store,vertices,triangles,createConstructions(store,vertices,triangles),{stopAtFirst:true,dirty}).any===true;
}
export function autorefine(vertices,triangles,{dirty=null}={}){
  const store=createStore(vertices),build=createConstructions(store,vertices,triangles),timings={},clock=()=>performance.now();let t0=clock();
  log(`store S=${store.S}`);const found=intersectAll(store,vertices,triangles,build,{dirty});timings.intersect=clock()-t0;t0=clock();log(`intersected ${JSON.stringify(found.stats)}`);
  const {segs,points,parent,root}=found,groups=new Map();
  for(const t of new Set([...segs.keys(),...points.keys(),...parent.keys()])){const r=parent.has(t)?root(t):t;if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t);}
  for(const m of groups.values())m.sort((a,b)=>a-b);
  const M=2**30,superPoints=[0,1,2].map(k=>[[-M,-M],[3*M,-M],[-M,3*M]].map(([u,v])=>{const p=[0,0,0];p[(k+1)%3]=u;p[(k+2)%3]=v;return store.integerPoint(p);}));
  const stats={...found.stats,refinedSourceTriangles:0,groups:groups.size,largestGroup:0,crossings:0};
  const replaced=new Uint8Array(triangles.length),soup=[];
  for(const members of groups.values()){stats.largestGroup=Math.max(stats.largestGroup,members.length);
    for(const {t} of triangulateGroup(store,triangles,build,members,segs,points,superPoints,stats))soup.push(t);
    for(const m of members)replaced[m]=1;stats.refinedSourceTriangles+=members.length;}
  for(let t=0;t<triangles.length;t++)if(!replaced[t])soup.push(triangles[t]);
  timings.triangulate=clock()-t0;
  return {store,soup,stats:{...stats,predicates:store.stats},timings,intersecting:segs.size+points.size+parent.size>0};
}

// ---------------- classification (port of reconstruct's winding logic) ----------------
function classify(store,soup){
  const {px,py,pz,pd,X,Y,Z,W,orient3d}=store;let coincident=0,cancelled=0,cancelledArea=0,patches=0,rays=0,retries=0,interior=0;
  const keyed=new Map();
  for(const t of soup){const s=[...t].sort((a,b)=>a-b),sign=(t[0]===s[0]&&t[1]===s[1])||(t[0]===s[1]&&t[1]===s[2])||(t[0]===s[2]&&t[1]===s[0])?1:-1,key=`${s[0]},${s[1]},${s[2]}`;
    const g=keyed.get(key);if(g){g.net+=sign;g.count++;}else keyed.set(key,{s,net:sign,count:1});}
  const area=s=>{const u=[px[s[1]]-px[s[0]],py[s[1]]-py[s[0]],pz[s[1]]-pz[s[0]]],v=[px[s[2]]-px[s[0]],py[s[2]]-py[s[0]],pz[s[2]]-pz[s[0]]];return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
  const faces=[];
  for(const {s,net,count} of keyed.values()){if(count>1)coincident++;if(net>0)faces.push({v:s,w:net});else if(net<0)faces.push({v:[s[0],s[2],s[1]],w:-net});else{cancelled+=count;cancelledArea+=count*area(s);}}
  keyed.clear();if(!faces.length)throw Error('Solid reconstruction encloses no volume');
  const edges=new Map();
  faces.forEach((f,i)=>{for(let k=0;k<3;k++){const u=f.v[k],v=f.v[(k+1)%3],key=u<v?`${u},${v}`:`${v},${u}`,e=edges.get(key);const item={face:i,dir:u<v?1:-1};if(e)e.push(item);else edges.set(key,[item]);}});
  const parent=faces.map((_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;};
  for(const list of edges.values()){let balance=0;for(const e of list)balance+=e.dir*faces[e.face].w;
    if(balance!==0)throw Error('Solid reconstruction needs a closed surface, but refined edges are unbalanced');
    if(list.length===2&&list[0].dir!==list[1].dir&&faces[list[0].face].w===faces[list[1].face].w)parent[root(list[0].face)]=root(list[1].face);}
  edges.clear();
  const boxes=new Float64Array(6*faces.length),all=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  faces.forEach((f,i)=>{const [a,b,c]=f.v,d=Math.max(pd[a],pd[b],pd[c]);const b6=[Math.min(px[a],px[b],px[c])-d,Math.min(py[a],py[b],py[c])-d,Math.min(pz[a],pz[b],pz[c])-d,Math.max(px[a],px[b],px[c])+d,Math.max(py[a],py[b],py[c])+d,Math.max(pz[a],pz[b],pz[c])+d];
    boxes.set(b6,6*i);for(let k=0;k<3;k++){all[k]=Math.min(all[k],b6[k]);all[3+k]=Math.max(all[3+k],b6[3+k]);}});
  const tree=bvh(boxes,faces.length);let size=0;for(let k=0;k<3;k++)size=Math.max(size,all[3+k]-all[k]);
  const reach=4*size+1,margin=1e-9*(size+1),centre=[0,1,2].map(k=>(all[k]+all[3+k])/2);
  const windingToward=(f,q)=>{const t=faces[f].v;store.exact(t[0]);store.exact(t[1]);store.exact(t[2]);
    const [w0,w1,w2]=t.map(i=>W[i]),s=store.raw(X[t[0]]*w1*w2+X[t[1]]*w0*w2+X[t[2]]*w0*w1,Y[t[0]]*w1*w2+Y[t[1]]*w0*w2+Y[t[2]]*w0*w1,Z[t[0]]*w1*w2+Z[t[1]]*w0*w2+Z[t[2]]*w0*w1,3n*w0*w1*w2);
    if(orient3d(t[0],t[1],t[2],q)===0)return null;
    const a=[px[s],py[s],pz[s]],b=[px[q],py[q],pz[q]];let total=0,degenerate=false;
    tree.querySegment(a,b,margin,g=>{if(degenerate||g===f)return;if(!segmentMeetsBox(a,b,boxes,6*g,margin))return;const [p,r,u]=faces[g].v;
      const os=orient3d(p,r,u,s),oq=orient3d(p,r,u,q);if(oq===0){degenerate=true;return;}if(os===oq||os===0)return;
      const e1=orient3d(s,q,p,r),e2=orient3d(s,q,r,u),e3=orient3d(s,q,u,p);
      const positive=e1>=0&&e2>=0&&e3>=0,negative=e1<=0&&e2<=0&&e3<=0;if(!positive&&!negative)return;
      if(e1===0||e2===0||e3===0){degenerate=true;return;}total+=os>0?faces[g].w:-faces[g].w;});
    return degenerate?null:-total;};
  const members=new Map();faces.forEach((_,i)=>{const r=root(i);if(!members.has(r))members.set(r,[]);members.get(r).push(i);});
  const kept=[];
  for(const patch of members.values()){patches++;let front=0,known=false;
    for(let attempt=0;!known;attempt++){if(attempt>=64*patch.length)throw Error('No general-position ray for a surface patch');
      const f=patch[attempt%patch.length],angle=2.399963229728653*(attempt+1),z=1-2*((0.6180339887498949*(attempt+1))%1),radius=Math.sqrt(Math.max(0,1-z*z));
      const q=store.integerPoint([Math.round(centre[0]+reach*radius*Math.cos(angle)),Math.round(centre[1]+reach*radius*Math.sin(angle)),Math.round(centre[2]+reach*z)]);rays++;
      const winding=windingToward(f,q);if(winding===null){retries++;continue;}
      const t=faces[f].v;front=orient3d(t[0],t[1],t[2],q)>0?winding:winding-faces[f].w;known=true;}
    const back=front+faces[patch[0]].w;if((front>0)===(back>0)){interior+=patch.length;continue;}
    for(const f of patch){const t=[...faces[f].v];if(front>0)[t[1],t[2]]=[t[2],t[1]];kept.push(t);}}
  if(!kept.length)throw Error('Solid reconstruction encloses no volume');
  return {kept,report:{coincidentGroups:coincident,cancelledTriangles:cancelled,cancelledAreaMm2:cancelledArea,patches,rays,rayRetries:retries,boundaryTriangles:kept.length,interiorTriangles:interior}};
}

// ---------------- rounding and tiny-triangle collapse ----------------
function collapseTinyTriangles(vertices,triangles,isSource,onCollapse=()=>{},mergeMm=PRINT_RESOLUTION_MM){
  const tiny=t=>{const [a,b,c]=t.map(i=>vertices[i]),u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],w=[c[0]-b[0],c[1]-b[1],c[2]-b[2]];
    const longest=Math.sqrt(Math.max(u[0]**2+u[1]**2+u[2]**2,v[0]**2+v[1]**2+v[2]**2,w[0]**2+w[1]**2+w[2]**2));
    return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=1e-9*longest;};
  const incident=vertices.map(()=>new Set());triangles.forEach((t,i)=>t.forEach(v=>incident[v].add(i)));
  const neighbours=v=>{const s=new Set();for(const f of incident[v])for(const x of triangles[f])if(x&&x!==v)s.add(x);return s;};
  const out={collapsedEdges:0,remaining:0,maxCollapseMm:0};
  for(let changed=true;changed;){changed=false;
    // Tiny triangles lose their shortest collapsible edge; any triangle loses an
    // edge below print resolution with a constructed end (owner: spacing under
    // functional tolerance merges).
    for(let f=0;f<triangles.length;f++){const t=triangles[f];if(!t)continue;const flat=tiny(t);let best=null,length=flat?Infinity:mergeMm;
      for(let k=0;k<3;k++)for(const [s,d] of [[t[k],t[(k+1)%3]],[t[(k+1)%3],t[k]]]){if(isSource(s))continue;const l=Math.hypot(...[0,1,2].map(i=>vertices[s][i]-vertices[d][i]));if(l>=length)continue;
        const shared=[...incident[s]].filter(g=>incident[d].has(g)),apex=new Set(shared.flatMap(g=>triangles[g].filter(x=>x!==s&&x!==d))),common=[...neighbours(s)].filter(x=>neighbours(d).has(x));
        if(shared.length===2&&common.length===apex.size&&common.every(x=>apex.has(x))){best=[s,d];length=l;}}
      if(!best)continue;const [s,d]=best;
      for(const g of [...incident[s]]){const tri=triangles[g];if(tri.includes(d)){for(const x of tri)incident[x].delete(g);triangles[g]=null;}else{triangles[g]=tri.map(x=>x===s?d:x);incident[d].add(g);}}
      incident[s].clear();onCollapse(d);out.collapsedEdges++;out.maxCollapseMm=Math.max(out.maxCollapseMm,length);changed=true;}}
  for(const t of triangles)if(t&&tiny(t))out.remaining++;
  return out;
}

// Replaces a closed oriented surface that crosses itself by the boundary of its
// solid (w > 0), as the native helper's reconstruct(). Returns null when nothing intersects.
// Snap rounding: constructed points round to the rounding-guard lattice (a power
// of two at most print resolution / 1000); source points stay. When rounding
// creates crossings, the rounded surface is reconstructed again.
export const SNAP_GRID_MM=2**Math.floor(Math.log2(PRINT_RESOLUTION_MM/1000));
export function reconstructSolid(mesh,{closeMm=PRINT_RESOLUTION_MM,snapGridMm=SNAP_GRID_MM,maxPasses=6}={}){
  const passes=[],timings=[],source=new Set(mesh.vertices.map(p=>p.join(',')));let current=mesh;
  for(let pass=0;pass<maxPasses;pass++){
    // Later passes test only triangles that rounding or collapse touched.
    const t0=performance.now(),r=reconstructOnce(current,{closeMm:pass===0?closeMm:0,snapGridMm,isSource:p=>source.has(p.join(',')),dirty:current.dirty??null});
    if(!r){timings.push({finalProbe:performance.now()-t0});break;}passes.push(r.report);timings.push(r.timings);current=r;
    if(pass===maxPasses-1)passes.push({unresolved:'pass limit reached; rounding still creates crossings'});
  }
  return passes.length?{vertices:current.vertices,triangles:current.triangles,report:{passes},timings}:null;
}
function reconstructOnce({vertices,triangles},{closeMm,snapGridMm,isSource,dirty}){
  const clock=()=>performance.now(),timings={};let t0=clock();
  const any=anyIntersection(vertices,triangles,dirty);timings.probe=clock()-t0;if(!any)return null;t0=clock();
  const {points,closing}=closeOpposedSheets(vertices,triangles,closeMm);timings.close=clock()-t0;t0=clock();
  let volume=0;for(const [a,b,c] of triangles){const p=points[a],q=points[b],r=points[c];volume+=p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0]);}
  const reversed=volume<0,oriented=reversed?triangles.map(([a,b,c])=>[a,c,b]):triangles;
  const refined=autorefine(points,oriented,{dirty:closing.movedVertices?null:dirty});timings.refine=clock()-t0;t0=clock();
  const {kept,report}=classify(refined.store,refined.soup);timings.classify=clock()-t0;t0=clock();
  const {px,py,pz}=refined.store,index=new Map(),rounded=[],byKey=new Map(),inputs=points.length,snap=x=>Math.round(x/snapGridMm)*snapGridMm;let merged=0,dropped=0,maxSnapMm=0;
  const faces=new Map();
  for(const t of kept){const r=t.map(v=>{if(!index.has(v)){const p=v<inputs?points[v]:[snap(px[v]),snap(py[v]),snap(pz[v])],key=p.join(',');
      if(v>=inputs)maxSnapMm=Math.max(maxSnapMm,Math.hypot(p[0]-px[v],p[1]-py[v],p[2]-pz[v]));
      let i=byKey.get(key);if(i===undefined){i=rounded.length;rounded.push(p);byKey.set(key,i);}else merged++;index.set(v,i);}return index.get(v);});
    if(new Set(r).size<3){dropped++;continue;}
    // Rounding can make opposed copies coincide; they cancel as in classification.
    const s=[...r].sort((a,b)=>a-b),key=s.join(','),sign=(s.indexOf(r[1])-s.indexOf(r[0])+3)%3===1?1:-1,g=faces.get(key);if(g)g.net+=sign;else faces.set(key,{r,sign,net:sign});}
  const out=[];let roundingCancelled=0;for(const {r,sign,net} of faces.values()){if(net===0){roundingCancelled++;continue;}out.push(Math.sign(net)===sign?r:[r[0],r[2],r[1]]);}
  const moved=new Uint8Array(rounded.length);for(const [v,i] of index)if(v>=inputs)moved[i]=1;
  const collapse=collapseTinyTriangles(rounded,out,v=>isSource(rounded[v]),d=>{moved[d]=1;});
  const used=new Map(),finalVertices=[],finalTriangles=[],finalDirty=[];
  for(const t of out)if(t){finalTriangles.push(t.map(v=>{if(!used.has(v)){used.set(v,finalVertices.length);finalVertices.push(rounded[v]);}return used.get(v);}));finalDirty.push(moved[t[0]]|moved[t[1]]|moved[t[2]]);}
  timings.round=clock()-t0;
  return {vertices:finalVertices,triangles:finalTriangles,dirty:Uint8Array.from(finalDirty),report:{closing,reversedOrientation:reversed,refinedTriangles:refined.soup.length,...report,snapGridMm,maxSnapMm,roundingMergedPoints:merged,roundingDroppedTriangles:dropped,roundingCancelledPairs:roundingCancelled,...collapse,refine:refined.stats},timings};
}
