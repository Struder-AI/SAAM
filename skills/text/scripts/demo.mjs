// Isolated, unapproved example through the public geometry preparation workflow.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,loadBundle} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';
import {clampedKnots} from '../../../core/geom/spline-solid.mjs';
import {splineTube} from '../../pipe-cladding/scripts/demo.mjs';
// A box is six flat patches, each a 2 × 2 net of shared corners (GEOMETRY.md).
const splineBox=({runMm:x,widthMm:y,heightMm:z})=>{
  const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
  return {shape:'spline',patches:[face('top',[0,0,z],[0,y,z],[x,0,z],[x,y,z]),face('bottom',[0,0,0],[0,y,0],[x,0,0],[x,y,0]),
    face('front',[0,0,0],[0,0,z],[x,0,0],[x,0,z]),face('right',[x,0,0],[x,0,z],[x,y,0],[x,y,z]),
    face('back',[0,y,0],[0,y,z],[x,y,0],[x,y,z]),face('left',[0,0,0],[0,0,z],[0,y,0],[0,y,z])]};
};
// A block whose cubic top follows a grid of control heights: top controls sit on
// the Greville abscissae so the footprint is exact, and each wall is ruled down
// from the top's boundary row, sharing its control points (GEOMETRY.md).
const splineBlock=({runMm,widthMm,heightsMm})=>{
  const nu=heightsMm.length,nv=heightsMm[0].length,pu=Math.min(3,nu-1),pv=Math.min(3,nv-1);
  const greville=(n,p)=>{const k=clampedKnots(n,p);return Array.from({length:n},(_,i)=>k.slice(i+1,i+p+1).reduce((a,b)=>a+b,0)/p);};
  const x=greville(nu,pu).map(g=>g*runMm),y=greville(nv,pv).map(g=>g*widthMm);
  const wall=(points,degree)=>({degreeU:degree,degreeV:1,controlPoints:points.map(([px,py,h])=>[[px,py,0],[px,py,h]])});
  return {shape:'spline',patches:[
    {name:'top',degreeU:pu,degreeV:pv,controlPoints:x.map((px,i)=>y.map((py,j)=>[px,py,heightsMm[i][j]]))},
    {name:'bottom',degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,widthMm,0]],[[runMm,0,0],[runMm,widthMm,0]]]},
    {name:'front',...wall(x.map((px,i)=>[px,0,heightsMm[i][0]]),pu)},
    {name:'right',...wall(y.map((py,j)=>[runMm,py,heightsMm[nu-1][j]]),pv)},
    {name:'back',...wall(x.map((px,i)=>[px,widthMm,heightsMm[i][nv-1]]),pu)},
    {name:'left',...wall(y.map((py,j)=>[0,py,heightsMm[0][j]]),pv)}]};
};

const directory=resolve(process.argv[2]??'Prints/text-development');
const fontPath=fileURLToPath(new URL('../tests/fixtures/Abel-Regular.ttf',import.meta.url));
const box=splineBox({runMm:24,widthMm:14,heightMm:3});
const plan=defaults();
plan.geometry={shape:'assembly',parts:[
  {id:'raised',xMm:0,yMm:0,zMm:0,geometry:box},
  {id:'recessed',xMm:30,yMm:0,zMm:0,geometry:box},
  {id:'curved-roof',xMm:0,yMm:20,zMm:0,geometry:splineBlock({runMm:24,widthMm:14,heightsMm:[[3,3,3,3],[3,7,7,3],[3,7,7,3],[3,3,3,3]]})},
  {id:'wrapped-pipe',xMm:43,yMm:31,zMm:0,geometry:splineTube({columns:24,heightMm:12,boreRadiusMm:8,radiusAt:()=>10.4})}
]};
await initBundle(directory,plan);
for(const part of ['raised','recessed'])await applyText(directory,{part,feature:{fontPath,text:'SAAM',sizeMm:7,positionMm:[4,4],mode:part==='raised'?'raised':'recessed',depthMm:0.8,
  reference:{kind:'plane',origin:[0,0,3],xAxis:[1,0,0],yAxis:[0,1,0]}}});
await applyText(directory,{part:'curved-roof',feature:{fontPath,text:'CURVE',sizeMm:6,outlineOffsetMm:0.15,positionMm:[4,4],depthMm:0.8,
  reference:{kind:'part',patch:'top',sizeMm:[24,14]}}});
const radius=10.4;
await applyText(directory,{part:'wrapped-pipe',feature:{fontPath,text:'WRAP',sizeMm:5,positionMm:[2,3],depthMm:0.8,
  reference:{kind:'spline',degreeU:2,degreeV:1,sizeMm:[Math.PI*radius/2,12],controlPoints:[
    [[radius,0,0],[radius,0,12]],[[radius,radius,0,Math.SQRT1_2],[radius,radius,12,Math.SQRT1_2]],[[0,radius,0],[0,radius,12]]
  ]}}});
const state=await loadBundle(directory,{program:false});
console.log(JSON.stringify({directory,mode:'development geometry only',approvals:state.review.approvals,parts:state.geometry.features.map(f=>f.id)},null,2));
