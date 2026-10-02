import {distance,requireThat,findRoot} from './tolerance.mjs';


// Numerical curve refinement shared by native, mapped and family curves.
// The evaluator is geometry-only: samples contain a world point and optional
// chart coordinates; deposition, ordering and machine policy live elsewhere.
export function sampleCurveIntervals({at,cuts=[0,1],stepMm,toleranceMm,chartSteps=[]}){
  requireThat(stepMm>0&&toleranceMm>0,'Curve sampling needs positive physical step and tolerance.');
  const ordered=[...new Set(cuts)].sort((a,b)=>a-b),samples=[{...at(ordered[0]),t:ordered[0]}];
  const evaluate=t=>({...at(t),t});
  for(let i=1;i<ordered.length;i++){
    const stack=[[samples.at(-1),evaluate(ordered[i])]];
    while(stack.length){
      const [a,b]=stack.pop(),fractions=[.25,.5,.75],probes=fractions.map(f=>evaluate(a.t+(b.t-a.t)*f));
      const error=Math.max(...probes.map((p,j)=>distance(p.point,a.point.map((v,k)=>v+(b.point[k]-v)*fractions[j]))));
      const chartOkay=chartSteps.every((limit,k)=>!Number.isFinite(limit)||Math.abs(b.chart[k]-a.chart[k])<=limit);
      if(chartOkay&&distance(a.point,b.point)<=stepMm&&error<=toleranceMm){samples.push(b);continue;}
      const mid=probes[1];
      requireThat(mid.t>a.t&&mid.t<b.t,'Curve refinement cannot progress at requested physical tolerance.');
      stack.push([mid,b],[a,mid]);
    }
  }
  return samples;
}

// Positive intervals evidenced by an ordered parameter survey. Refinement
// locates observed sign changes; it does not discover unsampled crossings.
export function sampledPositiveIntervals(at,parameters,values=parameters.map(at)){
  const intervals=[];
  let start=values[0]>0?parameters[0]:null;
  for(let j=1;j<parameters.length;j++){
    const active=values[j]>0,before=values[j-1]>0;
    if(active!==before){
      const root=findRoot(at,parameters[j-1],parameters[j],values[j-1],values[j]);
      if(active)start=root;else{intervals.push([start,root]);start=null;}
    }
  }
  if(start!==null)intervals.push([start,parameters.at(-1)]);
  return intervals;
}
