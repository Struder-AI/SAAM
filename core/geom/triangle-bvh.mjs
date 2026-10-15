// Packed AABB hierarchies: one index per item, no spatial cell duplication. Boxes
// are [minx,miny,minz,maxx,maxy,maxz] per item in one Float64Array.
import {ROUNDING_MM} from '../dimensions.mjs';

export function boxHierarchy(boxes,count=boxes.length/6){
  const order=new Int32Array(count),centre=new Float64Array(3*count);
  for(let i=0;i<count;i++){order[i]=i;for(let k=0;k<3;k++)centre[3*i+k]=boxes[6*i+k]+boxes[6*i+3+k];}
  // Leaves hold 4..8 items, so there are at most 2*ceil(count/4) nodes.
  const capacity=2*Math.ceil(count/4)+1,nb=new Float64Array(6*capacity),first=new Int32Array(capacity),size=new Int32Array(capacity),left=new Int32Array(capacity).fill(-1),right=new Int32Array(capacity);let nodes=0;
  function build(from,n){
    const id=nodes++,o=6*id;for(let k=0;k<3;k++){nb[o+k]=Infinity;nb[o+3+k]=-Infinity;}
    for(let i=from;i<from+n;i++){const b=order[i]*6;for(let k=0;k<3;k++){if(boxes[b+k]<nb[o+k])nb[o+k]=boxes[b+k];if(boxes[b+3+k]>nb[o+3+k])nb[o+3+k]=boxes[b+3+k];}}
    first[id]=from;size[id]=n;if(n<=8)return id;
    let axis=0;for(let k=1;k<3;k++)if(nb[o+3+k]-nb[o+k]>nb[o+3+axis]-nb[o+axis])axis=k;
    // nth_element on box centres: the first half have keys at most the rest.
    const h=n>>1,nth=from+h;let lo=from,hi=from+n-1;
    while(lo<hi){const pivot=centre[3*order[(lo+hi)>>1]+axis];let i=lo,j=hi;
      while(i<=j){while(centre[3*order[i]+axis]<pivot)i++;while(centre[3*order[j]+axis]>pivot)j--;if(i<=j){const s=order[i];order[i]=order[j];order[j]=s;i++;j--;}}
      if(nth<=j)hi=j;else if(nth>=i)lo=i;else break;}
    left[id]=build(from,h);right[id]=build(from+h,n-h);size[id]=0;return id;
  }
  if(count)build(0,count);
  const boxDistance2=(n,p)=>{let d2=0;for(let k=0;k<3;k++){const d=Math.max(nb[6*n+k]-p[k],0,p[k]-nb[6*n+3+k]);d2+=d*d;}return d2;};
  const extent=n=>nb[6*n+3]-nb[6*n]+nb[6*n+4]-nb[6*n+1]+nb[6*n+5]-nb[6*n+2];
  const overlap=(n,m)=>{const p=6*n,q=6*m;return !(nb[p]>nb[q+3]||nb[q]>nb[p+3]||nb[p+1]>nb[q+4]||nb[q+1]>nb[p+4]||nb[p+2]>nb[q+5]||nb[q+2]>nb[p+5]);};
  return {
    // Items of the leaves whose boxes meet box b (at offset o); callers test items.
    queryBox(b,o,visit){const stack=count?[0]:[];while(stack.length){const n=stack.pop(),q=n*6;
      if(b[o]>nb[q+3]||b[o+3]<nb[q]||b[o+1]>nb[q+4]||b[o+4]<nb[q+1]||b[o+2]>nb[q+5]||b[o+5]<nb[q+2])continue;
      if(left[n]<0){for(let j=first[n],e=j+size[n];j<e;j++)visit(order[j]);}else stack.push(left[n],right[n]);}},
    // Items of the leaves whose boxes, widened by margin, meet segment ac.
    querySegment(a,c,margin,visit){const stack=count?[0]:[];while(stack.length){const n=stack.pop();
      if(!segmentMeetsBox(a,c,nb,n*6,margin))continue;
      if(left[n]<0){for(let j=first[n],e=j+size[n];j<e;j++)visit(order[j]);}else stack.push(left[n],right[n]);}},
    // The item nearest to p, nearer subtrees first; measure(i, best) gives item i's
    // squared distance (it may stop early once beyond best).
    nearest(p,measure,best={item:-1,distance2:Infinity}){
      const visit=n=>{if(boxDistance2(n,p)>best.distance2)return;
        if(left[n]<0){for(let j=first[n],e=j+size[n];j<e;j++){const i=order[j];let b2=0;for(let k=0;k<3;k++){const d=Math.max(boxes[6*i+k]-p[k],0,p[k]-boxes[6*i+3+k]);b2+=d*d;}
          if(b2>best.distance2)continue;const d=measure(i,best.distance2);if(d<best.distance2){best.item=i;best.distance2=d;}}return;}
        const l=left[n],r=right[n];if(boxDistance2(l,p)<=boxDistance2(r,p)){visit(l);visit(r);}else{visit(r);visit(l);}};
      if(count)visit(0);return best;},
    // Every pair of items in leaves whose boxes meet, once each; callers test items.
    selfPairs(visit){const stack=count?[0,0]:[];
      while(stack.length){const m=stack.pop(),n=stack.pop();
        if(n===m){if(left[n]<0){for(let a=first[n],e=a+size[n];a<e;a++)for(let b=a+1;b<e;b++)visit(order[a],order[b]);}else stack.push(left[n],left[n],right[n],right[n],left[n],right[n]);continue;}
        if(!overlap(n,m))continue;
        if(left[n]<0&&left[m]<0){for(let a=first[n],ea=a+size[n];a<ea;a++)for(let b=first[m],eb=b+size[m];b<eb;b++)visit(order[a],order[b]);}
        // Otherwise split the inner node with the larger box.
        else if(left[m]<0||(left[n]>=0&&extent(n)>=extent(m)))stack.push(left[n],m,right[n],m);
        else stack.push(n,left[m],n,right[m]);}},
  };
}
// Boxes far larger than typical (cut caps) would inflate every node above them, so
// they get their own hierarchy: [typical, large], each {items, tree}.
function hierarchiesBySize(boxes){
  const n=boxes.length/6,diag=new Float64Array(n);for(let t=0;t<n;t++){const o=6*t;diag[t]=boxes[o+3]-boxes[o]+boxes[o+4]-boxes[o+1]+boxes[o+5]-boxes[o+2];}
  const limit=16*diag.slice().sort()[n>>1],groups=[[],[]];for(let t=0;t<n;t++)groups[diag[t]>limit?1:0].push(t);
  return groups.map(items=>{const b=new Float64Array(6*items.length);items.forEach((t,k)=>b.set(boxes.subarray(6*t,6*t+6),6*k));return {items,tree:boxHierarchy(b)};});
}
// Every pair i<j of overlapping (closed) boxes, once.
export function overlappingBoxPairs(boxes,visit){
  if(!boxes.length)return;const [small,big]=hierarchiesBySize(boxes);
  const test=(i,j)=>{const bi=6*i,bj=6*j;if(boxes[bi]>boxes[bj+3]||boxes[bj]>boxes[bi+3]||boxes[bi+1]>boxes[bj+4]||boxes[bj+1]>boxes[bi+4]||boxes[bi+2]>boxes[bj+5]||boxes[bj+2]>boxes[bi+5])return;if(i<j)visit(i,j);else visit(j,i);};
  small.tree.selfPairs((x,y)=>test(small.items[x],small.items[y]));
  big.tree.selfPairs((x,y)=>test(big.items[x],big.items[y]));
  for(const b of big.items)small.tree.queryBox(boxes,6*b,k=>test(b,small.items[k]));
}
// Nearest-item queries over boxes: nearest(p, measure) as boxHierarchy's, item
// indices into boxes.
export function nearestBoxQuery(boxes){
  const parts=boxes.length?hierarchiesBySize(boxes):[];
  return (p,measure)=>{const best={item:-1,distance2:Infinity};
    for(const {items,tree} of parts){const found=tree.nearest(p,(k,limit)=>measure(items[k],limit),{item:-1,distance2:best.distance2});if(found.item>=0){best.item=items[found.item];best.distance2=found.distance2;}}
    return best;};
}
export function segmentMeetsBox(a,b,box,o,margin){
  let lo=0,hi=1;
  for(let k=0;k<3;k++){const d=b[k]-a[k],min=box[o+k]-margin,max=box[o+3+k]+margin;
    if(d===0){if(a[k]<min||a[k]>max)return false;continue;}
    let t0=(min-a[k])/d,t1=(max-a[k])/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false;}
  return true;
}
// Boxes of triangles given as index triples into [x,y,z] vertices, widened by margin.
export function triangleBoxes(vertices,triangles,margin=0){
  const boxes=new Float64Array(6*triangles.length);
  triangles.forEach((t,i)=>{for(let k=0;k<3;k++){const a=vertices[t[0]][k],b=vertices[t[1]][k],c=vertices[t[2]][k];boxes[6*i+k]=Math.min(a,b,c)-margin;boxes[6*i+3+k]=Math.max(a,b,c)+margin;}});
  return boxes;
}
// Triangles whose boxes may meet the box [min, max] (rounding guard slack).
export function triangleBVH(vertices,triangles){
  const tree=boxHierarchy(triangleBoxes(vertices,triangles,ROUNDING_MM));
  return {query(min,max,visit){tree.queryBox([...min,...max],0,visit);}};
}
