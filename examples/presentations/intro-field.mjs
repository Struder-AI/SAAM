// Presentation field homotopy; SAAM owns contour extraction, clipping and mapping.
import {sampledFieldStrokes} from '../../core/region/fill-patterns.mjs';
export function blendedInfill(layer,amount){
  const region=layer.preparedLayout.sparseRegion,spacing=layer.pitchMm/layer.strokeSettings.fillDensity;
  const step=Math.min(layer.strokeSettings.sampleStepMm,2.4*spacing/32),points=region.flat();
  const axes=[0,1].map(k=>{const lo=Math.min(...points.map(p=>p[k])),hi=Math.max(...points.map(p=>p[k])),n=Math.ceil((hi-lo)/step);return Array.from({length:n+1},(_,i)=>lo+(hi-lo)*i/n);});
  const k=(1-amount)*Math.PI/spacing+amount*2*Math.PI/(2.4*spacing),angle=layer.strokeSettings.patternAngleDeg*Math.PI/180,z=layer.slice.origin[2]*k;
  const [xs,ys]=axes,values=xs.map(x=>Float64Array.from(ys,y=>{
    const straight=Math.sin(k*(-Math.sin(angle)*x+Math.cos(angle)*y)),X=x*k,Y=y*k;
    const gyroid=Math.sin(X)*Math.cos(Y)+Math.sin(Y)*Math.cos(z)+Math.sin(z)*Math.cos(X);
    return (1-amount)*straight+amount*gyroid;
  }));
  return sampledFieldStrokes({xs,ys,values},region).map(curve=>({...curve,role:'infill'}));
}
