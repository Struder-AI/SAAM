// Packed AABB hierarchy: one index per triangle, no spatial cell duplication.
export function triangleBVH(vertices,triangles){
  const count=triangles.length,ids=Uint32Array.from({length:count},(_,i)=>i);
  const capacity=2*2**Math.ceil(Math.log2(Math.max(1,Math.ceil(count/8)))),bounds=new Float64Array(capacity*6),left=new Int32Array(capacity).fill(-1),right=new Int32Array(capacity).fill(-1),start=new Uint32Array(capacity),size=new Uint32Array(capacity);
  let used=0;
  const center=(i,k)=>{const t=triangles[i];return vertices[t[0]][k]+vertices[t[1]][k]+vertices[t[2]][k];};
  function build(lo,hi){const node=used++,base=node*6;start[node]=lo;size[node]=hi-lo;
    for(let k=0;k<3;k++){bounds[base+k]=Infinity;bounds[base+3+k]=-Infinity;}
    for(let j=lo;j<hi;j++)for(const v of triangles[ids[j]])for(let k=0;k<3;k++){const n=vertices[v][k];bounds[base+k]=Math.min(bounds[base+k],n);bounds[base+3+k]=Math.max(bounds[base+3+k],n);}
    if(hi-lo<=8)return node;
    let axis=0;for(let k=1;k<3;k++)if(bounds[base+3+k]-bounds[base+k]>bounds[base+3+axis]-bounds[base+axis])axis=k;
    ids.subarray(lo,hi).sort((a,b)=>center(a,axis)-center(b,axis)||a-b);
    const middle=(lo+hi)>>>1;left[node]=build(lo,middle);right[node]=build(middle,hi);return node;
  }
  if(count)build(0,count);
  function query(min,max,visit){const stack=count?[0]:[];while(stack.length){const n=stack.pop(),b=n*6;
    if(min[0]>bounds[b+3]+1e-9||max[0]<bounds[b]-1e-9||min[1]>bounds[b+4]+1e-9||max[1]<bounds[b+1]-1e-9||min[2]>bounds[b+5]+1e-9||max[2]<bounds[b+2]-1e-9)continue;
    if(left[n]<0){for(let j=start[n],end=j+size[n];j<end;j++)visit(ids[j]);}else stack.push(left[n],right[n]);
  }}
  return {query,nodeCount:used};
}
