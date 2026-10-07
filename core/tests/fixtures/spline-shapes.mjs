// Spline solids written the way GEOMETRY.md describes, for tests and
// benchmarks only. Shipped code and agents author their own patches; nothing
// outside tests and benchmarks imports this module.
import {clampedKnots} from '../../geom/spline-solid.mjs';

// A rectangular block whose top follows a grid
// of control heights, rows along X and columns along Y. Top control points sit
// on the Greville abscissae, so the footprint is exactly runMm by widthMm and
// the ruled sides share the top's boundary curves.
export function splineBlock({runMm,widthMm,heightsMm}){
  const nu=heightsMm.length,nv=heightsMm[0].length,pu=Math.min(3,nu-1),pv=Math.min(3,nv-1);
  const greville=(count,degree)=>{const k=clampedKnots(count,degree);return Array.from({length:count},(_,i)=>k.slice(i+1,i+degree+1).reduce((a,b)=>a+b,0)/degree);};
  const x=greville(nu,pu).map(g=>g*runMm),y=greville(nv,pv).map(g=>g*widthMm);
  const wall=(points,degree)=>({degreeU:degree,degreeV:1,controlPoints:points.map(([px,py,h])=>[[px,py,0],[px,py,h]])});
  return {shape:'spline',patches:[
    {name:'top',degreeU:pu,degreeV:pv,controlPoints:x.map((px,i)=>y.map((py,j)=>[px,py,heightsMm[i][j]]))},
    {name:'bottom',degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,widthMm,0]],[[runMm,0,0],[runMm,widthMm,0]]]},
    {name:'front',...wall(x.map((px,i)=>[px,0,heightsMm[i][0]]),pu)},
    {name:'right',...wall(y.map((py,j)=>[runMm,py,heightsMm[nu-1][j]]),pv)},
    {name:'back',...wall(x.map((px,i)=>[px,widthMm,heightsMm[i][nv-1]]),pu)},
    {name:'left',...wall(y.map((py,j)=>[0,py,heightsMm[0][j]]),pv)}
  ]};
}

export const splineBox=({runMm,widthMm,heightMm})=>splineBlock({runMm,widthMm,heightsMm:[[heightMm,heightMm],[heightMm,heightMm]]});

// A tube written as four spline patches that share one periodic cubic basis
// around the axis: the exterior, the bore and the two annular ends ruled
// between them. radiusAt(angle, t) gives the exterior control radius at
// height fraction t on a clamped cubic grid of `rows` controls (linear when
// rows is 2). Uniform cubic B-splines sit slightly inside their control
// circle, so control radii are scaled to put the curve's knots on the radius.
export function splineTube({columns,rows=2,heightMm,boreRadiusMm,radiusAt}){
  const degreeV=Math.min(3,rows-1),vKnots=clampedKnots(rows,degreeV);
  const grevilleV=j=>vKnots.slice(j+1,j+degreeV+1).reduce((a,b)=>a+b,0)/degreeV;
  const onCurve=(4+2*Math.cos(2*Math.PI/columns))/6;
  const ring=(radius,z,i)=>{const a=2*Math.PI*(i%columns)/columns,r=radius/onCurve;return [r*Math.cos(a),r*Math.sin(a),z];};
  const around=Array.from({length:columns+3},(_,i)=>i);
  const knotsU=Array.from({length:columns+7},(_,i)=>i-3);
  const outer=around.map(i=>Array.from({length:rows},(_,j)=>ring(radiusAt(2*Math.PI*(i%columns)/columns,grevilleV(j)),heightMm*grevilleV(j),i)));
  const bore=around.map(i=>[ring(boreRadiusMm,0,i),ring(boreRadiusMm,heightMm,i)]);
  return {shape:'spline',patches:[
    {name:'outer',degreeU:3,degreeV,knotsU,controlPoints:outer},
    {name:'bore',degreeU:3,degreeV:1,knotsU,controlPoints:bore},
    {name:'bottom',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][0],outer[k][0]])},
    {name:'top',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][1],outer[k][rows-1]])}]};
}
