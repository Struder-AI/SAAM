// A numerical polyline can be represented by fewer ordinary NURBS spans without
// losing its parameter or silently smoothing a feature beyond print accuracy.
// Bernstein hulls bound the complete difference on every original edge.
import {distance,requireThat} from './tolerance.mjs';
import {ROUNDING_MM,FLOAT64_EPSILON} from '../dimensions.mjs';

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
// The restricted controls of a line/cubic come directly from endpoint values
// and derivatives. Work in each control's local coordinate frame, reusing small
// scratch arrays, rather than building two complete de Casteljau triangles for
// every sampled edge. These are the same Bernstein whole-edge certificates.
function differenceBound(rows,points,parameters,first,last){
  const state={error:0,edge:first+1},degree=rows.length-1;
  const errors=new Float64Array(rows.length*3),magnitudes=new Float64Array(rows.length);
  const from=parameters[first],span=parameters[last]-from;
  for(let i=first+1;i<=last;i++){
    const low=(parameters[i-1]-from)/span,high=(parameters[i]-from)/span,step=high-low;
    magnitudes.fill(1);
    for(let k=0;k<3;k++){
      const origin=rows[0][k],a=points[i-1][k],delta=points[i][k]-a;
      if(degree===1){
        const direction=rows[1][k]-origin;
        errors[k]=origin-a+low*direction;errors[3+k]=origin-a+high*direction-delta;
      }else{
        const b=rows[1][k]-origin,c=rows[2][k]-origin,d=rows[3][k]-origin,s=1-low,t=1-high;
        const left=low*(3*s*s*b+low*(3*s*c+low*d));
        const right=high*(3*t*t*b+high*(3*t*c+high*d));
        const firstTangent=s*s*b+2*s*low*(c-b)+low*low*(d-c);
        const lastTangent=t*t*b+2*t*high*(c-b)+high*high*(d-c);
        errors[k]=origin-a+left;
        errors[3+k]=origin-a+left+step*firstTangent-delta/3;
        errors[6+k]=origin-a+right-step*lastTangent-2*delta/3;
        errors[9+k]=origin-a+right-delta;
      }
      for(let j=0;j<=degree;j++){
        const on=a+j/degree*delta;
        magnitudes[j]=Math.max(magnitudes[j],Math.abs(on),Math.abs(on+errors[j*3+k]));
      }
    }
    for(let j=0;j<=degree;j++){
      const error=Math.hypot(errors[j*3],errors[j*3+1],errors[j*3+2])+FLOAT64_EPSILON*32*magnitudes[j];
      if(error>state.error){state.error=error;state.edge=i;}
    }
  }
  return state;
}
export function fitSampledCurve(points,{toleranceMm,forceNative=false,planeNormal=null}={}){
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Curve fitting needs a positive physical error budget.');
  if(points.length<2)return null;
  const plane=planeNormal?{normal:planeNormal.map(v=>v/Math.hypot(...planeNormal)),origin:points[0]}:null;
  if(plane){
    requireThat(plane.normal.length===3&&plane.normal.every(Number.isFinite),'A fitted material plane needs a finite nonzero normal.');
    if(points.some(point=>Math.abs(point.reduce((sum,v,k)=>sum+(v-plane.origin[k])*plane.normal[k],0))>ROUNDING_MM))return null;
  }
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  if(!(lengths.at(-1)>0)||lengths.some((value,i)=>i&&value===lengths[i-1]))return null;
  const parameters=lengths.map(value=>value/lengths.at(-1)),pieces=[],pending=[[0,points.length-1]],maximum={error:0};
  while(pending.length){
    const [first,last]=pending.pop(),line=[points[first],points[last]],straight=differenceBound(line,points,parameters,first,last);
    const candidate=straight.error<=toleranceMm?line:controls(points,parameters,first,last);
    const rows=plane?candidate.map(point=>{
      const distance=point.reduce((sum,v,k)=>sum+(v-plane.origin[k])*plane.normal[k],0);
      return point.map((v,k)=>v-distance*plane.normal[k]);
    }):candidate;
    const bound=rows===line?straight:differenceBound(rows,points,parameters,first,last);
    if(last===first+1||bound.error<=toleranceMm&&positiveSpeed(rows)){
      pieces.push({rows,from:parameters[first],to:parameters[last]});maximum.error=Math.max(maximum.error,bound.error);continue;
    }
    // Keep error-directed refinement balanced by point count. Repeated turns
    // can put the largest error next to an endpoint on every pass; peeling one
    // edge at a time makes fitting quadratic without improving its certificate.
    const margin=Math.max(1,Math.floor((last-first)/4));
    const cut=Math.max(first+margin,Math.min(last-margin,bound.edge));
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
