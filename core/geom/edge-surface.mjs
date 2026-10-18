// Geometric constructions from one closed boundary or two corresponding edges.
// These operations know no producer identity, dependencies, nozzle or machine.
import {matchCurveControls} from './curve-controls.mjs';
import {sampleSpatialCurve} from './spatial-curve.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {referenceSurface} from './reference-surface.mjs';
import {planeSlice} from './slice.mjs';
import {dot,cross,normalize,subtract,requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';

const xyz=p=>p.slice(0,3).map(v=>v/p[3]);
const weighted=p=>[...xyz(p),p[3]];

export function curvePairSurface(base,target,{correspondence={},normal=null}={}){
  const matched=matchCurveControls(base,target,correspondence),{baseControls,landingControls}=matched;
  const duplicate=base.closed&&xyz(baseControls[0]).every((v,k)=>v===xyz(baseControls.at(-1))[k]);
  const count=baseControls.length-(duplicate?1:0);
  const averageAdvanceMm=baseControls.slice(0,count).reduce((sum,p,i)=>sum+Math.hypot(...subtract(xyz(landingControls[i]),xyz(p))),0)/count;
  const surface={kind:'spline',degreeU:matched.degree,degreeV:1,knotsU:matched.knots,knotsV:[0,0,1,1],
    controlPoints:baseControls.map((p,i)=>[weighted(p),weighted(landingControls[i])]),sizeMm:[1,1]};
  if(normal&&dot(evaluateSurface(referenceSurface(surface),[.37,.5]).normal,normal)<0)surface.normalSide=-1;
  return {surface,averageAdvanceMm,matched,
    curveAt(t){return {closed:matched.closed,nurbs:{degree:matched.degree,knots:matched.knots,
      controlPoints:baseControls.map((p,i)=>xyz(p.map((v,k)=>v+t*(landingControls[i][k]-v)))),
      weights:baseControls.map((p,i)=>p[3]+t*(landingControls[i][3]-p[3]))}};}};
}

// Every returned row is a straight chord with endpoints on the actual 3D
// boundary. The projection chooses pairing only; it never flattens endpoints.
export function closedEdgeSpans(curve,{spacingMm,normal=null,angleDeg=0,sampleStepMm=.2}={}){
  requireThat(curve.closed,'A single bridge boundary must be closed; use two edges for an open loft.');
  requireThat(Number.isFinite(spacingMm)&&spacingMm>0&&Number.isFinite(angleDeg),'Bridge spacing must be positive and angle finite.');
  const {samples}=sampleSpatialCurve(curve,{toleranceMm:PRINT_RESOLUTION_MM/2,sampleStepMm});
  const points=samples.map(sample=>sample.point),origin=points[0];
  const area=points.slice(1).reduce((sum,p,i)=>{const c=cross(subtract(points[i],origin),subtract(p,origin));return sum.map((v,k)=>v+c[k]);},[0,0,0]);
  const frame=planeSlice({origin,normal:normal??area}),radians=angleDeg*Math.PI/180;
  const x=frame.xAxis.map((v,k)=>v*Math.cos(radians)+frame.yAxis[k]*Math.sin(radians)),y=cross(frame.normal,x);
  const projected=points.map(p=>[dot(subtract(p,origin),x),dot(subtract(p,origin),y)]);
  const low=Math.min(...projected.map(p=>p[1])),high=Math.max(...projected.map(p=>p[1]));
  requireThat(high-low>PRINT_RESOLUTION_MM,'The selected edge has no bridge area in this projection; use a different angle or two bounding edges.');
  const count=Math.max(1,Math.ceil((high-low)/spacingMm)),rows=[];
  for(let row=0;row<count;row++){
    const level=low+(row+.5)*(high-low)/count,hits=[];
    for(let i=1;i<points.length;i++){
      const a=projected[i-1],b=projected[i];if((a[1]>level)===(b[1]>level))continue;
      const t=(level-a[1])/(b[1]-a[1]);
      hits.push({along:a[0]+t*(b[0]-a[0]),point:points[i-1].map((v,k)=>v+t*(points[i][k]-v))});
    }
    hits.sort((a,b)=>a.along-b.along);
    requireThat(hits.length%2===0,'Bridge boundary projection has an unmatched crossing.');
    for(let i=0;i<hits.length;i+=2)if(hits[i+1].along-hits[i].along>ROUNDING_MM)rows.push([hits[i].point,hits[i+1].point]);
  }
  return {rows,normal:frame.normal};
}
