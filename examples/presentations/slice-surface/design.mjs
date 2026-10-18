export const INTRO_SECONDS=18;
export const defaults=Object.freeze({sizeMm:24,lineWidthMm:.45,fillDensity:.26,sampleStepMm:.65,frame:0,fps:30,durationSeconds:79});
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const ease=value=>{const x=clamp(value,0,1);return x*x*(3-2*x);};
export function normalize(input){
  const d={...defaults,...input};
  for(const key of Object.keys(defaults))if(!Number.isFinite(d[key]))throw Error('Expected finite '+key);
  if(d.sizeMm<=0||d.lineWidthMm<=0||d.sampleStepMm<=0||d.fillDensity<=0||d.fillDensity>1||d.durationSeconds<=0||d.fps!==30)throw Error('Use positive dimensions, density in (0,1], and 30 fps.');
  d.frame=clamp(Math.round(d.frame),0,Math.round(d.durationSeconds*d.fps));return d;
}
function cubePoseAt(seconds){
  const t=clamp(seconds,0,20),pose={tiltX:0,tiltY:0,amplitude:0,phase:0,label:'Flat XY slice',subtitle:'A familiar starting point.'};
  if(t>=2&&t<5){pose.tiltY=22*ease((t-2)/3);pose.label='Tilt the slice';pose.subtitle='The part stays fixed. The slicing surface rotates.';}
  else if(t>=5&&t<8){pose.tiltY=22-42*ease((t-5)/3);pose.tiltX=12*ease((t-5)/3);pose.label='Any orientation';pose.subtitle='Perimeters and infill are recalculated on the surface.';}
  else if(t>=8&&t<10){pose.tiltY=-20*(1-ease((t-8)/2));pose.tiltX=12*(1-ease((t-8)/2));pose.label='A surface, not just a plane';pose.subtitle='The same spline reference can be flat or curved.';}
  else if(t>=10&&t<13){pose.amplitude=3.6*ease((t-10)/3);pose.label='Introduce curvature';pose.subtitle='Move the control points. Recalculate one slice.';}
  else if(t>=13&&t<17){const q=(t-13)/4;pose.amplitude=3.6+1.1*Math.sin(q*Math.PI*2);pose.phase=q*Math.PI*2;pose.label='Shape the waves';pose.subtitle='The toolpath follows the changing spline surface.';}
  else if(t>=17){const q=ease((t-17)/2);pose.amplitude=3.6;pose.phase=Math.PI*2;pose.tiltY=16*q;pose.tiltX=-12*q;pose.label='Curvature + orientation';pose.subtitle='Slice is a surface through material.';}
  return pose;
}
export function surfaceSpec(d,pose=cubePoseAt(d.frame/d.fps)){
  const n=7,degree=3;
  const knots=Array.from({length:n+degree+1},(_,i)=>i<=degree?0:i>=n?1:(i-degree)/(n-degree));
  const greville=Array.from({length:n},(_,i)=>(knots[i+1]+knots[i+2]+knots[i+3])/3);
  const rx=pose.tiltX*Math.PI/180,ry=pose.tiltY*Math.PI/180,extent=d.sizeMm*.83;
  const cp=greville.map(u=>greville.map(v=>{
    const x=(u*2-1)*extent,y=(v*2-1)*extent;
    const z=pose.amplitude*(Math.sin(u*Math.PI*3+pose.phase)+.38*Math.sin(v*Math.PI*2-pose.phase*.7));
    const py=y*Math.cos(rx)-z*Math.sin(rx),pz=y*Math.sin(rx)+z*Math.cos(rx);
    return [x*Math.cos(ry)+pz*Math.sin(ry)+d.sizeMm/2,py+d.sizeMm/2,-x*Math.sin(ry)+pz*Math.cos(ry)+(pose.heightMm??d.sizeMm/2)];
  }));
  return {name:'animated-slice',degreeU:degree,degreeV:degree,knotsU:knots,knotsV:knots,controlPoints:cp};
}

const blend=(a,b,q)=>a+(b-a)*q;
const segment=(t,a,b)=>ease((t-a)/(b-a));
const ending=cubePoseAt(20);
function scalePose(q){return {...ending,tiltX:ending.tiltX*q,tiltY:ending.tiltY*q,amplitude:ending.amplitude*q};}
export function poseAt(seconds){return animationAt(seconds).pose;}
function bodyAnimationAt(t){
  const a={mode:'cube',pose:cubePoseAt(t),loops:2,density:.26,angle:45,stand:0,wrap:0,bridge:0,phase:0,cubeContext:1,cylinderContext:0,bridgeContext:0};
  if(t<=20)return a;
  if(t<25){a.pose=scalePose(1-segment(t,23,25));a.loops=0;a.density=blend(.26,1,segment(t,20,23));a.angle=blend(45,90,segment(t,20,23));}
  else if(t<42){
    a.mode='cladding';a.loops=0;a.density=1;a.angle=90;
    a.stand=t<27?segment(t,25,27):t<40?1:1-segment(t,40,42);
    a.wrap=t<32?segment(t,27,32):t<35?1:1-segment(t,35,40);
    a.phase=t<32?0:t<35?Math.PI*2*segment(t,32,35):Math.PI*2;
    a.cylinderContext=segment(t,28,31)*(1-segment(t,36,39));a.cubeContext=1-a.cylinderContext;
  }else if(t<46){const q=segment(t,42,45);a.pose=scalePose(q);a.loops=t<45?0:2;a.density=blend(1,.26,q);a.angle=blend(90,45,q);}
  else if(t<48){a.pose=scalePose(1-segment(t,46,48));a.bridgeContext=segment(t,46.5,48);a.cubeContext=1-a.bridgeContext;}
  else if(t<57){
    a.mode='bridge';a.bridge=t<51?segment(t,48,51):t<54?1:1-segment(t,54,57);
    a.angle=45*(1-a.bridge);a.phase=t<51?0:t<54?Math.PI*2*segment(t,51,54):Math.PI*2;
    a.bridgeContext=1-segment(t,55.5,57);a.cubeContext=1-a.bridgeContext;
  }else a.pose=scalePose(segment(t,57,60));
  return a;
}
const degree=3,nv=7;
const knotsV=Array.from({length:nv+degree+1},(_,i)=>i<=degree?0:i>=nv?1:(i-degree)/(nv-degree));
const vs=Array.from({length:nv},(_,i)=>(knotsV[i+1]+knotsV[i+2]+knotsV[i+3])/3);
// Piecewise cubic Bezier arcs retain a coincident, tangent-continuous periodic seam.
export function claddingSpec(d,a){
  const s=d.sizeMm,q=a.wrap,segments=12,sweep=q*Math.PI*2,width=blend(s,Math.PI*s*2/3,q),radius=sweep>1e-8?width/sweep:0;
  const centerOffset=sweep>1e-8?radius*(1+Math.cos(sweep/2))/2:0;
  function at(u,v){
    const theta=(u-.5)*sweep,phase=a.phase,bump=q*(1.35*Math.sin(3*theta+phase+v*4)+.6*Math.cos(5*theta-phase*.7-v*5));
    const bumpD=q*(4.05*Math.cos(3*theta+phase+v*4)-3*Math.sin(5*theta-phase*.7-v*5));
    let x,y,dx,dy;
    if(sweep<1e-8){x=s/2+width*(u-.5);y=s/2;dx=width;dy=0;}
    else {const r=radius+bump;x=s/2+r*Math.sin(theta)+q*.6*Math.sin(v*Math.PI*2);y=s/2+r*Math.cos(theta)-centerOffset+q*.5*Math.sin(v*Math.PI*3);dx=sweep*(bumpD*Math.sin(theta)+r*Math.cos(theta));dy=sweep*(bumpD*Math.cos(theta)-r*Math.sin(theta));}
    const angle=a.stand*Math.PI/2,yy=(v-.5)*s,zz=y-s/2;
    return {point:[x,s/2+yy*Math.cos(angle)+zz*Math.sin(angle),s/2+yy*Math.sin(angle)-zz*Math.cos(angle)],du:[dx,dy*Math.sin(angle),-dy*Math.cos(angle)]};
  }
  const cp=[];
  for(let i=0;i<segments;i++){
    const rows=vs.map(v=>[at(i/segments,v),at((i+1)/segments,v)]);
    if(i===0)cp.push(rows.map(([a])=>a.point));
    cp.push(rows.map(([a])=>a.point.map((x,k)=>x+a.du[k]/segments/3)));
    cp.push(rows.map(([,b])=>b.point.map((x,k)=>x-b.du[k]/segments/3)));
    cp.push(rows.map(([,b])=>b.point));
  }
  const knotsU=[0,0,0,0,...Array.from({length:segments-1},(_,i)=>Array(3).fill((i+1)/segments)).flat(),1,1,1,1];
  return {name:'animated-slice',degreeU:3,degreeV:3,knotsU,knotsV,controlPoints:cp};
}
export function bridgeSpec(d,a){
  const q=a.bridge,s=d.sizeMm,knotsU=knotsV;
  const cp=vs.map(u=>vs.map(v=>[blend(s*u,s/6+u*s*2/3,q),v*s,s/2-q*Math.sin(Math.PI*u)*(5+1.8*Math.sin(v*Math.PI*2+a.phase)+.8*Math.sin(u*Math.PI*3-a.phase))]));
  return {name:'animated-slice',degreeU:3,degreeV:3,knotsU,knotsV,controlPoints:cp};
}

export function animationAt(t){
  if(t>=INTRO_SECONDS)return bodyAnimationAt(t-INTRO_SECONDS);
  const a={mode:'intro',pose:{...cubePoseAt(0),heightMm:12},loops:2,density:.26,angle:45,gyroidMix:0,cubeContext:1,bridgeContext:0,layerIndex:-1,previousAlpha:0};
  if(t>=1&&t<4){a.density=t<2.5?blend(.26,.62,segment(t,1,2.5)):blend(.62,.26,segment(t,2.5,4));a.loops=t<2?2:t<2.7?4:t<3.4?1:2;}
  if(t>=4&&t<5)a.pose.heightMm=blend(12,4,segment(t,4,5));
  if(t>=5&&t<9.5){
    a.layerIndex=Math.min(8,Math.floor((t-5)/.45));a.pose.heightMm=4+a.layerIndex;a.angle=a.layerIndex%2?135:45;
    a.previousAlpha=a.layerIndex>0?.24:0;if(t>=9.05)a.previousAlpha*=1-segment(t,9.05,9.5);
  }
  if(t>=9.5&&t<12.5)a.gyroidMix=segment(t,9.5,12.5);
  else if(t>=12.5&&t<14.5){a.gyroidMix=1;a.pose.heightMm=12+1.2*Math.sin((t-12.5)/2*Math.PI)**2;}
  else if(t>=14.5&&t<17.5)a.gyroidMix=1-segment(t,14.5,17.5);
  return a;
}
