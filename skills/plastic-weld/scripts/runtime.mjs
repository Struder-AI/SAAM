// Plastic weld composes public region, slice, evaluation and injection operations.
// The selected extension copy owns the technique; it has no release-relative imports.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// Heights (layer grid, rivet bottom and top, stroke levels) coincide and height
// ranges overlap to print resolution; an overlap below a print-resolution square is none.
export const PLASTIC_WELD_DEFAULTS={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:0.8,seatDepthMm:0,volumeFactor:1,flowMm3S:0.5,holdSeconds:1,nozzleC:null};
const positive=(v,name)=>requireThat(Number.isFinite(v)&&v>0,'plastic-weld '+name+' must be positive.');

export function validatePlasticWeld(plan){
  const s=plan.skills['plastic-weld'];
  requireThat(typeof s.enabled==='boolean'&&Array.isArray(s.sites),'plastic-weld needs an enabled flag and sites array.');
  for(const k of ['shaftDiameterMm','basinDiameterMm','basinHeightMm','wallMm','floorMm','volumeFactor','flowMm3S'])positive(s[k],k);
  requireThat(Number.isFinite(s.holdSeconds)&&s.holdSeconds>=0,'Rivet hold must be nonnegative.');
  requireThat(Number.isFinite(s.seatDepthMm)&&s.seatDepthMm>=0,'Rivet seat depth must be nonnegative.');
  if(s.nozzleC!==null)requireThat(Number.isFinite(s.nozzleC)&&s.nozzleC>=0,'Authored nozzle temperature must be finite and nonnegative.');
  const ids=new Set();
  for(const site of s.sites){
    requireThat(site&&Object.keys(site).sort().join()==='id,part,xMm,yMm,zBottomMm,zTopMm','Rivet sites need exactly id, part, xMm, yMm, zBottomMm and zTopMm.');
    requireThat(typeof site.id==='string'&&/^[a-z][a-z0-9-]*$/.test(site.id)&&!ids.has(site.id),'Invalid or duplicate rivet site ID.');ids.add(site.id);
    requireThat(['xMm','yMm','zBottomMm','zTopMm'].every(k=>Number.isFinite(site[k])),'Rivet coordinates must be finite.');
    requireThat(site.zBottomMm>=0&&site.zTopMm>site.zBottomMm,'A rivet needs its bottom within its component and its opening above it.');
  }
}

export const plasticWeldRecordRuntime=()=>({validatePlasticWeld});

// Explicit sites can be spatially staggered while their height ranges overlap.
// This authoring helper returns ordinary locked sites, not a second recipe.
export function staggeredWeldSites({columns,rows,levels,pitchMm=12,heightStepMm=3,depthMm=4,
  xMm=4,yMm=4,zBottomMm=0.8,part=null}){
  requireThat([columns,rows,levels].every(n=>Number.isSafeInteger(n)&&n>0)&&Number.isSafeInteger(columns*rows*levels),'Invalid rivet grid size.');
  [pitchMm,heightStepMm,depthMm].forEach(v=>positive(v,'grid spacing/depth'));
  return Array.from({length:levels},(_,k)=>Array.from({length:rows},(_,j)=>Array.from({length:columns},(_,i)=>({
    id:`rivet-${k}-${j}-${i}`,part,xMm:xMm+(i+(k%2)/2)*pitchMm,yMm:yMm+j*pitchMm,
    zBottomMm:zBottomMm+k*heightStepMm,zTopMm:zBottomMm+k*heightStepMm+depthMm
  })))).flat(2);
}

export function plasticWeldRuntime({Geometry,Recipe,Toolpath}) {
  const {difference,union,regionArea,pointSegmentDistance,horizontalSlice,sliceStack,evaluateSurface,intersect}=Geometry;
  const {pointInjectionOperation}=Toolpath;
  const {assignmentFilament}=Recipe;
  const circle=(x,y,r)=>[Array.from({length:96},(_,i)=>[x+r*Math.cos(i*2*Math.PI/96),y+r*Math.sin(i*2*Math.PI/96)])];
  const area=r=>Math.abs(regionArea(r));
  const height=op=>op.strokes.reduce((h,s)=>s.points.reduce((z,p)=>Math.max(z,p[2]),h),-Infinity);

// -> {sites, notes}: a site that cannot be prepared is left out and noted.
function preparePlasticWeld({plan,placed,componentShells,processForAssignment}){
  const settings=plan.skills?.['plastic-weld'];if(!settings?.enabled)return {sites:[],notes:[]};
  // The widest cavity section bounds its envelope, whichever end is wider.
  const widest=Math.max(settings.basinDiameterMm,settings.shaftDiameterMm)/2,notes=[];
  const sites=settings.sites.flatMap(site=>{try{return [prepareSite(site)];}catch(error){notes.push(`Rivet ${site.id} produces nothing: ${error.message}`);return [];}});
  return {sites,notes};
  function prepareSite(site){
    requireThat(componentShells?componentShells.has(site.part):site.part===null,'Rivet site must select its native component.');
    const assignment={id:'plastic-weld:'+site.id,part:site.part,construction:'inject',filament:assignmentFilament(plan,{id:'plastic-weld:'+site.id,part:site.part}),process:null};
    const process=processForAssignment({part:site.part});
    const shell=componentShells?componentShells.get(site.part):placed;
    const component=componentShells?plan.geometry.parts.find(p=>p.id===site.part):null;
    const x=(component?.xMm??0)+site.xMm,y=(component?.yMm??0)+site.yMm;
    // Bottom and opening take the nearest layer of the component's grid; an
    // opening above the component takes its top layer. Moves are noted.
    const min=shell.bounds.min[2],first=min+process.firstLayerMm;
    const onGrid=z=>{const k=Math.round((z-first)/process.layerMm);return k>=0?first+k*process.layerMm:z-min<process.firstLayerMm/2?min:first;};
    const last=first+Math.floor((shell.bounds.max[2]-first+PRINT_RESOLUTION_MM)/process.layerMm)*process.layerMm;
    const bottom=onGrid(min+site.zBottomMm),top=Math.min(onGrid(min+site.zTopMm),last);
    requireThat(top>bottom+PRINT_RESOLUTION_MM,`Rivet ${site.id} has no depth on its component's layer grid.`);
    // A seated nozzle reaching the floor would strike it.
    requireThat(settings.seatDepthMm<top-bottom-PRINT_RESOLUTION_MM,`Rivet ${site.id}: the nozzle seated ${settings.seatDepthMm} mm deep would strike its floor ${(top-bottom).toFixed(3)} mm down; reduce seatDepthMm.`);
    const notes=Math.max(Math.abs(bottom-min-site.zBottomMm),Math.abs(top-min-site.zTopMm))>PRINT_RESOLUTION_MM?
      [`Rivet ${site.id}: placed on the component's layer grid, Z ${(bottom-min).toFixed(3)} to ${(top-min).toFixed(3)} mm above its base (authored ${site.zBottomMm} to ${site.zTopMm}).`]:[];
    const radiusAt=z=>settings.shaftDiameterMm/2+(settings.basinDiameterMm-settings.shaftDiameterMm)/2*Math.max(0,1-(z-bottom)/settings.basinHeightMm);
    // The maximum radius over each bead's height preserves a printable stepped
    // cavity. Meter its actual polygonal volume, not an ideal cone's volume.
    const regionAt=z=>z>bottom+PRINT_RESOLUTION_MM&&z<=top+PRINT_RESOLUTION_MM?circle(x,y,radiusAt(z-process.layerMm)):[];
    const footprint=circle(x,y,widest);
    const solidRegionAt=z=>z>bottom-settings.floorMm+PRINT_RESOLUTION_MM&&z<=top+PRINT_RESOLUTION_MM?
      difference(circle(x,y,widest+settings.wallMm),regionAt(z)):[];
    const completion={z:top,region:regionAt(top),operationId:'plastic-weld:'+site.id};
    // Slice owners of the part yield the cavity and fill the envelope solid.
    const reservation={part:site.part,footprint,regionAt,solidRegionAt,completion};
    return {...site,x,y,bottom,top,shell,regionAt,radiusAt,widest,settings,reservation,assignment,process,notes};
  }
}

// The enclosure's exact reference levels and required material are shared by
// dependency preparation and the authoritative finalized-material check.
function rivetEnclosureLayers(site,process){
  const {settings:s,shell,x,y,bottom,top}=site;
  return sliceStack({base:horizontalSlice(shell.bounds.min[2]),pitchMm:process.layerMm,firstLayerMm:process.firstLayerMm},
    {min:shell.bounds.min,max:[shell.bounds.max[0],shell.bounds.max[1],top]}).layers.map(layer=>layer.slice.origin[2]).filter(z=>z>bottom-s.floorMm+PRINT_RESOLUTION_MM).map(z=>{
      const cavity=site.regionAt(z),outer=circle(x,y,(z<=bottom+PRINT_RESOLUTION_MM?site.widest:site.radiusAt(z-process.layerMm))+s.wallMm);
      return {z,cavity,required:cavity.length?difference(outer,cavity):outer};
    });
}

function rivetInjectionResult({plan,site,modelResults,siteIndex=0,siteCount=1}){
  const model=modelResults.flatMap(r=>r.operations);
  const planarLayers=new Map();
  for(const op of model)if(op.region&&op.materialCoverage==='area'){
    const key=height(op).toFixed(7);
    if(!planarLayers.has(key))planarLayers.set(key,{operations:[]});
    planarLayers.get(key).operations.push(op);
  }
  const {settings:s,shell,x,y,bottom,top}=site;
  const hostIds=new Set(),open=[];let cavityVolumeMm3=0;
  const hostProcess=site.process??plan.process;
  for(const {z,cavity,required} of rivetEnclosureLayers(site,hostProcess)){
    const layer=planarLayers.get(z.toFixed(7)),candidates=layer?.operations??[];
    const supplied=layer?(layer.region??=union(candidates.flatMap(op=>op.materialRegion??[]),[])):[];
    if(area(difference(required,supplied))>0.01)open.push(z);
    for(const op of candidates)hostIds.add(op.id);
    cavityVolumeMm3+=area(cavity)*hostProcess.layerMm;
  }
  // An incomplete enclosure or floor is shown and noted: the injection can leak there.
  const floorShortMm=shell.bounds.min[2]-(bottom-s.floorMm);
  const notes=[...(open.length?[`Rivet ${site.id}: solid enclosing material or floor is missing at ${open.length} layer(s), Z ${open[0].toFixed(3)} to ${open.at(-1).toFixed(3)} mm; the injection can leak there. Assign a solid host region or move the site into solid material.`]:[]),
    ...(floorShortMm>PRINT_RESOLUTION_MM?[`Rivet ${site.id}: its floor is ${floorShortMm.toFixed(3)} mm thinner than floorMm; the component's base closes the cavity.`]:[])];
  const id='plastic-weld:'+site.id,layer=Math.round((top-shell.bounds.min[2]-hostProcess.firstLayerMm)/hostProcess.layerMm);
  const after=[...hostIds];
  const volumeMm3=cavityVolumeMm3*s.volumeFactor;
  const layerZ=shell.bounds.min[2]+hostProcess.firstLayerMm+layer*hostProcess.layerMm;
  const operation=pointInjectionOperation({point:[x,y,top-s.seatDepthMm],volumeMm3,
    flowMm3S:s.flowMm3S,holdSeconds:s.holdSeconds,approachMm:s.seatDepthMm},
    {id,phase:'plastic-weld',layer,layerIndex:siteIndex,layerCount:siteCount,layerId:'planar:'+layerZ,rank:top,after,plan,nozzleC:s.nozzleC,role:'plastic-rivet'});
  const report={id:site.id,part:site.part,positionMm:[x,y,top-s.seatDepthMm],openingMm:top,bottomMm:bottom,cavityVolumeMm3,volumeMm3,
    nozzleC:s.nozzleC??plan.setup.nozzleC,flowMm3S:s.flowMm3S};
  return {id:'plastic-weld',operations:[operation],report:{depositionFamily:'inject',sites:[report],physicalValidation:'not performed',...(notes.length?{notes}:{})}};
}

// Audit every finalized producer, including later covers and continuous paths.
// A seated nozzle enters the shaft down to top-seatDepthMm: material deposited
// there before injection would be struck, which stops generation. Other material
// inside the cavity is shown and noted; the metered volume assumes it empty.
function rivetClearanceNotes({plan,sites,modelResults}){
  const model=modelResults.flatMap(result=>result.operations),notes=[],failures=[];
  for(const site of sites){
    const {settings:s,x,y,bottom,top}=site,entry=top-s.seatDepthMm;
    for(const op of model){
      // Operations reaching above the opening wait for injection (weldOperationDependencies).
      const later=op.strokes.some(stroke=>stroke.points.some(p=>p[2]>top+PRINT_RESOLUTION_MM));let inside=false;
      for(const stroke of op.strokes){
        const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points,width=stroke.beadWidthMm??plan.process.lineWidthMm;
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],lo=Math.min(a[2],b[2]),hi=Math.max(a[2],b[2]);
          if(hi<=bottom+PRINT_RESOLUTION_MM||lo>top+PRINT_RESOLUTION_MM)continue;
          // Planar owners reserved the precise cavity; curved paths are bounded
          // conservatively by the widest cavity section including bead width.
          // Process scale: 0.025 mm slack for the owner's offset beads against the 96-gon cavity.
          const intrudes=op.region&&Math.abs(a[2]-b[2])<PRINT_RESOLUTION_MM?
            pointSegmentDistance([x,y],a,b)<site.radiusAt(a[2]-(site.process??plan.process).layerMm)+width/2-0.025:
            pointSegmentDistance([x,y],a,b)<=site.widest+width/2;
          if(!intrudes)continue;
          if(!later&&hi>entry+PRINT_RESOLUTION_MM&&!failures.some(f=>f.assignment===site.assignment.id))failures.push({assignment:site.assignment.id,
            message:`Operation ${op.id} deposits inside rivet ${site.id} above the seated nozzle tip at Z ${entry.toFixed(3)} mm, which would strike it; reduce seatDepthMm or separate the operation's region.`});
          inside=true;
        }
      }
      if(inside)notes.push(`Rivet ${site.id}: operation ${op.id} deposits inside its cavity; the injected volume assumes an empty cavity.`);
    }
  }
  return {notes,failures};
}

function weldWork(sites,processForAssignment){
  return sites.map((site,index)=>({
    key:'rivet:'+site.id,kind:'inject',construction:'rivet',sourceId:site.assignment.id,part:site.part,nominalRank:site.top,index,
    context:{site,siteCount:sites.length,assignment:site.assignment},requires:[],operationDependencies:false,
    construct:({node,plan,predecessors})=>rivetInjectionResult({plan:{...plan,process:processForAssignment(node.context.assignment)},
      site,siteIndex:index,siteCount:sites.length,modelResults:predecessors.filter(item=>item.node.construction!=='rivet').map(item=>item.result)})
  }));
}
function weldDependencies(node,nodes){
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
        const points=layer.region.map(loop=>loop.map(uv=>evaluateSurface(layer.slice,uv).point)),flat=points.flat();
        return flat.length&&enclosure.some(({z,required})=>z>=Math.min(...flat.map(p=>p[2]))-PRINT_RESOLUTION_MM&&z<=Math.max(...flat.map(p=>p[2]))+PRINT_RESOLUTION_MM&&Math.abs(regionArea(intersect(points.map(loop=>loop.map(p=>p.slice(0,2))),required)))>PRINT_RESOLUTION_MM**2);
      }))needs.add(other.key);
    }

  }
  return [...needs];
}

function weldOperationDependencies(sites,operation){
  return sites.filter(site=>operation.id!==site.reservation.completion.operationId&&operation.strokes.some(stroke=>stroke.points.some(p=>p[2]>site.top+PRINT_RESOLUTION_MM)))
    .map(site=>site.reservation.completion.operationId);
}

// -> {results, failures}: a rivet the nozzle would strike fails as its own
// assignment, and the print is generated again without it.
function finishWeldResults(plan,sites,{results,workResults:injections}){
  const material=results.filter(result=>!injections.includes(result)),injected=injections.filter(result=>result.operations.length);
  const produced=sites.filter(site=>injected.some(result=>result.report.sites?.some(report=>report.id===site.id)));
  const clearance=rivetClearanceNotes({plan,sites:produced,modelResults:material});
  const notes=[...produced.flatMap(site=>site.notes),...injected.flatMap(result=>result.report.notes??[]),...clearance.notes];
  if(injected.length)material.push({id:'plastic-weld',operations:injected.flatMap(result=>result.operations),report:{depositionFamily:'inject',sites:injected.flatMap(result=>result.report.sites??[]),physicalValidation:'not performed',...(notes.length?{notes}:{})}});
  return {results:material,failures:clearance.failures};
}

  return {preparePlasticWeld,weldWork,weldDependencies,
    weldOperationDependencies,finishWeldResults};
}
