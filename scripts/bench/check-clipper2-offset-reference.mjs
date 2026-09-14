// Compare independently generated C# offset results with the production WASM
// adapter. Recording stores the C# output, never expected data from production.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {offsetFixtures} from './offset-fixtures.mjs';
import {offsetRegion} from '../../core/region/offset.mjs';
import {canonicalLoops} from '../../core/region/clipper.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const [file,...flags]=process.argv.slice(2);
if(!file)throw Error('Usage: node scripts/bench/check-clipper2-offset-reference.mjs expected.json [--record]');
const reference=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(reference.length,offsetFixtures.length);
const failures=[];
for(let i=0;i<reference.length;i++){
  const f=offsetFixtures[i];assert.equal(reference[i].name,f.name);
  try{assert.deepEqual(offsetRegion(f.loops,f.delta,f),canonicalLoops(reference[i].loops),f.name);}
  catch(error){failures.push({name:f.name,error});}
}
if(failures.length){
  console.error(failures.map(f=>f.name).join('\n'));
  throw new Error(`${failures.length} C#/WASM offset construction differences; first: ${failures[0].error.message}`);
}
if(flags.includes('--record')){
  const root='.local/intersection-native-reference/CSharp/Clipper2Lib';
  const sourceSha256=Object.fromEntries(fs.readdirSync(root).filter(name=>name.endsWith('.cs')).sort().map(name=>[name,hash(fs.readFileSync(root+'/'+name))]));
  fs.writeFileSync('core/tests/fixtures/clipper2-offset-reference.json',JSON.stringify({
    upstreamRevision:'642390d0d515cfb645d2ec4d95d218e28be645f4',
    wasmPackage:'clipper2-wasm@0.4.0',wasmRevision:'3c244f3edd0adae6c851460fc409c15f3d235395',
    source:'https://github.com/AngusJohnson/Clipper2/tree/642390d0d515cfb645d2ec4d95d218e28be645f4/CSharp/Clipper2Lib',
    sourceSha256,inputSha256:hash(JSON.stringify(offsetFixtures)),
    generator:'scripts/bench/clipper2-offset-reference.cs (.NET 8, USINGZ)',
    note:'Unmodified C# Clipper2 kernel; local-origin integer coordinates; NonZero input/output normalization, PreserveCollinear=false, Polygon offset construction. Historical Clipper 6 results remain in clipper-reference.json.',
    cases:reference})+'\n');
}
console.log(`Exact coordinate and loop agreement in ${reference.length} independent Clipper2 C# / WASM offset cases.`);
