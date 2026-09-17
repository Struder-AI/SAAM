import {makeMesh} from '../../geom/mesh.mjs';

export function flutedVase({columns=64,rings=9,ripple=1.3}={}){
  const vertices=[],triangles=[];
  for(let j=0;j<rings;j++)for(let i=0;i<columns;i++){
    const t=j/(rings-1),theta=2*Math.PI*i/columns,r=10+2*t+Math.sin(Math.PI*t)+ripple*Math.cos(16*theta-3*t);
    vertices.push([2*t+r*Math.cos(theta),-t+r*Math.sin(theta),20*t]);
  }
  for(let j=0;j<rings-1;j++)for(let i=0;i<columns;i++){
    const a=j*columns+i,b=j*columns+(i+1)%columns,c=b+columns,d=a+columns;
    triangles.push([a,b,c],[a,c,d]);
  }
  const bottom=vertices.length;vertices.push([0,0,0]);const top=vertices.length;vertices.push([2,-1,20]);
  for(let i=0;i<columns;i++){
    triangles.push([bottom,(i+1)%columns,i]);
    triangles.push([top,(rings-1)*columns+i,(rings-1)*columns+(i+1)%columns]);
  }
  return makeMesh(vertices,triangles);
}
