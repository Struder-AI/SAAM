// SAAM's own solid reconstruction (plans/0.3.7.md "Retire CGAL"): a closed
// outward surface that crosses itself is replaced by the boundary of its solid.
// Meshes here are packed: xyz (Float64Array, 3 per vertex), tri (Int32Array, 3 per
// triangle).
// Exactness: input coordinates are doubles, integers on a 2^-S lattice. Constructed
// points (edge x plane, three planes, two coplanar edges) are homogeneous BigInt
// coordinates on that lattice, deduplicated by exact value. Predicates filter in
// doubles with error bounds that cover the rounded approximation of constructed
// points; an undecided sign is exact: expansion arithmetic on doubles, BigInt when
// a constructed point takes part. Coplanar overlapping triangles share one 2D
// triangulation, so their common pieces are identical triangles and opposed copies
// cancel.
import {NUMERIC_MM,NUMERIC_RELATIVE,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {closestTrianglePoint} from './mesh-spatial.mjs';
import {separatedTriangles} from './mesh.mjs';
import {orient2dExact,orient3dExact} from './exact-predicates.mjs';
import {boxHierarchy,overlappingBoxPairs,segmentMeetsBox} from './triangle-bvh.mjs';

const babs=x=>x<0n?-x:x,bsign=x=>x>0n?1:x<0n?-1:0;
function gcd(a,b){a=babs(a);b=babs(b);while(b){const r=a%b;a=b;b=r;}return a;}
const llround=x=>x<0?-Math.round(-x):Math.round(x);
// Bounds of the double filters, relative to the permanent
// (Shewchuk proves about 7.8e-16 and 3.3e-16 for orientation in 3D and 2D).
const FILTER=2**-50,PLANE_FILTER=2**-48;

// ---------------- packed containers ----------------
// Open-addressing map from three doubles (a point, or a sorted index triple) to an index.
const hashF64=new Float64Array(1),hashU32=new Uint32Array(hashF64.buffer);
function hashWord(h,v){hashF64[0]=v+0;h=Math.imul(h^hashU32[0],0xcc9e2d51);h=Math.imul(h^(h>>>15)^hashU32[1],0x1b873593);return h^(h>>>13);}
class PointMap{
  constructor(expected){let size=16;while(size<2*expected)size*=2;this.keys=new Float64Array(3*size);this.values=new Int32Array(size).fill(-1);this.count=0;}
  slot(x,y,z){const mask=this.values.length-1;let s=hashWord(hashWord(hashWord(0x9e3779b9,x),y),z)&mask;
    for(;;){if(this.values[s]<0)return s;const o=3*s;if(this.keys[o]===x&&this.keys[o+1]===y&&this.keys[o+2]===z)return s;s=(s+1)&mask;}}
  get(x,y,z){return this.values[this.slot(x,y,z)];}
  set(x,y,z,value){
    if(2*(this.count+1)>this.values.length){const {keys,values}=this;this.keys=new Float64Array(2*keys.length);this.values=new Int32Array(2*values.length).fill(-1);this.count=0;
      for(let s=0;s<values.length;s++)if(values[s]>=0)this.set(keys[3*s],keys[3*s+1],keys[3*s+2],values[s]);}
    const s=this.slot(x,y,z);if(this.values[s]<0)this.count++;this.keys[3*s]=x;this.keys[3*s+1]=y;this.keys[3*s+2]=z;this.values[s]=value;
  }
}
// Vertex -> incident triangles (compressed rows).
function incidence(vertexCount,tri){
  const start=new Int32Array(vertexCount+1),faces=new Int32Array(tri.length);
  for(const v of tri)start[v+1]++;for(let v=0;v<vertexCount;v++)start[v+1]+=start[v];
  const fill=start.slice(0,vertexCount);for(let i=0;i<tri.length;i++)faces[fill[tri[i]]++]=(i/3)|0;
  return {start,faces};
}
function packedBoxes(xyz,tri,margin=0){
  const n=tri.length/3,boxes=new Float64Array(6*n);
  for(let t=0;t<n;t++)for(let k=0;k<3;k++){const a=xyz[3*tri[3*t]+k],b=xyz[3*tri[3*t+1]+k],c=xyz[3*tri[3*t+2]+k];boxes[6*t+k]=Math.min(a,b,c)-margin;boxes[6*t+3+k]=Math.max(a,b,c)+margin;}
  return boxes;
}

// ---------------- exact point store and predicates ----------------
// Exact double v as an integer on the 2^-S lattice.
const bitsView=new DataView(new ArrayBuffer(8));
function latticeInteger(v,S){
  if(v===0)return 0n;bitsView.setFloat64(0,v);const hi=bitsView.getUint32(0),biased=(hi>>>20)&2047;
  let m=(BigInt(hi&0xfffff)<<32n)|BigInt(bitsView.getUint32(4));const e=biased?(m|=1n<<52n,biased-1075):-1074;
  m=e+S>=0?m<<BigInt(e+S):m>>BigInt(-e-S);return hi>>>31?-m:m;
}
// Points 0..n0-1 are the input vertices. A point with pd 0 is an exact double
// (inputs, the triangulation's super vertices, ray ends); others are constructed,
// held exactly as (X,Y,Z,W) and approximated in px/py/pz within pd.
class PointStore{
  constructor(xyz){
    const n0=xyz.length/3;let S=0;
    for(let i=0;i<xyz.length;i++){let x=xyz[i],s=0;while(!Number.isInteger(x)){x*=2;s++;}if(s>S)S=s;}
    this.n0=n0;this.S=S;this.count=n0;this.allocate(n0+1024);
    for(let i=0;i<n0;i++){this.px[i]=xyz[3*i];this.py[i]=xyz[3*i+1];this.pz[i]=xyz[3*i+2];}
    this.exact=[];this.keys=new Map();this.inputs=null;this.lattice=new Map();
    this.stats={exact3:0,exact2:0,exactBig:0,constructed:0};
  }
  allocate(capacity){
    const grow=old=>{const a=new Float64Array(capacity);if(old)a.set(old.subarray(0,this.count));return a;};
    this.px=grow(this.px);this.py=grow(this.py);this.pz=grow(this.pz);this.pd=grow(this.pd);
  }
  push(x,y,z,d){if(this.count===this.px.length)this.allocate(2*this.count);const i=this.count++;this.px[i]=x;this.py[i]=y;this.pz[i]=z;this.pd[i]=d;return i;}
  // Exact homogeneous lattice coordinates [X,Y,Z,W].
  exactPoint(i){
    if(this.pd[i]>0)return this.exact[i-this.n0];
    let p=this.lattice.get(i);if(!p){const S=this.S;p=[latticeInteger(this.px[i],S),latticeInteger(this.py[i],S),latticeInteger(this.pz[i],S),1n];this.lattice.set(i,p);}return p;
  }
  approx(v,w){return Number((v<<64n)/w)*2**-64*2**-this.S;}
  pushExact(X,Y,Z,W){const a=this.approx(X,W),b=this.approx(Y,W),c=this.approx(Z,W);
    const i=this.push(a,b,c,Math.max(Math.abs(a),Math.abs(b),Math.abs(c))*2**-50+2**-(60+this.S));this.exact[i-this.n0]=[X,Y,Z,W];return i;}
  // A constructed point, shared by exact value; an input vertex when it is one.
  add(X,Y,Z,W){
    if(W<0n){X=-X;Y=-Y;Z=-Z;W=-W;}if(W===0n)throw Error('Degenerate construction');
    const g=gcd(gcd(gcd(X,Y),Z),W);if(g>1n){X/=g;Y/=g;Z/=g;W/=g;}
    if(W===1n){
      if(!this.inputs){this.inputs=new PointMap(this.n0);for(let i=0;i<this.n0;i++)this.inputs.set(this.px[i],this.py[i],this.pz[i],i);}
      const u=2**-this.S,i=this.inputs.get(Number(X)*u,Number(Y)*u,Number(Z)*u);
      if(i>=0){const p=this.exactPoint(i);if(p[0]===X&&p[1]===Y&&p[2]===Z)return i;}
    }
    const key=`${X},${Y},${Z},${W}`,known=this.keys.get(key);if(known!==undefined)return known;
    this.stats.constructed++;const i=this.pushExact(X,Y,Z,W);this.keys.set(key,i);return i;
  }
  // A temporary exact point that is never shared (ray starts).
  raw(X,Y,Z,W){if(W<0n){X=-X;Y=-Y;Z=-Z;W=-W;}return this.pushExact(X,Y,Z,W);}
  doublePoint(x,y,z){return this.push(x,y,z,0);}
  // Sign of det(b-a, c-a, d-a).
  orient3d(a,b,c,d){
    if(a===b||a===c||a===d||b===c||b===d||c===d)return 0;
    const {px,py,pz,pd}=this,ax=px[a],ay=py[a],az=pz[a],ux=px[b]-ax,uy=py[b]-ay,uz=pz[b]-az,vx=px[c]-ax,vy=py[c]-ay,vz=pz[c]-az,wx=px[d]-ax,wy=py[d]-ay,wz=pz[d]-az;
    const m1=vy*wz,m2=vz*wy,m3=vz*wx,m4=vx*wz,m5=vx*wy,m6=vy*wx,det=ux*(m1-m2)+uy*(m3-m4)+uz*(m5-m6);
    let bound=FILTER*(Math.abs(ux)*(Math.abs(m1)+Math.abs(m2))+Math.abs(uy)*(Math.abs(m3)+Math.abs(m4))+Math.abs(uz)*(Math.abs(m5)+Math.abs(m6)));
    const del=Math.max(pd[a],pd[b],pd[c],pd[d]);
    if(del>0){const lu=Math.abs(ux)+Math.abs(uy)+Math.abs(uz),lv=Math.abs(vx)+Math.abs(vy)+Math.abs(vz),lw=Math.abs(wx)+Math.abs(wy)+Math.abs(wz);bound+=8*del*(lu*lv+lv*lw+lu*lw)+24*del*del*(lu+lv+lw)+64*del*del*del;}
    if(det>bound)return 1;if(det<-bound)return -1;
    this.stats.exact3++;
    if(del===0)return orient3dExact(ax,ay,az,px[b],py[b],pz[b],px[c],py[c],pz[c],px[d],py[d],pz[d]);
    this.stats.exactBig++;
    const r=[a,b,c,d].map(i=>this.exactPoint(i)),m=(p,q,i,j)=>p[i]*q[j]-p[j]*q[i];
    return -bsign(m(r[0],r[1],0,1)*m(r[2],r[3],2,3)-m(r[0],r[1],0,2)*m(r[2],r[3],1,3)+m(r[0],r[1],0,3)*m(r[2],r[3],1,2)
      +m(r[0],r[1],1,2)*m(r[2],r[3],0,3)-m(r[0],r[1],1,3)*m(r[2],r[3],0,2)+m(r[0],r[1],2,3)*m(r[2],r[3],0,1));
  }
  // 2D orientation in the plane that drops axis k, coordinates (k+1, k+2).
  orient2d(k,a,b,c){
    if(a===b||b===c||a===c)return 0;
    const U=k===0?this.py:k===1?this.pz:this.px,V=k===0?this.pz:k===1?this.px:this.py,pd=this.pd;
    const ax=U[a],ay=V[a],bx=U[b]-ax,by=V[b]-ay,cx=U[c]-ax,cy=V[c]-ay,l=bx*cy,r=by*cx,det=l-r;
    let bound=FILTER*(Math.abs(l)+Math.abs(r));const del=Math.max(pd[a],pd[b],pd[c]);
    if(del>0)bound+=4*del*(Math.abs(bx)+Math.abs(by)+Math.abs(cx)+Math.abs(cy))+16*del*del;
    if(det>bound)return 1;if(det<-bound)return -1;
    this.stats.exact2++;
    if(del===0)return orient2dExact(ax,ay,U[b],V[b],U[c],V[c]);
    this.stats.exactBig++;
    const i=(k+1)%3,j=(k+2)%3,[A,B,C]=[a,b,c].map(p=>this.exactPoint(p));
    return bsign(A[i]*(B[j]*C[3]-B[3]*C[j])-A[j]*(B[i]*C[3]-B[3]*C[i])+A[3]*(B[i]*C[j]-B[j]*C[i]));
  }
  // Exact comparison of coordinate k of two points.
  compare(k,p,q){
    if(this.pd[p]===0&&this.pd[q]===0){const A=k===0?this.px:k===1?this.py:this.pz;return A[p]<A[q]?-1:A[p]>A[q]?1:0;}
    const P=this.exactPoint(p),Q=this.exactPoint(q);return bsign(P[k]*Q[3]-Q[k]*P[3]);
  }
}

// ---------------- constructions from input primitives ----------------
function createConstructions(store,tri){
  const planes=new Map(),cache=new Map();
  function plane(t){let p=planes.get(t);if(p)return p;const [A,B,C]=[0,1,2].map(k=>store.exactPoint(tri[3*t+k]));
    const ux=B[0]-A[0],uy=B[1]-A[1],uz=B[2]-A[2],vx=C[0]-A[0],vy=C[1]-A[1],vz=C[2]-A[2],n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    p={n,d:n[0]*A[0]+n[1]*A[1]+n[2]*A[2]};planes.set(t,p);return p;}
  // Edge uv (input vertices) meets the plane of triangle f.
  function edgeFaceRaw(u,v,f){const {n,d}=plane(f),U=store.exactPoint(u),V=store.exactPoint(v),ou=n[0]*U[0]+n[1]*U[1]+n[2]*U[2]-d,ov=n[0]*V[0]+n[1]*V[1]+n[2]*V[2]-d,s=ou-ov<0n?-1n:1n;
    return {u,v,f,X:s*(ou*V[0]-ov*U[0]),Y:s*(ou*V[1]-ov*U[1]),Z:s*(ou*V[2]-ov*U[2]),W:s*(ou-ov)};}
  function edgeFace(u,v,f){const key=`e${Math.min(u,v)},${Math.max(u,v)}f${f}`;let id=cache.get(key);if(id!==undefined)return id;
    const p=edgeFaceRaw(u,v,f);id=store.add(p.X,p.Y,p.Z,p.W);cache.set(key,id);return id;}
  // Three planes meet.
  function threePlanes(a,b,c){const s=[a,b,c].sort((x,y)=>x-y),key=`f${s}`;let id=cache.get(key);if(id!==undefined)return id;
    const rows=s.map(plane),det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const w=det(rows.map(x=>x.n)),col=k=>det(rows.map(x=>x.n.map((v,j)=>j===k?x.d:v)));
    id=store.add(col(0),col(1),col(2),w);cache.set(key,id);return id;}
  // Two coplanar edges uv, wx cross (2D, dropping axis k).
  function twoEdges(u,v,w,x,k){const e1=[Math.min(u,v),Math.max(u,v)],e2=[Math.min(w,x),Math.max(w,x)],key=`x${e1<e2?[e1,e2]:[e2,e1]}`;let id=cache.get(key);if(id!==undefined)return id;
    const [U,V,Wp,X]=[u,v,w,x].map(i=>store.exactPoint(i)),i=(k+1)%3,j=(k+2)%3,c2=(p0,p1,q0,q1)=>p0*q1-p1*q0;
    const num=c2(Wp[i]-U[i],Wp[j]-U[j],X[i]-Wp[i],X[j]-Wp[j]),den=c2(V[i]-U[i],V[j]-U[j],X[i]-Wp[i],X[j]-Wp[j]);
    id=store.add(U[0]*den+(V[0]-U[0])*num,U[1]*den+(V[1]-U[1])*num,U[2]*den+(V[2]-U[2])*num,den);cache.set(key,id);return id;}
  return {plane,edgeFace,edgeFaceRaw,threePlanes,twoEdges};
}

// ---------------- pairwise intersections ----------------
// Orientation-only rejection of non-coplanar pairs before any construction.
// Without a shared vertex: A meets plane B in a segment S (its vertices on the plane
// and its edges crossing it), and A meets B exactly where S meets B. In plane B the
// two are disjoint when one edge line of B has all of S strictly outside. For a point
// X of plane B and an edge uv of B, the 2D side is -h(w) orient3d(u,v,w,X) for any w
// off the plane at signed height h(w); a crossing X of edge pq takes w = p, where
// orient3d(u,v,p,X) has the sign of orient3d(u,v,p,q).
function sectionDisjoint(store,A,sA,B){
  const off=sA[0]?0:sA[1]?1:2,w=A[off],hw=sA[off];
  for(let e=0;e<3;e++){const u=B[e],v=B[(e+1)%3];let outside=true;
    for(let k=0;k<3&&outside;k++){
      if(sA[k]===0&&-hw*store.orient3d(u,v,w,A[k])>=0)outside=false;
      const m=(k+1)%3;if(sA[k]*sA[m]<0&&-sA[k]*store.orient3d(u,v,A[k],A[m])>=0)outside=false;}
    if(outside)return true;}
  return false;
}
// One shared vertex v = A[i] = B[j], the other vertices strictly straddling: both
// segments start at v, and they overlap beyond v when they leave in the same
// direction, i.e. B's segment end lies on the side of a2 of the plane (v,a1,b1).
function meetOnlyAtShared(store,A,B){
  const i=A.findIndex(v=>B.includes(v)),j=B.indexOf(A[i]),v=A[i],a1=A[(i+1)%3],a2=A[(i+2)%3],b1=B[(j+1)%3],b2=B[(j+2)%3];
  return store.orient3d(v,a1,b1,a2)!==store.orient3d(v,a1,b1,b2);
}
// Per triangle: segments {a,b,line} with line {plane:t} or {edge:[u,v]}, isolated
// points, and coplanar overlap groups (union-find). With stopAtFirst, only whether
// any pair meets beyond shared vertices and edges (pairs with a dirty triangle only,
// when given).
function intersectAll(store,tri,build,{stopAtFirst=false,dirty=null}={}){
  const n=tri.length/3,{px,py,pz}=store;
  const boxes=new Float64Array(n*6);
  for(let t=0;t<n;t++){const a=tri[3*t],b=tri[3*t+1],c=tri[3*t+2],o=6*t;
    boxes[o]=Math.min(px[a],px[b],px[c]);boxes[o+1]=Math.min(py[a],py[b],py[c]);boxes[o+2]=Math.min(pz[a],pz[b],pz[c]);
    boxes[o+3]=Math.max(px[a],px[b],px[c]);boxes[o+4]=Math.max(py[a],py[b],py[c]);boxes[o+5]=Math.max(pz[a],pz[b],pz[c]);}
  // Double planes: det = n.(p-a) with |error| <= PLANE_FILTER |u|1 |v|1 |p-a|1, else orient3d.
  // The dominant normal axis is a projection where the triangle does not degenerate.
  const plane=new Float64Array(n*4),axis=new Uint8Array(n);
  for(let t=0;t<n;t++){const a=tri[3*t],b=tri[3*t+1],c=tri[3*t+2],ux=px[b]-px[a],uy=py[b]-py[a],uz=pz[b]-pz[a],vx=px[c]-px[a],vy=py[c]-py[a],vz=pz[c]-pz[a],o=4*t;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;plane[o]=nx;plane[o+1]=ny;plane[o+2]=nz;plane[o+3]=PLANE_FILTER*(Math.abs(ux)+Math.abs(uy)+Math.abs(uz))*(Math.abs(vx)+Math.abs(vy)+Math.abs(vz));
    axis[t]=Math.abs(nx)>=Math.abs(ny)&&Math.abs(nx)>=Math.abs(nz)?0:Math.abs(ny)>=Math.abs(nz)?1:2;}
  const side=(t,p)=>{const a=tri[3*t];if(p===a||p===tri[3*t+1]||p===tri[3*t+2])return 0;const wx=px[p]-px[a],wy=py[p]-py[a],wz=pz[p]-pz[a],o=4*t,det=plane[o]*wx+plane[o+1]*wy+plane[o+2]*wz,bound=plane[o+3]*(Math.abs(wx)+Math.abs(wy)+Math.abs(wz));
    return det>bound?1:det<-bound?-1:store.orient3d(a,tri[3*t+1],tri[3*t+2],p);};
  const out={segs:new Map(),points:new Map(),parent:new Map(),axis,any:false,stats:{candidatePairs:0,segmentPairs:0,pointPairs:0,coplanarOverlaps:0,coplanarTouches:0}};
  const root=x=>{let r=x;while(out.parent.has(r)&&out.parent.get(r)!==r)r=out.parent.get(r);return r;};out.root=root;
  const addSeg=(t,s)=>{const l=out.segs.get(t);if(l)l.push(s);else out.segs.set(t,[s]);};
  const addPoint=(t,p)=>{if(tri[3*t]===p||tri[3*t+1]===p||tri[3*t+2]===p)return;const l=out.points.get(t);if(l)l.push(p);else out.points.set(t,[p]);};
  const found=()=>{out.any=true;return stopAtFirst;};
  overlappingBoxPairs(boxes,(i,j)=>{
    if(stopAtFirst&&out.any||dirty&&!dirty[i]&&!dirty[j])return;
    const a0=tri[3*i],a1=tri[3*i+1],a2=tri[3*i+2],b0=tri[3*j],b1=tri[3*j+1],b2=tri[3*j+2];
    const s0=side(i,b0),s1=side(i,b1),s2=side(i,b2);
    if((s0>0&&s1>0&&s2>0)||(s0<0&&s1<0&&s2<0))return;
    const r0=side(j,a0),r1=side(j,a1),r2=side(j,a2);
    if((r0>0&&r1>0&&r2>0)||(r0<0&&r1<0&&r2<0))return;
    const inA=v=>v===a0||v===a1||v===a2,inB=v=>v===b0||v===b1||v===b2,A=[a0,a1,a2],B=[b0,b1,b2];
    if(!(s0===0&&s1===0&&s2===0)){
      // Non-shared vertices strictly on one side of the other plane: the pair meets only in shared vertices.
      const shared=(inB(a0)?1:0)+(inB(a1)?1:0)+(inB(a2)?1:0),sA=[r0,r1,r2],sB=[s0,s1,s2];
      if(shared===2)return;
      if(shared===1){let pa=1,pb=1;if(!inB(a0))pa*=r0;if(!inB(a1))pa*=r1;if(!inB(a2))pa*=r2;if(!inA(b0))pb*=s0;if(!inA(b1))pb*=s1;if(!inA(b2))pb*=s2;if(pa>0||pb>0)return;
        out.stats.candidatePairs++;if(pa<0&&pb<0&&meetOnlyAtShared(store,A,B))return;}
      else{out.stats.candidatePairs++;if(sectionDisjoint(store,A,sA,B))return;}
      // Candidate endpoints stay unregistered until they bound the result.
      const cut=(T,s,f)=>{const pts=[];for(let k=0;k<3;k++){if(s[k]===0){const P=store.exactPoint(T[k]);pts.push({id:T[k],X:P[0],Y:P[1],Z:P[2],W:1n});}const m=(k+1)%3;if(s[k]*s[m]<0)pts.push(build.edgeFaceRaw(T[k],T[m],f));}return pts;};
      const pa=cut(A,sA,j),pb=cut(B,sB,i);if(!pa.length||!pb.length)return;
      const na=build.plane(i).n,nb=build.plane(j).n,d=[na[1]*nb[2]-na[2]*nb[1],na[2]*nb[0]-na[0]*nb[2],na[0]*nb[1]-na[1]*nb[0]];
      const f=p=>d[0]*p.X+d[1]*p.Y+d[2]*p.Z,cmp=(p,q)=>{if(p===q||(p.id!==undefined&&p.id===q.id))return 0;const l=f(p)*q.W,r=f(q)*p.W;return l<r?-1:l>r?1:0;};
      pa.sort(cmp);pb.sort(cmp);const l0=pa[0],l1=pa[pa.length-1],m0=pb[0],m1=pb[pb.length-1];
      const lo=cmp(l0,m0)>=0?l0:m0,hi=cmp(l1,m1)<=0?l1:m1,order=cmp(lo,hi);
      if(order>0)return;
      const id=p=>p.id??build.edgeFace(p.u,p.v,p.f);
      if(order===0){if(stopAtFirst){if(lo.id!==undefined&&inA(lo.id)&&inB(lo.id))return;found();return;}const p=id(lo);if(inA(p)&&inB(p))return;addPoint(i,p);addPoint(j,p);out.stats.pointPairs++;return;}
      if(found())return;const a=id(lo),b=id(hi);addSeg(i,{a,b,line:{plane:j}});addSeg(j,{a,b,line:{plane:i}});out.stats.segmentPairs++;return;
    }
    out.stats.candidatePairs++;
    const k=axis[i],sa=store.orient2d(k,a0,a1,a2),sb=store.orient2d(k,b0,b1,b2);
    // Some edge of P has every vertex of Q on its outer side or on it.
    const separated=(P,sp,Q)=>{for(let e=0;e<3;e++){const u=P[e],v=P[(e+1)%3];if(store.orient2d(k,u,v,Q[0])*sp<=0&&store.orient2d(k,u,v,Q[1])*sp<=0&&store.orient2d(k,u,v,Q[2])*sp<=0)return true;}return false;};
    if(!separated(A,sa,B)&&!separated(B,sb,A)){if(found())return;out.stats.coplanarOverlaps++;const ri=root(i),rj=root(j);if(ri!==rj){out.parent.set(ri,rj);if(!out.parent.has(rj))out.parent.set(rj,rj);}return;}
    const inside=(p,T,s)=>store.orient2d(k,T[0],T[1],p)*s>=0&&store.orient2d(k,T[1],T[2],p)*s>=0&&store.orient2d(k,T[2],T[0],p)*s>=0;let touched=false;
    for(const v of B)if(!inA(v)&&inside(v,A,sa)){addPoint(i,v);touched=true;}
    for(const v of A)if(!inB(v)&&inside(v,B,sb)){addPoint(j,v);touched=true;}
    if(touched){if(found())return;out.stats.coplanarTouches++;}
  });
  return out;
}

// ---------------- 2D constrained triangulation of one plane group ----------------
// members: coplanar input triangles (one, or several overlapping). Returns refined
// 3D triangles (point ids, flat), each oriented as the member that contains it.
// Crossings, points on constraints and containment are found through box hierarchies.
function triangulateGroup(store,tri,build,k,members,segs,points,superPoints,stats){
  const G=members[0],o=(a,b,c)=>store.orient2d(k,a,b,c),{pd}=store,U=k===0?store.py:k===1?store.pz:store.px,V=k===0?store.pz:k===1?store.px:store.py;
  const cons=[],seen=new Set(),pset=new Set();
  const addCons=(a,b,line)=>{if(a===b)return;const key=a<b?`${a},${b}`:`${b},${a}`;if(seen.has(key))return;seen.add(key);cons.push({a,b,line});pset.add(a);pset.add(b);};
  for(const m of members){for(let e=0;e<3;e++){const u=tri[3*m+e],v=tri[3*m+(e+1)%3];addCons(u,v,{edge:[u,v]});}
    for(const s of segs.get(m)??[])addCons(s.a,s.b,s.line);for(const p of points.get(m)??[])pset.add(p);}
  // Constraint boxes (2D, with each end's approximation error).
  const consBoxes=new Float64Array(6*cons.length);
  cons.forEach((c,x)=>{const m=Math.max(pd[c.a],pd[c.b]),q=6*x;consBoxes[q]=Math.min(U[c.a],U[c.b])-m;consBoxes[q+1]=Math.min(V[c.a],V[c.b])-m;consBoxes[q+3]=Math.max(U[c.a],U[c.b])+m;consBoxes[q+4]=Math.max(V[c.a],V[c.b])+m;});
  const consTree=boxHierarchy(consBoxes,cons.length);
  // Proper crossings become points defined by the two lines.
  const crossings=[];
  cons.forEach((c1,x)=>consTree.queryBox(consBoxes,6*x,y=>{if(y<=x)return;const c2=cons[y];
    if(c1.a===c2.a||c1.a===c2.b||c1.b===c2.a||c1.b===c2.b)return;
    if(o(c1.a,c1.b,c2.a)*o(c1.a,c1.b,c2.b)>=0||o(c2.a,c2.b,c1.a)*o(c2.a,c2.b,c1.b)>=0)return;crossings.push(x,y);}));
  const pairs=[];for(let q=0;q<crossings.length;q+=2)pairs.push(crossings[q]*cons.length+crossings[q+1]);pairs.sort((p,q)=>p-q);
  for(const pair of pairs){const l1=cons[Math.floor(pair/cons.length)].line,l2=cons[pair%cons.length].line;let p;
    if(l1.plane!==undefined&&l2.plane!==undefined)p=build.threePlanes(G,l1.plane,l2.plane);
    else if(l1.plane!==undefined)p=build.edgeFace(l2.edge[0],l2.edge[1],l1.plane);
    else if(l2.plane!==undefined)p=build.edgeFace(l1.edge[0],l1.edge[1],l2.plane);
    else p=build.twoEdges(l1.edge[0],l1.edge[1],l2.edge[0],l2.edge[1],k);
    pset.add(p);stats.crossings++;}
  const pts=[...pset];
  // Split constraints at the points on them (collinear overlaps, T-junctions).
  const pointBoxes=new Float64Array(6*pts.length);
  pts.forEach((p,i)=>{const q=6*i;pointBoxes[q]=U[p]-pd[p];pointBoxes[q+3]=U[p]+pd[p];pointBoxes[q+1]=V[p]-pd[p];pointBoxes[q+4]=V[p]+pd[p];});
  const pointTree=boxHierarchy(pointBoxes,pts.length),sub=[];
  cons.forEach((c,x)=>{const on=[];
    pointTree.queryBox(consBoxes,6*x,i=>{const p=pts[i];if(p!==c.a&&p!==c.b&&o(c.a,c.b,p)===0)on.push(p);});
    if(!on.length){sub.push(c.a,c.b);return;}
    const A=store.compare((k+1)%3,c.a,c.b)!==0?(k+1)%3:(k+2)%3,dir=store.compare(A,c.a,c.b);
    const between=on.filter(p=>store.compare(A,c.a,p)===dir&&store.compare(A,p,c.b)===dir).sort((p,q)=>-store.compare(A,p,q)*dir);
    let prev=c.a;for(const p of between){sub.push(prev,p);prev=p;}sub.push(prev,c.b);});
  // Incremental triangulation inside a super triangle; half-edge map a*K+b -> triangle.
  const gid=[...superPoints[k],...pts],local=new Map(gid.map((g,i)=>[g,i])),K=2**21,T=[],he=new Map(),vt=[];
  const og=(a,b,c)=>o(gid[a],gid[b],gid[c]);
  const addTri=(a,b,c)=>{const t=T.length;T.push([a,b,c]);he.set(a*K+b,t);he.set(b*K+c,t);he.set(c*K+a,t);vt[a]=vt[b]=vt[c]=t;return t;};
  const delTri=t=>{const [a,b,c]=T[t];for(const key of [a*K+b,b*K+c,c*K+a])if(he.get(key)===t)he.delete(key);T[t]=null;};
  addTri(0,1,2);let last=0,seed=12345;const rand=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  for(let p=3;p<gid.length;p++){
    let t=last;for(let steps=0;;steps++){if(steps>64*T.length+1024)throw Error('Point location does not terminate');const tri=T[t],r=Math.floor(rand()*3);let moved=false;
      for(let e=0;e<3;e++){const u=tri[(r+e)%3],v=tri[(r+e+1)%3];if(og(u,v,p)<0){t=he.get(v*K+u);moved=true;break;}}if(!moved)break;}
    const [a,b,c]=T[t],s=[og(a,b,p),og(b,c,p),og(c,a,p)],zeros=s.filter(x=>x===0).length;
    if(zeros>1)throw Error('Duplicate point in triangulation');
    if(zeros===0){delTri(t);addTri(a,b,p);addTri(b,c,p);last=addTri(c,a,p);continue;}
    const e=s.indexOf(0),u=T[t][e],v=T[t][(e+1)%3],w=T[t][(e+2)%3],nt=he.get(v*K+u),x=T[nt].find(q=>q!==u&&q!==v);
    delTri(t);delTri(nt);addTri(u,p,w);addTri(p,v,w);addTri(v,p,x);last=addTri(p,u,x);
  }
  // Ear clipping of a cavity polygon (counterclockwise); after each ear the scan resumes beside it.
  const triangulate=poly=>{poly=[...poly];
    for(let i=0,failures=0;poly.length>3;){const n=poly.length;i%=n;const p=poly[(i+n-1)%n],c=poly[i],q=poly[(i+1)%n];
      if(og(p,c,q)>0&&!poly.some(r=>r!==p&&r!==c&&r!==q&&og(p,c,r)>=0&&og(c,q,r)>=0&&og(q,p,r)>=0)){addTri(p,c,q);poly.splice(i,1);i=Math.max(0,i-1);failures=0;continue;}
      if(++failures>n)throw Error('Cavity polygon has no ear');i++;}
    if(og(poly[0],poly[1],poly[2])<=0)throw Error('Degenerate cavity triangle');addTri(poly[0],poly[1],poly[2]);};
  for(let q=0;q<sub.length;q+=2){const a=local.get(sub[q]),b=local.get(sub[q+1]);
    if(he.has(a*K+b)||he.has(b*K+a))continue;
    let t=vt[a],start=null;for(let steps=0;steps<=T.length;steps++){const tri=T[t],i=tri.indexOf(a),x=tri[(i+1)%3],y=tri[(i+2)%3];
      if(og(a,x,b)>0&&og(a,y,b)<0){start=[t,x,y];break;}t=he.get(a*K+y);}
    if(!start)throw Error(`Constraint start not found in coplanar group of ${members.length} triangles`);
    let [t0,v,u]=start;const L=[a,u],R=[a,v];delTri(t0);
    for(let steps=0;;steps++){if(steps>T.length)throw Error('Constraint walk does not terminate');const nt=he.get(u*K+v),w=T[nt].find(q=>q!==u&&q!==v);delTri(nt);
      if(w===b)break;const s=og(a,b,w);if(s===0)throw Error('Vertex on constraint');if(s>0){L.push(w);u=w;}else{R.push(w);v=w;}}
    triangulate([a,b,...L.slice(1).reverse()]);triangulate([...R,b]);
  }
  // Each triangle belongs to every member containing its three corners.
  const memberBoxes=new Float64Array(6*members.length),info=members.map((m,i)=>{
    const t=[tri[3*m],tri[3*m+1],tri[3*m+2]],s=o(...t),q=6*i;
    memberBoxes[q]=Math.min(...t.map(v=>U[v]-pd[v]));memberBoxes[q+1]=Math.min(...t.map(v=>V[v]-pd[v]));memberBoxes[q+3]=Math.max(...t.map(v=>U[v]+pd[v]));memberBoxes[q+4]=Math.max(...t.map(v=>V[v]+pd[v]));
    return {s,e:s>0?t:[t[0],t[2],t[1]]};});
  const memberTree=boxHierarchy(memberBoxes,members.length),out=[],box=new Float64Array(6),hits=[];
  for(const tr of T){if(!tr||tr[0]<3||tr[1]<3||tr[2]<3)continue;const g=tr.map(i=>gid[i]);
    box[0]=Math.min(...g.map(v=>U[v]-pd[v]));box[1]=Math.min(...g.map(v=>V[v]-pd[v]));box[3]=Math.max(...g.map(v=>U[v]+pd[v]));box[4]=Math.max(...g.map(v=>V[v]+pd[v]));
    hits.length=0;memberTree.queryBox(box,0,i=>hits.push(i));hits.sort((x,y)=>x-y);
    for(const i of hits){const {s,e}=info[i];
      if(g.every(p=>o(e[0],e[1],p)>=0&&o(e[1],e[2],p)>=0&&o(e[2],e[0],p)>=0))out.push(...(s>0?g:[g[0],g[2],g[1]]));}
  }
  return out;
}

// ---------------- closing opposed sheets (port of closeOpposedSheets) ----------------
function segSeg2(p1,q1,p2,q2){
  const d1=[0,1,2].map(k=>q1[k]-p1[k]),d2=[0,1,2].map(k=>q2[k]-p2[k]),r=[0,1,2].map(k=>p1[k]-p2[k]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const a=dot(d1,d1),e=dot(d2,d2),f=dot(d2,r);let s,t;
  if(a<=0&&e<=0){s=t=0;}else if(a<=0){s=0;t=Math.min(1,Math.max(0,f/e));}
  else{const c=dot(d1,r);if(e<=0){t=0;s=Math.min(1,Math.max(0,-c/a));}else{const b=dot(d1,d2),den=a*e-b*b;s=den>0?Math.min(1,Math.max(0,(b*f-c*e)/den)):0;t=(b*s+f)/e;
    if(t<0){t=0;s=Math.min(1,Math.max(0,-c/a));}else if(t>1){t=1;s=Math.min(1,Math.max(0,(b-c)/a));}}}
  const x=[0,1,2].map(k=>p1[k]+d1[k]*s-p2[k]-d2[k]*t);return dot(x,x);
}
// Whether triangles A and B come within distance r (vertex-face and edge-edge pairs).
function trianglesWithin(A,B,r){
  if(!separatedTriangles(A,B))return true;const r2=r*r;
  for(const [P,Q] of [[A,B],[B,A]])for(const p of P){const q=closestTrianglePoint(p,...Q);if((p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2<=r2)return true;}
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(segSeg2(A[i],A[(i+1)%3],B[j],B[(j+1)%3])<=r2)return true;return false;
}
// Opposed sheets of the source closer than closeMm (print resolution), in any
// orientation, would reconstruct as a film below print resolution that thins to
// knife edges. Faces that face each other or away, lie within closeMm of each
// other's planes and come within closeMm form groups, joined through shared
// vertices of seeded faces coplanar within closeMm. Each group's vertices move onto
// one plane near the one fitted to its seeds, x[k] = (si*x[i] + sj*x[j] + t) / 2^q,
// with x[i], x[j] on a 2^-grid lattice, so moved points are exactly coplanar doubles
// and opposed copies cancel. A vertex moves at most closeMm, only for its largest group.
function closeOpposedSheets({xyz,tri},closeMm){
  const out={method:'opposed-sheet-plane/1',toleranceMm:closeMm,groups:0,faces:0,movedVertices:0,unmovedVertices:0,maxDisplacementMm:0},points=xyz.slice(),moved=new Uint8Array(xyz.length/3);
  if(!(closeMm>0))return {points,moved,closing:out};
  const n=tri.length/3,nv=xyz.length/3,normal=new Float64Array(3*n),area=new Float64Array(n),boxes=packedBoxes(xyz,tri,closeMm),{start,faces}=incidence(nv,tri);
  const P=v=>[xyz[3*v],xyz[3*v+1],xyz[3*v+2]],corners=f=>[P(tri[3*f]),P(tri[3*f+1]),P(tri[3*f+2])];
  for(let f=0;f<n;f++){const [a,b,c]=corners(f),u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const x=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...x);normal.set(l>0?x.map(q=>q/l):x,3*f);area[f]=l/2;}
  const offset=(f,v)=>{const o=3*tri[3*f];return normal[3*f]*(xyz[3*v]-xyz[o])+normal[3*f+1]*(xyz[3*v+1]-xyz[o+1])+normal[3*f+2]*(xyz[3*v+2]-xyz[o+2]);};
  const withinPlane=(f,g)=>{for(const [p,q] of [[f,g],[g,f]])for(let k=0;k<3;k++)if(Math.abs(offset(p,tri[3*q+k]))>closeMm)return false;return true;};
  const shareVertex=(f,g)=>{for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(tri[3*f+a]===tri[3*g+b])return true;return false;};
  const parent=Int32Array.from({length:n},(_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;},seeded=new Uint8Array(n);
  overlappingBoxPairs(boxes,(f,g)=>{
    if(normal[3*f]*normal[3*g]+normal[3*f+1]*normal[3*g+1]+normal[3*f+2]*normal[3*g+2]>=0||shareVertex(f,g))return;
    if(!withinPlane(f,g)||!trianglesWithin(corners(f),corners(g),closeMm))return;
    parent[root(f)]=root(g);seeded[f]=seeded[g]=1;});
  for(let v=0;v<nv;v++)for(let a=start[v];a<start[v+1];a++)for(let b=a+1;b<start[v+1];b++){const f=faces[a],g=faces[b];
    if(seeded[f]&&seeded[g]&&withinPlane(f,g))parent[root(f)]=root(g);}
  const groups=new Map(),groupArea=new Map();
  for(let f=0;f<n;f++)if(seeded[f]){const r=root(f);if(!groups.has(r)){groups.set(r,[]);groupArea.set(r,0);}groups.get(r).push(f);groupArea.set(r,groupArea.get(r)+area[f]);}
  const order=[...groups.keys()].sort((a,b)=>groupArea.get(a)!==groupArea.get(b)?groupArea.get(b)-groupArea.get(a):a-b);
  const owner=new Int32Array(n).fill(-1),planes=[];
  let reach=0;for(const v of xyz)reach=Math.max(reach,Math.abs(v));
  // |x| < 2^e over the part; slopes resolve 2^-q, so a plane strays at most closeMm/16
  // across the part; |si*mi|, |sj*mj|, |t| < 2^(e+grid+q) = 2^50 keep x[k] exact.
  const e=reach>0?Math.floor(Math.log2(reach))+1:0,q=e+5+Math.ceil(Math.log2(1/closeMm)),grid=50-e-q;
  for(const r of order){const members=groups.get(r);let best=members[0];for(const f of members)if(area[f]>area[best])best=f;
    const sum=[0,0,0],centre=[0,0,0];let weight=0;
    for(const f of members){const dot=normal[3*f]*normal[3*best]+normal[3*f+1]*normal[3*best+1]+normal[3*f+2]*normal[3*best+2],w=dot>=0?area[f]:-area[f];
      for(let k=0;k<3;k++){sum[k]+=w*normal[3*f+k];centre[k]+=area[f]*(xyz[3*tri[3*f]+k]+xyz[3*tri[3*f+1]+k]+xyz[3*tri[3*f+2]+k])/3;}weight+=area[f];}
    const len=Math.hypot(...sum),unit=sum.map(v=>v/len),at=centre.map(v=>v/weight);
    const a=Math.abs(unit[0])>=Math.abs(unit[1])&&Math.abs(unit[0])>=Math.abs(unit[2])?0:Math.abs(unit[1])>=Math.abs(unit[2])?1:2,i=(a+1)%3,j=(a+2)%3;
    const si=llround(-unit[i]/unit[a]*2**q),sj=llround(-unit[j]/unit[a]*2**q),t=llround((at[a]-si*2**-q*at[i]-sj*2**-q*at[j])*2**(grid+q));
    const kIndex=planes.length;planes.push({k:a,i,j,si,sj,t});
    const near=g=>{for(let c=0;c<3;c++){const v=3*tri[3*g+c];if(Math.abs(unit[0]*(xyz[v]-at[0])+unit[1]*(xyz[v+1]-at[1])+unit[2]*(xyz[v+2]-at[2]))>closeMm)return false;}return true;};
    const queue=[];for(const f of members)if(owner[f]<0&&near(f)){owner[f]=kIndex;queue.push(f);}
    if(!queue.length)continue;out.groups++;
    while(queue.length){const f=queue.pop();out.faces++;for(let c=0;c<3;c++){const v=tri[3*f+c];for(let x=start[v];x<start[v+1];x++){const g=faces[x];if(owner[g]<0&&near(g)){owner[g]=kIndex;queue.push(g);}}}}
  }
  const vertexGroup=new Int32Array(nv).fill(-1);
  for(let f=0;f<n;f++)if(owner[f]>=0)for(let c=0;c<3;c++){const v=tri[3*f+c];if(vertexGroup[v]<0||owner[f]<vertexGroup[v])vertexGroup[v]=owner[f];}
  for(let v=0;v<nv;v++){if(vertexGroup[v]<0)continue;const pl=planes[vertexGroup[v]],p=P(v);
    const si=pl.si*2**-q,sj=pl.sj*2**-q,off=(p[pl.k]-si*p[pl.i]-sj*p[pl.j]-pl.t*2**(-grid-q))/(1+si*si+sj*sj),x=[0,0,0];
    const onGrid=(c,s,y)=>{if(s===0){x[c]=p[c];return 0;}const m=llround(y*2**grid);x[c]=m*2**-grid;return m;};
    const mi=onGrid(pl.i,pl.si,p[pl.i]+off*si),mj=onGrid(pl.j,pl.sj,p[pl.j]+off*sj);x[pl.k]=(pl.si*mi+pl.sj*mj+pl.t)*2**(-grid-q);
    const move=Math.hypot(x[0]-p[0],x[1]-p[1],x[2]-p[2]);
    if(move>closeMm){out.unmovedVertices++;continue;}if(move>0){points.set(x,3*v);moved[v]=1;out.movedVertices++;out.maxDisplacementMm=Math.max(out.maxDisplacementMm,move);}
  }
  return {points,moved,closing:out};
}

// ---------------- refinement: exact arrangement of the triangle soup ----------------
export function anyIntersection(mesh,dirty=null){
  const store=new PointStore(mesh.xyz);return intersectAll(store,mesh.tri,createConstructions(store,mesh.tri),{stopAtFirst:true,dirty}).any;
}
function autorefine(xyz,tri,dirty){
  const store=new PointStore(xyz),build=createConstructions(store,tri),found=intersectAll(store,tri,build,{dirty});
  const {segs,points,parent,root,axis}=found,groups=new Map();
  for(const t of new Set([...segs.keys(),...points.keys(),...parent.keys()])){const r=parent.has(t)?root(t):t;if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t);}
  for(const m of groups.values())m.sort((a,b)=>a-b);
  const M=2**30,superPoints=[0,1,2].map(k=>[[-M,-M],[3*M,-M],[-M,3*M]].map(([u,v])=>{const p=[0,0,0];p[(k+1)%3]=u;p[(k+2)%3]=v;return store.doublePoint(...p);}));
  const stats={...found.stats,refinedSourceTriangles:0,groups:groups.size,largestGroup:0,crossings:0};
  const replaced=new Uint8Array(tri.length/3),soup=[];
  for(const members of groups.values()){stats.largestGroup=Math.max(stats.largestGroup,members.length);
    for(const v of triangulateGroup(store,tri,build,axis[members[0]],members,segs,points,superPoints,stats))soup.push(v);
    for(const m of members)replaced[m]=1;stats.refinedSourceTriangles+=members.length;}
  for(let t=0;t<replaced.length;t++)if(!replaced[t])soup.push(tri[3*t],tri[3*t+1],tri[3*t+2]);
  return {store,soup:Int32Array.from(soup),stats:{...stats,predicates:store.stats}};
}

// ---------------- classification (port of reconstruct's winding logic) ----------------
// Coincident refined triangles add their orientations (net zero is no surface).
// Patches are faces joined across edges only they share, with matching orientation
// and weight; a patch is kept, facing w <= 0, exactly when the winding number w is
// positive on one side only.
function classify(store,soup){
  const {px,py,pz,pd}=store,count=soup.length/3,report={coincidentGroups:0,cancelledTriangles:0,cancelledAreaMm2:0,patches:0,rays:0,rayRetries:0,boundaryTriangles:0,interiorTriangles:0};
  const sorted=new Int32Array(soup.length),sign=new Int8Array(count);
  for(let t=0;t<count;t++){let a=soup[3*t],b=soup[3*t+1],c=soup[3*t+2],s=1;if(a>b){[a,b]=[b,a];s=-s;}if(b>c){[b,c]=[c,b];s=-s;}if(a>b){[a,b]=[b,a];s=-s;}sorted[3*t]=a;sorted[3*t+1]=b;sorted[3*t+2]=c;sign[t]=s;}
  const order=new Uint32Array(count);for(let t=0;t<count;t++)order[t]=t;
  order.sort((x,y)=>sorted[3*x]-sorted[3*y]||sorted[3*x+1]-sorted[3*y+1]||sorted[3*x+2]-sorted[3*y+2]);
  const area=(a,b,c)=>{const ux=px[b]-px[a],uy=py[b]-py[a],uz=pz[b]-pz[a],vx=px[c]-px[a],vy=py[c]-py[a],vz=pz[c]-pz[a];return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;};
  const fv=[],fw=[];
  for(let i=0;i<count;){const t=order[i],a=sorted[3*t],b=sorted[3*t+1],c=sorted[3*t+2];let j=i,net=0;
    while(j<count&&sorted[3*order[j]]===a&&sorted[3*order[j]+1]===b&&sorted[3*order[j]+2]===c)net+=sign[order[j++]];
    if(j-i>1)report.coincidentGroups++;
    if(net>0){fv.push(a,b,c);fw.push(net);}else if(net<0){fv.push(a,c,b);fw.push(-net);}else{report.cancelledTriangles+=j-i;report.cancelledAreaMm2+=(j-i)*area(a,b,c);}
    i=j;}
  const nf=fw.length;if(!nf)throw Error('Solid reconstruction encloses no volume');
  // Edges sorted by (low, high); each must balance, and plain two-face edges join patches.
  const lo=new Int32Array(3*nf),hi=new Int32Array(3*nf),edges=new Uint32Array(3*nf);
  for(let e=0;e<3*nf;e++){const f=(e/3)|0,u=fv[e],v=fv[3*f+(e%3+1)%3];lo[e]=Math.min(u,v);hi[e]=Math.max(u,v);edges[e]=e;}
  edges.sort((x,y)=>lo[x]-lo[y]||hi[x]-hi[y]||x-y);
  const direction=e=>fv[e]<fv[3*((e/3)|0)+(e%3+1)%3]?1:-1;
  const parent=Int32Array.from({length:nf},(_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;};
  for(let i=0;i<edges.length;){let j=i,balance=0;while(j<edges.length&&lo[edges[j]]===lo[edges[i]]&&hi[edges[j]]===hi[edges[i]]){balance+=direction(edges[j])*fw[(edges[j]/3)|0];j++;}
    if(balance!==0)throw Error('Solid reconstruction needs a closed surface, but refined edges are unbalanced');
    if(j-i===2){const f=(edges[i]/3)|0,g=(edges[i+1]/3)|0;if(direction(edges[i])!==direction(edges[i+1])&&fw[f]===fw[g])parent[root(f)]=root(g);}
    i=j;}
  const boxes=new Float64Array(6*nf),all=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let f=0;f<nf;f++){const a=fv[3*f],b=fv[3*f+1],c=fv[3*f+2],d=Math.max(pd[a],pd[b],pd[c]),o=6*f;
    boxes[o]=Math.min(px[a],px[b],px[c])-d;boxes[o+1]=Math.min(py[a],py[b],py[c])-d;boxes[o+2]=Math.min(pz[a],pz[b],pz[c])-d;
    boxes[o+3]=Math.max(px[a],px[b],px[c])+d;boxes[o+4]=Math.max(py[a],py[b],py[c])+d;boxes[o+5]=Math.max(pz[a],pz[b],pz[c])+d;
    for(let k=0;k<3;k++){all[k]=Math.min(all[k],boxes[o+k]);all[3+k]=Math.max(all[3+k],boxes[o+3+k]);}}
  const tree=boxHierarchy(boxes,nf);let size=0;for(let k=0;k<3;k++)size=Math.max(size,all[3+k]-all[k]);
  const reach=4*size+1,margin=NUMERIC_RELATIVE*(size+1),centre=[0,1,2].map(k=>(all[k]+all[3+k])/2);
  // Winding on the side of face f that faces q, from the signed crossings of the
  // segment centroid->q (w(q)=0 outside); null when the segment meets an edge,
  // vertex or plane degenerately and another q is needed.
  const windingToward=(f,q)=>{const t=[fv[3*f],fv[3*f+1],fv[3*f+2]],[A,B,C]=t.map(i=>store.exactPoint(i)),w0=A[3],w1=B[3],w2=C[3];
    const s=store.raw(A[0]*w1*w2+B[0]*w0*w2+C[0]*w0*w1,A[1]*w1*w2+B[1]*w0*w2+C[1]*w0*w1,A[2]*w1*w2+B[2]*w0*w2+C[2]*w0*w1,3n*w0*w1*w2);
    if(store.orient3d(t[0],t[1],t[2],q)===0)return null;
    const a=[px[s],py[s],pz[s]],b=[px[q],py[q],pz[q]];let total=0,degenerate=false;
    tree.querySegment(a,b,margin,g=>{if(degenerate||g===f||!segmentMeetsBox(a,b,boxes,6*g,margin))return;const p=fv[3*g],r=fv[3*g+1],u=fv[3*g+2];
      const os=store.orient3d(p,r,u,s),oq=store.orient3d(p,r,u,q);if(oq===0){degenerate=true;return;}if(os===oq||os===0)return;
      const e1=store.orient3d(s,q,p,r),e2=store.orient3d(s,q,r,u),e3=store.orient3d(s,q,u,p);
      if(!(e1>=0&&e2>=0&&e3>=0)&&!(e1<=0&&e2<=0&&e3<=0))return;
      if(e1===0||e2===0||e3===0){degenerate=true;return;}total+=os>0?fw[g]:-fw[g];});
    return degenerate?null:-total;};
  const members=new Map();for(let f=0;f<nf;f++){const r=root(f);if(!members.has(r))members.set(r,[]);members.get(r).push(f);}
  const kept=[];
  for(const patch of members.values()){report.patches++;let front=0,known=false;
    // Fixed pseudo-random directions keep the result deterministic; the bound only stops a defect.
    for(let attempt=0;!known;attempt++){if(attempt>=64*patch.length)throw Error('No general-position ray for a surface patch');
      const f=patch[attempt%patch.length],angle=2.399963229728653*(attempt+1),z=1-2*((0.6180339887498949*(attempt+1))%1),radius=Math.sqrt(Math.max(0,1-z*z));
      const q=store.doublePoint(Math.round(centre[0]+reach*radius*Math.cos(angle)),Math.round(centre[1]+reach*radius*Math.sin(angle)),Math.round(centre[2]+reach*z));report.rays++;
      const winding=windingToward(f,q);if(winding===null){report.rayRetries++;continue;}
      front=store.orient3d(fv[3*f],fv[3*f+1],fv[3*f+2],q)>0?winding:winding-fw[f];known=true;}
    const back=front+fw[patch[0]];if((front>0)===(back>0)){report.interiorTriangles+=patch.length;continue;}
    for(const f of patch){const a=fv[3*f],b=fv[3*f+1],c=fv[3*f+2];if(front>0)kept.push(a,c,b);else kept.push(a,b,c);}}
  if(!kept.length)throw Error('Solid reconstruction encloses no volume');
  report.boundaryTriangles=kept.length/3;
  return {kept:Int32Array.from(kept),report};
}

// ---------------- tiny-triangle collapse ----------------
// SAAM's mesh contract needs every triangle's height above numeric conditioning.
// A flatter triangle loses its shortest collapsible edge, and any triangle loses an
// edge below print resolution (owner: spacing under functional tolerance merges),
// when that edge has a constructed end, which moves onto the other end; source
// vertices stay. tri marks removed triangles -1.
function collapseTinyTriangles(xyz,tri,isSource,onCollapse,mergeMm=PRINT_RESOLUTION_MM){
  const n=tri.length/3,P=v=>3*v,dist=(s,d)=>Math.hypot(xyz[P(s)]-xyz[P(d)],xyz[P(s)+1]-xyz[P(d)+1],xyz[P(s)+2]-xyz[P(d)+2]);
  const tiny=f=>{const a=P(tri[3*f]),b=P(tri[3*f+1]),c=P(tri[3*f+2]),u=[xyz[b]-xyz[a],xyz[b+1]-xyz[a+1],xyz[b+2]-xyz[a+2]],v=[xyz[c]-xyz[a],xyz[c+1]-xyz[a+1],xyz[c+2]-xyz[a+2]],w=[xyz[c]-xyz[b],xyz[c+1]-xyz[b+1],xyz[c+2]-xyz[b+2]];
    const longest=Math.sqrt(Math.max(u[0]**2+u[1]**2+u[2]**2,v[0]**2+v[1]**2+v[2]**2,w[0]**2+w[1]**2+w[2]**2));
    return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=NUMERIC_MM*longest;};
  // Only triangles with a constructed vertex can change; incidence covers their vertices.
  const candidates=[],incident=new Map();
  for(let f=0;f<n;f++)if(!isSource[tri[3*f]]||!isSource[tri[3*f+1]]||!isSource[tri[3*f+2]]){candidates.push(f);for(let c=0;c<3;c++)incident.set(tri[3*f+c],[]);}
  for(let f=0;f<n;f++)for(let c=0;c<3;c++)incident.get(tri[3*f+c])?.push(f);
  const neighbours=v=>{const s=new Set();for(const f of incident.get(v))for(let c=0;c<3;c++){const x=tri[3*f+c];if(x!==v)s.add(x);}return s;};
  const out={collapsedEdges:0,remaining:0,maxCollapseMm:0};
  for(let changed=true;changed;){changed=false;
    for(const f of candidates){if(tri[3*f]<0)continue;let best=null,length=tiny(f)?Infinity:mergeMm;
      for(let k=0;k<3;k++)for(const [s,d] of [[tri[3*f+k],tri[3*f+(k+1)%3]],[tri[3*f+(k+1)%3],tri[3*f+k]]]){if(isSource[s])continue;const l=dist(s,d);if(l>=length)continue;
        const shared=incident.get(s).filter(g=>incident.get(d).includes(g)),apex=new Set(shared.flatMap(g=>[0,1,2].map(c=>tri[3*g+c]).filter(x=>x!==s&&x!==d)));
        const ns=neighbours(s),nd=neighbours(d),common=[...ns].filter(x=>nd.has(x));
        if(shared.length===2&&common.length===apex.size&&common.every(x=>apex.has(x))){best=[s,d];length=l;}}
      if(!best)continue;const [s,d]=best,into=incident.get(d);
      for(const g of incident.get(s)){if(tri[3*g]===d||tri[3*g+1]===d||tri[3*g+2]===d){for(let c=0;c<3;c++){const x=tri[3*g+c];if(x!==s){const l=incident.get(x);l.splice(l.indexOf(g),1);}tri[3*g+c]=-1;}}
        else{for(let c=0;c<3;c++)if(tri[3*g+c]===s)tri[3*g+c]=d;into.push(g);}}
      incident.set(s,[]);onCollapse(d);out.collapsedEdges++;out.maxCollapseMm=Math.max(out.maxCollapseMm,length);changed=true;}}
  for(let f=0;f<n;f++)if(tri[3*f]>=0&&tiny(f))out.remaining++;
  return out;
}

// ---------------- reconstruction passes ----------------
// Replaces a closed outward surface that crosses itself by the boundary of its
// solid (w > 0), as the native helper's reconstruct(); null when nothing intersects.
// Snap rounding: constructed points round to the rounding-guard lattice (a power of
// two at most print resolution / 1000); source points stay. When rounding creates
// crossings, the triangles it touched are reconstructed again.
export const SNAP_GRID_MM=2**Math.floor(Math.log2(PRINT_RESOLUTION_MM/1000));
export function reconstructSolid({xyz,tri},{closeMm=PRINT_RESOLUTION_MM,snapGridMm=SNAP_GRID_MM,maxPasses=6,progress=()=>{}}={}){
  const passes=[],timings=[];let current={xyz,tri,source:new Uint8Array(xyz.length/3).fill(1),dirty:null};
  for(let pass=0;pass<maxPasses;pass++){
    const t0=performance.now(),r=reconstructOnce(current,{closeMm:pass===0?closeMm:0,snapGridMm,pass,progress});
    if(!r){timings.push({finalProbe:performance.now()-t0});break;}passes.push(r.report);timings.push(r.timings);current=r;
    if(pass===maxPasses-1)throw Error('Rounding the reconstructed surface still creates crossings after '+maxPasses+' passes; no result accepted');
  }
  return passes.length?{xyz:current.xyz,tri:current.tri,passes,timings}:null;
}
function reconstructOnce({xyz,tri,source,dirty},{closeMm,snapGridMm,pass,progress}){
  const clock=()=>performance.now(),timings={};let t0=clock();
  progress({stage:'intersections',pass});const any=anyIntersection({xyz,tri},dirty);timings.probe=clock()-t0;if(!any)return null;t0=clock();
  progress({stage:'close',pass});const {points,moved,closing}=closeOpposedSheets({xyz,tri},closeMm);timings.close=clock()-t0;t0=clock();
  progress({stage:'refine',pass});const refined=autorefine(points,tri,closing.movedVertices?null:dirty);timings.refine=clock()-t0;t0=clock();
  progress({stage:'classify',pass});const {kept,report}=classify(refined.store,refined.soup);timings.classify=clock()-t0;t0=clock();
  progress({stage:'round',pass});
  const store=refined.store,{px,py,pz}=store,inputs=points.length/3,index=new Int32Array(store.count).fill(-1),byPoint=new PointMap(inputs);
  const rounded=new Float64Array(3*store.count),roundedSource=new Uint8Array(store.count),fromConstruction=new Uint8Array(store.count),snap=x=>Math.round(x/snapGridMm)*snapGridMm;
  let vertices=0,merged=0,dropped=0,maxSnapMm=0;
  const vertex=v=>{if(index[v]>=0)return index[v];const x=v<inputs?px[v]:snap(px[v]),y=v<inputs?py[v]:snap(py[v]),z=v<inputs?pz[v]:snap(pz[v]);
    if(v>=inputs)maxSnapMm=Math.max(maxSnapMm,Math.hypot(x-px[v],y-py[v],z-pz[v]));
    let i=byPoint.get(x,y,z);if(i<0){i=vertices++;rounded[3*i]=x;rounded[3*i+1]=y;rounded[3*i+2]=z;byPoint.set(x,y,z,i);}else merged++;
    if(v<inputs&&source[v]&&!moved[v])roundedSource[i]=1;if(v>=inputs)fromConstruction[i]=1;return index[v]=i;};
  // Rounding can make opposed copies coincide; they cancel as in classification.
  const faces=new PointMap(kept.length/3),fr=[],fsign=[],fnet=[];
  for(let t=0;t<kept.length;t+=3){const a=vertex(kept[t]),b=vertex(kept[t+1]),c=vertex(kept[t+2]);
    if(a===b||b===c||a===c){dropped++;continue;}
    let x=a,y=b,z=c,s=1;if(x>y){[x,y]=[y,x];s=-s;}if(y>z){[y,z]=[z,y];s=-s;}if(x>y){[x,y]=[y,x];s=-s;}
    const g=faces.get(x,y,z);if(g>=0)fnet[g]+=s;else{faces.set(x,y,z,fsign.length);fr.push(a,b,c);fsign.push(s);fnet.push(s);}}
  const out=[];let roundingCancelled=0;
  for(let g=0;g<fsign.length;g++){if(fnet[g]===0){roundingCancelled++;continue;}if(Math.sign(fnet[g])===fsign[g])out.push(fr[3*g],fr[3*g+1],fr[3*g+2]);else out.push(fr[3*g],fr[3*g+2],fr[3*g+1]);}
  const outTri=Int32Array.from(out),touched=fromConstruction.slice(0,vertices);
  const collapse=collapseTinyTriangles(rounded,outTri,roundedSource,d=>{touched[d]=1;});
  if(collapse.remaining)throw Error(`${collapse.remaining} reconstructed triangles stay below SAAM's minimum height and cannot be collapsed; no result accepted`);
  const used=new Int32Array(vertices).fill(-1),finalTri=[],finalDirty=[];let nv=0;
  for(let t=0;t<outTri.length;t+=3){if(outTri[t]<0)continue;for(let c=0;c<3;c++){const v=outTri[t+c];if(used[v]<0)used[v]=nv++;finalTri.push(used[v]);}
    finalDirty.push(touched[outTri[t]]|touched[outTri[t+1]]|touched[outTri[t+2]]);}
  const finalXyz=new Float64Array(3*nv),finalSource=new Uint8Array(nv);
  for(let v=0;v<vertices;v++)if(used[v]>=0){finalXyz.set(rounded.subarray(3*v,3*v+3),3*used[v]);finalSource[used[v]]=roundedSource[v];}
  timings.round=clock()-t0;
  return {xyz:finalXyz,tri:Int32Array.from(finalTri),source:finalSource,dirty:Uint8Array.from(finalDirty),timings,
    report:{closing,refinedTriangles:refined.soup.length/3,...report,snapGridMm,maxSnapMm,roundingMergedPoints:merged,roundingDroppedTriangles:dropped,roundingCancelledPairs:roundingCancelled,...collapse,refine:refined.stats}};
}
