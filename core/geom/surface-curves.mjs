import {findSpan,basisFunctions,evaluateCurve,requireSplineDegree} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {bezierPieces} from './surface-intersection.mjs';
import {restrictBezierNet,bernsteinProductWeights} from './bezier-net.mjs';
import {cubicBezierPieces} from './cubic-bezier.mjs';
import {FLOAT64_EPSILON} from '../dimensions.mjs';

// Hold U or V fixed, retaining the other axis's native knots and domain.
// These are ordinary rational curves, usable by offsets and closure queries.
export function surfaceIsoCurve(patch,axis,value){
  requireSplineDegree(patch.orderU-1);requireSplineDegree(patch.orderV-1);
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

// Images of straight chart segments retain their parameters. Bernstein
// composition is reduced to certified cubic pieces before becoming curves.
function surfaceSegmentPolynomials(patch,a,b){
  const direction=b.map((value,k)=>value-a[k]),cuts=[0,1];
  for(const [axis,knots] of [patch.knotsU,patch.knotsV].entries()){
    if(!direction[axis])continue;
    for(const knot of knots){const t=(knot-a[axis])/direction[axis];if(t>0&&t<1)cuts.push(t);}
  }
  const ordered=[...new Set(cuts)].sort((x,y)=>x-y),pieces=bezierPieces(patch),polynomials=[];
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
    polynomials.push({controls,from,to});
  }
  return polynomials;
}
export function surfaceSegmentCurves(patch,a,b){
  const curves=[];
  for(const polynomial of surfaceSegmentPolynomials(patch,a,b)){
    for(const piece of cubicBezierPieces(polynomial.controls,{from:polynomial.from,to:polynomial.to})){
      const n=piece.rows.length;
      curves.push({n,order:n,cp:Float64Array.from(piece.rows.flat()),knots:Float64Array.from([...Array(n).fill(piece.from),...Array(n).fill(piece.to)]),
        domain:[piece.from,piece.to],positionErrorMm:piece.positionErrorMm});
    }
  }
  return curves;
}

// Bound deviation from the supplied, identically parameterized line over the
// whole native chart segment. No probing or spline approximation participates
// in deciding whether topology may replace an edge by a line or a point.
export function surfaceSegmentLineError(patch,a,b,first,last){
  const bounds=surfaceSegmentPolynomials(patch,a,b).map(({controls,from,to})=>{
    const weightScale=Math.max(...controls.map(row=>row[3]));
    const rows=controls.map(row=>row.map(v=>v/weightScale)),degree=rows.length-1;
    const start=first.map((v,k)=>v+from*(last[k]-v)),end=first.map((v,k)=>v+to*(last[k]-v));
    const numerator=Array.from({length:degree+2},(_,i)=>{
      const t=i/(degree+1),left=rows[Math.min(i,degree)],right=rows[Math.max(0,i-1)];
      return [0,1,2].map(k=>(1-t)*(left[k]-left[3]*start[k])+t*(right[k]-right[3]*end[k]));
    });
    const weight=Math.min(...rows.map(row=>row[3]));
    const rounding=FLOAT64_EPSILON*16*rows.length**3*Math.max(1,...rows.flat().map(Math.abs),...start.map(Math.abs),...end.map(Math.abs))/weight;
    return Math.max(...numerator.map(row=>Math.hypot(...row)))/weight+rounding;
  });
  return Math.max(...bounds);
}
