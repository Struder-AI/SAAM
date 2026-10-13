// Shape-preserving compatible control nets for curve interpolation.
import {authoredNurbs} from './spatial.mjs';
import {extract,join,reverseCurve} from './curve-ops.mjs';
import {requireThat,distance} from './tolerance.mjs';

export function controlCurve(input){
  requireThat(input&&typeof input.closed==='boolean','Curve needs explicit closure.');
  if(input.nurbs)return authoredNurbs(input.nurbs);
  let points=structuredClone(input.points);
  requireThat(Array.isArray(points)&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Curve needs finite XYZ controls or NURBS.');
  requireThat(points.length>=(input.closed?3:2),'Curve has too few controls.');
  if(input.closed&&distance(points[0],points.at(-1))===0)points.pop();
  if(input.closed)points.push(points[0]);
  return authoredNurbs({degree:1,controlPoints:points,knots:[0,...points.map((_,i)=>i/(points.length-1)),1]});
}
function orientedCurve(input,direction='forward',seam=0){
  let curve=controlCurve(input);
  const [a,b]=curve.domain;
  curve={...curve,knots:Float64Array.from(curve.knots,k=>(k-a)/(b-a)),domain:[0,1]};
  requireThat(['forward','reverse'].includes(direction)&&Number.isFinite(seam)&&seam>=0&&seam<1&&(input.closed||seam===0),'Curve direction/seam is invalid.');
  if(direction==='reverse')curve=reverseCurve(curve);
  if(seam){curve=join(extract(curve,seam,1),extract(curve,0,seam),1);
    curve={...curve,knots:Float64Array.from(curve.knots,k=>k-seam),domain:[0,1]};}
  return curve;
}
function elevatedControls(controls,degree,target){
  let rows=Array.from({length:controls.length/4},(_,i)=>Array.from(controls.slice(i*4,i*4+4)));
  while(degree<target){const next=[rows[0]];
    for(let i=1;i<=degree;i++)next.push(rows[i].map((v,k)=>i/(degree+1)*rows[i-1][k]+(1-i/(degree+1))*v));
    next.push(rows.at(-1));rows=next;degree++;}
  return rows;
}
export function matchCurveControls(base,landing,mapping={}){
  requireThat(base.closed===landing.closed,'Curve closures must match.');
  const a=orientedCurve(base,mapping.baseDirection,mapping.baseSeam),b=orientedCurve(landing,mapping.landingDirection,mapping.landingSeam);
  const degree=Math.max(a.order,b.order)-1;
  const result=(knots,baseControls,landingControls)=>{
    const same=controls=>[0,1,2].every(k=>controls[0][k]/controls[0][3]===controls.at(-1)[k]/controls.at(-1)[3]);
    const count=base.closed&&same(baseControls)&&same(landingControls)?baseControls.length-1:baseControls.length;
    return {closed:base.closed,degree,knots,baseControls,landingControls,
      direction:[0,1,2].map(k=>baseControls.slice(0,count).reduce((sum,p,i)=>sum+landingControls[i][k]/landingControls[i][3]-p[k]/p[3],0)/count)};
  };
  if(a.order===b.order&&a.knots.length===b.knots.length&&a.knots.every((v,i)=>v===b.knots[i]))return result(Array.from(a.knots),elevatedControls(a.cp,degree,degree),elevatedControls(b.cp,degree,degree));
  const cuts=[...new Set([0,1,...a.knots,...b.knots])].filter(t=>t>=0&&t<=1).sort((x,y)=>x-y);
  const compatible=curve=>cuts.slice(1).flatMap((end,i)=>{
    const piece=extract(curve,cuts[i],end),rows=elevatedControls(piece.cp,curve.order-1,degree);
    return i?rows.slice(1):rows;
  });
  return result([...Array(degree+1).fill(0),...cuts.slice(1,-1).flatMap(t=>Array(degree).fill(t)),...Array(degree+1).fill(1)],compatible(a),compatible(b));
}
