// Synthetic software fixture; no hardware, calibration or job approval.
import {loadMachine} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';
import {generatePath} from '../../print/generate.mjs';
import {rhino} from '../../print/geometry.mjs';
import {syntheticDobotSetup} from './dobot.mjs';
import {developmentPipePlan} from '../../../skills/pipe-cladding/scripts/demo.mjs';
import {exportAndInterpretProgram,interpretProgram} from '../../export/registry.mjs';
import {unpackZip} from '../../export/zip.mjs';
import {decodeSource} from '../../../studio/source-player.mjs';
import {interpretBambuSource} from '../../export/bambu-player.mjs';
import {createHash} from 'node:crypto';

export async function enrichmentScenarios(){
  const native=await rhino(),out={};
  for(const [id,tool] of [['ultimaker-s5',0],['bambu-h2d',0],['bambu-h2d',1],['bambu-x1-carbon',0],['dobot-mg400',0],['denso-vp6242-rc8',0]]){
    const machine=loadMachine(id),plan=id==='denso-vp6242-rc8'?developmentPipePlan(machine):defaults(machine);
    if(id==='denso-vp6242-rc8'){plan.geometry.heightMm=1.2;plan.skills['pipe-cladding'].shells=2;}
    else{plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:.6};plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;}
    if(id==='dobot-mg400')syntheticDobotSetup(plan);
    if(id==='bambu-h2d')plan.setup.tool=tool;
    const path=generatePath(plan,machine,native),result=exportAndInterpretProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-19'});
    const bytes=Buffer.from(result.bytes),interpreted=interpretProgram(bytes,plan,machine);
    const sources=plan.output==='griffin-gcode'?{program:bytes.toString()}:plan.output==='bambu-gcode'?{program:unpackZip(bytes).get('Metadata/plate_1.gcode').toString()}:Object.fromEntries([...unpackZip(bytes)].filter(([name])=>/\.(lua|pcs)$/.test(name)).map(([name,body])=>[name,body.toString()]));
    const ordinary=decodeSource(sources,plan,machine,{compact:false}),compact=decodeSource(sources,plan,machine);
    const normalized={...compact,moves:[...compact.moves]};
    const value={archiveSha256:createHash('sha256').update(bytes).digest('hex'),combined:result.program,interpreted,ordinary,compact:normalized};
    if(plan.output==='bambu-gcode'){
      const failures={};
      for(const [name,code] of [['marker',sources.program.replace(';SAAM_BODY_BEGIN',';INVALID')],['late-command',sources.program.replace(';SAAM_BODY_END\n','G999\n;SAAM_BODY_END\n')]]){
        const rows=[],writer={push:row=>rows.push(row),get length(){return rows.length;}};
        try{interpretBambuSource(code,plan,machine,{moves:writer});failures[name]={unexpected:'accepted'};}catch(error){failures[name]={message:error.message,rows};}
      }
      value.failures=failures;
    }
    out[id+'-tool'+tool]=value;
  }
  return out;
}
