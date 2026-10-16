// Retain exact native images of piecewise straight chart paths. Process fields
// and scheduling never enter this boundary; altered/unsupported mappings stay
// with their finalized sampled geometry.
import {surfaceSegmentCurves} from './surface-curves.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {prepareNumericalCurve,numericalCurveAt,numericalCurveRange} from './curve-query.mjs';
import {distance} from './tolerance.mjs';
import {ROUNDING_MM,FLOAT64_EPSILON,PRINT_RESOLUTION_MM} from '../dimensions.mjs';

function elevate(rows,degree){
  const state={rows};
  while(state.rows.length<=degree){
    const previous=state.rows,n=previous.length;
    state.rows=Array.from({length:n+1},(_,i)=>i===0?previous[0]:i===n?previous.at(-1):
      previous[i].map((value,k)=>(1-i/n)*value+i/n*previous[i-1][k]));
  }
  return state.rows;
}
function reduce(rows){
  const state={rows};
  while(state.rows.length>2){
    const current=state.rows,n=current.length-1,lower=[current[0]];
    for(let i=1;i<n;i++)lower.push(current[i].map((value,k)=>(n*value-i*lower[i-1][k])/(n-i)));
    const checked=elevate(lower,n),weight=Math.min(...lower.map(row=>row[3]));
    const rounding=FLOAT64_EPSILON*128*n*n*Math.max(1,...current.flat().map(Math.abs));
    if(!(weight>0)||checked.some((row,i)=>row.some((value,k)=>Math.abs(value-current[i][k])>
      (k===3?rounding:ROUNDING_MM*weight/n+rounding))))break;
    state.rows=lower;
  }
  return state.rows;
}
function corners(surface,chart){
  const kept=[0];
  for(let i=1;i<chart.length-1;i++){
    const a=chart[kept.at(-1)],b=chart[i],c=chart[i+1],delta=c.map((value,k)=>value-a[k]);
    const length2=delta.reduce((sum,value)=>sum+value*value,0),t=length2?b.reduce((sum,value,k)=>sum+(value-a[k])*delta[k],0)/length2:0;
    const on=a.map((value,k)=>value+t*delta[k]);
    if(!(t>0&&t<1)||distance(evaluateSurface(surface,b).point,evaluateSurface(surface,on).point)>ROUNDING_MM)kept.push(i);
  }
  kept.push(chart.length-1);return kept;
}
export function mappedSurfacePath(surface,chart,points){
  const record=surface?.kind==='patch'?surface.patch:surface?.cp?surface:null;
  if(!record||!chart||chart.length!==points.length||points.length<2)return null;
  const patch=ArrayBuffer.isView(record.cp)?record:{...record,cp:Float64Array.from(record.cp),knotsU:Float64Array.from(record.knotsU),knotsV:Float64Array.from(record.knotsV)};
  const lengths=[0];
  for(let i=1;i<chart.length;i++){
    const length=Math.hypot(...chart[i].map((value,k)=>value-chart[i-1][k]));
    if(!(length>0))return null;lengths.push(lengths.at(-1)+length);
  }
  const parameters=lengths.map(value=>value/lengths.at(-1)),kept=corners(surface,chart),pieces=[];
  const error={positionMm:0};
  for(const [i,point] of points.entries()){
    error.positionMm=Math.max(error.positionMm,distance(point,evaluateSurface(surface,chart[i]).point));
    if(error.positionMm>ROUNDING_MM)return null;
  }
  for(let i=1;i<kept.length;i++){
    const a=kept[i-1],b=kept[i];
    for(const curve of surfaceSegmentCurves(patch,chart[a],chart[b])){
      const rows=reduce(Array.from({length:curve.n},(_,j)=>Array.from(curve.cp.slice(j*4,j*4+4))));
      pieces.push({rows,from:parameters[a]+curve.domain[0]*(parameters[b]-parameters[a]),to:parameters[a]+curve.domain[1]*(parameters[b]-parameters[a])});
    }
  }
  const degree=Math.max(...pieces.map(piece=>piece.rows.length-1)),controls=[],knots=Array(degree+1).fill(0);
  for(const [i,piece] of pieces.entries()){
    const rows=elevate(piece.rows,degree),scale=i?controls.at(-1)[3]/rows[0][3]:1;
    controls.push(...rows.slice(i?1:0).map(row=>row.map(value=>value*scale)));
    knots.push(...Array(i===pieces.length-1?degree+1:degree).fill(piece.to));
  }
  const geometry={kind:'nurbs',degree,knots,controlPoints:controls.map(row=>row.slice(0,3).map(value=>value/row[3])),weights:controls.map(row=>row[3])};
  if(geometry.weights.every(weight=>Math.abs(weight-1)<=FLOAT64_EPSILON*32))delete geometry.weights;
  const prepared=prepareNumericalCurve(geometry);
  for(let i=0;i<points.length;i++){
    const vertexError=distance(points[i],numericalCurveAt(prepared,parameters[i]).point);
    if(vertexError>ROUNDING_MM)return null;
    if(i){
      const range=numericalCurveRange(prepared,parameters[i-1],parameters[i]);
      error.positionMm=Math.max(error.positionMm,range.interpolationErrorMm+vertexError+ROUNDING_MM);
      if(error.positionMm>PRINT_RESOLUTION_MM)return null;
    }
  }
  return {geometry,parameters,points,positionErrorMm:error.positionMm};
}
