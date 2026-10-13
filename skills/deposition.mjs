// Extension compositions return engine inputs and finalized-result constraints.
// The build owns execution and the bundle.
import {loadExtensionEntry} from '../core/extensions/library.mjs';

async function depositionRuntime(id,engines,dependency){
  try{const create=await loadExtensionEntry(id,'deposition-runtime');return {runtime:await create(engines,dependency),error:null};}
  catch(error){if(error.name==='AbortError')throw error;return {runtime:null,error};}
}

export async function extensionDeposition({plan,placed,componentShells,shells,volumes,contexts,processForAssignment,engines}){
  const weldLoaded=plan.skills?.['plastic-weld']?.enabled?await depositionRuntime('plastic-weld',engines):{runtime:null,error:null};
  const weld=weldLoaded.runtime;
  // A rivet site that cannot be prepared is left out with a note.
  const {sites,notes}=placed&&weld?weld.preparePlasticWeld({plan,placed,componentShells,processForAssignment}):{sites:[],notes:weldLoaded.error?(plan.skills['plastic-weld'].sites??[]).map(site=>`Inject plastic-weld:${site.id} produced nothing: ${weldLoaded.error.message}`):[]};
  const hasSleeve=contexts.some(({assignment})=>assignment.construction==='sleeve'||assignment.join);
  const vaseLoaded=hasSleeve?await depositionRuntime('vase-wall',engines):{runtime:null,error:null};
  const vase=vaseLoaded.runtime;
  const advancedLoaded=contexts.some(({assignment})=>assignment.construction==='sleeve'&&assignment.pattern!==null)?await depositionRuntime('advanced-vase-wall',engines,vase):{runtime:null,error:null};
  const advanced=advancedLoaded.runtime;
  // A sleeve prepares its geometry as it is constructed, so its failure is its own.
  const vaseWork=args=>{
    if(vaseLoaded.error)throw vaseLoaded.error;
    const foundationSegments=vase.vaseFoundationSegments(args),{node,after,onProgress,substrateAdaptation}=args;
    if(node.context.assignment.pattern!==null&&advancedLoaded.error)throw advancedLoaded.error;
    if(node.context.assignment.pattern!==null)return advanced.advancedVaseResult({...node.context,after,onProgress,foundationSegments,substrateAdaptation});
    const geometry=node.context.geometry??vase.prepareSleeveGeometry({...node.context,onProgress});
    return vase.standardVaseResult({...node.context,geometry,after},{foundationSegments,substrateAdaptation});
  };
  const sleeves=contexts.filter(({assignment})=>assignment.construction==='sleeve'||assignment.join).map(context=>{
    if(context.assignment.join){
      // A spiral boundary that cannot be resolved fails as its own assignment.
      const prepared=(()=>{try{return engines.MaterialRegions.prepareSliceBoundaryStack({plan,assignment:context.assignment,shells,volumes});}catch(error){return {error};}})();
      if(prepared.error)return {...context,construct:()=>{throw prepared.error;},providesSurface:true,kind:'trace'};
      const referenceStack=prepared.referenceStack,first=referenceStack.layers[0];
      return {...context,assignment:{...context.assignment,construction:'sleeve',pattern:null,zStartMm:0,endTransition:context.assignment.join.levelEnd?'level':'rising',toleranceMm:.02,boundaryToleranceMm:.02,meshSleeve:null},
        startMm:prepared.startMm,endMm:prepared.endMm,geometry:{referenceStack:()=>referenceStack,firstHeight:first.heightMm,start:prepared.startMm,base:prepared.startMm,end:prepared.endMm,
          speedMmS:context.process.planarSpeedMmS,minimumTurnSeconds:0,role:'spiral',batch:{key:'spiral',layerId:context.assignment.id+':spiral',phase:'spiral'},terminalBoundary:false,report:()=>({join:'spiral',reference:'owned-region'})},
        construct:vaseWork,providesSurface:true,kind:'trace'};
    }
    const {assignment,shell}=context;
    if(!shell)return {...context,startMm:0,endMm:0,construct:()=>{throw Error('A sleeve construction needs selected geometry.');},providesSurface:true,kind:'trace'};
    return {...context,startMm:shell.bounds.min[2]+assignment.zStartMm,
      endMm:assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm,
      construct:vaseWork,providesSurface:true,kind:'trace'};
  });
  const curveSources=[],sourceRuntimes=new Map();
  for(const context of contexts.filter(({assignment})=>assignment.construction==='curves'&&assignment.source)){
    const id=context.assignment.source.extension;
    if(!sourceRuntimes.has(id)){
      try{const create=await loadExtensionEntry(id,'trace-source');sourceRuntimes.set(id,{runtime:await create(engines),error:null});}
      catch(error){if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;sourceRuntimes.set(id,{runtime:null,error});}
    }
    const loaded=sourceRuntimes.get(id);
    curveSources.push({...context,curveSource:loaded.runtime,sourceError:loaded.error});
  }
  return {notes,curveSources,
    bands:sleeves.filter(s=>!s.assignment.join).map(s=>({sourceId:s.assignment.id,part:s.assignment.part,startMm:s.startMm,endMm:s.endMm})),
    reserves:sites.map(site=>({...site.reservation,sourceId:site.assignment.id})),envelopes:sites.map(site=>({...site.reservation,sourceId:site.assignment.id})),
    constructions:sleeves,
    work:weld?.weldWork(sites,processForAssignment)??[],workDependencies:(node,nodes)=>{const sleeve=vase?.vaseDependencies(node,nodes)??{dependencies:[],notes:[]};return {dependencies:[...sleeve.dependencies,...(weld?.weldDependencies(node,nodes)??[])],notes:sleeve.notes};},
    operationDependencies:(operation,excluded)=>weld?.weldOperationDependencies(sites.filter(site=>!excluded.has(site.assignment.id)),operation)??[],
    finishResults:batch=>weld?weld.finishWeldResults(plan,sites,batch):{results:batch.results,failures:[]}
  };
}

export function extensionSummary(results){
  const summary={},vases=results.filter(result=>result.report.construction==='sleeve').map(result=>({id:result.id,...result.report}));
  if(vases.length)summary.vaseWall={...vases[0],instances:vases};
  const weld=results.find(result=>result.id==='plastic-weld'&&Array.isArray(result.report.sites));
  if(weld)summary.plasticWeld=weld.report;
  return summary;
}
