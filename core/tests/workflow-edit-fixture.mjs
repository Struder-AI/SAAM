import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBundleWorkflow} from '../print/workflow.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

export async function editFixture(factory=createBundleWorkflow){
  const directory=await mkdtemp(join(tmpdir(),'saam-edit-stages-')),events=[];
  let failGeometry=false;
  const adapter={kind:'edit-fixture',defaults,version:'fixture',buildDate:'2026-09-19',exportName:'part.gcode',
    machineFile:'machines/ultimaker-s5.json',limitations:()=>[],
    validatePlan(plan){events.push('validate');if(plan.process.planarSpeedMmS<=0)throw Error('invalid speed');},
    geometryTemplate:shape=>({shape,width:2,height:3}),
    async createGeometry(parameters){events.push('geometry');if(failGeometry)throw Error('geometry failed');return {bytes:Buffer.from(JSON.stringify(parameters)),descriptor:{nativeFile:'model.mesh.json',parameters}};},
    async verifyGeometry(){events.push('verify');},generatePath(){throw Error('unexpected generation');}};
  const api=factory(adapter),plan=defaults(loadMachine());
  plan.geometry={shape:'fixture',width:2,height:3};
  plan.process.pattern={motif:'plain',density:1};
  await api.initBundle(directory,plan);
  const review={schema:'saam-review/1',approvals:{toolpath:{hash:'synthetic'}},history:[{event:'synthetic-review'}],generation:{planHash:'synthetic'}};
  await writeFile(join(directory,'review.json'),JSON.stringify(review));
  const state=await api.loadBundle(directory,{program:false});events.length=0;
  return {directory,api,state,events,adapter,read:name=>readFile(join(directory,name),'utf8'),
    set failGeometry(value){failGeometry=value;},cleanup:()=>rm(directory,{recursive:true,force:true})};
}
