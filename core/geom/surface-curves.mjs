import {findSpan,basisFunctions,evaluateCurve} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {bezierPieces} from './surface-intersection.mjs';
import {restrictBezierNet,bernsteinProductWeights} from './bezier-net.mjs';

// Hold U or V fixed, retaining the other axis's native knots and domain.
// These are ordinary rational curves, usable by offsets and closure queries.
export function surfaceIsoCurve(patch,axis,value){
  requireThat(axis===0||axis===1,'Isocurve axis is U (0) or V (1).');
  const counts=[patch.nu,patch.nv],orders=[patch.orderU,patch.orderV],knots=[patch.knotsU,patch.knotsV],domains=[patch.domainU,patch.domainV],along=1-axis;
  requireThat(value>=domains[axis][0]&&value<=domains[axis][1],'Isocurve leaves the surface domain.');
  const span=findSpan(knots[axis],counts[axis],orders[axis],value),basis=basisFunctions(knots[axis],span,value,orders[axis]),cp=new Float64Array(counts[along]*4);
  for(let i=0;i<counts[along];i++)for(let j=0;j<orders[axis];j++){
    const fixed=span-orders[axis]+1+j,index=axis===0?fixed*patch.nv+i:i*patch.nv+fixed;
    for(let k=0;k<4;k++)cp[i*4+k]+=basis[j]*patch.cp[index*4+k];
  }
  return {n:counts[along],order:orders[along],knots:knots[along],cp,domain:[...domains[along]],source:{surface:patch,axis,value}};
}

export function curvePoint(curve,fraction){
  return evaluateCurve(curve,curve.domain[0]+fraction*(curve.domain[1]-curve.domain[0])).point;
}

// Exact rational images of a straight segment in the surface's native UV.
// Split only at knot lines, then restrict each tensor-product Bezier net to
// its diagonal. Multiplying its two Bernstein bases yields degree p+q.
export function surfaceSegmentCurves(patch,a,b){
  const direction=b.map((value,k)=>value-a[k]),cuts=[0,1];
  for(const [axis,knots] of [patch.knotsU,patch.knotsV].entries()){
    if(!direction[axis])continue;
    for(const knot of knots){const t=(knot-a[axis])/direction[axis];if(t>0&&t<1)cuts.push(t);}
  }
  const ordered=[...new Set(cuts)].sort((x,y)=>x-y),pieces=bezierPieces(patch),curves=[];
  for(let i=1;i<ordered.length;i++){
    const from=ordered[i-1],to=ordered[i],mid=a.map((value,k)=>value+(from+to)/2*direction[k]);
    const piece=pieces.find(piece=>mid[0]>=piece.u[0]&&mid[0]<=piece.u[1]&&mid[1]>=piece.v[0]&&mid[1]<=piece.v[1]);
    requireThat(piece,'Surface segment leaves its native knot spans.');
    const ranges=[piece.u,piece.v].map(([low,high],k)=>[from,to].map(t=>(a[k]+t*direction[k]-low)/(high-low)));
    const restricted=restrictBezierNet(piece.net,ranges.map(range=>[Math.min(...range),Math.max(...range)]));
    const rows=ranges[0][1]>=ranges[0][0]?restricted:[...restricted].reverse();
    const oriented=ranges[1][1]>=ranges[1][0]?rows:rows.map(row=>[...row].reverse());
    const net=direction[0]===0?[oriented[0]]:direction[1]===0?oriented.map(row=>[row[0]]):oriented;
    const p=net.length-1,q=net[0].length-1,weights=bernsteinProductWeights(p,q),controls=Array.from({length:p+q+1},()=>[0,0,0,0]);
    for(let u=0;u<=p;u++)for(let v=0;v<=q;v++)for(let k=0;k<4;k++)controls[u+v][k]+=weights[u][v]*net[u][v][k];
    const n=controls.length;
    curves.push({n,order:n,cp:Float64Array.from(controls.flat()),knots:Float64Array.from([...Array(n).fill(from),...Array(n).fill(to)]),domain:[from,to]});
  }
  return curves;
}
