// Retain bounded cubic images of piecewise straight chart paths. Process fields
// and scheduling never enter this boundary; altered/unsupported mappings stay
// with their finalized sampled geometry.
import {prepareSurfaceReference} from './surface-record.mjs';
import {surfaceSegmentCurves} from './surface-curves.mjs';
import {evaluate} from './nurbs.mjs';
import {restrictBezierLine} from './bezier-net.mjs';
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
function corners(surface,chart,mapped){
  const kept=[0];
  for(let i=1;i<chart.length-1;i++){
    const a=chart[kept.at(-1)],b=chart[i],c=chart[i+1],delta=c.map((value,k)=>value-a[k]);
    const length2=delta.reduce((sum,value)=>sum+value*value,0),t=length2?b.reduce((sum,value,k)=>sum+(value-a[k])*delta[k],0)/length2:0;
    const on=a.map((value,k)=>value+t*delta[k]);
    const onSurface=on.every((value,k)=>value===b[k])?mapped[i]:evaluate(surface,on[0],on[1],false).point;
    if(!(t>0&&t<1)||distance(mapped[i],onSurface)>ROUNDING_MM)kept.push(i);
  }
  kept.push(chart.length-1);return kept;
}
// Bound X-W*L directly on each original edge, split at native piece boundaries.
// This needs only positional Bernstein controls; derivative, length and frame
// queries would repeat unrelated work for every construction sample.
function positionBound(pieces,parameters,points){
  const state={piece:0,error:0};
  for(let i=1;i<parameters.length;i++){
    const a=parameters[i-1],b=parameters[i],cursor={from:a};
    while(cursor.from<b){
      while(pieces[state.piece].to<=cursor.from)state.piece++;
      const piece=pieces[state.piece],to=Math.min(b,piece.to),span=piece.to-piece.from;
      const rows=restrictBezierLine(piece.rows,[(cursor.from-piece.from)/span,(to-piece.from)/span]);
      const start=points[i-1].map((v,k)=>v+(points[i][k]-v)*(cursor.from-a)/(b-a));
      const end=points[i-1].map((v,k)=>v+(points[i][k]-v)*(to-a)/(b-a));
      const degree=rows.length-1,weight=Math.min(...rows.map(row=>row[3]));
      const rounding=FLOAT64_EPSILON*128*rows.length**3*Math.max(1,...start.map(Math.abs),...end.map(Math.abs));
      for(let j=0;j<=degree+1;j++){
        const t=j/(degree+1),left=rows[Math.min(j,degree)],right=rows[Math.max(0,j-1)];
        const numerator=start.map((v,k)=>(1-t)*(left[k]-left[3]*v)+t*(right[k]-right[3]*end[k]));
        state.error=Math.max(state.error,Math.hypot(...numerator)/weight+rounding);
      }
      if(state.error>PRINT_RESOLUTION_MM)return state.error;
      cursor.from=to;
    }
  }
  return state.error;
}
export function mappedSurfacePath(surface,chart,points){
  if(surface?.representation)surface=prepareSurfaceReference(surface);
  if(surface?.kind==='slice-chart')return mappedSurfacePath(surface.slice,chart,points);
  if(chart&&surface?.at?.nativeImage){
    const native=surface.at.nativeImage(chart);return mappedSurfacePath(native.surface,native.chart,points);
  }
  const record=surface?.kind==='patch'?surface.patch:surface?.cp?surface:null;
  if(!record||!chart||chart.length!==points.length||points.length<2)return null;
  const patch=ArrayBuffer.isView(record.cp)?record:{...record,cp:Float64Array.from(record.cp),knotsU:Float64Array.from(record.knotsU),knotsV:Float64Array.from(record.knotsV)};
  const lengths=[0];
  for(let i=1;i<chart.length;i++){
    const length=Math.hypot(...chart[i].map((value,k)=>value-chart[i-1][k]));
    if(!(length>0))return null;lengths.push(lengths.at(-1)+length);
  }
  const parameters=lengths.map(value=>value/lengths.at(-1)),mapped=chart.map(uv=>evaluate(patch,uv[0],uv[1],false).point),pieces=[];
  const error={positionMm:0,sourceMm:0};
  for(const [i,point] of points.entries()){
    error.positionMm=Math.max(error.positionMm,distance(point,mapped[i]));
    if(error.positionMm>ROUNDING_MM)return null;
  }
  const kept=corners(patch,chart,mapped);
  for(let i=1;i<kept.length;i++){
    const a=kept[i-1],b=kept[i];
    for(const curve of surfaceSegmentCurves(patch,chart[a],chart[b])){
      error.sourceMm=Math.max(error.sourceMm,curve.positionErrorMm);
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
  error.positionMm=Math.max(error.positionMm,positionBound(pieces,parameters,points))+error.sourceMm;
  if(error.positionMm>PRINT_RESOLUTION_MM)return null;
  return {geometry,parameters,points,positionErrorMm:error.positionMm};
}
