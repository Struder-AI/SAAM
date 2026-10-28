// Extension compositions prepare geometry, material intent and work dependencies.
// The build owns execution and the bundle.
import {loadExtensionEntry} from '../core/extensions/library.mjs';

async function depositionRuntime(id,engines,dependency){
  try{const create=await loadExtensionEntry(id,'deposition-runtime');return {runtime:await create(engines,dependency),error:null};}
  catch(error){if(error.name==='AbortError')throw error;return {runtime:null,error};}
}

export function extensionMaterialBands(contexts){
  return contexts.filter(({assignment})=>assignment.construction==='sleeve'&&!assignment.join).map(({assignment,shell})=>({
    sourceId:assignment.id,part:assignment.part,startMm:shell?shell.bounds.min[2]+assignment.zStartMm:0,
    endMm:shell?(assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm):0}));
}

export async function extensionDeposition({plan,componentShells,shells,volumes,sources,contexts,bands,engines}){
  const hasSleeve=contexts.some(({assignment})=>assignment.construction==='sleeve'||assignment.join);
  const vaseLoaded=hasSleeve?await depositionRuntime('vase-wall',engines):{runtime:null,error:null};
  const vase=vaseLoaded.runtime;
  const advancedLoaded=contexts.some(({assignment})=>assignment.construction==='sleeve'&&assignment.pattern!==null)?await depositionRuntime('advanced-vase-wall',engines,vase):{runtime:null,error:null};
  const advanced=advancedLoaded.runtime;
  // A sleeve prepares its geometry as it is constructed, so its failure is its own.
  const vaseWork=args=>{
    if(vaseLoaded.error)throw vaseLoaded.error;
    const {node,onProgress}=args;
    const patterned=node.context.assignment.pattern!==null;
    if(patterned&&advancedLoaded.error)throw advancedLoaded.error;
    const geometry=node.context.geometry??vase.prepareSleeveGeometry({...node.context,onProgress});
    // The sleeve declares only what its recipe names. What its first turn rests
    // on is the Scheduler's to qualify; later turns rest on the sleeve itself.
    const after=node.context.assignment.after??[];
    const result=patterned?advanced.advancedVaseResult({...node.context,geometry,after,onProgress}):vase.standardVaseResult({...node.context,geometry,after});
    // A sleeve is a stack: its producer owns its support design, so the
    // Scheduler only orders it after the material beneath its first turn.
    return {...result,operations:result.operations.map(operation=>({...operation,foundation:'stack'}))};
  };
  const sleeves=contexts.filter(({assignment})=>assignment.construction==='sleeve'||assignment.join).map(context=>{
    if(context.assignment.join){
      // A spiral boundary that cannot be resolved fails as its own assignment.
      const prepared=(()=>{try{return engines.MaterialRegions.prepareSliceBoundaryStack({plan,assignment:context.assignment,shells,volumes,sources});}catch(error){return {error};}})();
      if(prepared.error)return {...context,construct:()=>{throw prepared.error;},kind:'trace'};
      const referenceStack=prepared.referenceStack,first=referenceStack.layers[0];
      return {...context,assignment:{...context.assignment,construction:'sleeve',pattern:null,zStartMm:0,endTransition:context.assignment.join.levelEnd?'level':'rising',toleranceMm:engines.Geometry.dimensions.CHORD_TOLERANCE_MM,boundaryToleranceMm:engines.Geometry.dimensions.CHORD_TOLERANCE_MM,meshSleeve:null},
        startMm:prepared.startMm,endMm:prepared.endMm,geometry:{referenceStack:()=>referenceStack,firstHeight:first.heightMm,start:prepared.startMm,base:prepared.startMm,end:prepared.endMm,
          speedMmS:context.process.planarSpeedMmS,role:'spiral',batch:{key:'spiral',layerId:context.assignment.id+':spiral',phase:'spiral'},terminalBoundary:false,report:()=>({join:'spiral',reference:'owned-region'})},
        construct:vaseWork,kind:'trace'};
    }
    const {assignment,shell}=context;
    if(!shell)return {...context,startMm:0,endMm:0,construct:()=>{throw Error('A sleeve construction needs selected geometry.');},kind:'trace'};
    const band=bands.find(band=>band.sourceId===assignment.id&&band.part===assignment.part);
    return {...context,startMm:band.startMm,endMm:band.endMm,construct:vaseWork,kind:'trace'};
  });
  for(const context of sleeves)context.prepare=current=>{
    if(vaseLoaded.error)throw vaseLoaded.error;
    const prepared=current.geometry??vase.prepareSleeveGeometry(current),stack=prepared.referenceStack();
    const geometry={...prepared,referenceStack:()=>stack},parts=current.assignment.part===null&&componentShells?[null,...componentShells.keys()]:[current.assignment.part];
    // A continuous wall owns its side frontier. An open pattern advertises
    // its terminal boundary only; its guiding sheet is not filled material.
    const preparedLayers=stack.layers.map(layer=>({...layer,region:layer.curves.map(curve=>curve.points.map(point=>{
      const p=point.map((value,k)=>value-layer.slice.origin[k]);
      return [layer.slice.xAxis,layer.slice.yAxis].map(axis=>axis.reduce((sum,value,k)=>sum+value*p[k],0));
    }))}));
    const selected=current.assignment.pattern===null?preparedLayers:preparedLayers.slice(-1),layers=selected.map(layer=>{
      const {origin,xAxis,normal}=layer.slice,yAxis=layer.slice.yAxis;
      const loops=engines.Geometry.widenPlanarStrokes(layer.curves,current.process.lineWidthMm/2,{origin,xAxis,normal,arcToleranceMm:engines.Geometry.resolutionMm});
      const project=point=>{const p=point.map((v,k)=>v-origin[k]);return [p.reduce((sum,v,k)=>sum+v*xAxis[k],0),p.reduce((sum,v,k)=>sum+v*yAxis[k],0)];};
      return {...layer,region:loops.map(loop=>loop.map(project)),direction:stack.direction};
    });
    return {...current,geometry,...(current.assignment.endTransition==='level'&&geometry.terminalBoundary!==false?
      {preparedSurfaces:{...stack,layers:preparedLayers,prerequisite:{assignment:current.assignment.id,part:current.assignment.part}}}:{}),
      materialSurfaces:parts.map(part=>({part,reference:{assignment:current.assignment.id,part:current.assignment.part},layers}))};
  };
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
  return {curveSources,constructions:sleeves};
}

export function extensionSummary(results){
  const summary={},vases=results.filter(result=>result.report.construction==='sleeve').map(result=>({id:result.id,...result.report}));
  if(vases.length)summary.vaseWall={...vases[0],instances:vases};
  const reports=results.flatMap(result=>result.report.extension?.id?[result.report.extension]:[]);
  if(reports.length)summary.extensions=Object.fromEntries([...new Set(reports.map(r=>r.id))].map(id=>[id,reports.filter(r=>r.id===id).map(r=>({sourceId:r.sourceId,...r.report}))]));
  return summary;
}
