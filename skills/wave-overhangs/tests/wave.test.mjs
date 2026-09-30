import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referencePatch} from '../../../core/geom/reference-surface.mjs';
import {surfaceWaves,connectWavePasses,WAVE_DEFAULTS} from '../scripts/wave.mjs';

const settings={...WAVE_DEFAULTS,lineSpacingMm:0.5,propagationStepMm:0.25,sampleStepMm:0.5};

test('a curved canopy rim retains rounding residue without spurious perimeter passes',()=>{
  // Original SAAM canopy geometry, starting one complete ring before its rim.
  // This isolates the large example's failure without regenerating 110 rings.
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/canopy-rim.json',import.meta.url)));
  for(const [x,y] of [[0,0],[140.2,100.2]]){
    const surface={...fixture.surface,controlPoints:fixture.surface.controlPoints.map(row=>row.map(p=>[p[0]+x,p[1]+y,p[2]]))};
    const patch=referencePatch(surface),s={...settings,lineSpacingMm:.3,propagationStepMm:.3};
    const result=surfaceWaves(patch,fixture.domainUv,fixture.seedUv,s);
    assert.deepEqual(result.waves.map(w=>w.paths.length),[1]);
    assert.ok(result.report.residualsUv.length>0,'Numerical strips remain reported.');
    assert.ok(result.report.residualMaxSampleDiameterMm>s.toleranceMm,'Long strips are not mislabeled as short residuals.');
    assert.ok(result.report.residualRoundingBandUv>0&&result.report.residualRoundingBandUv<=s.toleranceMm/240);
    assert.equal(connectWavePasses(patch,result.waves,fixture.domainUv,s,.4).passes.length,1);
  }
});
