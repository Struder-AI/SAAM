// Opt-in reference/measurement harness using the production region adapter.
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { intersectionFixtures, intersectionFixtureIdentity } from './intersection-fixtures.mjs';
import { canonicalLoops } from '../../core/region/clipper.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(args.includes('--inputs')) {
  save(arg('--inputs'),intersectionFixtures);
} else {
  const start=performance.now(),ops=await import('../../core/region/intersection.mjs');
  const startupMs=performance.now()-start;
  const run=()=>intersectionFixtures.map(f=>({name:f.name,loops:ops[f.operation](f.a,f.b,{precisionMm:f.precisionMm})}));
  const firstStart=performance.now(),actual=run(),firstMs=performance.now()-firstStart;
  if(args.includes('--reference')) {
    const expected=JSON.parse(fs.readFileSync(arg('--reference'))).map(f=>({...f,loops:canonicalLoops(f.loops)}));
    const failures=actual.filter((f,i)=>JSON.stringify(f)!==JSON.stringify(expected[i]));
    if(failures.length)throw new Error(`C#/WASM mismatch: ${failures.map(f=>f.name).join(', ')}`);
    if(args.includes('--record'))save(new URL('../../core/tests/fixtures/intersection-reference.json',import.meta.url),{
      upstreamRevision:'642390d0d515cfb645d2ec4d95d218e28be645f4',
      wasmPackage:'clipper2-wasm@0.4.0',wasmRevision:'3c244f3edd0adae6c851460fc409c15f3d235395',
      inputSha256:hash(JSON.stringify(intersectionFixtureIdentity)),expected
    });
  }
  const samplesMs=[];
  for(let i=0;i<7;i++){const t=performance.now();run();samplesMs.push(performance.now()-t);}
  console.log(JSON.stringify({cases:actual.length,startupMs,firstMs,samplesMs,medianMs:[...samplesMs].sort((a,b)=>a-b)[3],
    node:process.version,cpu:os.cpus()[0].model,outputSha256:hash(JSON.stringify(actual)),
    adapterSha256:hash(fs.readFileSync(new URL('../../core/region/intersection.mjs',import.meta.url))),
    wasmSha256:hash(fs.readFileSync(new URL('../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',import.meta.url)))},null,2));
}
