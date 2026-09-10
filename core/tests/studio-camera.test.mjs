import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjection} from '../../studio/camera.mjs';
test('frame projection preserves screen positions and depth across camera views, fit and zoom',()=>{
 for(const bounds of [{min:[0,0,0],max:[24,24,25.6]},{min:[-100,10,0],max:[320,200,100]},{min:[1,2,3],max:[1,2,3]}])
 for(const [yaw,tilt] of [[-.78,.62],[0,0],[0,Math.PI/2],[1.6,-1.4]])
 for(const zoom of [.08,1,4]){
   const width=527,height=401,project=createProjection(bounds,width,height,yaw,tilt,zoom);
   for(const p of [bounds.min,bounds.max,[5,-4,42]]){
     const size=bounds.max.map((v,i)=>Math.max(1,v-bounds.min[i]));
     const [x,y,z]=p.map((v,i)=>v-(bounds.min[i]+bounds.max[i])/2);
     const u=x*Math.cos(yaw)-y*Math.sin(yaw),v=x*Math.sin(yaw)+y*Math.cos(yaw);
     const scale=Math.min(width/(size[0]+size[1])*1.1,height/(size[2]+Math.max(size[0],size[1]))*.9)*zoom;
     assert.deepEqual(project(p),[width/2+u*scale,height*.53+(v*Math.sin(tilt)-z*Math.cos(tilt))*scale,v*Math.cos(tilt)+z*Math.sin(tilt)]);
   }
 }
});
