import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {uniformKnots} from '../../../core/geom/voxel.mjs';
import {createVoxelBundle} from '../../../core/print/voxel.mjs';
import {generateBundle} from '../../../core/print/bundle.mjs';

export function demoVoxelRequest(){
  const counts=[11,11,2],degrees=[3,3,1],knots=counts.map((n,i)=>uniformKnots(n,degrees[i])),values=[];
  const coordinate=(i,axis)=>24*knots[axis].slice(i+1,i+degrees[axis]+1).reduce((a,b)=>a+b,0)/degrees[axis]-12;
  for(let z=0;z<2;z++)for(let y=0;y<11;y++)for(let x=0;x<11;x++){
    const dx=coordinate(x,0),dy=coordinate(y,1),r=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
    values.push(Math.min(10.5-r,r-5-1.5*Math.cos(3*angle)));
  }
  return {field:{schema:'saam-voxel-field/1',originMm:[0,0,0],sizeMm:[24,24,4.8],counts,degrees,knots,values,weights:null,isoValue:0},extraction:{edgeMm:0.6}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dir=resolve(process.argv[2]??'Prints/voxel-field-demo');
  await createVoxelBundle(dir,demoVoxelRequest(),{machineId:'ultimaker-s5'});
  const checks=await generateBundle(dir,{development:true});
  console.log(JSON.stringify({print:dir,development:true,approvals:'none',checks},null,2));
}
