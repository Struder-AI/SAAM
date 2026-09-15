// Compact edge incidence and vertex fan checks for the indexed mesh contract.
// Returned edge data is sufficient to materialize the legacy Map only on demand.
export function meshTopology(vertices,triangles,requireInput){
  const count=triangles.length,edgeCount=count*3,order=Uint32Array.from({length:edgeCount},(_,i)=>i),neighbors=new Int32Array(edgeCount).fill(-1),degree=new Uint32Array(vertices.length),first=new Int32Array(vertices.length).fill(-1);
  const a=e=>{const t=triangles[Math.floor(e/3)],k=e%3;return Math.min(t[k],t[(k+1)%3]);},b=e=>{const t=triangles[Math.floor(e/3)],k=e%3;return Math.max(t[k],t[(k+1)%3]);},third=e=>triangles[Math.floor(e/3)][(e%3+2)%3];
  order.sort((x,y)=>a(x)-a(y)||b(x)-b(y)||third(x)-third(y)||x-y);
  const edgeData=new Int32Array(edgeCount*2);let at=0;
  for(let i=0;i<edgeCount;){let end=i+1;const ea=a(order[i]),eb=b(order[i]);while(end<edgeCount&&a(order[end])===ea&&b(order[end])===eb)end++;
    for(let j=i+1;j<end;j++)requireInput(third(order[j-1])!==third(order[j]),'Duplicate mesh triangle.');
    requireInput(end-i===2,'Mesh must be closed, manifold and consistently wound; repair the source before importing.');
    const e=order[i],f=order[i+1],ti=Math.floor(e/3),tj=Math.floor(f/3),forward=triangles[ti][e%3]===ea,otherForward=triangles[tj][f%3]===ea;
    requireInput(forward!==otherForward,'Mesh must be closed, manifold and consistently wound; repair the source before importing.');
    neighbors[e]=tj;neighbors[f]=ti;
    edgeData[at++]=ea;edgeData[at++]=eb;edgeData[at++]=(forward?1:-1)*(ti+1);edgeData[at++]=(otherForward?1:-1)*(tj+1);i=end;
  }
  for(let i=0;i<count;i++)for(const v of triangles[i]){degree[v]++;first[v]=i;}
  for(let v=0;v<vertices.length;v++){
    requireInput(degree[v]>=3,'Unused or nonmanifold mesh vertex.');
    let face=first[v],visited=0;
    // Consistent edge winding gives one directed cycle around each vertex.
    do{const k=triangles[face].indexOf(v);requireInput(k>=0,'Nonmanifold mesh vertex.');face=neighbors[face*3+k];visited++;requireInput(visited<=degree[v]&&face>=0,'Nonmanifold mesh vertex.');}while(face!==first[v]);
    requireInput(visited===degree[v],'Nonmanifold mesh vertex.');
  }
  return edgeData;
}
export function meshEdgeMap(data){const edges=new Map();for(let i=0;i<data.length;i+=4){const records=[data[i+2],data[i+3]].map(v=>({triangle:Math.abs(v)-1,direction:Math.sign(v)}));edges.set(data[i]+':'+data[i+1],records);}return edges;}
