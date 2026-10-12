// Extension compositions return engine inputs and finalized-result constraints.
// The build owns execution and the bundle.
import {loadExtensionEntry} from '../core/extensions/library.mjs';

export async function extensionDeposition({plan,placed,componentShells,shells,volumes,contexts,processForAssignment,engines}){
  const support=plan.skills?.supports?.enabled?await (await loadExtensionEntry('supports','deposition-runtime'))(engines):null;
  const weld=plan.skills?.['plastic-weld']?.enabled?await (await loadExtensionEntry('plastic-weld','deposition-runtime'))(engines):null;
  const sites=placed&&weld?weld.preparePlasticWeld({plan,placed,componentShells,processForAssignment}):[];
  const hasSleeve=contexts.some(({assignment})=>assignment.construction==='sleeve'||assignment.join);
  const vase=hasSleeve?await (await loadExtensionEntry('vase-wall','deposition-runtime'))(engines):null;
  const advanced=contexts.some(({assignment})=>assignment.construction==='sleeve'&&assignment.pattern!==null)?await (await loadExtensionEntry('advanced-vase-wall','deposition-runtime'))(engines,vase):null;
  // A sleeve prepares its geometry as it is constructed, so its failure is its own.
  const vaseWork=vase?args=>{
    const foundationSegments=vase.vaseFoundationSegments(args),{node,after,onProgress,substrateAdaptation}=args;
    if(node.context.assignment.pattern!==null)return advanced.advancedVaseResult({...node.context,after,onProgress,foundationSegments,substrateAdaptation});
    const geometry=node.context.geometry??vase.prepareSleeveGeometry({...node.context,onProgress});
    return vase.standardVaseResult({...node.context,geometry,after},{foundationSegments,substrateAdaptation});
  }:null;
  const sleeves=contexts.filter(({assignment})=>assignment.construction==='sleeve'||assignment.join).map(context=>{
    if(context.assignment.join){
      const prepared=engines.Toolpath.prepareSliceBoundaryStack({plan,assignment:context.assignment,shells,volumes});
      const referenceStack=prepared.referenceStack,first=referenceStack.layers[0];
      return {...context,assignment:{...context.assignment,construction:'sleeve',pattern:null,zStartMm:0,endTransition:context.assignment.join.levelEnd?'level':'rising',toleranceMm:.02,boundaryToleranceMm:.02,meshSleeve:null},
        startMm:prepared.startMm,endMm:prepared.endMm,geometry:{referenceStack:()=>referenceStack,firstHeight:first.heightMm,start:prepared.startMm,base:prepared.startMm,end:prepared.endMm,
          speedMmS:context.process.planarSpeedMmS,minimumTurnSeconds:0,role:'spiral',batch:{key:'spiral',layerId:context.assignment.id+':spiral',phase:'spiral'},terminalBoundary:false,report:()=>({join:'spiral',reference:'owned-region'})},
        construct:vaseWork,providesSurface:true,kind:'trace'};
    }
    const {assignment,shell}=context;
    return {...context,startMm:shell.bounds.min[2]+assignment.zStartMm,
      endMm:assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm,
      construct:vaseWork,providesSurface:true,kind:'trace'};
  });
  const trees=support?support.prepareSupportContexts({plan,processForAssignment,shells:componentShells?[...componentShells.values()]:placed?[placed]:[]}):[];
  return {
    bands:sleeves.filter(s=>!s.assignment.join).map(s=>({part:s.assignment.part,startMm:s.startMm,endMm:s.endMm})),
    reserves:sites.map(site=>site.reservation),envelopes:sites.map(site=>site.reservation),
    constructions:sleeves,
    additionalContexts:trees,
    work:weld?.weldWork(sites,processForAssignment)??[],workDependencies:(node,nodes)=>[...(vase?.vaseDependencies(node,nodes)??[]),...(weld?.weldDependencies(node,nodes)??[])],
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
