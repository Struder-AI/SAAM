// Process sources declare atomic work before geometric preparation can fail.
// The host admits those identities once; generation owns dependency failure closure.
import {loadExtensionEntry} from './library.mjs';
import {depositionAssignment} from '../print/assignment-records.mjs';
import {convexVolume} from '../geom/convex-clearance.mjs';

export async function prepareProcessSources(input,engines){
  const contributions=[],declarations=[],notes=[],assignmentOwners=new Map(),processFailures=new Map();
  const ids=new Set(input.plan.slices.assignments.map(a=>a.id));
  const fail=(id,error)=>{
    if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
    if(!processFailures.has(id))processFailures.set(id,error);
  };
  for(const [extension,settings] of Object.entries(input.plan.skills??{})){
    if(!settings?.enabled)continue;
    // Unreadable code or declarations reject the request: unknown work cannot
    // be safely presented as a successful, empty contribution.
    const create=await loadExtensionEntry(extension,'process-source');
    const runtime=await create({...engines,extensionId:extension,settings:structuredClone(settings)});
    if(!Array.isArray(runtime?.declarations)||typeof runtime.prepare!=='function')throw Error('Process source '+extension+' needs declarations and prepare.');
    const declared=new Map();
    for(const declaration of runtime.declarations){
      if(typeof declaration?.id!=='string'||!declaration.id||!Array.isArray(declaration.assignments)||
        !declaration.assignments.some(a=>a.id===declaration.id)||declared.has(declaration.id))throw Error('Invalid process contribution declaration: '+extension+'.');
      for(const assignment of declaration.assignments){
        if(typeof assignment.id!=='string'||!assignment.id||ids.has(assignment.id))throw Error('Duplicate or missing process assignment: '+assignment.id+'.');
        if(assignment.part!==null&&typeof assignment.part!=='string')throw Error('Process declaration needs an explicit part: '+assignment.id+'.');
        if(assignment.construction&&!['curves','inject'].includes(assignment.construction)||assignment.source)throw Error('Process sources declare Slice, explicit Trace or Inject assignments.');
        ids.add(assignment.id);assignmentOwners.set(assignment.id,declaration.id);
        declarations.push(structuredClone(assignment));
      }
      declared.set(declaration.id,declaration);
    }
    let prepared;
    try{
      prepared=await runtime.prepare(input);
      if(!prepared||!Array.isArray(prepared.contributions)||prepared.failures!==undefined&&!Array.isArray(prepared.failures))throw Error('Invalid process preparation result: '+extension+'.');
    }catch(error){
      if(!declared.size)throw error;
      for(const id of declared.keys())fail(id,error);
      continue;
    }
    notes.push(...(prepared.notes??[]));
    for(const failure of prepared.failures??[]){
      if(!declared.has(failure?.id)||typeof failure.message!=='string')throw Error('Undeclared process failure: '+extension+'.');
      fail(failure.id,Error(failure.message));
    }
    const received=new Map();
    for(const contribution of prepared.contributions){
      if(!declared.has(contribution?.id))throw Error('Undeclared process contribution: '+extension+'.');
      if(received.has(contribution.id))fail(contribution.id,Error('Duplicate prepared process contribution: '+contribution.id+'.'));
      received.set(contribution.id,contribution);
    }
    for(const [id,declaration] of declared){
      if(processFailures.has(id))continue;
      try{
        const contribution=received.get(id);
        if(!contribution)throw Error('Declared process contribution produced no result: '+id+'.');
        const assignments=(contribution.assignments??[]).map(options=>depositionAssignment(options));
        const expected=new Map(declaration.assignments.map(a=>[a.id,a]));
        if(assignments.length!==expected.size||new Set(assignments.map(a=>a.id)).size!==expected.size||assignments.some(a=>
          !expected.has(a.id)||a.part!==expected.get(a.id).part||a.construction!==expected.get(a.id).construction||a.source))
          throw Error('Prepared process assignments differ from their declarations: '+id+'.');
        const requiredMaterial=(contribution.requiredMaterial??[]).map(requirement=>{
          if(requirement.part!==assignments.find(a=>a.id===id).part)throw Error('A material requirement must name its primary assignment part.');
          return {part:requirement.part,volume:convexVolume(requirement.volume?.vertices)};
        });
        contributions.push({...contribution,extension,assignments,requiredMaterial});
      }catch(error){fail(id,error);}
    }
  }
  return {notes,declarations,processFailures,assignmentOwners,assignments:contributions.flatMap(c=>c.assignments),
    materialRequirements:new Map(contributions.map(c=>[c.id,c.requiredMaterial])),
    reports:new Map(contributions.map(c=>[c.id,{extension:{id:c.extension,sourceId:c.id,report:c.report??{}}}])),
    geometryCuts:contributions.flatMap(c=>(c.geometryCuts??[]).map(cut=>({...cut,sourceId:c.id}))),
    solidVolumes:contributions.flatMap(c=>(c.solidVolumes??[]).map(volume=>({...volume,sourceId:c.id})))};
}
