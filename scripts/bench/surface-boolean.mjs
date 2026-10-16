// Complete native boundary construction (including sewing) versus mesh Boolean
// construction, from identical rational inputs and one accuracy setting. Source
// builds and runtime warm-up are outside the timed construction samples.
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {geometryOperations} from '../../core/geom/operations.mjs';
import {BOOLEAN_TOLERANCE_MM} from '../../core/dimensions.mjs';
import {solidKernel,solidFromMesh,meshFromSolid} from '../../core/geom/solid.mjs';
import {tessellateSolid} from '../../core/geom/boolean-display.mjs';
import {splineBox,splineBlock} from '../../core/tests/fixtures/spline-shapes.mjs';

const G=geometryOperations(),results=[];
const hosts=[['flat',splineBox({runMm:40,widthMm:40,heightMm:12})],
  ['curved',splineBlock({runMm:40,widthMm:40,heightsMm:[[12,12,12,12],[12,16,16,12],[12,16,16,12],[12,12,12,12]]})]];
const startup=performance.now(),warm=await G.buildGeometry(hosts[0][1]);
await G.constructSolids([warm],{toleranceMm:BOOLEAN_TOLERANCE_MM});
const startupMs=performance.now()-startup;
for(const [hostName,geometry] of hosts)for(const holes of [1,4]){
  const started=performance.now(),shell=await G.buildGeometry(geometry),operands=[shell];
  for(let i=0;i<holes;i++)operands.push(await G.buildGeometry(G.revolvedProfile({
    positionMm:[10+20*(i%2),10+20*Math.floor(i/2),8],axis:[0,0,1],profile:[[0,1.45],[12,1.45]]
  })));
  const buildMs=performance.now()-started,samples=[];
  for(let repeat=0;repeat<3;repeat++){
    const nativeStart=performance.now(),native=G.combineSolids('difference',operands),nativeMs=performance.now()-nativeStart;
    const meshStart=performance.now(),mesh=await meshBoolean(operands);
    samples.push({nativeMs,meshMs:performance.now()-meshStart,faces:native.patches.length,
      sharedEdges:native.topology.edges.length,triangles:mesh?.triangles.length??0});
  }
  results.push({hostName,holes,buildMs,samples});
}
const output=resolve(process.argv[2]??'.local/surface-boolean-benchmark.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({node:process.version,toleranceMm:BOOLEAN_TOLERANCE_MM,startupMs,
  scope:'Construction only, including native edge sewing. Excludes output tessellation, feature diagnostics, persistence and slicing.',results},null,2));
console.log(`Saved Boolean construction measurements to ${output}`);

// Preserve the former mesh route as an independent development comparison.
// Product clients use Geometry; this benchmark deliberately measures internals.
async function meshBoolean(operands){
  const kernel=await solidKernel(),owned=[];
  try{
    const solids=[];
    for(const operand of operands){
      const mesh=await tessellateSolid(operand,{toleranceMm:BOOLEAN_TOLERANCE_MM}),solid=solidFromMesh(kernel,mesh);
      owned.push(solid);solids.push(solid);
    }
    const state={solid:solids[0]};
    for(const next of solids.slice(1)){state.solid=state.solid.subtract(next);owned.push(state.solid);}
    return state.solid.isEmpty()?null:meshFromSolid(state.solid);
  }finally{for(const solid of owned.reverse())solid.delete();}
}