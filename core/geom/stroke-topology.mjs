import {offsetPaths} from '../region/clipper.mjs';
import {cross,dot,requireThat} from './tolerance.mjs';
import {validateDirectionPair} from './frame.mjs';

// One footprint construction for topology queries and physical planar strokes.
// Keep source order and Math.round's grid convention; do not canonicalize loops.
function strokeFootprint(strokes,radius,scale,arcTolerance){
  const paths=strokes.map(stroke=>{
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    return points.map(([x,y])=>({X:Math.round(x*scale),Y:Math.round(y*scale)}));
  });
  return offsetPaths(paths,radius*scale,{join:'round',miterLimit:2,arcTolerance:arcTolerance*scale,end:'Round'});
}

// Round-capped, round-joined footprints of coplanar XYZ centerlines, in mm.
// The supplied unit frame sets the fixed 0.001 mm rounding grid. Native handles
// stay inside Clipper; output keeps its contour order and includes no bead data.
export function widenPlanarStrokes(strokes,radiusMm,{origin,xAxis,normal,arcToleranceMm}){
  requireThat(Array.isArray(origin)&&origin.length===3&&origin.every(Number.isFinite),'Stroke origin must be a finite XYZ point.');
  validateDirectionPair(xAxis,normal);
  requireThat(Number.isFinite(radiusMm)&&radiusMm>0&&Number.isFinite(arcToleranceMm)&&arcToleranceMm>0,'Stroke radius and arc tolerance must be positive and finite.');
  requireThat(Array.isArray(strokes)&&strokes.every(stroke=>Array.isArray(stroke.points)&&stroke.points.length>=2&&stroke.points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))),'Planar strokes need finite XYZ centerlines.');
  const yAxis=cross(normal,xAxis),local=strokes.map(stroke=>({closed:stroke.closed,points:stroke.points.map(p=>{
    const v=p.map((n,i)=>n-origin[i]);
    requireThat(Math.abs(dot(v,normal))<=1e-6,'Curved parallel strokes need physical surface offsets.');
    return [dot(v,xAxis),dot(v,yAxis)];
  })}));
  return strokeFootprint(local,radiusMm,1000,arcToleranceMm).filter(loop=>loop.length>=3)
    .map(loop=>loop.map(p=>origin.map((v,i)=>v+xAxis[i]*p.X/1000+yAxis[i]*p.Y/1000)));
}

// Query the footprint topology of 2D centerlines widened by a round bead.
// Coordinates and width use the same caller-chosen units. The scale controls
// integer precision for the polygon operation; font units use ten ticks/unit.
export function strokeTopology(strokes,width,{scale=10}={}){
  if(!Array.isArray(strokes)||!Number.isFinite(width)||width<=0||!Number.isFinite(scale)||scale<=0)
    throw Error('Stroke topology needs centerlines, positive width and scale.');
  const loops=strokeFootprint(strokes,width/2,scale,0.3);
  const area=loop=>loop.reduce((sum,p,i)=>sum+(p.X*loop[(i+1)%loop.length].Y-loop[(i+1)%loop.length].X*p.Y),0)/2;
  const components=loops.filter(loop=>area(loop)>0).length;
  return {components,holes:loops.length-components};
}
