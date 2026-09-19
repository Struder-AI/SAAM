// A normal rising vase course decorated with overlapping, gently tilted circles.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {circlePoints} from '../../../core/geom/cylinder.mjs';
import {loopMotif,tileVaseMotif} from './motif.mjs';

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

export function loopDemoPlan({courses=24,loopsPerTurn=20,samplesPerLoop=64,
  radius=14,motifDepthMm=4.8,motifWidthMm=5.6,exterior='smooth',waveDepthMm=0}={}){
  if(!['smooth','scalloped','both-scalloped'].includes(exterior))throw new Error('Choose smooth, scalloped or both-scalloped.');
  const plan=defaults();
  const perimeter=2*Math.PI*(radius-plan.process.lineWidthMm/2),rise=plan.process.layerMm;
  const pattern={motif:loopMotif({widthCells:motifWidthMm*loopsPerTurn/perimeter,depthMm:motifDepthMm,
    samples:samplesPerLoop,beadHeightMm:rise,exterior}),cellsPerTurn:loopsPerTurn,courseRiseMm:rise,repeats:courses,tiltDeg:0};
  const {points}=tileVaseMotif(pattern).paths[0];
  const top=plan.process.firstLayerMm+Math.max(...points.map(p=>p[1]))+(courses-1)*rise;
  plan.geometry=loopHost({radius,heightMm:top,waveDepthMm});
  plan.placement={xMm:125,yMm:105};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.skills['vase-wall'],{enabled:true,endTransition:'spiral',pathMode:'continuous',pattern});
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const variant=process.argv[3]??'smooth';
  if(!['smooth','scalloped','both-scalloped','wavy'].includes(variant))throw new Error('Choose smooth, scalloped, both-scalloped or wavy.');
  const directory=resolve(process.argv[2]??`Prints/development/${variant}-loop-vase`);
  const options=variant==='wavy'?{exterior:'scalloped',waveDepthMm:.6,courses:36,loopsPerTurn:32,motifWidthMm:3.2,motifDepthMm:2.4,samplesPerLoop:40}:
    {exterior:variant};
  const plan=loopDemoPlan(options);
  await initBundle(directory,plan);
  const checked=await generateBundle(directory,{development:true});
  console.log(JSON.stringify({directory,moves:checked.moves,estimatedMinutes:checked.estimatedMinutes,
    variant,options,
    scope:'Continuous tilted loops warped around a solid host. Development preview; contact and physical printing are not validated.'},null,2));
}
