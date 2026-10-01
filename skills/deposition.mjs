// Extension compositions return engine inputs and finalized-result constraints.
// The build owns execution and the bundle.
import {loadExtensionEntry} from '../core/extensions/library.mjs';
import {requireExclusiveClaims} from '../core/region/ownership.mjs';
import {TOLERANCE} from '../core/geom/tolerance.mjs';

export async function extensionDeposition({plan,placed,componentShells,contexts,onProgress,processForAssignment,engines}){
  const support=plan.skills?.supports?.enabled?await (await loadExtensionEntry('supports','deposition-runtime'))(engines):null;
  const weld=plan.skills?.['plastic-weld']?.enabled?await (await loadExtensionEntry('plastic-weld','deposition-runtime'))(engines):null;
  const sites=placed&&weld?weld.preparePlasticWeld({plan,placed,componentShells,processForAssignment}):[];
  const hasSleeve=contexts.some(({assignment})=>assignment.construction==='sleeve');
  const vase=hasSleeve?await (await loadExtensionEntry('vase-wall','deposition-runtime'))(engines):null;
  const advanced=hasSleeve?await (await loadExtensionEntry('advanced-vase-wall','deposition-runtime'))(engines,vase):null;
  const vaseWork=advanced?.constructVaseWork;
  const sleeves=contexts.filter(({assignment})=>assignment.construction==='sleeve').map(context=>{
    const {assignment,shell}=context;
    return {...context,startMm:shell.bounds.min[2]+assignment.zStartMm,
      endMm:assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm,
      construct:vaseWork,providesSurface:true,kind:assignment.pattern===null?'slice':'trace'};
  });
  for(let i=0;i<sleeves.length;i++)for(let j=i+1;j<sleeves.length;j++)
    if(sleeves[i].assignment.part===sleeves[j].assignment.part&&Math.min(sleeves[i].endMm,sleeves[j].endMm)-Math.max(sleeves[i].startMm,sleeves[j].startMm)>TOLERANCE.point)
      requireExclusiveClaims(sleeves[i].assignment,sleeves[j].assignment);
  const boundaries=sleeves.filter(context=>context.kind==='slice').map(context=>({...context,geometry:engines.Geometry.prepareContourSleeve({...context,onProgress})}));
  const trees=support?support.prepareSupportContexts({plan,processForAssignment,shells:componentShells?[...componentShells.values()]:placed?[placed]:[]}):[];
  return {
    bands:sleeves.map(s=>({part:s.assignment.part,startMm:s.startMm,endMm:s.endMm})),
    reserves:sites.map(site=>site.reservation),envelopes:sites.map(site=>site.reservation),
    constructions:sleeves.filter(context=>context.kind==='trace'),
    additionalContexts:[...(vase?.standardVaseContexts(boundaries)??[]).map(record=>({...record,constructWork:vaseWork,providesSurface:true})),...trees],
    work:weld?.weldWork(sites,processForAssignment)??[],workDependencies:(node,nodes)=>[...(advanced?.vaseDependencies(node,nodes)??[]),...(weld?.weldDependencies(node,nodes)??[])],
    operationDependencies:operation=>weld?.weldOperationDependencies(sites,operation)??[],
    finishResults:batch=>weld?weld.finishWeldResults(plan,sites,batch):batch.results
  };
}

export async function extensionResultDependencies(results,supports,engines){
  if(!supports.length)return [];
  const runtime=await (await loadExtensionEntry('supports','deposition-runtime'))(engines);
  return runtime.supportDependencies(supports,results);
}

export function extensionSummary(results){
  const summary={},vases=results.filter(result=>result.report.construction==='sleeve').map(result=>({id:result.id,...result.report}));
  if(vases.length)summary.vaseWall={...vases[0],instances:vases};
  const weld=results.find(result=>result.id==='plastic-weld'&&Array.isArray(result.report.sites));
  if(weld)summary.plasticWeld=weld.report;
  return summary;
}
