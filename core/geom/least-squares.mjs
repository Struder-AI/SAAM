// Small dense least-squares systems for reference-surface fitting.
// Householder QR (Golub & Van Loan, Matrix Computations, 4th ed., §5.2):
// orthogonal reflectors avoid squaring the condition number as normal equations
// would. This is an original bounded implementation of that standard algorithm,
// not a imported upstream solver. Factor once, solve many coordinate columns.
import {requireThat} from './tolerance.mjs';

export function leastSquares(matrix){
  const m=matrix.length,n=matrix[0]?.length;
  requireThat(Number.isInteger(n)&&n>0&&m>=n&&matrix.every(row=>row.length===n&&row.every(Number.isFinite)),
    'Least-squares fitting needs a finite rectangular matrix with at least as many rows as columns.');
  const a=matrix.map(row=>Float64Array.from(row)),reflectors=[];
  let scale=0;for(const row of a)for(const value of row)scale=Math.max(scale,Math.abs(value));
  for(let k=0;k<n;k++){
    let norm=0;for(let i=k;i<m;i++)norm=Math.hypot(norm,a[i][k]);
    requireThat(norm>Number.EPSILON*Math.max(m,n)*scale,'Reference fit is rank deficient; use fewer controls or more distinct samples.');
    const v=Float64Array.from({length:m-k},(_,i)=>a[i+k][k]);
    v[0]+=v[0]>=0?norm:-norm;
    let vnorm=0;for(const value of v)vnorm=Math.hypot(vnorm,value);
    for(let i=0;i<v.length;i++)v[i]/=vnorm;
    for(let j=k;j<n;j++){
      let dot=0;for(let i=k;i<m;i++)dot+=v[i-k]*a[i][j];
      for(let i=k;i<m;i++)a[i][j]-=2*v[i-k]*dot;
    }
    reflectors.push(v);
  }
  return values=>{
    requireThat(values.length===m&&values.every(Number.isFinite),'Reference fit coordinate count must match its sample rows.');
    const b=Float64Array.from(values),result=new Float64Array(n);
    for(let k=0;k<n;k++){
      const v=reflectors[k];let dot=0;
      for(let i=k;i<m;i++)dot+=v[i-k]*b[i];
      for(let i=k;i<m;i++)b[i]-=2*v[i-k]*dot;
    }
    for(let i=n-1;i>=0;i--){let value=b[i];for(let j=i+1;j<n;j++)value-=a[i][j]*result[j];result[i]=value/a[i][i];}
    return result;
  };
}
