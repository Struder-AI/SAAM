// Selected extensions own technique settings and publish ordinary deposition.
// The host combines atomic contributions; scheduling interprets material requirements.
import {loadExtensionEntry} from './library.mjs';
import {depositionAssignment} from '../print/assignment-records.mjs';
import {convexVolume} from '../geom/convex-clearance.mjs';

export async function prepareProcessSources(input,engines){
  const sources=[],notes=[],ids=new Set(input.plan.slices.assignments.map(a=>a.id));
  for(const [id,settings] of Object.entries(input.plan.skills??{})){
    if(!settings?.enabled)continue;
    try{
      const create=await loadExtensionEntry(id,'process-source');
      const runtime=await create({...engines,extensionId:id,settings:structuredClone(settings)});
      const prepared=await runtime.prepare(input),contributions=[],proposedIds=new Set();
      for(const contribution of prepared.contributions??[]){
        if(typeof contribution.id!=='string'||!contribution.id)throw Error('A process contribution needs an id.');
        const assignments=(contribution.assignments??[]).map(options=>{
          if(options.construction&&!['curves','inject'].includes(options.construction)||options.source)throw Error('Process sources publish Slice, explicit Trace or Inject assignments.');
          return depositionAssignment(options);
        });
        if(!assignments.some(a=>a.id===contribution.id))throw Error('A process contribution needs its primary assignment.');
        for(const assignment of assignments){
          if(ids.has(assignment.id)||proposedIds.has(assignment.id))throw Error('Duplicate process assignment '+assignment.id+'.');
          proposedIds.add(assignment.id);
        }
        const requiredMaterial=(contribution.requiredMaterial??[]).map(requirement=>{
          if(requirement.part!==assignments.find(a=>a.id===contribution.id).part)throw Error('A material requirement must name its primary assignment part.');
          return {part:requirement.part,volume:convexVolume(requirement.volume?.vertices)};
        });
        contributions.push({...contribution,assignments,requiredMaterial});
      }
      for(const assignmentId of proposedIds)ids.add(assignmentId);
      sources.push({id,runtime,prepared,contributions});notes.push(...(prepared.notes??[]));
    }catch(error){
      if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
      notes.push('Extension '+id+' produces nothing: '+error.message);
    }
  }
  const contributions=sources.flatMap(source=>source.contributions.map(contribution=>({...contribution,extension:source.id})));
  return {notes,assignments:contributions.flatMap(c=>c.assignments),
    materialRequirements:new Map(contributions.map(c=>[c.id,c.requiredMaterial])),
    assignmentOwners:new Map(contributions.flatMap(c=>c.assignments.map(a=>[a.id,c.id]))),
    reports:new Map(contributions.map(c=>[c.id,{extension:{id:c.extension,sourceId:c.id,report:c.report??{}}}])),
    geometryCuts:contributions.flatMap(c=>(c.geometryCuts??[]).map(cut=>({...cut,sourceId:c.id}))),
    solidVolumes:contributions.flatMap(c=>(c.solidVolumes??[]).map(volume=>({...volume,sourceId:c.id})))};
}
