import {rivetInjectionResult,rivetEnclosureLayers,validateRivetClearance} from './weld.mjs';
import {assignmentPlan} from '../../../core/print/assignment-process.mjs';
import {slicePoint} from '../../../core/geom/slice.mjs';
import {intersect} from '../../../core/region/boolean.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';

export function weldWork(sites){
  return sites.map((site,index)=>({
    key:'rivet:'+site.id,kind:'inject',construction:'rivet',sourceId:'plastic-weld',part:site.part,nominalRank:site.top,index,
    context:{site,siteCount:sites.length,assignment:site.assignment},requires:[],operationDependencies:false,
    construct:({node,plan,machine,predecessors})=>rivetInjectionResult({plan:assignmentPlan(plan,machine,node.context.assignment),machine,
      site,siteIndex:index,siteCount:sites.length,modelResults:predecessors.filter(item=>item.node.construction!=='rivet').map(item=>item.result)})
  }));
}

export function weldDependencies(node,nodes){
  const needs=new Set();
  for(const other of nodes){
    if(other===node)continue;
    // Enclosure construction precedes injection; cover construction may then
    // consume its completed action. Exact physical barriers are checked again
    // against finalized heights, rather than trusting this construction rank.
    if(node.construction==='rivet'&&other.kind==='slice'&&!other.record.reference){
      const layers=other.record.spec.layers.filter(layer=>other.index===null||layer.index===other.index);
      const enclosure=rivetEnclosureLayers(node.context.site,node.context.site.process);
      if(layers.some(layer=>{
        const points=layer.region.map(loop=>loop.map(uv=>slicePoint(layer.slice,uv))),flat=points.flat();
        return flat.length&&enclosure.some(({z,required})=>z>=Math.min(...flat.map(p=>p[2]))-1e-8&&z<=Math.max(...flat.map(p=>p[2]))+1e-8&&Math.abs(regionArea(intersect(points.map(loop=>loop.map(p=>p.slice(0,2))),required)))>1e-8);
      }))needs.add(other.key);
    }

  }
  return [...needs];
}

export function weldOperationDependencies(sites,operation){
  return sites.filter(site=>operation.id!==site.reservation.completion.operationId&&operation.strokes.some(stroke=>stroke.points.some(p=>p[2]>site.top+1e-8)))
    .map(site=>site.reservation.completion.operationId);
}

export function finishWeldResults(plan,sites,{results,supports,workResults:injections}){
  const material=results.filter(result=>!injections.includes(result));
  validateRivetClearance({plan,sites,modelResults:[...supports,...material]});
  if(injections.length)material.push({id:'plastic-weld',operations:injections.flatMap(result=>result.operations),report:{depositionFamily:'inject',sites:injections.flatMap(result=>result.report.sites),physicalValidation:'not performed'}});
  return material;
}
