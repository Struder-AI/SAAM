// Synthetic software-only composition example; never a hardware configuration
// or human job approval. A roof component is sliced below and above a vase-wall
// band and finished with a draped skin; a separate upper component is sliced
// whole. (A planar region consuming the roof's published lower surface waits
// for height-field slices.)
import {defaults} from '../../print/plan.mjs';
import {sliceAssignment} from '../../print/slices.mjs';
import {sleeveAssignment} from '../../print/sleeve-constructions.mjs';
import {skinAssignment} from '../../print/surface-constructions.mjs';
import {syntheticDobotSetup} from './dobot.mjs';
import {splineBox,splineBlock} from './spline-shapes.mjs';

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
  const roof=backend==='mesh'?wavyMesh():splineBlock({runMm:8,widthMm:8,heightsMm:[[3,3,3,3],[3,3.6,3.6,3],[3,3.6,3.6,3],[3,3,3,3]]});
  plan.geometry={shape:'assembly',parts:[{id:'roof',xMm:0,yMm:0,zMm:0,geometry:roof},
    {id:'upper',xMm:10,yMm:0,zMm:0,geometry:splineBox({runMm:8,widthMm:8,heightMm:4})}]};
  plan.process.minimumLayerSeconds=0;
  const slab=(fromMm,toMm)=>[{kind:'slab',fromMm,toMm}];
  plan.slices.assignments=[
    sliceAssignment({id:'base',part:'roof',fillDensity:1,within:slab(0,0.4)}),
    sliceAssignment({id:'cap',part:'roof',fillDensity:1,within:slab(1.2,1.6)}),
    sliceAssignment({id:'roof-body',part:'roof',solidTop:1,solidBottom:1}),
    sliceAssignment({id:'upper',part:'upper',fillDensity:1}),
    sleeveAssignment({id:'wall',part:'roof',zStartMm:.4,zEndMm:1.2,endTransition:'level'}),
    skinAssignment({id:'roof-finish',part:'roof',layers:2,pitchMm:.2,surveyStepMm:.2,sampleStepMm:.2})
  ];
  return plan;
}
