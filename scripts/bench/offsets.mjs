// Opt-in construction timing, separate from reference validation and the public
// print lifecycle. Writes JSON to stdout; redirect to an ignored .local file.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {offsetRegion} from '../../core/region/offset.mjs';
import {offsetSurfaceRegion} from '../../core/region/surface-offset.mjs';
import {offsetFixtures} from './offset-fixtures.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function measure(name,fn,count) {
  let result;const start=performance.now();result=fn();const coldMs=performance.now()-start,samples=[];
  const outputHash=hash(result);
  for(let trial=0;trial<3;trial++){const t=performance.now();for(let i=0;i<count;i++)result=fn();samples.push((performance.now()-t)/count);}
  if(hash(result)!==outputHash)throw Error('Offset output changed across trials');
  return {name,coldMs,warmMedianMs:[...samples].sort((a,b)=>a-b)[1],warmSamplesMs:samples,outputHash,report:result.report};
}
const nested=offsetFixtures.find(f=>f.name==='nested/-0.2/round');
const cp=[];for(const [x,y,w] of [[10,0,1],[10,10,Math.SQRT1_2],[0,10,1]])for(const z of [0,20])cp.push(x*w,y*w,z*w,w);
const patch={nu:3,nv:2,orderU:3,orderV:2,knotsU:[0,0,0,1,1,1],knotsV:[0,0,20,20],domainU:[0,1],domainV:[0,20],cp};
const files=['core/region/offset.mjs','core/region/clipper.mjs','core/region/surface-offset.mjs','core/geom/surface-derivatives.mjs','node_modules/clipper-lib/clipper.js'];
console.log(JSON.stringify({node:process.version,platform:process.platform,sourceHashes:Object.fromEntries(files.map(file=>[file,hash(fs.readFileSync(file,'utf8'))])),
  measurements:[measure('planar nested loops, 16 vertices',()=>offsetRegion(nested.loops,nested.delta,nested),100),
    measure('planar 90-case corpus',()=>offsetFixtures.map(f=>offsetRegion(f.loops,f.delta,f)),3),
    measure('cylinder surface, 4-vertex boundary, -0.4 mm',()=>offsetSurfaceRegion(patch,[[[0.25,6],[0.75,6],[0.75,14],[0.25,14]]],-0.4,{toleranceMm:0.005,maxStepMm:1}),3)]},null,2));
