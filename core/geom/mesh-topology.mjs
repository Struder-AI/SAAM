// Edge incidence and vertex fan checks for the indexed mesh contract. Defects that a
// section meets only where it crosses them are counted, not refused (owner, 2026-10-09:
// "Our job is to show things in saam, not limit what we can do with saam"): open and
// nonmanifold edges, edges whose two faces wind the same way, sheets meeting only at a
// vertex (STL cannot keep such a vertex apart) and unused vertices. A repeated
// triangle is refused.
export function checkMeshTopology(vertices,triangles,requireInput){
  const report={openEdges:0,nonmanifoldEdges:0,inconsistentEdges:0,nonmanifoldVertices:0,unusedVertices:0};
  const count=triangles.length,edgeCount=count*3,order=Uint32Array.from({length:edgeCount},(_,i)=>i),neighbors=new Int32Array(edgeCount).fill(-1),degree=new Uint32Array(vertices.length),first=new Int32Array(vertices.length).fill(-1);
  const a=e=>{const t=triangles[Math.floor(e/3)],k=e%3;return Math.min(t[k],t[(k+1)%3]);},b=e=>{const t=triangles[Math.floor(e/3)],k=e%3;return Math.max(t[k],t[(k+1)%3]);},third=e=>triangles[Math.floor(e/3)][(e%3+2)%3];
  order.sort((x,y)=>a(x)-a(y)||b(x)-b(y)||third(x)-third(y)||x-y);
  for(let i=0;i<edgeCount;){let end=i+1;const ea=a(order[i]),eb=b(order[i]);while(end<edgeCount&&a(order[end])===ea&&b(order[end])===eb)end++;
    for(let j=i+1;j<end;j++)requireInput(third(order[j-1])!==third(order[j]),'Duplicate mesh triangle.');
    if(end-i===1)report.openEdges++;
    else if(end-i>2)report.nonmanifoldEdges++;
    else{
      const e=order[i],f=order[i+1],ti=Math.floor(e/3),tj=Math.floor(f/3),forward=triangles[ti][e%3]===ea,otherForward=triangles[tj][f%3]===ea;
      if(forward===otherForward)report.inconsistentEdges++;else{neighbors[e]=tj;neighbors[f]=ti;}
    }
    i=end;
  }
  for(let i=0;i<count;i++)for(const v of triangles[i]){degree[v]++;first[v]=i;}
  for(let v=0;v<vertices.length;v++){
    if(!degree[v]){report.unusedVertices++;continue;}
    // Consistent edge winding gives one directed cycle around each vertex; a walk that
    // meets a counted edge defect ends there and judges nothing more.
    let face=first[v],visited=0;
    do{const k=triangles[face].indexOf(v);face=neighbors[face*3+k];visited++;}while(face>=0&&face!==first[v]&&visited<=degree[v]);
    if(face===first[v]&&visited!==degree[v])report.nonmanifoldVertices++;
  }
  return report;
}
