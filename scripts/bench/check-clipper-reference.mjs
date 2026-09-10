// Feed this runner the original C# runner's JSON output. --record deliberately
// updates the checked fixture only after exact agreement with the JS port.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {offsetFixtures} from './offset-fixtures.mjs';
import {offsetRegion} from '../../core/region/offset.mjs';
import {canonicalLoops} from '../../core/region/clipper.mjs';
const [file,...flags]=process.argv.slice(2);
if(!file)throw Error('Usage: node scripts/bench/check-clipper-reference.mjs expected.json [--record]');
const reference=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(reference.length,offsetFixtures.length);
for(let i=0;i<reference.length;i++) {
  const f=offsetFixtures[i];assert.equal(reference[i].name,f.name);
  assert.deepEqual(offsetRegion(f.loops,f.delta,f),canonicalLoops(reference[i].loops),f.name);
}
if(flags.includes('--record')) {
  const source=fs.readFileSync('.local/offset-reference/clipper.cs');
  const sha256=createHash('sha256').update(source).digest('hex');
  assert.equal(sha256,'697a4d31d33642a41705e46247873a34694632cd180de46c00deb97fe7278f4f','Reference source changed; inspect it before changing the pinned reference.');
  fs.writeFileSync('core/tests/fixtures/clipper-reference.json',JSON.stringify({
    source:'https://github.com/arendvw/clipper/blob/master/ClipperTools/clipper.cs',version:'6.4.2',sha256,
    generator:'scripts/bench/clipper-reference.cs (.NET 8)',
    note:'Original unmodified C# kernel, with SAAM material-region semantics, NonZero normalization and StrictlySimple cleanup; not GH closed-line stroke semantics.',cases:reference})+'\n');
}
console.log(`Exact coordinate and loop agreement in ${reference.length} original C# / JS cases.`);
