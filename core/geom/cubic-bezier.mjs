// Surface composition has at most 18th-degree Bernstein coefficients (a cubic
// UV curve on a bicubic patch). These coefficients are proof data, never a
// native spline. Subdivision emits ordinary cubic curves with a whole-interval
// rational position bound and the original parameter correspondence.
import {splitBezierLine,bernsteinProductWeights} from './bezier-net.mjs';
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,FLOAT64_EPSILON} from '../dimensions.mjs';

function cubicControls(rows){
  const degree=rows.length-1;
  return [rows[0],rows[0].map((v,k)=>v+degree*(rows[1][k]-v)/3),
    rows.at(-1).map((v,k)=>v-degree*(v-rows.at(-2)[k])/3),rows.at(-1)];
}
function positionBound(source,cubic){
  // The proof is invariant under homogeneous scaling, including very small
  // authored weights. Normalize before multiplying to avoid under/overflow.
  const scaleWeight=Math.max(...source.map(row=>Math.abs(row[3])),...cubic.map(row=>Math.abs(row[3])));
  const original=source.map(row=>row.map(v=>v/scaleWeight)),approximation=cubic.map(row=>row.map(v=>v/scaleWeight));
  const weight=Math.min(...original.map(row=>row[3]))*Math.min(...approximation.map(row=>row[3]));
  if(!(weight>0))return Infinity;
  const p=source.length-1,factors=bernsteinProductWeights(p,3),numerator=Array.from({length:p+4},()=>[0,0,0]);
  const origin=original[0].slice(0,3).map(v=>v/original[0][3]);
  const local=original.map(row=>row.slice(0,3).map((v,k)=>v-origin[k]*row[3]));
  const candidate=approximation.map(row=>row.slice(0,3).map((v,k)=>v-origin[k]*row[3]));
  for(let i=0;i<=p;i++)for(let j=0;j<4;j++)for(let k=0;k<3;k++)
    numerator[i+j][k]+=(local[i][k]*approximation[j][3]-candidate[j][k]*original[i][3])*factors[i][j];
  const scale=Math.max(1,...original.flat().map(Math.abs),...approximation.flat().map(Math.abs));
  const rounding=FLOAT64_EPSILON*64*(p+1)**2*scale/weight;
  return Math.max(...numerator.map(row=>Math.hypot(...row)))/weight+rounding;
}
export function cubicBezierPieces(controls,{from=0,to=1,toleranceMm=PRINT_RESOLUTION_MM/4}={}){
  requireThat(controls.length>=2&&controls.length<=19&&controls.every(row=>row.length===4&&row.every(Number.isFinite)),
    'Surface composition requires linear, quadratic or cubic source geometry.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(from)&&Number.isFinite(to)&&to>from,
    'Cubic construction needs an increasing parameter domain and positive physical tolerance.');
  const pending=[{rows:controls,from,to}],pieces=[];
  while(pending.length){
    const piece=pending.pop();
    if(piece.rows.length<=4&&piece.rows.every(row=>row[3]>0)){pieces.push({...piece,positionErrorMm:0});continue;}
    const rows=cubicControls(piece.rows),positionErrorMm=positionBound(piece.rows,rows);
    if(positionErrorMm<=toleranceMm){pieces.push({rows,from:piece.from,to:piece.to,positionErrorMm});continue;}
    const middle=(piece.from+piece.to)/2;
    requireThat(middle>piece.from&&middle<piece.to,'Cubic surface image cannot meet its position tolerance at parameter precision.');
    const [left,right]=splitBezierLine(piece.rows,.5);
    pending.push({rows:right,from:middle,to:piece.to},{rows:left,from:piece.from,to:middle});
  }
  return pieces;
}
