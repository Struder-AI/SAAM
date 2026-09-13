// Isolated, unapproved example through the public geometry preparation workflow.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,loadBundle} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';

const directory=resolve(process.argv[2]??'Prints/text-development');
const fontPath=fileURLToPath(new URL('../tests/fixtures/Abel-Regular.ttf',import.meta.url));
const box={shape:'box',runMm:24,widthMm:14,heightMm:3};
const plan=defaults();plan.skills['draped-skin'].enabled=false;
plan.geometry={shape:'assembly',parts:[
  {id:'raised',xMm:0,yMm:0,zMm:0,geometry:box},
  {id:'recessed',xMm:30,yMm:0,zMm:0,geometry:box},
  {id:'curved-roof',xMm:0,yMm:20,zMm:0,geometry:{shape:'spline-top',runMm:24,widthMm:14,cpU:4,cpV:4,heightsMm:[[3,3,3,3],[3,7,7,3],[3,7,7,3],[3,3,3,3]]}},
  {id:'wrapped-pipe',xMm:43,yMm:31,zMm:0,geometry:{shape:'pipe',innerRadiusMm:8,outerRadiusMm:10.4,heightMm:12,toleranceMm:0.01}}
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
