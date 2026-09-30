import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import facts from './fixtures/bambu-h2d-hardware-facts.json' with {type:'json'};
import {dualNozzleVerificationFixture} from './fixtures/bambu-dual.mjs';
import {h2dColourFixture} from './fixtures/bambu-h2d-colours.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {unpackZip} from '../export/zip.mjs';

test('fresh H2D generation preserves physically accepted colour and dual executables and project metadata',async()=>{
  const r=await rhino();
  for(const [make,record]of [[h2dColourFixture,facts.generatedSameNozzle],[dualNozzleVerificationFixture,facts.generatedDualNozzle]]){
    const {plan,machine}=make(),path=generatePath(plan,machine,r);
    const bytes=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:facts.date});
    const program=interpretProgram(bytes,plan,machine);
    const executable=program.code.slice(program.code.indexOf('; EXECUTABLE_BLOCK_START'));
    assert.equal(createHash('sha256').update(executable).digest('hex'),record.executableSha256,
      'Executable differs from the physically tested file; review the change and its hardware-evidence implications');
    assert.deepEqual(program.filamentSequence,record.filamentSequence);
    assert.equal(
      createHash('sha256').update(unpackZip(bytes).get('Metadata/project_settings.config')).digest('hex'),record.projectSha256,
      'Generated project differs from the physically accepted archive; unchanged commands alone do not preserve Bambu hardware evidence');
    if(record.depositionStages){
      const stages=[];
      for(const move of program.moves.filter(m=>m.extruding)){
        const stage=stages.at(-1);
        if(!stage||stage.tool!==move.tool||Math.abs(stage.zMm-move.to[2])>1e-6)stages.push({tool:move.tool,zMm:move.to[2]});
      }
      assert.deepEqual(stages,record.depositionStages.map(({tool,zMm})=>({tool,zMm})));
    }
  }
});
