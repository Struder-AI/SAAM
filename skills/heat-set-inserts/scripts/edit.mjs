import {compileHeatSet} from './geometry.mjs';
import {heatSetFeature,heatSetAssignmentId,legacyHeatSetAssignmentId} from './feature.mjs';


const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
function unwrapTextGeometry(geometry){
  const layers=[];let base=geometry;
  while(base.shape==='text'&&base.base&&!base.standalone){layers.push(base);base=base.base;}
  return {base,layers};
}
// -> {geometry, notes} of the lettering reapplied innermost first.
async function rebuildTextGeometry(base,layers,operations){
  const notes=[];let rebuilt=base;
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i];
    requireThat(typeof operations.compileText==='function','Heat-set text needs the selected text extension compiler.');
    const compiled=await operations.compileText(rebuilt,layer.features,{...operations,toleranceMm:layer.toleranceMm,maxEdgeMm:layer.maxEdgeMm});
    rebuilt=compiled.geometry;notes.push(...compiled.notes);
  }
  return {geometry:rebuilt,notes};
}

export async function editHeatSet(source,request,geometryOperations){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','toleranceMm','sourceAssignment','sourceAssignments'].includes(k)),'Unknown heat-set request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one heat-set feature or remove id.');
  const plan=structuredClone(source),solid=plan.geometry.shape==='spatial'?plan.geometry.solid:plan.geometry;
  const container=plan.geometry.shape==='spatial'?{geometry:solid}:plan;
  const owner=request.part?solid.parts?.find(p=>p.id===request.part):container;
  requireThat(owner&&owner.geometry.shape!=='assembly','Select an existing assembly part before applying heat-set inserts.');
  const {base:geometry,layers}=unwrapTextGeometry(owner.geometry);
  const old=geometry.shape==='heat-set'?geometry:null,base=old?old.base:geometry;
  const features=structuredClone(old?.features??[]);
  if(request.remove){const index=features.findIndex(f=>f.id===request.remove);requireThat(index>=0,'Heat-set feature not found.');features.splice(index,1);}
  else{
    const feature=request.feature,index=features.findIndex(f=>f.id===(feature.id??'insert'));
    // Same-print values are the actual last-used feature settings. New named
    // holes inherit dimensions and fin choices, but never copy placement silently.
    const previous=index>=0?features[index]:features.at(-1);
    const reusable=previous?Object.fromEntries(Object.entries(previous).filter(([k])=>!['id','positionMm','axis'].includes(k))):{};
    const next={...reusable,...(index>=0?features[index]:{}),...feature};
    requireThat(next.insertId,'Choose an exact insertId from the heat-set manual size/profile table.');
    if(index>=0)features[index]=next;else features.push(next);
  }
  const bored=features.length?await compileHeatSet(base,features,{...geometryOperations,toleranceMm:request.toleranceMm??old?.toleranceMm??geometryOperations.dimensions.CONSTRUCTION_TOLERANCE_MM}):{geometry:base,notes:[]};
  const lettered=await rebuildTextGeometry(bored.geometry,layers,geometryOperations);
  owner.geometry=lettered.geometry;
  if(!request.part&&plan.geometry.shape==='spatial')plan.geometry.solid=owner.geometry;
  const notes=[...bored.notes,...lettered.notes];
  // A source Trace follows one real Slice owner per layer, without claiming
  // material or reserving fill. Unrelated assignments/curves are preserved.
  const part=request.part??null;
  const existingByFeature=new Map(),priorSources=new Map(),kept=[];
  for(const assignment of plan.slices.assignments){
    const owners=assignment.part===part?(old?.features??[]).filter(f=>{
      const current=heatSetAssignmentId(f,part),legacy=legacyHeatSetAssignmentId(f);
      return assignment.source?.extension==='heat-set-inserts'&&assignment.source.parameters?.feature?.id===f.id||[current,legacy].includes(assignment.id)||[[current,'--fin-'],[legacy,'-fin-']].some(([name,separator])=>
        assignment.id.startsWith(name+separator)&&/^\d+$/.test(assignment.id.slice(name.length+separator.length)));
    }):[];
    requireThat(owners.length<=1,'Existing heat-set assignment identity is ambiguous; rename its feature/assignment explicitly before editing.');
    if(!owners.length){kept.push(assignment);continue;}
    const id=owners[0].id,ids=existingByFeature.get(id)??new Set();ids.add(assignment.id);existingByFeature.set(id,ids);
    if(assignment.source?.extension==='heat-set-inserts'){const prior=priorSources.get(id)??new Set();prior.add(assignment.source.assignment);priorSources.set(id,prior);}
  }
  const candidates=kept.filter(a=>!a.construction&&!a.join&&!a.preset&&!a.geometry&&
    (a.part===part||a.part===null));
  const available=candidates;
  requireThat(!(request.sourceAssignment&&request.sourceAssignments),'Choose sourceAssignment or sourceAssignments.');
  if(request.sourceAssignments)requireThat(Array.isArray(request.sourceAssignments)&&request.sourceAssignments.length&&
    request.sourceAssignments.every(id=>typeof id==='string')&&new Set(request.sourceAssignments).size===request.sourceAssignments.length,'sourceAssignments must contain distinct Slice ids.');
  const assignmentRequests=[...kept,...features.flatMap(raw=>{
    const feature=heatSetFeature(raw),target=Boolean(request.feature)&&feature.id===(request.feature.id??'insert');
    const requested=target?(request.sourceAssignments??(request.sourceAssignment?[request.sourceAssignment]:null)):null;
    const selected=requested??(priorSources.has(feature.id)?[...priorSources.get(feature.id)]:
      available.map(assignment=>assignment.id));
    requireThat(selected.length,'Heat-set reinforcement needs a matching source Slice assignment.');
    const canonical=heatSetAssignmentId(feature,part),legacy=legacyHeatSetAssignmentId(feature),existing=existingByFeature.get(feature.id)??new Set();
    const primary=existing.has(canonical)?canonical:existing.has(legacy)?legacy:canonical;
    return selected.map((sourceId,index)=>{
      const parent=kept.find(a=>a.id===sourceId&&!a.construction&&!a.join&&(a.part===part||a.part===null));
      requireThat(parent,'Heat-set sourceAssignments must name matching ordinary Slice owners.');
      const id=index===0?primary:canonical+'--source-'+sourceId;
      return {id,construction:'curves',part,source:{extension:'heat-set-inserts',assignment:parent.id,
        parameters:{feature,toleranceMm:bored.geometry.toleranceMm??request.toleranceMm??geometryOperations.dimensions.CONSTRUCTION_TOLERANCE_MM}}};
    });
  })];
  return {geometry:plan.geometry,assignmentRequests,...(notes.length?{report:{notes}}:{})};
}
