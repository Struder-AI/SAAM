import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBundleWorkflow} from '../print/workflow.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePreparedPath} from '../print/bundle.mjs';
import {curveAssignment} from '../print/curves.mjs';

export function generationWorkflow(events=[],onGenerate=()=>{}){
  let generateHook;const machine=loadMachine('ultimaker-s5');
  const api=createBundleWorkflow({kind:'stage-fixture',defaults,version:'fixture',buildDate:'2026-09-19',exportName:'part.gcode',
    machineFile:'machines/ultimaker/ultimaker-s5.json',validatePlan:plan=>plan,
    createGeometry:async parameters=>({bytes:Buffer.from(JSON.stringify(parameters)),descriptor:{nativeFile:'model.mesh.json',parameters}}),
    async generatePath(plan){
      events.push('generate');onGenerate();await generateHook?.();
      return generatePreparedPath({...plan,geometry:undefined,slices:{assignments:[curveAssignment({id:'fixture-line',curves:[
        {closed:false,points:[[0,0,.2],[1,0,.2]],heightMm:.2,beadWidthMm:.4,speedMmS:10}]})]}});
    }});
  return {api,set generateHook(hook){generateHook=hook;}};
}

export async function generationFixture(){
  const directory=await mkdtemp(join(tmpdir(),'saam-generation-stages-')),events=[];
  let generateCount=0;
  const workflow=generationWorkflow(events,()=>generateCount++),api=workflow.api;
  await api.initBundle(directory,{...defaults(loadMachine()),geometry:{shape:'fixture'}},{machineId:'ultimaker-s5'});
  const read=name=>readFile(join(directory,name),'utf8');
  const options={onProgress:p=>events.push(p.stage),beforeCommit:()=>events.push('commit')};
  return {directory,api,events,options,read,get generateCount(){return generateCount;},set generateHook(hook){workflow.generateHook=hook;},
    cleanup:()=>rm(directory,{recursive:true,force:true})};
}
