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

// Default loop width so adjacent loops are exactly tangent — touching at a
// single point with no overlap into each other's interior. The physical bead
// width already gives that point a real bonding surface, so the centerlines
// themselves should not also overlap. Numerically solved since the footprint
// span above has no closed-form inverse.
export function touchingMotifWidthMm({perimeter,loopsPerTurn}){
  const advance=perimeter/loopsPerTurn;
  let lo=advance/(2*Math.PI)+1e-6,hi=advance*4;
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    if(loopFootprintSpanMm(mid,advance)<advance)lo=mid;else hi=mid;
  }
  return lo+hi;
}

// Inverse of touchingMotifWidthMm: given a fixed loop half-width, the
// tangential advance at which adjacent loops of that size are exactly
// tangent. footprintSpan-advance falls from 2*tangentRadius (a stationary
// loop) to negative (a flattened one) as advance grows, so this root — where
// it crosses zero — is unique.
function touchingAdvanceMm({tangentRadius}){
  let lo=1e-6,hi=2*Math.PI*tangentRadius-1e-6;
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    if(loopFootprintSpanMm(tangentRadius,mid)-mid>0)lo=mid;else hi=mid;
  }
  return (lo+hi)/2;
}

// A loop's own tangential width should stay a fixed, small multiple of the
// requested wall depth (its length:width ratio) so every loop reads as the
// same tight coil regardless of the host's local diameter. Picking a loop
// *count* first and letting width be whatever touching that spacing implies
// does the opposite: the same loopsPerTurn stretches loops thin on a wide
// host and crowds them on a narrow one, since nothing then ties width to
// depth at all. Here width is fixed first; loopsPerTurn is just how many of
// these fixed-size, touching loops fit around the actual local perimeter.
export function tightLoopMotif({perimeter,motifDepthMm,lengthToWidthRatio=3}){
  const motifWidthMm=lengthToWidthRatio*motifDepthMm;
  const advance=touchingAdvanceMm({tangentRadius:motifWidthMm/2});
  return {motifWidthMm,loopsPerTurn:Math.max(1,Math.ceil(perimeter/advance))};
}

export function loopDemoPlan({courses=24,loopsPerTurn=null,samplesPerLoop=64,
  radius=14,motifDepthMm=4.8,motifWidthMm=null,exterior='smooth',waveDepthMm=0}={}){
  if(!['smooth','scalloped','both-scalloped'].includes(exterior))throw new Error('Choose smooth, scalloped or both-scalloped.');
  const plan=defaults();
  const perimeter=2*Math.PI*(radius-plan.process.lineWidthMm/2),rise=plan.process.layerMm;
  // Neither given: size loops by the fixed length:width ratio. Only
  // loopsPerTurn given: keep the old period-first behavior (width touching
  // that specific spacing) for callers that still want to pick a count.
  const tight=tightLoopMotif({perimeter,motifDepthMm});
  const turnsPerCourse=loopsPerTurn??tight.loopsPerTurn;
  const width=motifWidthMm??(loopsPerTurn!=null?touchingMotifWidthMm({perimeter,loopsPerTurn:turnsPerCourse}):tight.motifWidthMm);
  const tangentRadius=width/2;
  const points=[],offsets=[];
  // The advance is part of the looping curve itself. There is no separate
  // circumference stroke, closing circle, or straight connector between loops.
  for(let i=0;i<=turnsPerCourse*samplesPerLoop;i++){
    const phase=i/(turnsPerCourse*samplesPerLoop),fraction=(i%samplesPerLoop)/samplesPerLoop;
    const angle=2*Math.PI*fraction,x=tangentRadius*Math.sin(angle);
    const depth=motifDepthMm*(1-Math.cos(angle))/2;
    const offset=exterior==='both-scalloped'?motifDepthMm/2-depth:exterior==='scalloped'?depth:-depth;
    points.push([phase+x/perimeter,rise*phase+.03*depth]);offsets.push(offset);
  }
  const top=plan.process.firstLayerMm+points.reduce((max,p)=>Math.max(max,p[1]),0)+(courses-1)*rise;
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
