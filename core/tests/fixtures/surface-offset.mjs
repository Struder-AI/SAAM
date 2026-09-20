export const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export function offsetPlane(slope=0,scaleU=1,scaleV=1){
  return {nu:2,nv:2,orderU:2,orderV:2,knotsU:[0,0,20*scaleU,20*scaleU],knotsV:[0,0,20*scaleV,20*scaleV],
    domainU:[0,20*scaleU],domainV:[0,20*scaleV],cp:Float64Array.from([0,0,0,1,0,20,0,1,20,0,20*slope,1,20,20,20*slope,1])};
}
export function offsetCylinder(){
  const cp=[];
  for(const [x,y,w] of [[10,0,1],[10,10,Math.SQRT1_2],[0,10,1]])for(const z of [0,20])cp.push(x*w,y*w,z*w,w);
  return {nu:3,nv:2,orderU:3,orderV:2,knotsU:[0,0,0,1,1,1],knotsV:[0,0,20,20],domainU:[0,1],domainV:[0,20],cp:Float64Array.from(cp)};
}
export function offsetCurvedPatch(){
  const patch={nu:3,nv:3,orderU:3,orderV:3,knotsU:[-10,-10,-10,10,10,10],knotsV:[-10,-10,-10,10,10,10],domainU:[-10,10],domainV:[-10,10],cp:[]};
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)patch.cp.push([-10,0,10][i],[-10,0,10][j],[2,-2,2][i]+[1,-1,1][j],1);
  return patch;
}
