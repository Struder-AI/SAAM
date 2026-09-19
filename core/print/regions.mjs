// Resolve explicit material assignments to existing skill results. Regions keep
// the native geometry and one shared operation/dependency/approval pipeline.
import {requireThat} from '../geom/tolerance.mjs';
import {sectionGeometry,topAt} from '../geom/query.mjs';
import {pointInRegion,pointSegmentDistance,regionArea,loopArea} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {strokeRegion} from '../region/stroke.mjs';
import {difference,union,intersect} from '../region/boolean.mjs';
import {fullFillResult,layerHeights} from '../../skills/full-fill/scripts/fill.mjs';
import {planarInfillResults} from '../../skills/planar-infill/scripts/infill.mjs';
import {vaseWallResult} from '../../skills/vase-wall/scripts/vase.mjs';
import {thickLipResult} from '../../skills/thick-lip/scripts/lip.mjs';
import {drapedSkinResult,surveySurface,machineMaxAngle,bodyTopAt} from '../../skills/draped-skin/scripts/drape.mjs';
import {spacingFactor} from '../path/spacing.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';
import {selectionsOverlap} from '../geom/selections.mjs';

const has=(record,name)=>Object.hasOwn(record.assignment.skills,name);
const planar=record=>has(record,'full-fill')||has(record,'planar-infill');
const ids=results=>results.flatMap(r=>r.operations.map(op=>op.id));
const inBounds=(x,y,b)=>x>=b.min[0]-1e-8&&x<=b.max[0]+1e-8&&y>=b.min[1]-1e-8&&y<=b.max[1]+1e-8;
const covered=(x,y,region)=>pointInRegion([x,y],region)||region.some(loop=>loop.some((p,i)=>pointSegmentDistance([x,y],p,loop[(i+1)%loop.length])<=1e-7));
const planarLayers=results=>results.flatMap(r=>r.operations).filter(op=>op.region&&op.strokes.length).map(op=>({region:op.region,materialRegion:op.materialRegion??op.region,coverage:op.materialCoverage??'area',z:op.strokes[0].points[0][2]}));

// Shared lattice support query, including translated components and deliberately
// separate supporting columns. A bridge uses the declared underlying lattice;
// it does not invent a deposited material surface in the intervening void.
export function planarSupportTopAt(supports,process) {
  const sampledSupports=supports.map(support=>({...support,
    layers:support.results?planarLayers(support.results).sort((a,b)=>b.z-a.z):null}));
  return (x,y,ceiling)=>{
    const candidates=[];
    for(const support of sampledSupports) {
      if(support.layers){
        for(const layer of support.layers)if(layer.z<=ceiling+1e-8&&covered(x,y,layer.region)){candidates.push(layer.z);break;}
        continue;
      }
      if(!inBounds(x,y,support.shell.bounds))continue;
      const top=topAt(support.shell,x,y);if(!top)continue;
      const z=bodyTopAt(Math.min(ceiling,top.zMm,support.end??Infinity),process,support.shell.bounds.min[2]);
      if(z<=ceiling+1e-8&&z>(support.start??support.shell.bounds.min[2])+1e-8)candidates.push(z);
    }
    if(candidates.length)return Math.max(...candidates);
    requireThat(supports.length,'No supporting region supplies a layer grid for this surface.');
    const origin=Math.min(...supports.map(s=>s.shell.bounds.min[2]));
    return bodyTopAt(ceiling,process,origin);
  };
}

function surfaceField(shell,query,step=0.5) {
  const [minX,minY]=shell.bounds.min,[maxX,maxY]=shell.bounds.max;
  const nx=Math.max(2,Math.ceil((maxX-minX)/step)),ny=Math.max(2,Math.ceil((maxY-minY)/step));
  const xs=Array.from({length:nx+3},(_,i)=>minX+(maxX-minX)*(i-1)/nx),ys=Array.from({length:ny+3},(_,i)=>minY+(maxY-minY)*(i-1)/ny);
  const values=xs.map(x=>ys.map(y=>query(x,y)));
  // The footprint bounds material ownership. Extend the numeric field outside
  // it to keep interpolation at its edge from introducing an artificial cliff.
  // Each pass fills the cells touching the previous pass's values, so the fill
  // walks its own front instead of sweeping the whole grid once per pass.
  const around=(i,j)=>[[i-1,j],[i+1,j],[i,j-1],[i,j+1]];
  let front=[];
  for(let i=0;i<xs.length;i++)for(let j=0;j<ys.length;j++)if(Number.isFinite(values[i][j]))front.push([i,j]);
  while(front.length) {
    const candidates=new Map();
    for(const [i,j] of front)for(const [a,b] of around(i,j))if(values[a]?.[b]===null)candidates.set(a*ys.length+b,[a,b]);
    const filled=[...candidates.values()].map(([i,j])=>[i,j,around(i,j).map(([a,b])=>values[a]?.[b]).filter(Number.isFinite)]);
    for(const [i,j,neighbors] of filled)values[i][j]=neighbors.reduce((a,b)=>a+b,0)/neighbors.length;
    front=filled.map(([i,j])=>[i,j]);
  }
  requireThat(values.every(row=>row.every(Number.isFinite)),'No complete material top can be published for this region.');
  return {xs,ys,values};
}

function publishSurface(record,results) {
  const {shell,start,end,plan,survey}=record;let footprint,query,kind,field,solidFootprint=null;
  if(has(record,'draped-skin')) {
    const spaced=spacingFactor(plan.skills['draped-skin'])>1;
    footprint=survey.skinRegion;
    if(spaced){
      // A spaced skin publishes its actual projected bead strips, not a filled
      // roof over the gaps. XY skin scanlines are straight even on a curved roof.
      const last=results.flatMap(r=>r.operations).filter(op=>op.phase==='draped-skin').at(-1),half=plan.process.lineWidthMm/2;
      const strips=last.strokes.map(stroke=>{
        const a=stroke.points[0],b=stroke.points.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(length<1e-9)return null;
        const dx=-(b[1]-a[1])*half/length,dy=(b[0]-a[0])*half/length;
        return [[a[0]-dx,a[1]-dy],[b[0]-dx,b[1]-dy],[b[0]+dx,b[1]+dy],[a[0]+dx,a[1]+dy]];
      }).filter(Boolean);
      footprint=intersect(footprint,union(strips,[]));
    }
    query=(x,y)=>{if(spaced&&!covered(x,y,footprint))return null;const top=topAt(shell,x,y);return top&&top.patch!=='bottom'&&top.slopeDeg<=survey.limitDeg+1e-8?top.zMm:null;};kind=spaced?'sparse':'area';
  } else if(has(record,'vase-wall')) {
    if(plan.skills['vase-wall'].endTransition!=='level')return null;
    if(plan.skills['vase-wall'].pattern!==null||plan.skills['vase-wall'].meshSleeve){
      const boundary=results.find(r=>r.levelBoundary)?.levelBoundary;
      if(!boundary)return null;
      const paths=[];
      for(const stroke of boundary.strokes){
        let path=[];
        for(let i=0;i<stroke.volumesMm3.length;i++){
          if(stroke.volumesMm3[i]>0){
            if(!path.length)path.push(stroke.points[i].slice(0,2));
            path.push(stroke.points[i+1].slice(0,2));
          }else if(path.length){paths.push(path);path=[];}
        }
        if(path.length)paths.push(path);
      }
      footprint=strokeRegion(paths,boundary.widthMm,{arcToleranceMm:plan.skills['vase-wall'].boundaryToleranceMm/4});
    }else{
      const section=sectionGeometry(shell,end).loops,outer=section.filter(loop=>loopArea(loop)>0);
      footprint=intersect(section,difference(outer,offsetRegion(outer,-plan.process.lineWidthMm)));
    }
    query=(x,y)=>covered(x,y,footprint)?end:null;kind='rim';
    // A constant plane needs no raster search for a narrow bead footprint.
    field={xs:[shell.bounds.min[0],shell.bounds.max[0]],ys:[shell.bounds.min[1],shell.bounds.max[1]],values:[[end,end],[end,end]]};
  } else if(has(record,'thick-lip')) {
    // A rolled/thickened rim is a terminal finish: nothing is expected to
    // print above it, so it publishes no consumable material top.
    return null;
  } else {
    const layers=planarLayers(results).sort((a,b)=>b.z-a.z);
    // A reserved process void can publish material completed by a later
    // operation. Consumers inherit that operation, so its mouth is usable as
    // a final surface without pretending the surrounding fill deposited it.
    for(const {completion:c} of shell.processReservations??[])if(c&&c.z>start+1e-8&&c.z<=end+1e-8)
      layers.push({z:c.z,region:c.region,materialRegion:c.region,coverage:'area'});
    layers.sort((a,b)=>b.z-a.z);
    query=(x,y)=>{for(const layer of layers)if(covered(x,y,layer.region))return layer.z;return null;};
    // Top ownership follows emitted solid masks and walls. Sparse interiors
    // remain explicitly sparse; a real solid top mask can publish area support.
    const topLevels=[...new Set(layers.map(layer=>layer.z))].sort((a,b)=>b-a);
    let seen=[],missing=[];solidFootprint=[];
    for(const z of topLevels){
      const same=layers.filter(layer=>layer.z===z),uniqueRegions=[...new Set(same.map(layer=>layer.region))];
      const envelope=uniqueRegions.reduce((area,region)=>union(area,region),[]);
      const newlyExposed=difference(envelope,seen);
      // A higher emitted surface already owns these XY locations. Lower solid
      // masks cannot change either their top or coverage classification.
      if(newlyExposed.length===0)continue;
      const solid=same.filter(layer=>layer.coverage==='area').reduce((area,layer)=>union(area,layer.materialRegion),[]);
      missing=union(missing,difference(newlyExposed,solid));seen=union(seen,envelope);
      solidFootprint=union(solidFootprint,intersect(newlyExposed,solid));
    }
    footprint=seen;
    kind=Math.abs(regionArea(missing))<=1e-5?'area':'sparse';
  }
  field??=surfaceField(shell,query,plan.skills['draped-skin'].surveyStepMm);
  return {footprint,solidFootprint:solidFootprint??footprint,topAt:query,field,
    sourceOperationIds:[...ids(results),...(shell.processReservations??[]).map(r=>r.completion).filter(c=>c&&c.z>start+1e-8&&c.z<=end+1e-8).map(c=>c.operationId)],kind,sourceRegionId:record.assignment.id};
}

export function prepareRegionRecords(plan,placed,componentShells) {
  const records=plan.composition.regions.map(assignment=>{
    const shell=componentShells?componentShells.get(assignment.part):placed;
    const localPlan=structuredClone(plan);localPlan.composition.regions=[];
    // A region with process overrides owns its own layer grid from its start Z.
    const ownsGrid=Object.hasOwn(assignment,'process');
    if(ownsGrid)Object.assign(localPlan.process,assignment.process);
    for(const [name,settings] of Object.entries(localPlan.skills)) {
      settings.enabled=Object.hasOwn(assignment.skills,name);
      if(settings.enabled)Object.assign(settings,assignment.skills[name]);
    }
    const start=shell.bounds.min[2]+assignment.zStartMm;
    // A rim finish generates its own geometry above its start Z and never
    // samples the modeled shell there, unlike every other region skill - so
    // it alone is exempt from needing real geometry to reach its own "end."
    // Leaving zEndMm null gives it a nominal one-layer span; a caller-given
    // zEndMm still must clear zStartMm, same as any other region.
    const isLip=Object.hasOwn(assignment.skills,'thick-lip');
    const end=assignment.zEndMm===null?(isLip?start+localPlan.process.layerMm:shell.bounds.max[2]):shell.bounds.min[2]+assignment.zEndMm;
    requireThat(start>=shell.bounds.min[2]-1e-8&&(isLip||end<=shell.bounds.max[2]+1e-8)&&end>start,'Region bounds exceed its selected native geometry.');
    return {assignment,shell,plan:localPlan,start,end,ownsGrid,after:new Set(),results:[]};
  });
  return records;
}

export function prepareRegionDependencies(prepared,machine,selections) {
  const records=prepared.map(record=>({...record,after:new Set(record.after)}));
  for(const record of records) {
    const {assignment}=record;
    if(assignment.lowerSurfaceFrom)record.after.add(assignment.lowerSurfaceFrom);
    if(has(record,'vase-wall'))requireThat(Object.keys(assignment.skills).length===1,'A continuous outer-wall region cannot also assign another wall or interior owner; use separate material regions.');
    if(has(record,'thick-lip'))requireThat(Object.keys(assignment.skills).length===1,'A rim finish cannot also assign another wall or interior owner; use a separate material region.');
    if(has(record,'full-fill')&&has(record,'planar-infill'))requireThat(record.plan.skills['full-fill'].mode==='solid-surfaces','Overlapping body fill and sparse fill require complementary solid-surfaces ownership.');
    for(const previous of records)if(previous!==record&&(selections
      ?selectionsOverlap(selections.get(previous.assignment.part),selections.get(assignment.part))
      :previous.assignment.part===assignment.part)) {
      const overlap=Math.min(previous.end,record.end)-Math.max(previous.start,record.start);
      requireThat(overlap<=1e-8||assignment.lowerSurfaceFrom===previous.assignment.id||previous.assignment.lowerSurfaceFrom===assignment.id,
        'Overlapping material regions need an explicit consumed lower surface; put complementary sparse and solid masks in one region.');
      if(previous.end<=record.start+1e-8)record.after.add(previous.assignment.id);
    }
    if(has(record,'draped-skin')) {
      const settings=record.plan.skills['draped-skin'],declared=machineMaxAngle(machine),limit=settings.maxAngleDegOverride??declared;
      record.survey=surveySurface(record.shell,settings,limit);
      Object.assign(record.survey,{declaredLimitDeg:declared,experimentalOverride:Boolean(machine.nonplanar?.experimental)||(settings.maxAngleDegOverride!==null&&settings.maxAngleDegOverride!==declared)});
    }
  }
  return records;
}

export function generateAssignedRegion(prepared,{plan,machine,records,byId,ordered,planarZ,onProgress}) {
  const record={...prepared,results:[]}, {assignment,shell,start,end}=record,localPlan=record.plan;
  const predecessors=[...record.after].map(id=>byId.get(id));
  const touching=predecessors.filter(p=>Math.abs(p.end-start)<=1e-8&&p.assignment.part===assignment.part);
  const lowerSurface=assignment.lowerSurfaceFrom?byId.get(assignment.lowerSurfaceFrom).surface:null;
  if(assignment.lowerSurfaceFrom) {
    requireThat(lowerSurface,'The referenced region does not publish a consumable material top; finish its boundary transition first.');
    const minimum=lowerSurface.field.values.reduce((best,row)=>row.reduce((min,z)=>Math.min(min,z),best),Infinity);
    // A planar consumer starts on a global horizontal layer grid. A curved
    // skin instead begins above its local support at each sampled stroke;
    // valleys outside its footprint must not constrain its bounding-box Z.
    if(planar(record))requireThat(start<=minimum+1e-6,'Consumer start skips material above the lower surface; start at or below its minimum height.');
  }
  if(start>shell.bounds.min[2]+1e-8&&!lowerSurface)requireThat(touching.length,'Region starts above unassigned material; assign its supporting region or consume a published lower surface.');
  for(const previous of touching)if(has(previous,'vase-wall')) {
    requireThat(previous.plan.skills['vase-wall'].endTransition==='level',`Region ${assignment.id} needs a level vase ending at its flat boundary; set region ${previous.assignment.id}'s vase-wall endTransition to level in the proposed recipe.`);
  }
  if(has(record,'thick-lip'))requireThat(touching.some(p=>has(p,'vase-wall')),`Region ${assignment.id} is a rim finish; it must sit directly above a level-ended vase-wall region on the same component.`);
  if(planar(record)||has(record,'vase-wall')) {
    if(record.ownsGrid){
      const span=end-start,{firstLayerMm,layerMm}=localPlan.process,index=(span-firstLayerMm)/layerMm;
      requireThat(lowerSurface||Math.abs(index-Math.round(index))<1e-8,'A flat region span must contain its first layer plus a whole number of local layer pitches.');
    } else {
      const relative=start-shell.bounds.min[2],index=(relative-plan.process.firstLayerMm)/plan.process.layerMm;
      requireThat(lowerSurface||relative<1e-8||Math.abs(index-Math.round(index))<1e-8,'A flat region boundary must align with the component layer grid.');
    }
  }
  const consumed=new Set();let source=assignment.lowerSurfaceFrom;
  while(source){consumed.add(source);source=byId.get(source).assignment.lowerSurfaceFrom;}
  const reserve=records.filter(r=>r.survey&&!consumed.has(r.assignment.id)&&r.end>=start-1e-8).map(r=>r.survey);
  const prefix=assignment.id;
  const layerOriginMm=record.ownsGrid?start:null;
  const firstZ=Number(((layerOriginMm??shell.bounds.min[2])+localPlan.process.firstLayerMm).toFixed(9));
  const layerIndexOffset=Math.max(0,planarZ.indexOf(firstZ));
  if(has(record,'planar-infill'))record.results.push(...planarInfillResults({shell,plan:localPlan,machine,reserve,id:prefix+':planar-infill',solid:has(record,'full-fill'),zStartMm:start,zEndMm:end,layerOriginMm,layerIndexOffset,lowerSurface}));
  else if(has(record,'full-fill'))record.results.push(fullFillResult({shell,plan:localPlan,machine,reserve,id:prefix+':full-fill',zStartMm:start,zEndMm:end,layerOriginMm,layerIndexOffset,lowerSurface}));
  if(has(record,'vase-wall')) {
    requireThat(!lowerSurface,'A vase foundation ring requires a flat lower boundary; use a planar transition region above the supplied surface.');
    const result=vaseWallResult({shell,plan:localPlan,machine,id:prefix+':vase-wall',zStartMm:start,zEndMm:end,onProgress});
    record.results.push(result);
  }
  if(has(record,'thick-lip')) {
    requireThat(!lowerSurface,'A rim finish requires a flat lower boundary; use a planar transition region above the supplied surface.');
    record.results.push(thickLipResult({shell,plan:localPlan,id:prefix+':thick-lip',zStartMm:start}));
  }
  if(has(record,'draped-skin')) {
    const supports=[...ordered,record].filter(r=>planar(r)).map(r=>({shell:r.shell,start:r.start,end:r.end,results:r.results}));
    const supportTopAt=lowerSurface?((x,y,ceiling)=>{
      const value=lowerSurface.topAt(x,y),z=typeof value==='number'?value:value?.zMm;
      // The nominal reserve is not the first deposited surface. A measured
      // support slightly above it gives a thinner first bead; samplePath
      // checks the actual positive deposition gap against that support.
      requireThat(Number.isFinite(z),'Drape lower surface does not cover the skin stroke.');return z;
    }):planarSupportTopAt(supports,plan.process);
    const skin=drapedSkinResult({shell,plan:localPlan,machine,survey:record.survey,id:prefix+':draped-skin',after:ids(record.results),supportTopAt});
    for(const op of skin.operations)for(const stroke of op.strokes)for(const point of stroke.points)
      requireThat(point[2]>start-1e-8&&point[2]<=end+1e-8,'Draped roof lies outside its assigned region; extend the region to include the actual roof and skin stack.');
    record.results.push(skin);
  }
  requireThat(record.results.some(result=>result.operations.some(op=>op.strokes.length)),'Assigned region produced no material.');
  const publishedResults=record.results.map(result=>{
    const wall=has(record,'vase-wall'),roof=result.operations.some(op=>op.phase==='draped-skin');
    if(wall&&(localPlan.skills['vase-wall'].pattern!=null||localPlan.skills['vase-wall'].meshSleeve))return result;
    return publishFinishedBoundary(result,{shell,startMm:start,endMm:end-(wall&&localPlan.skills['vase-wall'].endTransition!=='level'?plan.process.layerMm:0),
      boundary:wall?'side':roof?'top':'shell',maxSlopeDeg:record.survey?.limitDeg??90,
      coverage:result.operations.some(op=>op.materialCoverage==='sparse')||(roof&&localPlan.skills['draped-skin'].spacingFactor>1)?'sparse':'nominal'});
  });
  const prerequisiteIds=[...ids(predecessors.flatMap(p=>p.results)),...(lowerSurface?.sourceOperationIds??[])];
  record.results=publishedResults.map(result=>({...result,operations:result.operations.map(op=>({...op,
    regionId:assignment.id,after:[...new Set([...(op.after??[]),...prerequisiteIds])]}))}));
  record.surface=publishSurface(record,record.results);
  const summary={id:assignment.id,part:assignment.part,zStartMm:assignment.zStartMm,zEndMm:assignment.zEndMm,startMm:start,endMm:end,
    skills:Object.keys(assignment.skills),process:assignment.process??null,lowerSurfaceFrom:assignment.lowerSurfaceFrom,
    publishedSurface:record.surface?.kind??null,operationIds:ids(record.results)};
  return {record,summary};

}

export function summarizeRegionResults(results,records,summaries) {
  const full=results.filter(r=>r.id.includes(':full-fill')||r.id.endsWith(':solid')),sparse=results.filter(r=>r.id.endsWith(':planar-infill')),vases=results.filter(r=>r.id.endsWith(':vase-wall')),skins=results.filter(r=>r.id.endsWith(':draped-skin')),lips=results.filter(r=>r.id.endsWith(':thick-lip'));
  const aggregate=items=>Object.fromEntries([...new Set(items.flatMap(r=>Object.keys(r.report)))].filter(key=>items.every(r=>r.report[key]===undefined||typeof r.report[key]==='number')).map(key=>[key,items.reduce((sum,r)=>sum+(r.report[key]??0),0)]));
  const summary={regions:summaries};
  if(full.length)summary.fullFill={...aggregate(full),instances:full.map(r=>({id:r.id,...r.report}))};
  if(sparse.length)summary.planarInfill={instances:sparse.map(r=>({id:r.id,...r.report}))};
  if(vases.length)summary.vaseWall={...vases[0].report,instances:vases.map(r=>({id:r.id,...r.report}))};
  if(skins.length)summary.drapedSkin={...aggregate(skins),instances:skins.map(r=>({id:r.id,...r.report}))};
  if(lips.length)summary.thickLip={instances:lips.map(r=>({id:r.id,...r.report}))};
  const surveys=records.filter(r=>r.survey).map(r=>r.survey);
  if(surveys.length)summary.nonplanarLimit={machineMaxAngleDeg:surveys[0].declaredLimitDeg,effectiveMaxAngleDeg:Math.max(...surveys.map(s=>s.limitDeg)),experimentalOverride:surveys.some(s=>s.experimentalOverride),surfaceMaxSlopeDeg:Math.max(...surveys.map(s=>s.maxSlopeDeg)),excludedAreaPercent:Math.max(...surveys.map(s=>s.steepFraction))*100};
  return summary;
}

export function generateRegionResults({plan,machine,placed,componentShells,selections,onProgress}) {
  const prepared=prepareRegionRecords(plan,placed,componentShells);
  // Compute the shared lattice before dependency validation, retaining validation order.
  const records=prepared;
  const planarZ=[...new Set(records.filter(planar).flatMap(record=>{
    const origin=record.ownsGrid?record.start:record.shell.bounds.min[2];
    return layerHeights(record.plan.process,origin,record.end).filter(z=>z>record.start+1e-9).map(z=>Number(z.toFixed(9)));
  }))].sort((a,b)=>a-b);
  const dependencies=prepareRegionDependencies(prepared,machine,selections);
  const byId=new Map(dependencies.map(record=>[record.assignment.id,record]));
  const results=[],completed=new Set(),ordered=[],summaries=[];
  while(completed.size<dependencies.length) {
    const ready=dependencies.filter(r=>!completed.has(r.assignment.id)&&[...r.after].every(id=>completed.has(id))).sort((a,b)=>a.start-b.start||dependencies.indexOf(a)-dependencies.indexOf(b));
    requireThat(ready.length,'Region surface/dependency references contain a cycle.');
    const generated=generateAssignedRegion(ready[0],{plan,machine,records:dependencies,byId,ordered,planarZ,onProgress});
    const {record,summary}=generated;
    byId.set(record.assignment.id,record);
    results.push(...record.results);ordered.push(record);completed.add(record.assignment.id);summaries.push(summary);
  }
  return {results,summary:summarizeRegionResults(results,dependencies,summaries)};
}
