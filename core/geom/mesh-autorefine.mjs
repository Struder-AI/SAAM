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
import {ROUNDING_MM,ROUNDING_RELATIVE,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {closestTrianglePoint,trianglesContact,diagonalPatchBound} from './mesh-spatial.mjs';
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
const mix32=h=>{h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);return h^(h>>>16);};
function hashWord(h,v){hashF64[0]=v+0;return mix32(mix32(h+hashU32[0])+hashU32[1]);}
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
  push(x,y,z,d){if(this.count===this.px.length)this.allocate(2*this.count);const i=this.count++;this.lattice.delete(i);this.px[i]=x;this.py[i]=y;this.pz[i]=z;this.pd[i]=d;return i;}
  // Exact homogeneous lattice coordinates [X,Y,Z,W].
  exactPoint(i){
    if(this.pd[i]>0)return this.exact[i-this.n0];
    let p=this.lattice.get(i);if(!p){let S=this.S;const coordinates=[this.px[i],this.py[i],this.pz[i]];
      // Ray ends and query points can have finer dyadic coordinates than the
      // original input lattice. Keep their denominator instead of truncating it.
      if(i>=this.n0)for(let x of coordinates){let s=0;while(!Number.isInteger(x)){x*=2;s++;}S=Math.max(S,s);}
      p=[...coordinates.map(x=>latticeInteger(x,S)),1n<<BigInt(S-this.S)];this.lattice.set(i,p);}return p;
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
// when given). onSheet (per point, or null) names the closing sheet a point lies on
// exactly: a triangle with every corner on one sheet lies in its plane (sheet[t]), so
// two on one sheet are coplanar without orientation tests.
function intersectAll(store,tri,build,{stopAtFirst=false,dirty=null,onSheet=null}={}){
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
  const sheet=new Int32Array(n).fill(-1);
  if(onSheet)for(let t=0;t<n;t++){const s=onSheet[tri[3*t]];if(s>=0&&onSheet[tri[3*t+1]]===s&&onSheet[tri[3*t+2]]===s)sheet[t]=s;}
  const out={segs:new Map(),points:new Map(),parent:new Map(),axis,sheet,any:false,stats:{candidatePairs:0,segmentPairs:0,pointPairs:0,coplanarOverlaps:0,coplanarTouches:0}};
  const root=x=>{let r=x;while(out.parent.has(r)&&out.parent.get(r)!==r)r=out.parent.get(r);return r;};out.root=root;
  const addSeg=(t,s)=>{const l=out.segs.get(t);if(l)l.push(s);else out.segs.set(t,[s]);};
  const addPoint=(t,p)=>{if(tri[3*t]===p||tri[3*t+1]===p||tri[3*t+2]===p)return;const l=out.points.get(t);if(l)l.push(p);else out.points.set(t,[p]);};
  const found=()=>{out.any=true;return stopAtFirst;};
  overlappingBoxPairs(boxes,(i,j)=>{
    if(stopAtFirst&&out.any||dirty&&!dirty[i]&&!dirty[j])return;
    const a0=tri[3*i],a1=tri[3*i+1],a2=tri[3*i+2],b0=tri[3*j],b1=tri[3*j+1],b2=tri[3*j+2];
    let s0=0,s1=0,s2=0,r0=0,r1=0,r2=0;
    if(sheet[i]<0||sheet[i]!==sheet[j]){
      s0=side(i,b0);s1=side(i,b1);s2=side(i,b2);if((s0>0&&s1>0&&s2>0)||(s0<0&&s1<0&&s2<0))return;
      r0=side(j,a0);r1=side(j,a1);r2=side(j,a2);if((r0>0&&r1>0&&r2>0)||(r0<0&&r1<0&&r2<0))return;}
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
  // Coordinate arrays are read after the constructions below, which may grow the store.
  const G=members[0],o=(a,b,c)=>store.orient2d(k,a,b,c),axes=()=>[k===0?store.py:k===1?store.pz:store.px,k===0?store.pz:k===1?store.px:store.py,store.pd];
  const cons=[],seen=new Set(),pset=new Set();
  const addCons=(a,b,line)=>{if(a===b)return;const key=a<b?`${a},${b}`:`${b},${a}`;if(seen.has(key))return;seen.add(key);cons.push({a,b,line});pset.add(a);pset.add(b);};
  for(const m of members){for(let e=0;e<3;e++){const u=tri[3*m+e],v=tri[3*m+(e+1)%3];addCons(u,v,{edge:[u,v]});}
    for(const s of segs.get(m)??[])addCons(s.a,s.b,s.line);for(const p of points.get(m)??[])pset.add(p);}
  // Constraint boxes (2D, with each end's approximation error).
  const consBoxes=new Float64Array(6*cons.length),[U0,V0,pd0]=axes();
  cons.forEach((c,x)=>{const m=Math.max(pd0[c.a],pd0[c.b]),q=6*x;consBoxes[q]=Math.min(U0[c.a],U0[c.b])-m;consBoxes[q+1]=Math.min(V0[c.a],V0[c.b])-m;consBoxes[q+3]=Math.max(U0[c.a],U0[c.b])+m;consBoxes[q+4]=Math.max(V0[c.a],V0[c.b])+m;});
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
  const pts=[...pset],[U,V,pd]=axes();
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
// A closing plane x[k] = (si*x[i] + sj*x[j] + t) / 2^q: with x[i], x[j] on a 2^-grid
// lattice its points are exact doubles. latticePlane rounds a plane (unit normal
// through at) to one; latticePlanePoint gives its point over (ui, uj), a coordinate
// whose slope is zero rounding to step (0 keeps it).
function latticePlane({unit,at},q,grid){
  const k=Math.abs(unit[0])>=Math.abs(unit[1])&&Math.abs(unit[0])>=Math.abs(unit[2])?0:Math.abs(unit[1])>=Math.abs(unit[2])?1:2,i=(k+1)%3,j=(k+2)%3;
  const si=llround(-unit[i]/unit[k]*2**q),sj=llround(-unit[j]/unit[k]*2**q),t=llround((at[k]-si*2**-q*at[i]-sj*2**-q*at[j])*2**(grid+q));
  return {k,i,j,si,sj,t};
}
function latticePlanePoint(plane,{q,grid},ui,uj,step){
  const x=[0,0,0],lattice=(c,s,y)=>{if(s===0){x[c]=step?Math.round(y/step)*step:y;return 0;}const m=llround(y*2**grid);x[c]=m*2**-grid;return m;};
  const mi=lattice(plane.i,plane.si,ui),mj=lattice(plane.j,plane.sj,uj);x[plane.k]=(plane.si*mi+plane.sj*mj+plane.t)*2**(-grid-q);return x;
}
// Opposed sheets of the source closer than closeMm (print resolution), in any
// orientation, would reconstruct as a film below print resolution that thins to
// knife edges. Faces that face each other or away, lie within closeMm of each
// other's planes and come within closeMm are seeded pairs; seeds form groups, joined
// through shared vertices of seeded faces coplanar within closeMm. Each group claims,
// from its seeds across shared vertices, the faces within closeMm of the plane fitted
// to its seeds. Claims that share a vertex or a seeded pair are one sheet with one
// closing plane fitted to all its faces, and every vertex of a sheet moves onto it
// (at most closeMm): a sheet's faces are exactly coplanar and its opposed copies
// cancel. onSheet[v] names the sheet vertex v lies on (-1: none).
function closeOpposedSheets({xyz,tri},closeMm){
  const out={method:'opposed-sheet-plane/2',toleranceMm:closeMm,groups:0,faces:0,movedVertices:0,unmovedVertices:0,maxDisplacementMm:0},points=xyz.slice(),moved=new Uint8Array(xyz.length/3);
  if(!(closeMm>0))return {points,moved,closing:out};
  const n=tri.length/3,nv=xyz.length/3,normal=new Float64Array(3*n),area=new Float64Array(n),boxes=packedBoxes(xyz,tri,closeMm),{start,faces}=incidence(nv,tri);
  const P=v=>[xyz[3*v],xyz[3*v+1],xyz[3*v+2]],corners=f=>[P(tri[3*f]),P(tri[3*f+1]),P(tri[3*f+2])];
  for(let f=0;f<n;f++){const [a,b,c]=corners(f),u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const x=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...x);normal.set(l>0?x.map(q=>q/l):x,3*f);area[f]=l/2;}
  const offset=(f,v)=>{const o=3*tri[3*f];return normal[3*f]*(xyz[3*v]-xyz[o])+normal[3*f+1]*(xyz[3*v+1]-xyz[o+1])+normal[3*f+2]*(xyz[3*v+2]-xyz[o+2]);};
  const withinPlane=(f,g)=>{for(const [p,q] of [[f,g],[g,f]])for(let k=0;k<3;k++)if(Math.abs(offset(p,tri[3*q+k]))>closeMm)return false;return true;};
  const shareVertex=(f,g)=>{for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(tri[3*f+a]===tri[3*g+b])return true;return false;};
  const parent=Int32Array.from({length:n},(_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;},seeded=new Uint8Array(n),seedPairs=[];
  overlappingBoxPairs(boxes,(f,g)=>{
    if(normal[3*f]*normal[3*g]+normal[3*f+1]*normal[3*g+1]+normal[3*f+2]*normal[3*g+2]>=0||shareVertex(f,g))return;
    if(!withinPlane(f,g)||!trianglesWithin(corners(f),corners(g),closeMm))return;
    parent[root(f)]=root(g);seeded[f]=seeded[g]=1;seedPairs.push(f,g);});
  for(let v=0;v<nv;v++)for(let a=start[v];a<start[v+1];a++)for(let b=a+1;b<start[v+1];b++){const f=faces[a],g=faces[b];
    if(seeded[f]&&seeded[g]&&withinPlane(f,g))parent[root(f)]=root(g);}
  const groups=new Map(),groupArea=new Map();
  for(let f=0;f<n;f++)if(seeded[f]){const r=root(f);if(!groups.has(r)){groups.set(r,[]);groupArea.set(r,0);}groups.get(r).push(f);groupArea.set(r,groupArea.get(r)+area[f]);}
  const order=[...groups.keys()].sort((a,b)=>groupArea.get(a)!==groupArea.get(b)?groupArea.get(b)-groupArea.get(a):a-b);
  // Area-weighted plane of faces, normals oriented as the largest face's.
  const fit=members=>{let best=members[0];for(const f of members)if(area[f]>area[best])best=f;
    const sum=[0,0,0],centre=[0,0,0];let weight=0;
    for(const f of members){const dot=normal[3*f]*normal[3*best]+normal[3*f+1]*normal[3*best+1]+normal[3*f+2]*normal[3*best+2],w=dot>=0?area[f]:-area[f];
      for(let k=0;k<3;k++){sum[k]+=w*normal[3*f+k];centre[k]+=area[f]*(xyz[3*tri[3*f]+k]+xyz[3*tri[3*f+1]+k]+xyz[3*tri[3*f+2]+k])/3;}weight+=area[f];}
    const len=Math.hypot(...sum);return {unit:sum.map(v=>v/len),at:centre.map(v=>v/weight)};};
  const owner=new Int32Array(n).fill(-1);let claims=0;
  for(const r of order){const members=groups.get(r),{unit,at}=fit(members),claim=claims;
    const near=g=>{for(let c=0;c<3;c++){const v=3*tri[3*g+c];if(Math.abs(unit[0]*(xyz[v]-at[0])+unit[1]*(xyz[v+1]-at[1])+unit[2]*(xyz[v+2]-at[2]))>closeMm)return false;}return true;};
    const queue=[];for(const f of members)if(owner[f]<0&&near(f)){owner[f]=claim;queue.push(f);}
    if(!queue.length)continue;claims++;
    while(queue.length){const f=queue.pop();for(let c=0;c<3;c++){const v=tri[3*f+c];for(let x=start[v];x<start[v+1];x++){const g=faces[x];if(owner[g]<0&&near(g)){owner[g]=claim;queue.push(g);}}}}
  }
  // Claims that share a vertex or a seeded pair are one sheet.
  const claimParent=Int32Array.from({length:claims},(_,i)=>i),top=x=>{while(claimParent[x]!==x)x=claimParent[x]=claimParent[claimParent[x]];return x;};
  const join=(x,y)=>{const a=top(x),b=top(y);if(a!==b)claimParent[Math.max(a,b)]=Math.min(a,b);};
  for(let v=0;v<nv;v++){let first=-1;for(let a=start[v];a<start[v+1];a++){const o=owner[faces[a]];if(o<0)continue;if(first<0)first=o;else join(first,o);}}
  for(let s=0;s<seedPairs.length;s+=2)if(owner[seedPairs[s]]>=0&&owner[seedPairs[s+1]]>=0)join(owner[seedPairs[s]],owner[seedPairs[s+1]]);
  const sheetOfClaim=new Int32Array(claims).fill(-1),sheetFaces=[];
  for(let f=0;f<n;f++)if(owner[f]>=0){const r=top(owner[f]);if(sheetOfClaim[r]<0){sheetOfClaim[r]=sheetFaces.length;sheetFaces.push([]);}sheetFaces[sheetOfClaim[r]].push(f);}
  // |x| < 2^e over the part; slopes resolve 2^-q, so a plane strays at most closeMm/16
  // across the part; |si*mi|, |sj*mj|, |t| < 2^(e+grid+q) = 2^50 keep x[k] exact.
  let reach=0;for(const v of xyz)reach=Math.max(reach,Math.abs(v));
  const e=reach>0?Math.floor(Math.log2(reach))+1:0,q=e+5+Math.ceil(Math.log2(1/closeMm)),grid=50-e-q,sheets={planes:sheetFaces.map(m=>latticePlane(fit(m),q,grid)),q,grid};
  const onSheet=new Int32Array(nv).fill(-1);out.groups=sheetFaces.length;
  sheetFaces.forEach((members,s)=>{out.faces+=members.length;for(const f of members)for(let c=0;c<3;c++)onSheet[tri[3*f+c]]=s;});
  for(let v=0;v<nv;v++){if(onSheet[v]<0)continue;const pl=sheets.planes[onSheet[v]],p=P(v);
    const si=pl.si*2**-q,sj=pl.sj*2**-q,off=(p[pl.k]-si*p[pl.i]-sj*p[pl.j]-pl.t*2**(-grid-q))/(1+si*si+sj*sj);
    const x=latticePlanePoint(pl,sheets,p[pl.i]+off*si,p[pl.j]+off*sj,0),move=Math.hypot(x[0]-p[0],x[1]-p[1],x[2]-p[2]);
    if(move>closeMm){onSheet[v]=-1;out.unmovedVertices++;continue;}if(move>0){points.set(x,3*v);moved[v]=1;out.movedVertices++;out.maxDisplacementMm=Math.max(out.maxDisplacementMm,move);}
  }
  return {points,moved,closing:out,sheets,onSheet};
}

// ---------------- refinement: exact arrangement of the triangle soup ----------------
export function anyIntersection(mesh,dirty=null,onSheet=null){
  const store=new PointStore(mesh.xyz);return intersectAll(store,mesh.tri,createConstructions(store,mesh.tri),{stopAtFirst:true,dirty,onSheet}).any;
}
// onSheet (per input vertex, or null) names closing sheets; a group whose plane is a
// sheet's (a member with all corners on it) puts its points on that sheet, and
// pointSheet records it for each constructed point (the first sheet that claims it).
function autorefine(xyz,tri,dirty,onSheet){
  const store=new PointStore(xyz),build=createConstructions(store,tri),found=intersectAll(store,tri,build,{dirty,onSheet}),pointSheet=new Map();
  const {segs,points,parent,root,axis,sheet:faceSheet}=found,groups=new Map();
  for(const t of new Set([...segs.keys(),...points.keys(),...parent.keys()])){const r=parent.has(t)?root(t):t;if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t);}
  for(const m of groups.values())m.sort((a,b)=>a-b);
  const M=2**30,superPoints=[0,1,2].map(k=>[[-M,-M],[3*M,-M],[-M,3*M]].map(([u,v])=>{const p=[0,0,0];p[(k+1)%3]=u;p[(k+2)%3]=v;return store.doublePoint(...p);}));
  const stats={...found.stats,refinedSourceTriangles:0,groups:groups.size,largestGroup:0,crossings:0};
  const replaced=new Uint8Array(tri.length/3),soup=[];
  for(const members of groups.values()){stats.largestGroup=Math.max(stats.largestGroup,members.length);const sheet=members.map(t=>faceSheet[t]).find(s=>s>=0)??-1;
    for(const v of triangulateGroup(store,tri,build,axis[members[0]],members,segs,points,superPoints,stats)){soup.push(v);if(sheet>=0&&v>=store.n0&&!pointSheet.has(v))pointSheet.set(v,sheet);}
    for(const m of members)replaced[m]=1;stats.refinedSourceTriangles+=members.length;}
  for(let t=0;t<replaced.length;t++)if(!replaced[t])soup.push(tri[3*t],tri[3*t+1],tri[3*t+2]);
  return {store,soup:Int32Array.from(soup),pointSheet,stats:{...stats,predicates:store.stats}};
}

// ---------------- classification (port of reconstruct's winding logic) ----------------
// Coincident refined triangles add their orientations (net zero is no surface).
// Patches are faces joined across edges only they share, with matching orientation
// and weight; a patch is kept, facing w <= 0, exactly when the winding number w is
// positive on one side only.
function classify(store,soup){
  // Rays add points, which may grow the store's arrays: these serve existing points only.
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
  const reach=4*size+1,margin=ROUNDING_RELATIVE*(size+1),centre=[0,1,2].map(k=>(all[k]+all[3+k])/2);
  // Winding on the side of face f that faces q, from the signed crossings of the
  // segment centroid->q (w(q)=0 outside); null when the segment meets an edge,
  // vertex or plane degenerately and another q is needed.
  const windingToward=(f,q)=>{const t=[fv[3*f],fv[3*f+1],fv[3*f+2]],[A,B,C]=t.map(i=>store.exactPoint(i)),w0=A[3],w1=B[3],w2=C[3];
    const s=store.raw(A[0]*w1*w2+B[0]*w0*w2+C[0]*w0*w1,A[1]*w1*w2+B[1]*w0*w2+C[1]*w0*w1,A[2]*w1*w2+B[2]*w0*w2+C[2]*w0*w1,3n*w0*w1*w2);
    if(store.orient3d(t[0],t[1],t[2],q)===0)return null;
    const a=[store.px[s],store.py[s],store.pz[s]],b=[store.px[q],store.py[q],store.pz[q]];let total=0,degenerate=false;
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

// ---------------- edge collapse ----------------
// SAAM's mesh contract needs every triangle's height above the rounding guard.
function belowHeightContract(xyz,a,b,c){return belowHeight(xyz,a,b,c,ROUNDING_MM);}
function belowHeight(xyz,a,b,c,heightMm){
  const A=3*a,B=3*b,C=3*c,u=[xyz[B]-xyz[A],xyz[B+1]-xyz[A+1],xyz[B+2]-xyz[A+2]],v=[xyz[C]-xyz[A],xyz[C+1]-xyz[A+1],xyz[C+2]-xyz[A+2]],w=[xyz[C]-xyz[B],xyz[C+1]-xyz[B+1],xyz[C+2]-xyz[B+2]];
  const longest=Math.sqrt(Math.max(u[0]**2+u[1]**2+u[2]**2,v[0]**2+v[1]**2+v[2]**2,w[0]**2+w[1]**2+w[2]**2));
  return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=heightMm*longest;
}
// Edge collapses on a flat triangle list (removed triangles -1) with its vertex
// incidence. Collapsing s into d keeps d where it is; the surface stays a manifold when
// the edge has two faces and the full vertex links meet only in its two apex
// vertices (no common link edge, including a tetrahedral component). collapse returns the
// record restore undoes.
function edgeCollapses(tri,vertexCount){
  const incident=Array.from({length:vertexCount},()=>[]);for(let f=0;f<tri.length/3;f++)if(tri[3*f]>=0)for(let c=0;c<3;c++)incident[tri[3*f+c]].push(f);
  const has=(f,v)=>tri[3*f]===v||tri[3*f+1]===v||tri[3*f+2]===v;
  const ring=v=>{const s=new Set();for(const f of incident[v])for(let c=0;c<3;c++)s.add(tri[3*f+c]);return s;};
  const linkEdges=v=>new Set(incident[v].map(f=>{const other=[tri[3*f],tri[3*f+1],tri[3*f+2]].filter(x=>x!==v);return other[0]<other[1]?other[0]+':'+other[1]:other[1]+':'+other[0];}));
  const joined=(s,d)=>incident[s].some(f=>has(f,d));
  const manifold=(s,d)=>{const shared=incident[s].filter(f=>has(f,d));if(shared.length!==2)return false;
    const apex=new Set(shared.flatMap(f=>[0,1,2].map(c=>tri[3*f+c]).filter(x=>x!==s&&x!==d))),rd=ring(d),common=[...ring(s)].filter(x=>x!==s&&x!==d&&rd.has(x));
    const ld=linkEdges(d);return common.length===apex.size&&common.every(x=>apex.has(x))&&![...linkEdges(s)].some(e=>ld.has(e));};
  // The triangles of s off the edge sd, as collapsing s into d leaves them.
  const moved=(s,d)=>incident[s].filter(f=>!has(f,d)).map(f=>[0,1,2].map(c=>tri[3*f+c]===s?d:tri[3*f+c]));
  const collapse=(s,d)=>{const undo={lists:new Map(),faces:[]};
    for(const v of [...ring(s),...ring(d)])if(!undo.lists.has(v))undo.lists.set(v,incident[v].slice());
    for(const f of incident[s]){undo.faces.push(f,tri[3*f],tri[3*f+1],tri[3*f+2]);
      if(has(f,d)){for(let c=0;c<3;c++){const x=tri[3*f+c];if(x!==s){const l=incident[x];l.splice(l.indexOf(f),1);}tri[3*f+c]=-1;}}
      else{for(let c=0;c<3;c++)if(tri[3*f+c]===s)tri[3*f+c]=d;incident[d].push(f);}}
    incident[s]=[];return undo;};
  const restore=({lists,faces})=>{for(const [v,l] of lists)incident[v]=l;for(let i=0;i<faces.length;i+=4)for(let c=0;c<3;c++)tri[3*faces[i]+c]=faces[i+1+c];};
  return {incident,ring,joined,manifold,moved,collapse,restore};
}

// Rounding-guard box of live face f of T, written at out[o..o+5].
function guardBox(xyz,T,f,out,o){
 for(let k=0;k<3;k++){const a=xyz[3*T[3*f]+k],b=xyz[3*T[3*f+1]+k],c=xyz[3*T[3*f+2]+k];out[o+k]=Math.min(a,b,c)-ROUNDING_MM;out[o+3+k]=Math.max(a,b,c)+ROUNDING_MM;}
}
function boxesMeet(A,a,B,b){return !(A[a]>B[b+3]||B[b]>A[a+3]||A[a+1]>B[b+4]||B[b+1]>A[a+4]||A[a+2]>B[b+5]||B[b+2]>A[a+5]);}
// Rounding-guard boxes of T's live faces when built, for changedContactFaces. Faces
// whose corners change afterwards are marked in edited and listed once in editedList
// by the owner of T; they are tested at their current corners instead.
function contactIndex(xyz,T,edited,editedList){
 const items=[];for(let f=0;f<T.length/3;f++)if(T[3*f]>=0)items.push(f);
 const boxes=new Float64Array(6*items.length);items.forEach((f,i)=>guardBox(xyz,T,f,boxes,6*i));
 return {tree:boxHierarchy(boxes),items,boxes,edited,editedList};
}
// Exact crossings and the same rounding-guard contacts publication rejects, of the
// changed faces. Only faces whose rounding-guard boxes meet a changed face's take
// part: through index (contactIndex) when given, else by one pass over T.
function changedContactFaces(xyz,T,changed,onSheet,store=new PointStore(xyz),index=null){
 const n=T.length/3,ids=[...new Set(changed)].filter(f=>T[3*f]>=0);if(!ids.length)return new Set();
 const near=new Float64Array(6*ids.length),selected=new Set(ids),others=[],box=new Float64Array(6);ids.forEach((f,i)=>guardBox(xyz,T,f,near,6*i));
 const meetsNear=(B,b)=>{for(let i=0;i<ids.length;i++)if(boxesMeet(B,b,near,6*i))return true;return false;};
 if(index){
  for(let i=0;i<ids.length;i++)index.tree.queryBox(near,6*i,k=>{const g=index.items[k];if(index.edited[g]||T[3*g]<0||selected.has(g)||!boxesMeet(index.boxes,6*k,near,6*i))return;selected.add(g);others.push(g);});
  for(const g of index.editedList){if(T[3*g]<0||selected.has(g))continue;guardBox(xyz,T,g,box,0);if(meetsNear(box,0)){selected.add(g);others.push(g);}}
 }else{const tree=boxHierarchy(near);
  for(let f=0;f<n;f++){if(T[3*f]<0||selected.has(f))continue;guardBox(xyz,T,f,box,0);let meets=false;tree.queryBox(box,0,i=>{if(!meets&&boxesMeet(box,0,near,6*i))meets=true;});if(meets)others.push(f);}}
 // Changed faces first, then the rest in face order.
 others.sort((a,b)=>a-b);const live=[...ids,...others];
 const packed=new Int32Array(3*live.length),dirty=new Uint8Array(live.length);live.forEach((f,i)=>{packed[3*i]=T[3*f];packed[3*i+1]=T[3*f+1];packed[3*i+2]=T[3*f+2];});dirty.fill(1,0,ids.length);const found=intersectAll(store,packed,createConstructions(store,packed),{dirty,onSheet}),hit=new Set();for(const i of [...found.segs.keys(),...found.points.keys(),...found.parent.keys()])if(dirty[i])hit.add(live[i]);
 // Each pair is measured once, and only while it can still add a changed face.
 const boxes=packedBoxes(xyz,packed,ROUNDING_MM),tree=boxHierarchy(boxes),point=v=>[xyz[3*v],xyz[3*v+1],xyz[3*v+2]],corners=i=>[packed[3*i],packed[3*i+1],packed[3*i+2]];for(let f=0;f<ids.length;f++)tree.queryBox(boxes,6*f,g=>{if(f===g||dirty[g]&&g<f||hit.has(live[f])&&(!dirty[g]||hit.has(live[g])))return;for(let k=0;k<3;k++)if(boxes[6*f+k]>boxes[6*g+k+3]||boxes[6*g+k]>boxes[6*f+k+3])return;const[i,j]=live[f]<live[g]?[f,g]:[g,f],a=corners(i),b=corners(j);if(trianglesContact(a.map(point),b.map(point),a.filter(v=>b.includes(v)).map(point))){if(dirty[f])hit.add(live[f]);if(dirty[g])hit.add(live[g]);}});return hit;
}

// Candidates are slivers below the height contract that touch a vertex in scan;
// height never permits a long vertex move. Adapt Milenkovic/Sacks' local
// skinny-triangle flips, with SAAM's independent surface
// error bound taking precedence over quality (Hu et al., arXiv:1611.02147).
// One call flips disjoint quadrilaterals once, in place. No coordinate moves; a
// flip's paired patch distance (zero when coplanar) adds to its faces' spent value.
function improveSliverTriangulation({xyz,tri:T,onSheet,spent,refusedFlips=new Set(),scan,touched},toleranceMm=PRINT_RESOLUTION_MM){
 const n=T.length/3,nv=xyz.length/3,report={candidateFaces:0,flippedEdges:0,contactsUndone:0,deferred:0},candidates=[];
 for(let f=0;f<n;f++)if(T[3*f]>=0&&(scan[T[3*f]]||scan[T[3*f+1]]||scan[T[3*f+2]])&&belowHeight(xyz,T[3*f],T[3*f+1],T[3*f+2],2*ROUNDING_MM))candidates.push(f);
 if(!candidates.length)return report;
 const store=new PointStore(xyz);let S=store.S;
 for(let value of[toleranceMm,ROUNDING_MM]){let bits=0;while(!Number.isInteger(value)){value*=2;bits++;}S=Math.max(S,bits);}
 const scale=1n<<BigInt(S-store.S),points=new Array(nv),exact={vertex:v=>points[v]??=store.exactPoint(v).slice(0,3).map(x=>x*scale),number:x=>latticeInteger(x,S)};
 const sub=(a,b)=>a.map((x,k)=>x-b[k]),square=v=>v.reduce((s,x)=>s+x*x,0n),height=t=>{const[a,b,c]=t.map(exact.vertex),u=sub(b,a),v=sub(c,a),w=sub(c,b),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];return[square(normal),[square(u),square(v),square(w)].reduce((a,b)=>a>b?a:b)];},compare=(a,b)=>bsign(a[0]*b[1]-b[0]*a[1]),limit=exact.number(ROUNDING_MM)**2n,rounding=exact.number(ROUNDING_MM)**2n,key=(a,b)=>a<b?a+':'+b:b+':'+a,edges=new Map();
 for(let f=0;f<n;f++)if(T[3*f]>=0)for(let k=0;k<3;k++){const id=key(T[3*f+k],T[3*f+(k+1)%3]),list=edges.get(id)??[];list.push(f);edges.set(id,list);}
 const locked=new Uint8Array(nv),proposals=[];
 for(const f of candidates){const face=Array.from(T.subarray(3*f,3*f+3)),oldHeight=height(face);if(oldHeight[0]>=limit*oldHeight[1])continue;report.candidateFaces++;
  // A flip blocked by a neighbour's reservation is retried next round.
  const defer=()=>{for(const id of face)touched[id]=1;report.deferred++;};if(face.some(v=>locked[v])){defer();continue;}let blocked=false,proposed=false;
  for(let k=0;k<3;k++){const h=face[k],t=face[(k+1)%3],v=face[(k+2)%3],support=edges.get(key(h,t));if(support?.length!==2)continue;const g=support.find(id=>id!==f),other=Array.from(T.subarray(3*g,3*g+3)),w=other.find(id=>id!==h&&id!==t);const flipKey=key(h,t)+'>'+key(v,w);if(w!==undefined&&locked[w]){blocked=true;continue;}if(w===undefined||edges.has(key(v,w))||refusedFlips.has(flipKey))continue;
   const fresh=[[v,h,w],[v,w,t]],before=[oldHeight,height(other)].sort(compare),after=fresh.map(height).sort(compare);if(after.some(a=>a[0]<=rounding*a[1]))continue;const oldBad=before.filter(a=>a[0]<limit*a[1]).length,newBad=after.filter(a=>a[0]<limit*a[1]).length;if(newBad>oldBad||newBad===oldBad&&!(compare(after[0],before[0])>0||compare(after[0],before[0])===0&&compare(after[1],before[1])>0))continue;
   const base=Math.max(spent[f],spent[g]),remaining=(toleranceMm-base)*(1-2**-46);if(!(remaining>0))continue;
   const bound=diagonalPatchBound(xyz,exact,h,t,v,w,remaining);if(bound===null||base+bound>=toleranceMm)continue;
   proposed=true;for(const id of[h,t,v,w])locked[id]=1;proposals.push({faces:[f,g],before:[face,other],after:fresh,spent:[spent[f],spent[g]],value:base+bound,flipKey,quad:[h,t,v,w]});break;
  }
  if(blocked&&!proposed)defer();
 }
 // Like collapses, a flip stays unless it adds rounding-guard contacts; an undone
 // flip is not proposed again, so it cannot keep reserving its neighbours.
 const contacts=changedContactFaces(xyz,T,proposals.flatMap(p=>p.faces),onSheet,store);
 for(const p of proposals){p.contacts=p.faces.filter(f=>contacts.has(f)).length;p.faces.forEach((f,k)=>{T.set(p.after[k],3*f);spent[f]=p.value;});}
 const active=new Set(proposals);for(let undone=true;undone;){undone=false;const hit=changedContactFaces(xyz,T,[...active].flatMap(p=>p.faces),onSheet,store);
  for(const p of active){const c=p.faces.filter(f=>hit.has(f)).length;if(c>p.contacts){p.faces.forEach((f,k)=>{T.set(p.before[k],3*f);spent[f]=p.spent[k];});active.delete(p);refusedFlips.add(p.flipKey);for(const id of p.quad)touched[id]=1;report.contactsUndone++;undone=true;}}}
 for(const p of active)for(const id of p.quad)touched[id]=1;
 report.flippedEdges=active.size;return report;
}

// ---------------- merging vertices closer than print resolution ----------------
// Vertices of the converged surface closer than mergeMm (print resolution) are one
// point of the print (owner, 2026-10-06: vertex spacing under functional tolerances
// merges). The closest pairs merge first: their edge collapses into the end that
// stays (an unmoved source vertex, else one on a closing sheet, when only one end is;
// either otherwise), so no point is constructed. Collapsing s into d moves the faces
// of s by at most |sd| (removed faces map onto the kept edge); they take the largest
// spent value among them plus that distance, which must stay below mergeMm. A pair
// collapse keeps the surface a manifold with every triangle above the height
// contract. Edits apply to tri in place; rounds repeat while one collapses.
function mergeMeshVertices({xyz,tri:T,source,onSheet,spent,scan,touched},mergeMm=PRINT_RESOLUTION_MM){
  if(!Number.isFinite(mergeMm)||mergeMm<0)throw Error('Surface cleanup needs a nonnegative finite displacement limit.');
  const nv=xyz.length/3,n=T.length/3,edges=edgeCollapses(T,nv),{incident,ring}=edges,P=v=>3*v,store=new PointStore(xyz);
  const dist=(a,b)=>Math.hypot(xyz[P(a)]-xyz[P(b)],xyz[P(a)+1]-xyz[P(b)+1],xyz[P(a)+2]-xyz[P(b)+2]),rank=v=>source[v]?2:onSheet[v]>=0?1:0;
  // Vertex pairs closer than mergeMm, closest first (a sweep along x); vertices keep
  // their positions, so a pair stays one while both ends are live.
  const pairs=[];{const order=Int32Array.from({length:nv},(_,v)=>v).sort((a,b)=>xyz[P(a)]-xyz[P(b)]);
    for(let i=0;i<nv;i++)for(let j=i+1;j<nv&&xyz[P(order[j])]-xyz[P(order[i])]<mergeMm;j++){const a=Math.min(order[i],order[j]),b=Math.max(order[i],order[j]),d=dist(a,b);if(d<mergeMm)pairs.push({a,b,d});}
    pairs.sort((p,q)=>p.d-q.d||p.a-q.a||p.b-q.b);}
  const livePairs=()=>pairs.filter(({a,b})=>incident[a].length&&incident[b].length);
  // A collapse moves the faces of s by at most |sd|. A nearly flat star bounds it tighter:
  // with the plane through s along the star's area-weighted normal, if every kept old face
  // and every new face projects without folding and the old fan turns once around s,
  // both stars are graphs over the same outline within eps of the plane, so they differ
  // by at most 2 eps.
  const point=v=>[xyz[P(v)],xyz[P(v)+1],xyz[P(v)+2]],minus=(p,q)=>[p[0]-q[0],p[1]-q[1],p[2]-q[2]],times=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],along=(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2];
  const flatBound=(s,d)=>{
    const S=point(s),old=incident[s].map(f=>[T[3*f],T[3*f+1],T[3*f+2]]),normal=[0,0,0];
    for(const t of old){const n=times(minus(point(t[1]),point(t[0])),minus(point(t[2]),point(t[0])));for(let k=0;k<3;k++)normal[k]+=n[k];}
    const length=Math.hypot(...normal);if(!(length>0))return Infinity;const unit=normal.map(x=>x/length);
    const up=t=>along(times(minus(point(t[1]),point(t[0])),minus(point(t[2]),point(t[0]))),unit)>0;
    if(!old.filter(t=>!t.includes(d)).every(up)||!edges.moved(s,d).every(up))return Infinity;
    let turn=0,eps=0;for(const t of old){const k=t.indexOf(s),a=minus(point(t[(k+1)%3]),S),b=minus(point(t[(k+2)%3]),S),pa=a.map((x,i)=>x-along(a,unit)*unit[i]),pb=b.map((x,i)=>x-along(b,unit)*unit[i]);
      turn+=Math.atan2(along(times(pa,pb),unit),along(pa,pb));for(const v of t)eps=Math.max(eps,Math.abs(along(minus(point(v),S),unit)));}
    return Math.abs(turn-2*Math.PI)<Math.PI?2*eps:Infinity;};
  const cost=(s,d)=>{let m=0;for(const f of incident[s])m=Math.max(m,spent[f]);return m+Math.min(dist(s,d),flatBound(s,d))*(1+2**-48);},fits=(s,d)=>cost(s,d)<mergeMm*(1-2**-46);
  // Why collapsing s into d is refused, or null.
  const refusal=(s,d)=>!edges.joined(s,d)?'notJoined':!edges.manifold(s,d)?'manifold':!fits(s,d)?'displacement':
    edges.moved(s,d).some(t=>belowHeightContract(xyz,...t))?'height':null;
  // Faces a collapse edits, for the contact index built at the first contact query.
  const edited=new Uint8Array(n),editedList=[],contacts={index:null};
  const merge=(s,d)=>{const value=cost(s,d),moved=incident[s].slice(),previous=moved.map(f=>spent[f]),u={s,d,moved,previous,...edges.collapse(s,d)};
    for(const f of moved){spent[f]=value;if(!edited[f]){edited[f]=1;editedList.push(f);}}return u;};
  const unmerge=u=>{edges.restore(u);u.moved.forEach((f,i)=>{spent[f]=u.previous[i];});};
  const crossing=changed=>changedContactFaces(xyz,T,changed,onSheet,store,contacts.index??=contactIndex(xyz,T,edited,editedList));
  const crossed=new Set(),report={rounds:0,mergedVertices:0,sliverCollapses:0,crossingUndone:0,closePairs:pairs.length,remainingPairs:0,remaining:{}};
  // A round collapses edges whose neighbourhoods are disjoint, then undoes each whose
  // changed triangles touch (exact crossing or rounding-guard contact) more
  // triangles than before, and that direction is not tried again. The converged
  // surface can carry contacts; an edit that does not add one stays. Returns the
  // number kept.
  const settle=proposals=>{const before=crossing(proposals.flatMap(([s])=>incident[s])),count=(u,hit)=>{let c=0;for(let i=0;i<u.faces.length;i+=4)if(hit.has(u.faces[i]))c++;return c;};
    const open=new Set(proposals.map(([s,d])=>{const u=merge(s,d);u.contacts=count(u,before);return u;}));
    for(let undone=true;undone;){undone=false;const hit=crossing([...open].flatMap(u=>u.faces.filter((_,i)=>i%4===0)));
      for(const u of open){const c=count(u,hit);if(c>u.contacts){unmerge(u);open.delete(u);crossed.add(u.s*nv+u.d);report.crossingUndone++;undone=true;}}}
    // Every corner of a changed face, so a neighbour across one of its edges is seen again.
    for(const u of open)for(const f of incident[u.d])for(let c=0;c<3;c++){touched[T[3*f+c]]=1;watch[T[3*f+c]]=1;}return open.size;};
  // Slivers first. Narrowness only selects a triangle: it loses its shortest edge
  // whose collapse passes the manifold and spent-allowance tests of a pair; a
  // triangle the collapse leaves thin is a later candidate.
  const sliverEdge=f=>{const v=[T[3*f],T[3*f+1],T[3*f+2]],order=[0,1,2].sort((i,j)=>dist(v[i],v[(i+1)%3])-dist(v[j],v[(j+1)%3]));
    for(const k of order){const a=v[k],b=v[(k+1)%3];for(const [s,d] of rank(a)<=rank(b)?[[a,b],[b,a]]:[[b,a],[a,b]])
      if(!crossed.has(s*nv+d)&&edges.manifold(s,d)&&fits(s,d))return [s,d];}
    return null;};
  const watch=scan.slice();
  for(;;){const locked=new Uint8Array(nv),proposals=[];
    for(let f=0;f<n;f++){if(T[3*f]<0||!(watch[T[3*f]]||watch[T[3*f+1]]||watch[T[3*f+2]])||!belowHeightContract(xyz,T[3*f],T[3*f+1],T[3*f+2]))continue;const e=sliverEdge(f);if(!e)continue;
      const near=new Set([...ring(e[0]),...ring(e[1])]);if([...near].some(v=>locked[v]))continue;proposals.push(e);for(const v of near)locked[v]=1;}
    if(!proposals.length)break;const kept=settle(proposals);if(!kept)break;report.sliverCollapses+=kept;
  }
  for(;;){const locked=new Uint8Array(nv),proposals=[];
    for(const {a,b} of livePairs()){if(locked[a]||locked[b])continue;
      const near=new Set([...ring(a),...ring(b)]);if([...near].some(v=>locked[v]))continue;
      for(const [s,d] of rank(a)<=rank(b)?[[a,b],[b,a]]:[[b,a],[a,b]]){
        if(crossed.has(s*nv+d)||refusal(s,d))continue;proposals.push([s,d]);for(const v of near)locked[v]=1;break;}}
    if(!proposals.length)break;report.rounds++;report.mergedVertices+=settle(proposals);
  }
  for(const {a,b} of livePairs()){report.remainingPairs++;const why=[[a,b],[b,a]].map(([s,d])=>crossed.has(s*nv+d)?'crossing':refusal(s,d)).find(Boolean);report.remaining[why]=(report.remaining[why]??0)+1;}
  return report;
}

// Split: a sliver whose apex v projects inside its long edge h-t gets a new point p
// there, on the existing surface; the face g across h-t splits at p and v collapses
// into p. The sliver goes, g keeps its shape, and v's other faces move by |vp|, the
// sliver's height. This removes slivers a flip cannot, where the neighbour is thin too.
// The new point keeps no coordinate of v; existing coordinates never move.
function splitSliverCaps(state,toleranceMm=PRINT_RESOLUTION_MM){
  const {tri:T,spent,scan,onSheet}=state,xyz=state.xyz,n=T.length/3,nv=xyz.length/3,report={splits:0,contactsUndone:0,deferred:0};
  const candidates=[];for(let f=0;f<n;f++)if(T[3*f]>=0&&(scan[T[3*f]]||scan[T[3*f+1]]||scan[T[3*f+2]])&&belowHeightContract(xyz,T[3*f],T[3*f+1],T[3*f+2]))candidates.push(f);
  if(!candidates.length)return report;
  const incident=Array.from({length:nv},()=>[]);for(let f=0;f<n;f++)if(T[3*f]>=0)for(let c=0;c<3;c++)incident[T[3*f+c]].push(f);
  const P=v=>[xyz[3*v],xyz[3*v+1],xyz[3*v+2]],face=f=>[T[3*f],T[3*f+1],T[3*f+2]];
  const locked=new Uint8Array(nv),proposals=[];
  for(const f of candidates){
    const t3=face(f),lengths=[0,1,2].map(k=>{const a=P(t3[k]),b=P(t3[(k+1)%3]);return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}),k=lengths.indexOf(Math.max(...lengths));
    const h=t3[k],t=t3[(k+1)%3],v=t3[(k+2)%3],H=P(h),D=P(t).map((x,i)=>x-H[i]),R=P(v).map((x,i)=>x-H[i]),s=(R[0]*D[0]+R[1]*D[1]+R[2]*D[2])/(D[0]*D[0]+D[1]*D[1]+D[2]*D[2]);
    if(!(s>0&&s<1))continue;
    const across=incident[h].filter(g=>g!==f&&incident[t].includes(g));if(across.length!==1)continue;
    const g=across[0],w=face(g).find(x=>x!==h&&x!==t),ring=new Set(incident[v].flatMap(face));
    if(ring.has(w))continue;
    // A split blocked by a neighbour's reservation is retried next round.
    if([h,t,w,...ring].some(x=>locked[x])){for(const x of t3)state.touched[x]=1;report.deferred++;continue;}
    const p=H.map((x,i)=>x+s*D[i]),height=Math.hypot(...p.map((x,i)=>x-xyz[3*v+i]));
    let base=spent[g];for(const e of incident[v])base=Math.max(base,spent[e]);
    const value=base+height*(1+2**-48);if(!(value<toleranceMm*(1-2**-46)))continue;
    for(const x of [h,t,w,...ring])locked[x]=1;proposals.push({f,g,h,t,v,w,p,value,moved:incident[v].filter(e=>e!==f)});
  }
  if(!proposals.length)return report;
  // New points extend the coordinate and per-vertex arrays.
  const grow=(array,size,fill)=>{const out=new array.constructor(size);out.set(array);if(fill!==undefined)out.fill(fill,array.length);return out;};
  const added=proposals.length;state.xyz=grow(xyz,3*(nv+added));state.source=grow(state.source,nv+added,1);state.onSheet=grow(onSheet,nv+added,-1);
  state.scan=grow(scan,nv+added,1);state.touched=grow(state.touched,nv+added,1);
  proposals.forEach((q,i)=>{q.index=nv+i;state.xyz.set(q.p,3*q.index);q.faces=[q.f,q.g,...q.moved];q.before=q.faces.map(face);q.spent=q.faces.map(e=>spent[e]);});
  const contacts=changedContactFaces(state.xyz,T,proposals.flatMap(q=>q.faces),state.onSheet);
  const apply=q=>{T.set([q.index,q.h,q.w],3*q.f);T.set([q.t,q.index,q.w],3*q.g);for(const e of q.moved)for(let c=0;c<3;c++)if(T[3*e+c]===q.v)T[3*e+c]=q.index;for(const e of q.faces)spent[e]=q.value;};
  const undo=q=>q.faces.forEach((e,i)=>{T.set(q.before[i],3*e);spent[e]=q.spent[i];});
  for(const q of proposals){q.contacts=q.faces.filter(e=>contacts.has(e)).length;apply(q);}
  // Like the other edits, a split stays unless it adds rounding-guard contacts.
  const active=new Set(proposals);for(let undone=true;undone;){undone=false;const hit=changedContactFaces(state.xyz,T,[...active].flatMap(q=>q.faces),state.onSheet);
    for(const q of active)if(q.faces.filter(e=>hit.has(e)).length>q.contacts){undo(q);active.delete(q);report.contactsUndone++;undone=true;}}
  for(const q of active)for(const e of q.faces)for(let c=0;c<3;c++)state.touched[T[3*e+c]]=1;
  report.splits=active.size;return report;
}

// Cleanup of the converged surface. Edits never move a coordinate: flips, splits
// and collapses change which points triangles join, and a split adds a point on an edge. spent[f] bounds how far face f lies
// from the converged surface before cleanup, in both directions; an edit gives its new
// faces the largest value among the faces it replaces plus its own paired distance and
// is kept only below print resolution. Each place therefore carries its own allowance,
// and flip and collapse rounds chain until a round changes nothing. Each round looks
// only at triangles around the points the previous round edited.
const CLEANUP_ROUNDS=64;
function cleanupReconstructedSurface(current,mergeMm,progress=()=>{}){
  const T=current.tri.slice(),spent=new Float64Array(T.length/3),state={...current,tri:T,spent,refusedFlips:new Set()},timings={sliverCorrection:0,merge:0};
  const flips={candidateFaces:0,flippedEdges:0,splits:0,contactsUndone:0},merge={toleranceMm:mergeMm,method:'close-pair-collapse/2',rounds:0,mergedVertices:0,sliverCollapses:0,crossingUndone:0};
  let rounds=0,last=null,scan=new Uint8Array(current.xyz.length/3).fill(1);
  while(rounds<CLEANUP_ROUNDS){rounds++;state.scan=scan;state.touched=new Uint8Array(scan.length);
    progress({stage:'sliver-correction',round:rounds});let t0=performance.now();const flip=improveSliverTriangulation(state,mergeMm);
    state.scan=scan.map((x,v)=>x|state.touched[v]);const split=splitSliverCaps(state,mergeMm);timings.sliverCorrection+=performance.now()-t0;
    flips.splits+=split.splits;flips.contactsUndone+=split.contactsUndone;
    progress({stage:'merge',round:rounds});t0=performance.now();last=mergeMeshVertices(state,mergeMm);timings.merge+=performance.now()-t0;
    flips.candidateFaces+=flip.candidateFaces;flips.flippedEdges+=flip.flippedEdges;flips.contactsUndone+=flip.contactsUndone;
    for(const k of ['rounds','mergedVertices','sliverCollapses','crossingUndone'])merge[k]+=last[k];
    if(!flip.flippedEdges&&!flip.deferred&&!flip.contactsUndone&&!split.splits&&!split.contactsUndone&&!split.deferred&&!last.sliverCollapses&&!last.mergedVertices)break;scan=state.touched;}
  merge.closePairs=last.closePairs;merge.remainingPairs=last.remainingPairs;merge.remaining=last.remaining;
  let bound=0,thin=0;for(let f=0;f<T.length/3;f++){if(T[3*f]<0)continue;bound=Math.max(bound,spent[f]);if(belowHeightContract(state.xyz,T[3*f],T[3*f+1],T[3*f+2]))thin++;}
  // A sliver no edit can remove within the allowance stays and is reported.
  const sliverCorrection={method:'chained-sliver-cleanup/1',cleanupRounds:rounds,...flips,reference:'converged reconstructed surface before cleanup, per face',totalSurfaceChangeBoundMm:bound,remainingSlivers:thin};
  const used=new Int32Array(state.xyz.length/3).fill(-1),outTri=[];let count=0;
  for(let f=0;f<T.length/3;f++){if(T[3*f]<0)continue;for(let c=0;c<3;c++){const v=T[3*f+c];if(used[v]<0)used[v]=count++;outTri.push(used[v]);}}
  const outXyz=new Float64Array(3*count);for(let v=0;v<used.length;v++)if(used[v]>=0)outXyz.set(state.xyz.subarray(3*v,3*v+3),3*used[v]);
  return{xyz:outXyz,tri:Int32Array.from(outTri),merge,sliverCorrection,timings:[timings]};
}

// Sliver cleanup of a closed surface without reconstruction (a hole fill that could
// only use slivers). Every vertex is a source vertex.
export function cleanSurfaceSlivers({xyz,tri},{mergeMm=PRINT_RESOLUTION_MM,progress=()=>{}}={}){
  const nv=xyz.length/3;return cleanupReconstructedSurface({xyz,tri,source:new Uint8Array(nv).fill(1),onSheet:new Int32Array(nv).fill(-1)},mergeMm,progress);
}

// ---------------- reconstruction passes ----------------
// Replaces a closed outward surface that crosses itself by the boundary of its
// solid (w > 0); null when nothing intersects.
// Snap rounding: constructed points round to the rounding-guard lattice (a power of
// two at most print resolution / 1000), except that a point on a closing sheet rounds
// on that sheet's plane lattice, as closing places the vertices it moves, so sheets
// stay exact planes; source points stay. When rounding creates crossings, the
// triangles it touched are reconstructed again; sheets and the vertices on them carry
// over to later passes. Once no crossing remains, vertices closer than mergeMm (print
// resolution) merge (mergeMeshVertices).
export const SNAP_GRID_MM=2**Math.floor(Math.log2(ROUNDING_MM));
export function reconstructSolid({xyz,tri},{closeMm=PRINT_RESOLUTION_MM,mergeMm=PRINT_RESOLUTION_MM,snapGridMm=SNAP_GRID_MM,maxPasses=6,progress=()=>{}}={}){
  const passes=[],timings=[];let unresolvedCrossings=false,current={xyz,tri,source:new Uint8Array(xyz.length/3).fill(1),dirty:null,onSheet:null,sheets:null};
  for(let pass=0;pass<maxPasses;pass++){
    const t0=performance.now(),r=reconstructOnce(current,{closeMm:pass===0?closeMm:0,snapGridMm,pass,progress});
    if(!r){timings.push({finalProbe:performance.now()-t0});break;}passes.push(r.report);timings.push(r.timings);current=r;
    // Rounding that still crosses after the last pass keeps that surface and reports it.
    if(pass===maxPasses-1)unresolvedCrossings=true;
  }
  if(!passes.length)return null;
  // Cleanup runs ONCE after all reconstruction/rounding passes. Its reference is
  // this complete surface, never the start of another reconstruction retry.
  const cleaned=cleanupReconstructedSurface(current,mergeMm,progress);timings.push(...cleaned.timings);
  return {...cleaned,passes,timings,unresolvedCrossings};
}
function reconstructOnce({xyz,tri,source,dirty,onSheet,sheets},{closeMm,snapGridMm,pass,progress}){
  const clock=()=>performance.now(),timings={};let t0=clock();
  progress({stage:'intersections',pass});const any=anyIntersection({xyz,tri},dirty,onSheet);timings.probe=clock()-t0;if(!any)return null;t0=clock();
  progress({stage:'close',pass});const closed=closeOpposedSheets({xyz,tri},closeMm),{points,moved,closing}=closed,closedSheets=closed.sheets??sheets,inputSheet=closed.onSheet??onSheet;timings.close=clock()-t0;t0=clock();
  progress({stage:'refine',pass});const refined=autorefine(points,tri,closing.movedVertices?null:dirty,inputSheet);timings.refine=clock()-t0;t0=clock();
  progress({stage:'classify',pass});const {kept,report}=classify(refined.store,refined.soup);timings.classify=clock()-t0;t0=clock();
  progress({stage:'round',pass});
  const store=refined.store,{px,py,pz}=store,{pointSheet}=refined,inputs=points.length/3,index=new Int32Array(store.count).fill(-1),byPoint=new PointMap(inputs);
  const rounded=new Float64Array(3*store.count),roundedSource=new Uint8Array(store.count),fromConstruction=new Uint8Array(store.count),roundedSheet=new Int32Array(store.count).fill(-1),snap=x=>Math.round(x/snapGridMm)*snapGridMm;
  const place=(v,sheet)=>{if(v<inputs)return [px[v],py[v],pz[v]];if(sheet<0)return [snap(px[v]),snap(py[v]),snap(pz[v])];
    const plane=closedSheets.planes[sheet],p=[px[v],py[v],pz[v]];return latticePlanePoint(plane,closedSheets,p[plane.i],p[plane.j],snapGridMm);};
  let vertices=0,merged=0,dropped=0,maxSnapMm=0;
  const vertex=v=>{if(index[v]>=0)return index[v];const sheet=v<inputs?(inputSheet?inputSheet[v]:-1):(pointSheet.get(v)??-1),[x,y,z]=place(v,sheet);
    if(v>=inputs)maxSnapMm=Math.max(maxSnapMm,Math.hypot(x-px[v],y-py[v],z-pz[v]));
    let i=byPoint.get(x,y,z);if(i<0){i=vertices++;rounded[3*i]=x;rounded[3*i+1]=y;rounded[3*i+2]=z;byPoint.set(x,y,z,i);}else merged++;
    if(sheet>=0&&roundedSheet[i]<0)roundedSheet[i]=sheet;
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
  const used=new Int32Array(vertices).fill(-1),finalTri=[],finalDirty=[];let nv=0;
  for(let t=0;t<outTri.length;t+=3){if(outTri[t]<0)continue;for(let c=0;c<3;c++){const v=outTri[t+c];if(used[v]<0)used[v]=nv++;finalTri.push(used[v]);}
    finalDirty.push(touched[outTri[t]]|touched[outTri[t+1]]|touched[outTri[t+2]]);}
  const finalXyz=new Float64Array(3*nv),finalSource=new Uint8Array(nv),finalSheet=new Int32Array(nv);
  for(let v=0;v<vertices;v++)if(used[v]>=0){finalXyz.set(rounded.subarray(3*v,3*v+3),3*used[v]);finalSource[used[v]]=roundedSource[v];finalSheet[used[v]]=roundedSheet[v];}
  timings.round=clock()-t0;
  return {xyz:finalXyz,tri:Int32Array.from(finalTri),source:finalSource,dirty:Uint8Array.from(finalDirty),onSheet:finalSheet,sheets:closedSheets,timings,
    report:{closing,refinedTriangles:refined.soup.length/3,...report,snapGridMm,maxSnapMm,roundingMergedPoints:merged,roundingDroppedTriangles:dropped,roundingCancelledPairs:roundingCancelled,refine:refined.stats}};
}
