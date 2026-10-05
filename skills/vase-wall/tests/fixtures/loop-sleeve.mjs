// A normal rising vase course decorated with overlapping, gently tilted circles.
import {defaults} from '../../../../core/print/plan.mjs';
import {circlePoints} from '../../../../core/geom/cylinder.mjs';
import {depositionAssignment} from '../../../../core/print/assignment-records.mjs';

// The explicit tile points: `loops` circles per turn as [phase, height] with signed depth.
function loopPath({loops,widthCells,depthMm,samples,beadHeightMm,riseMm,exterior}){
  const points=[],offsetMm=[];
  for(let cell=0;cell<loops;cell++)for(let i=cell?1:0;i<=samples;i++){
    const t=i/samples,angle=2*Math.PI*t,depth=depthMm*(1-Math.cos(angle))/2,u=i===samples?1:t+widthCells/2*Math.sin(angle),phase=(cell+u)/loops;
    points.push([phase,.03*depth+phase*riseMm]);
    offsetMm.push(exterior==='both-scalloped'?depthMm/2-depth:exterior==='scalloped'?depth:-depth);
  }
  return {points,offsetMm,beadHeightMm};
}

// A vase host is normally solid. The recipe creates the hollow printed wall.
function loopHost({radius,heightMm,waveDepthMm=0,rows=25}){
  const ring=circlePoints(radius,[0,0],.01),columns=ring.length,vertices=[],triangles=[];
  const levels=waveDepthMm?rows:2;
  for(let j=0;j<levels;j++){
    const z=heightMm*j/(levels-1),r=radius-waveDepthMm*(1-Math.cos(4*Math.PI*z/heightMm))/2;
    for(const [x,y] of ring)vertices.push([x*r/radius,y*r/radius,z]);
  }
  for(let j=0;j<levels-1;j++)for(let i=0;i<columns;i++){
    const a=j*columns+i,b=j*columns+(i+1)%columns,c=b+columns,d=a+columns;
    triangles.push([a,b,c],[a,c,d]);
  }
  const bottom=vertices.length,top=bottom+1;vertices.push([0,0,0],[0,0,heightMm]);
  for(let i=0;i<columns;i++){
    const next=(i+1)%columns,last=(levels-1)*columns;
    triangles.push([bottom,next,i],[top,last+i,last+next]);
  }
  return {shape:'mesh',vertices,triangles,source:null};
}

export function loopSleevePlan({courses=24,loopsPerTurn=20,samplesPerLoop=64,
  radius=14,tileDepthMm=4.8,tileWidthMm=5.6,exterior='smooth',waveDepthMm=0}={}){
  const plan=defaults();
  const perimeter=2*Math.PI*(radius-plan.process.lineWidthMm/2),rise=plan.process.layerMm;
  const pattern={paths:[loopPath({loops:loopsPerTurn,widthCells:tileWidthMm*loopsPerTurn/perimeter,depthMm:tileDepthMm,
    samples:samplesPerLoop,beadHeightMm:rise,riseMm:rise,exterior})],advance:[1,rise],repeats:courses};
  const {points}=pattern.paths[0];
  const top=plan.process.firstLayerMm+Math.max(...points.map(p=>p[1]))+(courses-1)*rise;
  plan.geometry=loopHost({radius,heightMm:top,waveDepthMm});
  plan.placement={xMm:125,yMm:105};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  plan.slices.assignments=[depositionAssignment({construction:'sleeve',id:'wall',endTransition:'spiral',pathMode:'continuous',pattern})];
  return plan;
}
