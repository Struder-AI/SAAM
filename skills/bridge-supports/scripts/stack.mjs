// Match curve controls, interpolate them, and hand ordinary curves to Trace.
import {addSupportBrim} from './brim.mjs';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const positive=(v,name)=>{check(Number.isFinite(v)&&v>0,`${name} must be positive and finite.`);return v;};
const xyz=p=>p.slice(0,3).map(v=>v/p[3]);
const EDGE_CONTACT_FRACTION=0.5;
export async function buildBridgeSupport(spec,process={},Geometry,{geometry,baseOnBed=false}={}){
  check(spec&&Object.keys(spec).every(k=>['id','part','base','landing','correspondence','layerHeightMm','beadWidthMm','sampleStepMm','speedMmS','after'].includes(k)),'Unknown bridge-support setting.');
  check(typeof spec.id==='string'&&/^[a-z][a-z0-9-]*$/.test(spec.id),'Support id must be lowercase hyphenated.');
  check(spec.after===undefined||Array.isArray(spec.after)&&spec.after.every(id=>typeof id==='string'&&id.length),'after names exact preceding operation IDs.');
  const mapping=spec.correspondence??{};
  check(Object.keys(mapping).every(k=>['baseDirection','landingDirection','baseSeam','landingSeam'].includes(k)),'Correspondence names directions and normalized parameter seams.');
  const width=positive(spec.beadWidthMm??process.lineWidthMm,'beadWidthMm'),speed=positive(spec.speedMmS??process.planarSpeedMmS,'speedMmS');
  const original=Geometry.matchCurveControls(spec.base,spec.landing,mapping),depthMm=EDGE_CONTACT_FRACTION*width;
  const offset=(curve,materialSide)=>Geometry.ribbon({geometry,curve,vertical:original.direction,depthMm,materialSide});
  let base=await offset(spec.base,-1);const landing=await offset(spec.landing,1);
  if(baseOnBed&&base.report.noAdjacentMaterial)base={curves:[spec.base],report:null};
  check(base.curves.length&&landing.curves.length,'Select actual part edges, or an unattached base on the bed.');
  check(base.curves.length===1&&landing.curves.length===1&&base.curves[0].closed===landing.curves[0].closed,'Ribbon folds split the selected edges; choose corresponding retained edge pieces.');
  const matched=Geometry.matchCurveControls(base.curves[0],landing.curves[0],mapping),{baseControls,landingControls}=matched;
  const closing=controls=>xyz(controls[0]).every((v,k)=>v===xyz(controls.at(-1))[k]);
  const count=baseControls.length-(matched.closed&&closing(baseControls)&&closing(landingControls)?1:0);
  const averageAdvance=baseControls.slice(0,count).reduce((sum,a,i)=>sum+Math.hypot(...xyz(a).map((v,k)=>xyz(landingControls[i])[k]-v)),0)/count;
  const target=positive(spec.layerHeightMm??process.layerMm,'layerHeightMm');
  const divisions=Math.max(1,Math.round(positive(averageAdvance,'Average curve separation')/target)),heightMm=averageAdvance/divisions;
  check(Number.isSafeInteger(divisions),'Curve divisions exceed integer representation.');
  const curves=[];
  for(let i=0;i<divisions;i++){
    const t=(i+1)/divisions,controls=baseControls.map((a,j)=>a.map((v,k)=>v+(landingControls[j][k]-v)*t));
    const first={closed:matched.closed,nurbs:{degree:matched.degree,knots:matched.knots,controlPoints:controls.map(xyz),weights:controls.map(p=>p[3])}};
    const side=landing.report.side*(mapping.landingDirection==='reverse'?-1:1);
    const second=await Geometry.ribbon({curve:first,vertical:original.direction,depthMm:side*width});
    check(second.curves.length,'The second support loop collapsed; select a wider support curve.');
    for(const curve of [first,...second.curves])curves.push({...curve,role:'breakaway-support',directionRequired:false,seamRequired:false,beadWidthMm:width,heightMm,speedMmS:speed,...(spec.sampleStepMm===undefined?{}:{sampleStepMm:positive(spec.sampleStepMm,'sampleStepMm')}),repetitions:[i]});
  }
  const repetitionIds=curves.map((_,i)=>`course-${i}`);
  const assignment={id:spec.id,construction:'curves',part:spec.part??null,filament:null,process:null,after:spec.after??[],curves,repeat:{count:divisions,translation:[0,0,0]},sequence:false,repetitionIds,repetitionAfter:Object.fromEntries(repetitionIds.slice(1).map((name,i)=>[name,[repetitionIds[i]]])),maxExcursionMm:null};
  return {assignment,report:{id:spec.id,courses:divisions,loops:2,controlPoints:baseControls.length,requestedLayerHeightMm:target,averageCourseSpacingMm:heightMm,edgeOffsets:{base:base.report,landing:landing.report},lastOperationId:`${spec.id}:${repetitionIds.at(-1)}`}};
}
export async function editBridgeSupports(source,request,Geometry){
  check(request&&Object.keys(request).join()==='supports'&&Array.isArray(request.supports)&&request.supports.length,'Supply a nonempty supports array.');
  const solid=source.geometry?.shape==='spatial'?source.geometry.solid:source.geometry;
  const prior=source.slices?.assignments??[],ids=new Set(prior.map(a=>a.id));
  const made=[];for(const {baseFrom,landingTo,...spec} of request.supports){
    check(!ids.has(spec.id),'Support id already exists; edit its ordinary Trace or choose another id.');ids.add(spec.id);
    const part=spec.part??null;
    check(part===null||solid?.shape==='assembly'&&solid.parts.some(p=>p.id===part),'Support part must name an assembly part.');
    const component=part===null?null:solid.parts.find(p=>p.id===part),geometry=component?.geometry??solid;
    const controls=Geometry.matchCurveControls(spec.base,spec.landing,spec.correspondence??{}).baseControls;
    const baseOnBed=controls.every(p=>p[2]/p[3]+(component?.zMm??0)===0);
    check(!Array.isArray(baseFrom)||baseFrom.length,'baseFrom cannot be empty.');
    check(!Array.isArray(landingTo)||landingTo.length,'landingTo cannot be empty.');
    check(baseOnBed||baseFrom||spec.after?.length,'Name baseFrom for printed material, or after for existing operation IDs.');
    made.push({...await buildBridgeSupport(spec,source.process,Geometry,{geometry,baseOnBed}),baseFrom,landingTo,baseOnBed,component});
  }
  for(const entry of made)entry.report.brim=await addSupportBrim(entry.assignment,source,Geometry,{baseOnBed:entry.baseOnBed,component:entry.component,otherAssignments:[...prior,...made.map(m=>m.assignment)]});
  let assignments=[...prior,...made.map(m=>m.assignment)];
  const reports=made.map(({assignment,report,baseFrom,landingTo})=>{
    const Recipe=Geometry.Recipe;
    check(!(baseFrom||landingTo)||Recipe,'The editor needs the shared Recipe operation interface.');
    const dependencies={base:[...(assignment.after??[])],landing:[]};
    if(baseFrom){
      const bases=Array.isArray(baseFrom)?baseFrom:[baseFrom];
      dependencies.base=bases.map(target=>Recipe.operationId(assignments,target));
      assignments=Recipe.withOperationAfter(assignments,{assignment:assignment.id,repetition:assignment.repetitionIds[0]},bases);
    }
    if(landingTo){
      const landings=Array.isArray(landingTo)?landingTo:[landingTo];
      dependencies.landing=landings.map(target=>Recipe.operationId(assignments,target));
      for(const target of landings)assignments=Recipe.withOperationAfter(assignments,target,[report.lastOperationId]);
    }
    return {...report,dependencies,...(!landingTo?{notes:['The landing is unbound; select landingTo when its deposition assignment exists.']}: {})};
  });
  return {assignmentRequests:assignments,report:{supports:reports}};
}
