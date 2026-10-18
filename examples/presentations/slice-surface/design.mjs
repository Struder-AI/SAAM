export const defaults=Object.freeze({sizeMm:24,lineWidthMm:.45,fillDensity:.26,sampleStepMm:.65,frame:0,fps:30,durationSeconds:20});
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const ease=value=>{const x=clamp(value,0,1);return x*x*(3-2*x);};
export function normalize(input){
  const d={...defaults,...input};
  for(const key of Object.keys(defaults))if(!Number.isFinite(d[key]))throw Error('Expected finite '+key);
  if(d.sizeMm<=0||d.lineWidthMm<=0||d.sampleStepMm<=0||d.fillDensity<=0||d.fillDensity>1||d.durationSeconds<=0||d.fps!==30)throw Error('Use positive dimensions, density in (0,1], and 30 fps.');
  d.frame=clamp(Math.round(d.frame),0,Math.round(d.durationSeconds*d.fps));return d;
}
export function poseAt(seconds){
  const t=clamp(seconds,0,20),pose={tiltX:0,tiltY:0,amplitude:0,phase:0,label:'Flat XY slice',subtitle:'A familiar starting point.'};
  if(t>=2&&t<5){pose.tiltY=22*ease((t-2)/3);pose.label='Tilt the slice';pose.subtitle='The part stays fixed. The slicing surface rotates.';}
  else if(t>=5&&t<8){pose.tiltY=22-42*ease((t-5)/3);pose.tiltX=12*ease((t-5)/3);pose.label='Any orientation';pose.subtitle='Perimeters and infill are recalculated on the surface.';}
  else if(t>=8&&t<10){pose.tiltY=-20*(1-ease((t-8)/2));pose.tiltX=12*(1-ease((t-8)/2));pose.label='A surface, not just a plane';pose.subtitle='The same spline reference can be flat or curved.';}
  else if(t>=10&&t<13){pose.amplitude=3.6*ease((t-10)/3);pose.label='Introduce curvature';pose.subtitle='Move the control points. Recalculate one slice.';}
  else if(t>=13&&t<17){const q=(t-13)/4;pose.amplitude=3.6+1.1*Math.sin(q*Math.PI*2);pose.phase=q*Math.PI*2;pose.label='Shape the waves';pose.subtitle='The toolpath follows the changing spline surface.';}
  else if(t>=17){const q=ease((t-17)/2);pose.amplitude=3.6;pose.phase=Math.PI*2;pose.tiltY=16*q;pose.tiltX=-12*q;pose.label='Curvature + orientation';pose.subtitle='Slice is a surface through material.';}
  return pose;
}
export function surfaceSpec(d){
  const pose=poseAt(d.frame/d.fps/d.durationSeconds*20),n=7,degree=3;
  const knots=Array.from({length:n+degree+1},(_,i)=>i<=degree?0:i>=n?1:(i-degree)/(n-degree));
  const greville=Array.from({length:n},(_,i)=>(knots[i+1]+knots[i+2]+knots[i+3])/3);
  const rx=pose.tiltX*Math.PI/180,ry=pose.tiltY*Math.PI/180,extent=d.sizeMm*.83;
  const cp=greville.map(u=>greville.map(v=>{
    const x=(u*2-1)*extent,y=(v*2-1)*extent;
    const z=pose.amplitude*(Math.sin(u*Math.PI*3+pose.phase)+.38*Math.sin(v*Math.PI*2-pose.phase*.7));
    const py=y*Math.cos(rx)-z*Math.sin(rx),pz=y*Math.sin(rx)+z*Math.cos(rx);
    return [x*Math.cos(ry)+pz*Math.sin(ry)+d.sizeMm/2,py+d.sizeMm/2,-x*Math.sin(ry)+pz*Math.cos(ry)+d.sizeMm/2];
  }));
  return {name:'animated-slice',degreeU:degree,degreeV:degree,knotsU:knots,knotsV:knots,controlPoints:cp};
}
