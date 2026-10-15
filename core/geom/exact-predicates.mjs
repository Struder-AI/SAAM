// Exact signs of orientation determinants of double coordinates, for callers whose
// floating-point filter could not decide. Shewchuk's expansion arithmetic: a sum
// or product of doubles is held exactly as a nonoverlapping sequence of doubles in
// increasing magnitude, whose largest component carries the sign.
const SPLITTER=2**27+1;
const buffer=n=>new Float64Array(n+1);
const D=Array.from({length:9},()=>buffer(2)),P=buffer(8),Q=buffer(8),C=buffer(16),T=[buffer(64),buffer(64),buffer(64)],S=buffer(128),F=buffer(192),A=buffer(64),B=buffer(192);

// h = e + f (fast_expansion_sum_zeroelim); returns the length of h.
function sum(elen,e,flen,f,h){
  let enow=e[0],fnow=f[0],ei=0,fi=0,hi=0,q,qnew,hh,bv,av;
  if((fnow>enow)===(fnow>-enow)){q=enow;enow=e[++ei];}else{q=fnow;fnow=f[++fi];}
  if(ei<elen&&fi<flen){
    if((fnow>enow)===(fnow>-enow)){qnew=enow+q;hh=q-(qnew-enow);enow=e[++ei];}else{qnew=fnow+q;hh=q-(qnew-fnow);fnow=f[++fi];}
    q=qnew;if(hh!==0)h[hi++]=hh;
    while(ei<elen&&fi<flen){
      let x;if((fnow>enow)===(fnow>-enow)){x=enow;enow=e[++ei];}else{x=fnow;fnow=f[++fi];}
      qnew=q+x;bv=qnew-q;av=qnew-bv;hh=(q-av)+(x-bv);q=qnew;if(hh!==0)h[hi++]=hh;
    }
  }
  while(ei<elen){qnew=q+enow;bv=qnew-q;av=qnew-bv;hh=(q-av)+(enow-bv);enow=e[++ei];q=qnew;if(hh!==0)h[hi++]=hh;}
  while(fi<flen){qnew=q+fnow;bv=qnew-q;av=qnew-bv;hh=(q-av)+(fnow-bv);fnow=f[++fi];q=qnew;if(hh!==0)h[hi++]=hh;}
  if(q!==0||hi===0)h[hi++]=q;
  return hi;
}
// h = e * b (scale_expansion_zeroelim).
function scale(elen,e,b,h){
  let c=SPLITTER*b;const bhi=c-(c-b),blo=b-bhi;
  let a=e[0],q=a*b;c=SPLITTER*a;let ahi=c-(c-a),alo=a-ahi,hh=alo*blo-(((q-ahi*bhi)-alo*bhi)-ahi*blo),hi=0;
  if(hh!==0)h[hi++]=hh;
  for(let i=1;i<elen;i++){
    a=e[i];const p1=a*b;c=SPLITTER*a;ahi=c-(c-a);alo=a-ahi;const p0=alo*blo-(((p1-ahi*bhi)-alo*bhi)-ahi*blo);
    const s=q+p0,bv=s-q,av=s-bv;hh=(q-av)+(p0-bv);if(hh!==0)h[hi++]=hh;
    q=p1+s;hh=s-(q-p1);if(hh!==0)h[hi++]=hh;
  }
  if(q!==0||hi===0)h[hi++]=q;
  return hi;
}
// h = e * f; A and B are scratch.
function product(elen,e,flen,f,h){
  let hlen=scale(elen,e,f[0],h);
  for(let j=1;j<flen;j++){const n=scale(elen,e,f[j],A);hlen=sum(hlen,h,n,A,B);h.set(B.subarray(0,hlen));}
  return hlen;
}
// d = a - b exactly, one or two components.
function difference(a,b,d){
  const x=a-b,bv=a-x,y=(a-(x+bv))+(bv-b);
  if(y===0){d[0]=x;return 1;}d[0]=y;d[1]=x;return 2;
}
const negate=(n,e)=>{for(let i=0;i<n;i++)e[i]=-e[i];return n;};
// e*f - g*h for one-or-two-component expansions, into out.
function cofactor(el,e,fl,f,gl,g,hl,h,out){
  const p=product(el,e,fl,f,P),q=negate(product(gl,g,hl,h,Q),Q);return sum(p,P,q,Q,out);
}

// Sign of det(b-a, c-a, d-a): positive when d lies on the side of plane abc
// that its normal (b-a)x(c-a) faces.
export function orient3dExact(ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz){
  const [ux,uy,uz,vx,vy,vz,wx,wy,wz]=D;
  const lux=difference(bx,ax,ux),luy=difference(by,ay,uy),luz=difference(bz,az,uz);
  const lvx=difference(cx,ax,vx),lvy=difference(cy,ay,vy),lvz=difference(cz,az,vz);
  const lwx=difference(dx,ax,wx),lwy=difference(dy,ay,wy),lwz=difference(dz,az,wz);
  let n=cofactor(lvy,vy,lwz,wz,lvz,vz,lwy,wy,C);const t0=product(n,C,lux,ux,T[0]);
  n=cofactor(lvz,vz,lwx,wx,lvx,vx,lwz,wz,C);const t1=product(n,C,luy,uy,T[1]);
  n=cofactor(lvx,vx,lwy,wy,lvy,vy,lwx,wx,C);const t2=product(n,C,luz,uz,T[2]);
  const s=sum(t0,T[0],t1,T[1],S),f=sum(s,S,t2,T[2],F),top=F[f-1];
  return top>0?1:top<0?-1:0;
}
// Sign of det(b-a, c-a) in the plane: positive when abc turns counterclockwise.
export function orient2dExact(ax,ay,bx,by,cx,cy){
  const [ux,uy,vx,vy]=D;
  const n=cofactor(difference(bx,ax,ux),ux,difference(cy,ay,vy),vy,difference(by,ay,uy),uy,difference(cx,ax,vx),vx,C),top=C[n-1];
  return top>0?1:top<0?-1:0;
}
