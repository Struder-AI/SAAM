// A normal rising vase course decorated with overlapping, gently tilted circles.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {circlePoints} from '../../../core/geom/cylinder.mjs';

// A vase host is normally solid. The recipe creates the hollow printed wall.
export function loopHost({radius,heightMm,waveDepthMm=0,rows=25}){
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

// The tangential span a single loop's own start/end footprint covers, for a
// loop of half-width `tangentRadius` riding on a course that advances `advance`
// mm per loop. Follows from pos(v) = advance*v + tangentRadius*sin(2*pi*v),
// v in [0,1]; the span is the distance between that function's one interior
// max and min (they exist once tangentRadius exceeds advance/(2*pi)).
function loopFootprintSpanMm(tangentRadius,advanceMm){
  const ratio=advanceMm/(2*Math.PI*tangentRadius);
  if(ratio>=1)return 0;
  const v1=Math.acos(-ratio)/(2*Math.PI);
  return advanceMm*(2*v1-1)+2*tangentRadius*Math.sin(2*Math.PI*v1);
}

// Default loop width so adjacent loops touch by one normal line width instead
// of leaving a gap at the seam between them, giving the overlap a second
// bonding surface rather than a single point of contact. Numerically solved
// since the footprint span above has no closed-form inverse.
export function touchingMotifWidthMm({perimeter,loopsPerTurn,lineWidthMm}){
  const advance=perimeter/loopsPerTurn;
  let lo=advance/(2*Math.PI)+1e-6,hi=advance*4;
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    if(loopFootprintSpanMm(mid,advance)<advance+lineWidthMm)lo=mid;else hi=mid;
  }
  return lo+hi;
}

export function loopDemoPlan({courses=24,loopsPerTurn=20,samplesPerLoop=64,
  radius=14,motifDepthMm=4.8,motifWidthMm=null,exterior='smooth',waveDepthMm=0}={}){
  if(!['smooth','scalloped','both-scalloped'].includes(exterior))throw new Error('Choose smooth, scalloped or both-scalloped.');
  const plan=defaults();
  const perimeter=2*Math.PI*(radius-plan.process.lineWidthMm/2),rise=plan.process.layerMm;
  const width=motifWidthMm??touchingMotifWidthMm({perimeter,loopsPerTurn,lineWidthMm:plan.process.lineWidthMm});
  const tangentRadius=width/2;
  const points=[],offsets=[];
  // The advance is part of the looping curve itself. There is no separate
  // circumference stroke, closing circle, or straight connector between loops.
  for(let i=0;i<=loopsPerTurn*samplesPerLoop;i++){
    const phase=i/(loopsPerTurn*samplesPerLoop),fraction=(i%samplesPerLoop)/samplesPerLoop;
    const angle=2*Math.PI*fraction,x=tangentRadius*Math.sin(angle);
    const depth=motifDepthMm*(1-Math.cos(angle))/2;
    const offset=exterior==='both-scalloped'?motifDepthMm/2-depth:exterior==='scalloped'?depth:-depth;
    points.push([phase+x/perimeter,rise*phase+.03*depth]);offsets.push(offset);
  }
  const top=plan.process.firstLayerMm+Math.max(...points.map(p=>p[1]))+(courses-1)*rise;
  plan.geometry=loopHost({radius,heightMm:top,waveDepthMm});
  plan.placement={xMm:125,yMm:105};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.skills['vase-wall'],{enabled:true,pathMode:'continuous',pattern:{advance:[1,rise],repeats:courses,
    paths:[{points,offsetMm:offsets,beadHeightMm:rise}]}});
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const variant=process.argv[3]??'smooth';
  if(!['smooth','scalloped','both-scalloped','wavy'].includes(variant))throw new Error('Choose smooth, scalloped, both-scalloped or wavy.');
  const directory=resolve(process.argv[2]??`Prints/development/${variant}-loop-vase`);
  const options=variant==='wavy'?{exterior:'scalloped',waveDepthMm:.6,courses:36,loopsPerTurn:32,motifDepthMm:2.4,samplesPerLoop:40}:
    {exterior:variant};
  const plan=loopDemoPlan(options);
  await initBundle(directory,plan);
  const checked=await generateBundle(directory,{development:true});
  console.log(JSON.stringify({directory,moves:checked.moves,estimatedMinutes:checked.estimatedMinutes,
    variant,options,
    scope:'Continuous tilted loops warped around a solid host. Development preview; contact and physical printing are not validated.'},null,2));
}
