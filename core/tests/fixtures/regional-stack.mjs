// Synthetic software-only composition example; never a hardware configuration
// or human job approval. One native roof component and an upper envelope share
// explicitly assigned material boundaries through lowerSurfaceFrom.
import {defaults} from '../../print/plan.mjs';
import {syntheticDobotSetup} from './dobot.mjs';

function wavyMesh() {
  const n=4,vertices=[],triangles=[],index=(x,y,top)=>top*(n+1)*(n+1)+x*(n+1)+y;
  for(const top of [0,1])for(let x=0;x<=n;x++)for(let y=0;y<=n;y++)vertices.push([x*2,y*2,top?3+0.3*Math.sin(Math.PI*x/n)*Math.sin(Math.PI*y/n):0]);
  const quad=(a,b,c,d)=>triangles.push([a,b,c],[a,c,d]);
  for(let x=0;x<n;x++)for(let y=0;y<n;y++) {
    quad(index(x,y,1),index(x+1,y,1),index(x+1,y+1,1),index(x,y+1,1));
    quad(index(x,y,0),index(x,y+1,0),index(x+1,y+1,0),index(x+1,y,0));
  }
  for(let i=0;i<n;i++) {
    quad(index(i,0,0),index(i+1,0,0),index(i+1,0,1),index(i,0,1));
    quad(index(n,i,0),index(n,i+1,0),index(n,i+1,1),index(n,i,1));
    quad(index(i+1,n,0),index(i,n,0),index(i,n,1),index(i+1,n,1));
    quad(index(0,i+1,0),index(0,i,0),index(0,i,1),index(0,i+1,1));
  }
  return {shape:'mesh',vertices,triangles,source:null};
}

export function regionalStackPlan(machine,backend='mesh') {
  const plan=defaults(machine);if(machine.id==='dobot-mg400')syntheticDobotSetup(plan);
  const roof=backend==='mesh'?wavyMesh():{shape:'spline-top',runMm:8,widthMm:8,cpU:4,cpV:4,
    heightsMm:[[3,3,3,3],[3,3.6,3.6,3],[3,3.6,3.6,3],[3,3,3,3]]};
  plan.geometry={shape:'assembly',parts:[{id:'roof',xMm:0,yMm:0,zMm:0,geometry:roof},
    {id:'upper',xMm:0,yMm:0,zMm:0,geometry:{shape:'box',runMm:8,widthMm:8,heightMm:4}}]};
  plan.process.minimumLayerSeconds=0;
  const region=(id,part,zStartMm,zEndMm,skills,supportPolicy='supported',lowerSurfaceFrom=null)=>({id,part,zStartMm,zEndMm,skills,supportPolicy,lowerSurfaceFrom});
  plan.composition.regions=[
    region('base','roof',0,0.4,{'full-fill':{mode:'body'}}),
    region('wall','roof',0.4,1.2,{'vase-wall':{endTransition:'level'}}),
    region('cap','roof',1.2,1.6,{'full-fill':{mode:'body'}},'bridge-experimental'),
    region('roof-finish','roof',1.6,null,{'planar-infill':{},'full-fill':{mode:'solid-surfaces',bottomLayers:1,topLayers:1},'draped-skin':{layers:2,normalMm:0.2,surveyStepMm:0.2,sampleStepMm:0.2}}),
    region('above-roof','upper',0,4,{'full-fill':{mode:'body',minFeatureMm:0.2}},'supported','roof-finish')
  ];
  return plan;
}
