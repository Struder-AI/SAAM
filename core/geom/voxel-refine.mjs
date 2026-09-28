// Exact homogeneous knot insertion: densification changes the design space,
// not the represented material. Tensor-product insertions span whole planes.
import {validateVoxelField} from './voxel.mjs';
import {findSpan} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {hierarchical,hierarchyControlPoint,hierarchyControlBounds} from './voxel-hierarchy.mjs';

export function insertVoxelKnot(input,axis,t){
  validateVoxelField(input);
  requireThat(!hierarchical(input),'Use local hierarchy refinement for a hierarchical field.');
  requireThat(Number.isInteger(axis)&&axis>=0&&axis<3&&Number.isFinite(t)&&t>0&&t<1,'Knot insertion needs an axis and an interior parameter.');
  const f=structuredClone(input),p=f.degrees[axis],U=f.knots[axis],n=f.counts[axis],k=findSpan(U,n,p+1,t),s=U.filter(v=>v===t).length;
  requireThat(s<p,'Knot insertion must retain a continuous field.');
  const counts=[...f.counts];counts[axis]++;
  const values=new Array(counts.reduce((a,b)=>a*b,1)),weights=f.weights?new Array(values.length):null;
  const index=(c,q)=>q[0]+c[0]*(q[1]+c[1]*q[2]);
  for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++){
    const q=[x,y,z],i=q[axis],terms=i<=k-p?[[i,1]]:i>=k-s+1?[[i-1,1]]:[[i,(t-U[i])/(U[i+p]-U[i])],[i-1,1-(t-U[i])/(U[i+p]-U[i])]];
    let w=0,v=0;
    for(const [j,a] of terms){const old=[...q];old[axis]=j;const id=index(f.counts,old),b=a*(f.weights?.[id]??1);w+=b;v+=b*f.values[id];}
    const id=index(counts,q);values[id]=v/w;if(weights)weights[id]=w;
  }
  f.counts=counts;f.values=values;f.weights=weights;f.knots[axis].splice(k+1,0,t);
  return validateVoxelField(f);
}

export function controlPoint(field,index){
  if(hierarchical(field))return hierarchyControlPoint(field,index);
  const [nx,ny]=field.counts,q=[index%nx,Math.floor(index/nx)%ny,Math.floor(index/(nx*ny))];
  return q.map((j,a)=>field.originMm[a]+field.sizeMm[a]*field.knots[a].slice(j+1,j+field.degrees[a]+1).reduce((s,v)=>s+v,0)/field.degrees[a]);
}

export function controlBounds(field,index){
  if(hierarchical(field))return hierarchyControlBounds(field,index);
  const [nx,ny]=field.counts,q=[index%nx,Math.floor(index/nx)%ny,Math.floor(index/(nx*ny))];
  return {min:q.map((j,a)=>field.originMm[a]+field.sizeMm[a]*field.knots[a][j]),
    max:q.map((j,a)=>field.originMm[a]+field.sizeMm[a]*field.knots[a][j+field.degrees[a]+1])};
}
