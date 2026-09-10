// Display creases, not tessellation. Weld coincident proxy vertices for edge
// adjacency without changing the source mesh or the geometry used for slicing.
export function buildMeshView({vertices,faces},creaseDeg=3) {
  const ids=new Map(),weld=vertices.map(p=>{
    const key=p.map(v=>Math.round(v*1e7)).join(',');
    if(!ids.has(key))ids.set(key,ids.size);
    return ids.get(key);
  });
  const edges=new Map(),normals=faces.map(face=>{
    const n=[0,0,0];
    for(let i=0;i<face.length;i++) {
      const a=vertices[face[i]],b=vertices[face[(i+1)%face.length]];
      n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);
    }
    const length=Math.hypot(...n);return length?n.map(v=>v/length):null;
  });
  const masks=faces.map(f=>f.map(()=>true));
  faces.forEach((face,f)=>face.forEach((v,i)=>{
    const a=weld[v],b=weld[face[(i+1)%face.length]],key=a<b?a+':'+b:b+':'+a;
    const entries=edges.get(key)??[];entries.push({f,i});edges.set(key,entries);
  }));
  const cosine=Math.cos(creaseDeg*Math.PI/180);
  for(const entries of edges.values()) {
    if(entries.length!==2)continue; // preserve boundaries/nonmanifold proxy edges
    const [a,b]=entries,na=normals[a.f],nb=normals[b.f];
    // Patch proxies can have opposite winding: compare their geometric planes.
    if(na&&nb&&Math.abs(na.reduce((s,v,i)=>s+v*nb[i],0))>cosine+1e-12)
      masks[a.f][a.i]=masks[b.f][b.i]=false;
  }
  return {edgeMasks:masks};
}
