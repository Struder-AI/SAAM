// One matched curve-pair construction; source edges own all attachment identity.
import {addSupportBrim} from './brim.mjs';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const positive=(value,name)=>{check(Number.isFinite(value)&&value>0,name+' must be positive.');return value;};

export async function buildBridgeSupport(spec,process,Geometry,{normal,outwardSide=1}={}){
  const width=positive(spec.beadWidthMm??process.lineWidthMm,'beadWidthMm'),speed=positive(spec.speedMmS??process.planarSpeedMmS,'speedMmS');
  const pair=Geometry.curvePairSurface(spec.base,spec.landing,{correspondence:spec.correspondence,normal});
  check(normal?.length===3,'Support construction needs its material advance normal.');
  const target=positive(spec.layerHeightMm??process.layerMm,'layerHeightMm');
  const divisions=Math.max(1,Math.round(positive(pair.averageAdvanceMm,'Average curve separation')/target)),heightMm=pair.averageAdvanceMm/divisions;
  check(Number.isSafeInteger(divisions),'Curve divisions exceed integer representation.');
  const curves=[];
  for(let i=0;i<divisions;i++){
    const first=pair.curveAt((i+1)/divisions);
    const second=await Geometry.ribbon({curve:first,vertical:normal,depthMm:outwardSide*width});
    check(second.curves.length===1,'The adjacent support loop split or collapsed; select corresponding retained edge pieces.');
    // The course ribbon supplies material normals, rather than treating the
    // vertical wall's surface normal as its stacking direction.
    const reference=Geometry.curvePairSurface(first,second.curves[0],{normal}).surface;
    for(const side of [0,1])curves.push({id:`loop-${i}-${side}`,closed:false,
      uv:{reference:{kind:'surface',surface:reference},points:[[0,side],[1,side]]},
      role:'breakaway-support',directionRequired:false,seamRequired:false,beadWidthMm:width,heightMm,speedMmS:speed,
      sampleStepMm:positive(spec.sampleStepMm??width/2,'sampleStepMm'),repetitions:[i]});
  }
  const repetitionIds=Array.from({length:divisions},(_,i)=>`course-${i}`);
  const assignment={id:spec.id,construction:'curves',part:spec.part??null,filament:null,process:null,after:[],curves,
    repeat:{count:divisions,translation:[0,0,0]},sequence:false,ordered:false,repetitionIds,
    repetitionAfter:Object.fromEntries(repetitionIds.slice(1).map((name,i)=>[name,[repetitionIds[i]]])),maxExcursionMm:null,
    toolPose:{alignToSliceNormal:true}};
  return {assignment,report:{id:spec.id,courses:divisions,loops:2,requestedLayerHeightMm:target,averageCourseSpacingMm:heightMm,lastOperationId:`${spec.id}:${repetitionIds.at(-1)}`}};
}

export async function editBridgeSupports(source,request,Geometry){
  check(request&&Object.keys(request).join()==='supports'&&Array.isArray(request.supports)&&request.supports.length,'Supply a nonempty supports array.');
  const Recipe=Geometry.Recipe;check(Recipe?.selectEdge&&Recipe?.withOperationAfter,'Supports need the shared printed-edge interface.');
  const prior=source.slices?.assignments??[],ids=new Set(prior.map(assignment=>assignment.id)),made=[];
  const shift=(curve,delta)=>curve.points?{...curve,points:curve.points.map(point=>point.map((v,k)=>v+delta[k]))}:
    {...curve,nurbs:{...curve.nurbs,controlPoints:curve.nurbs.controlPoints.map(point=>point.map((v,k)=>k<3?v+delta[k]:v))}};
  for(const spec of request.supports){
    check(Object.keys(spec).every(key=>['id','base','landing','correspondence','layerHeightMm','beadWidthMm','sampleStepMm','speedMmS','baseSide','landingSide'].includes(key)),'Select printed base/landing edges, or an explicit plate base with its curve.');
    check(typeof spec.id==='string'&&/^[a-z][a-z0-9-]*$/.test(spec.id)&&!ids.has(spec.id),'Choose an unused lowercase support id.');ids.add(spec.id);
    const landing=await Recipe.selectEdge(spec.landing);check(landing.reference,'A support landing must identify its future printed edge.');
    const baseOnBed=spec.base?.kind==='plate';
    check(!baseOnBed||Object.keys(spec.base).sort().join()==='curve,kind','A plate base supplies kind and curve.');
    const base=baseOnBed?{curve:spec.base.curve,reference:null}:await Recipe.selectEdge(spec.base);
    check(baseOnBed||base.reference,'A printed base must identify its manufactured edge.');
    check(baseOnBed||(base.reference.part??null)===(landing.reference.part??null),'Support base and landing must use the same part frame.');
    const normal=landing.materialNormal;check(normal?.length===3,'The landing needs a material normal.');
    const process={...source.process,...landing.process},width=positive(spec.beadWidthMm??process.lineWidthMm,'beadWidthMm');
    const baseSide=spec.baseSide??1,landingSide=spec.landingSide??1;
    check([1,-1].includes(baseSide)&&[1,-1].includes(landingSide),'Edge sides are right (1) or left (-1) of travel, seen along the material normal.');
    if(baseOnBed){
      const samples=Geometry.sampleSpatialCurve(base.curve,{toleranceMm:Geometry.resolutionMm,sampleStepMm:width/2}).samples;
      check(samples.every(sample=>Math.abs(sample.point[2])<=Geometry.resolutionMm),'An explicit plate base must lie on the canonical build plate.');
    }
    const outside=async(edge,side)=>{
      const offset=await Geometry.ribbon({curve:edge.curve,vertical:normal,depthMm:side*((edge.widthMm??width)+width)/2});
      check(offset.curves.length===1,'Selected edge offset split; select a retained support edge.');return offset.curves[0];
    };
    const lower=baseOnBed?base.curve:await outside(base,baseSide),upper=shift(await outside(landing,landingSide),normal.map(v=>-v*(landing.heightMm??landing.process.layerMm??process.layerMm)));
    const built=await buildBridgeSupport({...spec,part:landing.reference.part??null,base:lower,landing:upper},process,Geometry,{normal,outwardSide:landingSide});
    built.assignment.operationAfter=base.reference?{[built.assignment.repetitionIds[0]]:[base.reference]}:{};
    made.push({...built,baseOnBed,landing:landing.reference,base:base.reference});
  }
  for(const entry of made)entry.report.brim=await addSupportBrim(entry.assignment,source,Geometry,{baseOnBed:entry.baseOnBed,component:null,otherAssignments:[...prior,...made.map(item=>item.assignment)]});
  let assignments=[...prior,...made.map(item=>item.assignment)];
  for(const entry of made)assignments=Recipe.withOperationAfter(assignments,entry.landing,[entry.report.lastOperationId]);
  return {assignmentRequests:assignments,report:{supports:made.map(entry=>({...entry.report,base:entry.base??{kind:'plate'},landing:entry.landing}))}};
}
