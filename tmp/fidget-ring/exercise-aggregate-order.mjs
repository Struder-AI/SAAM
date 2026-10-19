import {readFileSync,writeFileSync} from 'node:fs';
import {schedulePath} from '../../core/path/schedule.mjs';
import {resolveSourceOrder} from '../../core/path/compose.mjs';
import {prepareCurvePath} from '../../core/path/curve-path.mjs';
import {joinSaamPath} from '../../core/path/saampath.mjs';
const original=JSON.parse(readFileSync('C:/SAAM/local/Prints/concentric-groove-fidget-20261017/paths/afce18c6-a599-4a8d-8470-ed3dc09be7db.json','utf8'));
const rotate=([x,y,z])=>{const a=.91,b=.47,Y=y*Math.cos(a)-z*Math.sin(a),Z=y*Math.sin(a)+z*Math.cos(a);return [x*Math.cos(b)-Y*Math.sin(b),x*Math.sin(b)+Y*Math.cos(b),Z];};
function profile(value,map){return value?.knots?{...value,knots:value.knots.map(([u,v])=>[u,map(v)])}:map(value);}
const pose=p=>({toolAxis:rotate(p.toolAxis),toolUp:rotate(p.toolUp)});
const rotated=structuredClone(original);
for(const c of Object.values(rotated.curves)){
  if(c.geometry.kind==='polyline')c.geometry.points=c.geometry.points.map(rotate);
  else if(c.geometry.kind==='nurbs')c.geometry.controlPoints=c.geometry.controlPoints.map(rotate);
  c.profiles.materialNormal=profile(c.profiles.materialNormal,rotate);c.profiles.pose=profile(c.profiles.pose,pose);
}
for(const s of Object.values(rotated.surfaces))for(const key of ['origin','normal','xAxis','yAxis'])if(s[key])s[key]=rotate(s[key]);
for(const op of Object.values(rotated.operations))if(op.stackDirection)op.stackDirection=rotate(op.stackDirection);
const results=[];
const started=performance.now(),scheduled=schedulePath(rotated,{sourcePathId:'rotated-spinner'});
joinSaamPath({sourcePathId:'rotated-spinner',deposition:rotated,schedule:scheduled});
results.push({case:'rigidly rotated spinner',elapsedMs:performance.now()-started,hierarchy:scheduled.summary.composition.hierarchy,queries:scheduled.summary.composition.queries});
const tiny=structuredClone(original),template=Object.values(original.operations)[0],curve=Object.values(original.curves)[0];
tiny.curves={};tiny.layers={};tiny.operations={};tiny.completions={};tiny.surfaces={};tiny.planning.process.minimumLayerSeconds=0;
for(const [id,z] of [['base',.2],['top',.4]]){
 tiny.curves[id]={geometry:{kind:'polyline',points:[[-2,0,z],[2,0,z]]},profiles:structuredClone(curve.profiles)};
 tiny.layers[id]={stackId:id,index:0,surfaceId:id,completionId:'completion:'+id};
 tiny.surfaces[id]={kind:'plane',origin:[0,0,z],normal:[0,0,1],xAxis:[1,0,0],yAxis:[0,1,0]};
 tiny.operations[id]={...template,id,layerId:id,construction:id,after:[],courses:[{...template.courses[0],id,curveId:id,from:0,to:1}]};
 tiny.completions['completion:'+id]={kind:'slice',members:[id],after:[]};
}
const supported=schedulePath(tiny,{sourcePathId:'support-contact'});
joinSaamPath({sourcePathId:'support-contact',deposition:tiny,schedule:supported});
results.push({case:'independent true supporting contact',summary:supported.summary.composition});
tiny.operations.base.after=['top'];
try{resolveSourceOrder(tiny,prepareCurvePath(tiny),{nozzleGeometry:{includedAngleDeg:80,tipDiameterMm:1.2}});results.push({case:'hard opposing prerequisite',unexpected:'accepted'});}
catch(error){results.push({case:'hard opposing prerequisite',code:error.code,message:error.message});}
writeFileSync('tmp/fidget-ring/aggregate-exercises.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
