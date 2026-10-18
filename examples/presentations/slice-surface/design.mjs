export const INTRO_SECONDS=18;
export const defaults=Object.freeze({sizeMm:24,lineWidthMm:.45,fillDensity:.26,sampleStepMm:.65,frame:0,fps:30,durationSeconds:80});
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

const blend=(a,b,q)=>a+(b-a)*q,segment=(t,a,b)=>ease((t-a)/(b-a)),ending=cubePoseAt(20);
export const endingPose=()=>({...ending});
export function poseAt(t){return animationAt(t).pose;}
export function animationAt(t){
  const a={mode:'cube',pose:t<18?{...cubePoseAt(0),heightMm:12}:cubePoseAt(t-18),loops:2,density:.26,angle:45,pattern:'rectilinear',context:'cube',morph:0,layerIndex:-1};
  if(t<18){
    a.mode='intro';
    if(t>=1&&t<4){a.density=t<2.5?blend(.26,.62,segment(t,1,2.5)):blend(.62,.26,segment(t,2.5,4));a.loops=t<2?2:t<2.7?4:t<3.4?1:2;}
    if(t>=4&&t<5)a.pose.heightMm=blend(12,4,segment(t,4,5));
    if(t>=5&&t<9.5){a.layerIndex=Math.min(8,Math.floor((t-5)/.45));a.pose.heightMm=4+a.layerIndex;a.angle=a.layerIndex%2?135:45;}
    if(t>=9.5&&t<11)a.density=.26*(1-segment(t,9.5,11));
    else if(t>=11&&t<12.5){a.pattern='gyroid';a.density=.26*segment(t,11,12.5);}
    else if(t>=12.5&&t<14.5){a.pattern='gyroid';a.pose.heightMm=12+1.2*Math.sin((t-12.5)/2*Math.PI)**2;}
    else if(t>=14.5&&t<16){a.pattern='gyroid';a.density=.26*(1-segment(t,14.5,16));}
    else if(t>=16&&t<17.5)a.density=.26*segment(t,16,17.5);
    return a;
  }
  if(t<38)return a;
  a.pose={...ending};
  if(t<51){a.mode='cladding';a.context='tube';a.loops=0;a.morph=segment(t,38,44);const q=segment(t,44,48);a.density=blend(.26,1,q);a.angle=blend(45,90,q);}
  else if(t<57){a.mode='cladding';a.morph=1-segment(t,51,57);a.density=blend(1,.26,segment(t,51,57));a.angle=blend(90,45,segment(t,51,57));}
  else if(t<59)return a;
  else if(t<72){a.mode='bridge';a.context='bridge';a.loops=0;a.morph=segment(t,59,65);const q=segment(t,65,69);a.density=blend(.26,.72,q);a.angle=blend(45,0,q);}
  else if(t<78){a.mode='bridge';a.morph=1-segment(t,72,78);a.density=blend(.72,.26,segment(t,72,78));a.angle=blend(0,45,segment(t,72,78));}
  return a;
}
const degree=3,nv=7;
const knotsV=Array.from({length:nv+degree+1},(_,i)=>i<=degree?0:i>=nv?1:(i-degree)/(nv-degree));
const vs=Array.from({length:nv},(_,i)=>(knotsV[i+1]+knotsV[i+2]+knotsV[i+3])/3);
export function claddingSpec(d,a){
  const size=d.sizeMm,q=a.wrap??1,n=12,sweep=q*2*Math.PI,width=blend(size,2*Math.PI*size/3,q),radius=sweep?width/sweep:0,centerOffset=sweep?radius*(1+Math.cos(sweep/2))/2:0;
  const controlPoints=Array.from({length:n+3},(_,i)=>vs.map(v=>{
    const u=(i-1)/n,theta=(u-.5)*sweep;
    if(q===0)return [size*u,size/2,size*v];
    const r=radius*(1+q*.0467)+q*(.675*Math.sin(2*theta+2*v)+.3*Math.cos(2*theta-2.5*v));
    return [size/2+r*Math.sin(theta)+q*.3*Math.sin(v*Math.PI),size/2+r*Math.cos(theta)-centerOffset+q*.25*Math.sin(v*Math.PI*1.5),size*v];
  }));
  return {name:'animated-slice',degreeU:3,degreeV:3,knotsU:Array.from({length:n+7},(_,i)=>(i-3)/n),knotsV,controlPoints};
}
export function bridgeSpec(d){
  const s=d.sizeMm;
  return {name:'animated-slice',degreeU:3,degreeV:3,knotsU:knotsV,knotsV,controlPoints:vs.map(u=>vs.map(v=>{
    const left=s*.5+2.4*Math.sin(v*Math.PI*2),right=s*.5+1.9*Math.sin(v*Math.PI*2+1.1);
    return [s/6+u*s*2/3,v*s,blend(left,right,u)];
  }))};
}
export function surfaceFor(d,a){
  const wave=surfaceSpec(d,a.pose);
  if(a.mode==='cladding'){
    if(a.morph>=1/3)return claddingSpec(d,{wrap:ease((a.morph-1/3)*1.5)});
    const q=ease(a.morph*3),target=claddingSpec(d,{wrap:0});
    return {...wave,controlPoints:wave.controlPoints.map((row,i)=>row.map((p,j)=>p.map((x,k)=>blend(x,[d.sizeMm*vs[i],d.sizeMm/2,d.sizeMm*vs[j]][k],q))))};
  }
  if(a.mode==='bridge'){const target=bridgeSpec(d);return {...wave,controlPoints:wave.controlPoints.map((row,i)=>row.map((p,j)=>p.map((x,k)=>blend(x,target.controlPoints[i][j][k],a.morph))))};}
  return wave;
}
