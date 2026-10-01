// Extension compositions return engine inputs and finalized-result constraints.
// The build owns execution and the bundle.
import {loadExtensionEntry} from '../core/extensions/library.mjs';
import {prepareContourSleeve} from './advanced-vase-wall/scripts/contour-sleeve.mjs';
import {constructVaseWork,vaseDependencies} from './advanced-vase-wall/scripts/work.mjs';
import {standardVaseContexts} from './vase-wall/scripts/prepare.mjs';
import {preparePlasticWeld} from './plastic-weld/scripts/weld.mjs';
import {weldWork,weldDependencies,weldOperationDependencies,finishWeldResults} from './plastic-weld/scripts/work.mjs';
import {requireExclusiveClaims} from '../core/region/ownership.mjs';
import {TOLERANCE} from '../core/geom/tolerance.mjs';

export async function extensionDeposition({plan,placed,componentShells,contexts,onProgress,processForAssignment,engines}){
  const support=plan.skills?.supports?.enabled?await (await loadExtensionEntry('supports','deposition-runtime'))(engines):null;
  const sites=placed?preparePlasticWeld({plan,placed,componentShells,processForAssignment}):[];
  const sleeves=contexts.filter(({assignment})=>assignment.construction==='sleeve').map(context=>{
    const {assignment,shell}=context;
    return {...context,startMm:shell.bounds.min[2]+assignment.zStartMm,
      endMm:assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm,
      construct:constructVaseWork,providesSurface:true,kind:assignment.pattern===null?'slice':'trace'};
  });
  for(let i=0;i<sleeves.length;i++)for(let j=i+1;j<sleeves.length;j++)
    if(sleeves[i].assignment.part===sleeves[j].assignment.part&&Math.min(sleeves[i].endMm,sleeves[j].endMm)-Math.max(sleeves[i].startMm,sleeves[j].startMm)>TOLERANCE.point)
      requireExclusiveClaims(sleeves[i].assignment,sleeves[j].assignment);
  const boundaries=sleeves.filter(context=>context.kind==='slice').map(context=>({...context,geometry:prepareContourSleeve({...context,onProgress})}));
  const trees=support?support.prepareSupportContexts({plan,processForAssignment,shells:componentShells?[...componentShells.values()]:placed?[placed]:[]}):[];
  return {
    bands:sleeves.map(s=>({part:s.assignment.part,startMm:s.startMm,endMm:s.endMm})),
    reserves:sites.map(site=>site.reservation),envelopes:sites.map(site=>site.reservation),
    constructions:sleeves.filter(context=>context.kind==='trace'),
    additionalContexts:[...standardVaseContexts(boundaries).map(record=>({...record,constructWork:constructVaseWork,providesSurface:true})),...trees],
    work:weldWork(sites,processForAssignment),workDependencies:(node,nodes)=>[...vaseDependencies(node,nodes),...weldDependencies(node,nodes)],
    operationDependencies:operation=>weldOperationDependencies(sites,operation),
    finishResults:batch=>finishWeldResults(plan,sites,batch)
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
