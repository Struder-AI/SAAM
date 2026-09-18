import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
export function nudgeCupPlan(){
const N=120;
function meshBuilder(){const vertices=[],triangles=[];return {vertices,triangles,ring(r,z){const s=vertices.length;for(let i=0;i<N;i++){const t=2*Math.PI*i/N;vertices.push([r*Math.cos(t),r*Math.sin(t),z]);}return s;},connect(a,b,reverse=false){for(let i=0;i<N;i++){const j=(i+1)%N;for(let f of [[a+i,a+j,b+j],[a+i,b+j,b+i]])triangles.push(reverse?f.reverse():f);}},disk(ring,z,up){const c=vertices.length;vertices.push([0,0,z]);for(let i=0;i<N;i++)triangles.push(up?[ring+i,ring+(i+1)%N,c]:[ring+(i+1)%N,ring+i,c]);},geometry(){return {shape:'mesh',vertices,triangles,source:null};}};}
const cup=meshBuilder(),bottom=cup.ring(18,0),top=cup.ring(18+4*17.8/18,17.8);cup.connect(bottom,top);cup.disk(bottom,0,false);cup.disk(top,17.8,true);
const foot=meshBuilder(),outer=foot.ring(18+4*17.8/18,0);let last=outer,next=foot.ring(22,.2);foot.connect(last,next);last=next;
for(let deg=2;deg<=88;deg+=2){const t=deg*Math.PI/180;next=foot.ring(22*Math.cos(t),.2+22*Math.sin(t));foot.connect(last,next);last=next;}
foot.disk(last,22.2,true);
const inner=foot.ring(21.3,0),ceiling=foot.ring(9,12.3);foot.connect(inner,ceiling,true);foot.disk(ceiling,12.3,false);
for(let i=0;i<N;i++){const j=(i+1)%N;foot.triangles.push([outer+i,inner+i,inner+j],[outer+i,inner+j,outer+j]);}
const plan=defaults(loadMachine('ultimaker-s5'));
plan.geometry={shape:'assembly',parts:[{id:'cup',xMm:0,yMm:0,zMm:0,geometry:cup.geometry()},{id:'foot',xMm:0,yMm:0,zMm:17.8,geometry:foot.geometry()}]};
plan.placement={xMm:165,yMm:120};
Object.assign(plan.skills['draped-skin'],{layers:3,normalMm:.2,sampleStepMm:.25,surveyStepMm:.25});
const region=(id,part,zStartMm,zEndMm,skills)=>({id,part,zStartMm,zEndMm,skills,lowerSurfaceFrom:null});
plan.composition.regions=[region('open-lip','cup',0,1.2,{'planar-infill':{density:0,perimeters:3}}),region('light-cup','cup',1.2,17.8,{'vase-wall':{endTransition:'level'}}),region('weighted-foot','foot',0,null,{'full-fill':{mode:'body',perimeters:3,fillAnglesDeg:[0,90]},'draped-skin':{}})];
plan.composition.dependencies=[{before:'light-cup:vase-wall:wall',after:'weighted-foot:full-fill:0:walls'}];
return plan;
}
