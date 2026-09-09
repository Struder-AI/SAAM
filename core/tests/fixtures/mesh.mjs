export function boxMesh(x=12,y=10,z=2,rise=0) {
  const vertices=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z+rise],[x,y,z+rise],[0,y,z]];
  const quads=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  return {shape:'mesh',vertices,triangles:quads.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]),source:null};
}

export function ringMesh() {
  const footprint=[[0,0],[12,0],[12,12],[0,12],[4,4],[8,4],[8,8],[4,8]];
  const vertices=[...footprint.map(p=>[...p,0]),...footprint.map(p=>[...p,2])],quads=[];
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    quads.push([i+8,j+8,j+12,i+12],[i+4,j+4,j,i],[i,j,j+8,i+8],[i+4,i+12,j+12,j+4]);
  }
  return {shape:'mesh',vertices,triangles:quads.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]),source:null};
}
