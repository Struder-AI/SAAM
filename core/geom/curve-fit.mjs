// A numerical polyline can be represented by fewer ordinary NURBS spans without
// losing its parameter or silently smoothing a feature beyond print accuracy.
// Bernstein hulls bound the complete difference on every original edge.
import {restrictBezierLine} from './bezier-net.mjs';
import {distance} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,FLOAT64_EPSILON} from '../dimensions.mjs';

// Numerical geometry serializes as ASCII. Include representation keys and
// numeric digits when choosing storage, rather than counting scalar values.
export function curveStorageReduced(geometry,points){
  return JSON.stringify(geometry).length<JSON.stringify({kind:'polyline',points}).length;
}
function controls(points,parameters,first,last){
  const a=points[first],b=points[last],from=parameters[first],span=parameters[last]-from;
  const sums={xx:0,xy:0,yy:0,x:[0,0,0],y:[0,0,0]};
  for(let i=first+1;i<last;i++){
    const t=(parameters[i]-from)/span,s=1-t,x=3*s*s*t,y=3*s*t*t;
    sums.xx+=x*x;sums.xy+=x*y;sums.yy+=y*y;
    for(let k=0;k<3;k++){const v=points[i][k]-s*s*s*a[k]-t*t*t*b[k];sums.x[k]+=x*v;sums.y[k]+=y*v;}
  }
  const determinant=sums.xx*sums.yy-sums.xy*sums.xy;
  if(!(determinant>FLOAT64_EPSILON*sums.xx*sums.yy))return [a,b];
  return [a,a.map((_,k)=>(sums.yy*sums.x[k]-sums.xy*sums.y[k])/determinant),
    a.map((_,k)=>(sums.xx*sums.y[k]-sums.xy*sums.x[k])/determinant),b];
}
function positiveSpeed(rows){
  const differences=rows.slice(1).map((row,i)=>row.map((value,k)=>value-rows[i][k]));
  const chord=rows.at(-1).map((value,k)=>value-rows[0][k]),length=Math.hypot(...chord);
  return length>0&&differences.every(row=>row.reduce((sum,value,k)=>sum+value*chord[k],0)>FLOAT64_EPSILON*length*Math.hypot(...row));
}
function differenceBound(rows,points,parameters,first,last){
  const state={error:0,edge:first+1};
  for(let i=first+1;i<=last;i++){
    const range=[parameters[i-1],parameters[i]].map(u=>(u-parameters[first])/(parameters[last]-parameters[first]));
    const piece=restrictBezierLine(rows,range),degree=piece.length-1;
    for(let j=0;j<=degree;j++){
      const on=points[i-1].map((value,k)=>value+j/degree*(points[i][k]-value)),error=distance(piece[j],on);
      const rounding=FLOAT64_EPSILON*32*Math.max(1,...piece[j].map(Math.abs),...on.map(Math.abs));
      if(error+rounding>state.error){state.error=error+rounding;state.edge=i;}
    }
  }
  return state;
}
export function fitSampledCurve(points,{toleranceMm=PRINT_RESOLUTION_MM/2,forceNative=false}={}){
  if(points.length<2)return null;
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  if(!(lengths.at(-1)>0)||lengths.some((value,i)=>i&&value===lengths[i-1]))return null;
  const parameters=lengths.map(value=>value/lengths.at(-1)),pieces=[],pending=[[0,points.length-1]],maximum={error:0};
  while(pending.length){
    const [first,last]=pending.pop(),line=[points[first],points[last]],straight=differenceBound(line,points,parameters,first,last);
    const rows=straight.error<=toleranceMm?line:controls(points,parameters,first,last);
    const bound=rows===line?straight:differenceBound(rows,points,parameters,first,last);
    if(last===first+1||bound.error<=toleranceMm&&positiveSpeed(rows)){
      pieces.push({rows,from:parameters[first],to:parameters[last]});maximum.error=Math.max(maximum.error,bound.error);continue;
    }
    const cut=Math.max(first+1,Math.min(last-1,bound.edge));
    pending.push([cut,last],[first,cut]);
  }
  const degree=pieces.some(piece=>piece.rows.length===4)?3:1,controlPoints=[],knots=Array(degree+1).fill(0);
  for(const [i,piece] of pieces.entries()){
    const rows=degree===3&&piece.rows.length===2?[piece.rows[0],
      piece.rows[0].map((value,k)=>value+(piece.rows[1][k]-value)/3),piece.rows[0].map((value,k)=>value+2*(piece.rows[1][k]-value)/3),piece.rows[1]]:piece.rows;
    controlPoints.push(...rows.slice(i?1:0));knots.push(...Array(i===pieces.length-1?degree+1:degree).fill(piece.to));
  }
  const geometry={kind:'nurbs',degree,knots,controlPoints};
  if(!forceNative&&!curveStorageReduced(geometry,points))return null;
  return {geometry,parameters,points,positionErrorMm:maximum.error};
}
