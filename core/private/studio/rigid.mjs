// Private studio utilities. Arithmetic/IO behavior is local to this bucket.
export const rigid=(translationMm=[0,0,0],rotation=identity())=>({translationMm,rotation});
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const scale=(a,s)=>a.map(v=>v*s);
export const norm=a=>Math.hypot(...a);
export const mv=(r,v)=>r.map(row=>dot(row,v));
export const mm=(a,b)=>a.map(row=>transpose(b).map(col=>dot(row,col)));
export function axisFrame(z,up=[0,1,0]){
  z=unit(z);if(Math.abs(dot(z,up))>.999)up=[1,0,0];
  const x=unit(cross(up,z)),y=cross(z,x);return x.map((_,i)=>[x[i],y[i],z[i]]);
}
export const rodFrame=(from,to)=>rigid(from,axisFrame(sub(to,from)));
export function rotation(axis,angle){
  const [x,y,z]=unit(axis),c=Math.cos(angle),s=Math.sin(angle),d=1-c;
  return [[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
}
export const point=(t,p)=>add(t.translationMm,mv(t.rotation,p));
export const invert=t=>{const r=transpose(t.rotation);return rigid(scale(mv(r,t.translationMm),-1),r);};
export const compose=(a,b)=>rigid(point(a,b.translationMm),mm(a.rotation,b.rotation));
export const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const identity=()=>[[1,0,0],[0,1,0],[0,0,1]];
export const transpose=r=>r[0].map((_,i)=>r.map(row=>row[i]));
export const unit=a=>{const n=norm(a);if(n<1e-12)throw Error('Degenerate frame direction');return scale(a,1/n);};
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
