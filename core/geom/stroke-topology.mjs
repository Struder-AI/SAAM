import {offsetPaths} from '../region/clipper.mjs';

// Query the footprint topology of 2D centerlines widened by a round bead.
// Coordinates and width use the same caller-chosen units. The scale controls
// integer precision for the polygon operation; font units use ten ticks/unit.
export function strokeTopology(strokes,width,{scale=10}={}){
  if(!Array.isArray(strokes)||!Number.isFinite(width)||width<=0||!Number.isFinite(scale)||scale<=0)
    throw Error('Stroke topology needs centerlines, positive width and scale.');
  const paths=strokes.map(stroke=>{
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    return points.map(([x,y])=>({X:Math.round(x*scale),Y:Math.round(y*scale)}));
  });
  const loops=offsetPaths(paths,width/2*scale,{join:'round',miterLimit:2,arcTolerance:0.3*scale,end:'Round'});
  const area=loop=>loop.reduce((sum,p,i)=>sum+(p.X*loop[(i+1)%loop.length].Y-loop[(i+1)%loop.length].X*p.Y),0)/2;
  const components=loops.filter(loop=>area(loop)>0).length;
  return {components,holes:loops.length-components};
}
