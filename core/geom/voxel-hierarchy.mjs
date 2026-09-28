// Sparse hierarchical B-splines. Coarse functions fully inside a refinement
// region are replaced by their dyadic children. Positive homogeneous weights
// preserve both numerator and denominator exactly; no global control grid grows.
import {basisFunctions,basisDerivatives,findSpan} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {validateVoxelField} from './voxel.mjs';

export const hierarchical=f=>f.schema==='saam-voxel-field/2';
const countsFor=(f,l)=>f.hierarchy.levels[l].knots.map((u,a)=>u.length-f.degrees[a]-1);
const xyz=(n,i)=>[i%n[0],Math.floor(i/n[0])%n[1],Math.floor(i/(n[0]*n[1]))];
const index=(n,q)=>q[0]+n[0]*(q[1]+n[1]*q[2]);
const full={min:[0,0,0],max:[1,1,1]};
export function hierarchySupport(f,c){
  const q=xyz(countsFor(f,c.level),c.index),U=f.hierarchy.levels[c.level].knots;
  return {min:q.map((i,a)=>U[a][i]),max:q.map((i,a)=>U[a][i+f.degrees[a]+1])};
}
export function covered(box,regions){
  if(regions.some(r=>box.min.every((v,a)=>v>=r.min[a]&&box.max[a]<=r.max[a])))return true;
  const cuts=box.min.map((lo,a)=>[...new Set([lo,box.max[a],...regions.flatMap(r=>[r.min[a],r.max[a]]).filter(t=>t>lo&&t<box.max[a])])].sort((a,b)=>a-b));
  for(let z=0;z<cuts[2].length-1;z++)for(let y=0;y<cuts[1].length-1;y++)for(let x=0;x<cuts[0].length-1;x++){
    const p=[x,y,z].map((i,a)=>(cuts[a][i]+cuts[a][i+1])/2);
    if(!regions.some(r=>p.every((v,a)=>v>=r.min[a]&&v<=r.max[a])))return false;
  }
  return true;
}
const refinedKnots=u=>[...u,...u.slice(1).flatMap((v,i)=>v>u[i]?[(v+u[i])/2]:[])].sort((a,b)=>a-b);
export function validateHierarchy(f){
  requireThat(Object.keys(f).sort().join()==='counts,degrees,hierarchy,isoValue,knots,originMm,schema,sizeMm,values,weights','Unexpected hierarchical field fields.');
  const {hierarchy,...base}=f,n=f.counts?.reduce((a,b)=>a*b,1);
  requireThat(Number.isSafeInteger(n)&&n>0&&n<=100000,'Invalid hierarchical base size.');
  validateVoxelField({...base,schema:'saam-voxel-field/1',values:Array(n).fill(0),weights:null});
  requireThat(hierarchy&&Object.keys(hierarchy).sort().join()==='controls,levels'&&Array.isArray(hierarchy.levels)&&hierarchy.levels.length>=1&&hierarchy.levels.length<=6,'Invalid hierarchy levels.');
  hierarchy.levels.forEach((l,i)=>{
    requireThat(l&&Object.keys(l).sort().join()==='knots,regions'&&JSON.stringify(l.knots)===JSON.stringify(i?hierarchy.levels[i-1].knots.map(refinedKnots):f.knots),'Hierarchy knots must be nested dyadic refinements.');
    requireThat(Array.isArray(l.regions)&&l.regions.length>0&&l.regions.length<=100,'Invalid refinement regions.');
    for(const r of l.regions){
      requireThat(r&&Object.keys(r).sort().join()==='max,min'&&['min','max'].every(k=>Array.isArray(r[k])&&r[k].length===3&&r[k].every(Number.isFinite))&&r.min.every((v,a)=>v>=0&&v<r.max[a]&&r.max[a]<=1),'Invalid refinement region bounds.');
      requireThat(!i||covered(r,hierarchy.levels[i-1].regions),'Refinement regions must be nested.');
      requireThat(r.min.every((v,a)=>l.knots[a].includes(v)&&l.knots[a].includes(r.max[a])),'Refinement regions must follow knot boundaries.');
    }
    if(!i)requireThat(JSON.stringify(l.regions)===JSON.stringify([full]),'The base hierarchy must cover its domain.');
  });
  requireThat(Array.isArray(hierarchy.controls)&&hierarchy.controls.length>0&&hierarchy.controls.length<=100000&&Array.isArray(f.values)&&f.values.length===hierarchy.controls.length&&f.values.every(Number.isFinite)&&Array.isArray(f.weights)&&f.weights.length===f.values.length&&f.weights.every(w=>Number.isFinite(w)&&w>0),'Invalid active hierarchical coefficients.');
  const seen=new Set();
  for(const c of hierarchy.controls){
    requireThat(c&&Object.keys(c).sort().join()==='index,level'&&Number.isInteger(c.level)&&c.level>=0&&c.level<hierarchy.levels.length&&Number.isSafeInteger(c.index)&&c.index>=0&&c.index<countsFor(f,c.level).reduce((a,b)=>a*b,1),'Invalid hierarchical control.');
    const key=c.level+':'+c.index,support=hierarchySupport(f,c);requireThat(!seen.has(key),'Duplicate hierarchical control.');seen.add(key);
    requireThat(covered(support,hierarchy.levels[c.level].regions)&&!covered(support,hierarchy.levels[c.level+1]?.regions??[]),'Control does not belong to the active hierarchical basis.');
  }
  // Every positive descendant of the original partition must be represented.
  // Checking only individual supports would accept missing controls and permit
  // a zero rational denominator, including at domain corners.
  const visited=new Set(),expected=new Set(),transfers=new Map();
  function visit(c){
    const key=c.level+':'+c.index;if(visited.has(key))return;visited.add(key);
    requireThat(visited.size<=1000000,'Hierarchy validation exceeds its basis traversal budget.');
    if(!covered(hierarchySupport(f,c),hierarchy.levels[c.level+1]?.regions??[])){expected.add(key);return;}
    if(!transfers.has(c.level))transfers.set(c.level,hierarchy.levels[c.level].knots.map((u,a)=>prolongation(u,f.degrees[a])));
    const T=transfers.get(c.level),q=xyz(countsFor(f,c.level),c.index),next=countsFor(f,c.level+1);
    for(const [x] of T[0][q[0]])for(const [y] of T[1][q[1]])for(const [z] of T[2][q[2]])visit({level:c.level+1,index:index(next,[x,y,z])});
  }
  for(let i=0;i<n;i++)visit({level:0,index:i});
  requireThat(expected.size===seen.size&&[...expected].every(k=>seen.has(k)),'Hierarchy is missing active basis support.');
  return f;
}
export function toHierarchy(input){
  validateVoxelField(input);if(hierarchical(input))return structuredClone(input);
  return {...structuredClone(input),schema:'saam-voxel-field/2',weights:input.weights?[...input.weights]:input.values.map(()=>1),hierarchy:{levels:[{knots:structuredClone(input.knots),regions:[structuredClone(full)]}],controls:input.values.map((_,index)=>({level:0,index}))}};
}

// Sparse univariate knot-insertion matrix, cached per level/axis by the refiner.
function prolongation(U,p){
  const n=U.length-p-1,V=[...U];let rows=Array.from({length:n},(_,i)=>new Map([[i,1]]));
  for(const t of U.slice(1).flatMap((v,i)=>v>U[i]?[(v+U[i])/2]:[])){
    const k=findSpan(V,rows.length,p+1,t),next=[];
    for(let i=0;i<=rows.length;i++){
      if(i<=k-p)next.push(rows[i]);else if(i>=k+1)next.push(rows[i-1]);else{
        const a=(t-V[i])/(V[i+p]-V[i]),row=new Map();
        for(const [j,w] of rows[i])if(a*w)row.set(j,a*w);
        for(const [j,w] of rows[i-1])if((1-a)*w)row.set(j,(row.get(j)??0)+(1-a)*w);
        next.push(row);
      }
    }
    V.splice(k+1,0,t);rows=next;
  }
  const children=Array.from({length:n},()=>[]);rows.forEach((r,i)=>{for(const [j,w] of r)children[j].push([i,w]);});return children;
}
export function refineHierarchy(input,control,{maxControls=2000}={}){
  const f=toHierarchy(input),chosen=f.hierarchy.controls[control];requireThat(chosen,'Invalid refinement control.');
  const level=chosen.level+1;requireThat(level<6,'Hierarchy depth budget exceeded.');
  const region=hierarchySupport(f,chosen);
  if(!f.hierarchy.levels[level])f.hierarchy.levels.push({knots:f.hierarchy.levels[level-1].knots.map(refinedKnots),regions:[]});
  f.hierarchy.levels[level].regions.push(region);
  const result=new Map(),transfers=new Map();
  function add(c,weight,numerator){
    if(covered(hierarchySupport(f,c),f.hierarchy.levels[c.level+1]?.regions??[])){
      if(!transfers.has(c.level))transfers.set(c.level,f.hierarchy.levels[c.level].knots.map((u,a)=>prolongation(u,f.degrees[a])));
      const T=transfers.get(c.level),q=xyz(countsFor(f,c.level),c.index),nextCounts=countsFor(f,c.level+1);
      for(const [x,wx] of T[0][q[0]])for(const [y,wy] of T[1][q[1]])for(const [z,wz] of T[2][q[2]]){const w=wx*wy*wz;add({level:c.level+1,index:index(nextCounts,[x,y,z])},weight*w,numerator*w);}
    }else{
      const key=c.level+':'+c.index,r=result.get(key)??{...c,weight:0,numerator:0};r.weight+=weight;r.numerator+=numerator;result.set(key,r);
    }
  }
  f.hierarchy.controls.forEach((c,i)=>add(c,f.weights[i],f.weights[i]*f.values[i]));
  requireThat(result.size<=maxControls,'Local refinement exceeds maxDesignControls.');
  const controls=[...result.values()].sort((a,b)=>a.level-b.level||a.index-b.index);
  f.hierarchy.controls=controls.map(({level,index})=>({level,index}));f.weights=controls.map(c=>c.weight);f.values=controls.map(c=>c.numerator/c.weight);
  return {field:validateHierarchy(f),region:{min:region.min.map((v,a)=>f.originMm[a]+v*f.sizeMm[a]),max:region.max.map((v,a)=>f.originMm[a]+v*f.sizeMm[a])},level,addedControls:f.values.length-input.values.length};
}
export function hierarchyControlPoint(f,i){
  const c=f.hierarchy.controls[i],q=xyz(countsFor(f,c.level),c.index),U=f.hierarchy.levels[c.level].knots;
  return q.map((j,a)=>f.originMm[a]+f.sizeMm[a]*U[a].slice(j+1,j+f.degrees[a]+1).reduce((s,v)=>s+v,0)/f.degrees[a]);
}
export function hierarchyControlBounds(f,i){
  const b=hierarchySupport(f,f.hierarchy.controls[i]);return {min:b.min.map((v,a)=>f.originMm[a]+v*f.sizeMm[a]),max:b.max.map((v,a)=>f.originMm[a]+v*f.sizeMm[a])};
}
export function createHierarchyEvaluator(input){
  const f=structuredClone(validateHierarchy(input)),levels=f.hierarchy.levels.map((l,i)=>({...l,counts:countsFor(f,i),active:new Map()}));
  f.hierarchy.controls.forEach((c,i)=>levels[c.level].active.set(c.index,i));
  return function evaluate(point,{derivatives=false,influences=false,homogeneous=false}={}){
    requireThat(Array.isArray(point)&&point.length===3&&point.every(Number.isFinite),'Field evaluation needs finite XYZ millimeters.');
    const t=point.map((v,a)=>(v-f.originMm[a])/f.sizeMm[a]);if(t.some(v=>v<0||v>1))return null;
    let numerator=0,denominator=0;const dn=[0,0,0],dd=[0,0,0],terms=[];
    for(const l of levels){
      if(!l.regions.some(r=>t.every((v,a)=>v>=r.min[a]&&v<=r.max[a])))continue;
      const one=t.map((v,a)=>{const p=f.degrees[a],s=findSpan(l.knots[a],l.counts[a],p+1,v);return {start:s-p,b:derivatives?basisDerivatives(l.knots[a],s,v,p+1,1):[basisFunctions(l.knots[a],s,v,p+1)]};});
      for(let z=0;z<=f.degrees[2];z++)for(let y=0;y<=f.degrees[1];y++)for(let x=0;x<=f.degrees[0];x++){
        const q=[x,y,z],id=l.active.get(index(l.counts,q.map((v,a)=>v+one[a].start)));if(id===undefined)continue;
        const b=q.map((v,a)=>one[a].b[0][v]),w=f.weights[id],N=w*b[0]*b[1]*b[2];numerator+=N*f.values[id];denominator+=N;
        if(influences&&N)terms.push({index:id,weight:N});
        if(derivatives)for(let a=0;a<3;a++){const d=w*one[a].b[1][q[a]]/f.sizeMm[a]*b[(a+1)%3]*b[(a+2)%3];dn[a]+=d*f.values[id];dd[a]+=d;}
      }
    }
    requireThat(denominator>0&&Number.isFinite(numerator/denominator),'Hierarchical field has missing or nonfinite support.');
    const value=numerator/denominator;
    return {value,...(homogeneous?{levelNumerator:numerator-f.isoValue*denominator}:{}),...(influences?{influences:terms.map(t=>({...t,weight:t.weight/denominator}))}:{}),...(derivatives?{gradient:dn.map((v,a)=>(v-value*dd[a])/denominator)}:{})};
  };
}
