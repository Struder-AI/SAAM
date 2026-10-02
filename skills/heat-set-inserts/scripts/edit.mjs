import {compileHeatSet} from './geometry.mjs';
import {heatSetFeature,heatSetAssignmentId,legacyHeatSetAssignmentId} from './feature.mjs';
import {heatSetSlices} from './slices.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
function unwrapTextGeometry(geometry){
  const layers=[];let base=geometry;
  while(base.shape==='text'&&base.base&&!base.standalone){layers.push(base);base=base.base;}
  return {base,layers};
}
async function rebuildTextGeometry(base,layers,operations){
  let rebuilt=base;
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i];
    requireThat(typeof operations.compileText==='function','Heat-set text needs the selected text extension compiler.');
    rebuilt=await operations.compileText(rebuilt,layer.features,{...operations,toleranceMm:layer.toleranceMm,maxEdgeMm:layer.maxEdgeMm});
  }
  return rebuilt;
}

export async function editHeatSet(source,request,geometryOperations){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','toleranceMm'].includes(k)),'Unknown heat-set request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one heat-set feature or remove id.');
  const plan=structuredClone(source),owner=request.part?plan.geometry.parts?.find(p=>p.id===request.part):plan;
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
    const reusable=previous?Object.fromEntries(Object.entries(previous).filter(([k])=>!['id','positionMm'].includes(k))):{};
    const next={...reusable,...(index>=0?features[index]:{}),...feature};
    requireThat(next.insertId,'Choose an exact insertId from the heat-set manual size/profile table.');
    if(index>=0)features[index]=next;else features.push(next);
  }
  const rebuilt=features.length?await compileHeatSet(base,features,{...geometryOperations,toleranceMm:request.toleranceMm??old?.toleranceMm??0.01}):base;
  owner.geometry=await rebuildTextGeometry(rebuilt,layers,geometryOperations);
  // Reinforcement is slice data: this part's heat-set owners are rewritten
  // ahead of every other slice assignment, so they claim their volumes first.
  const part=request.part??null;
  const existingByFeature=new Map(),kept=[];
  for(const assignment of plan.slices.assignments){
    const owners=assignment.part===part?(old?.features??[]).filter(f=>{
      const current=heatSetAssignmentId(f,part),legacy=legacyHeatSetAssignmentId(f);
      return [current,legacy].includes(assignment.id)||[[current,'--fin-'],[legacy,'-fin-']].some(([name,separator])=>
        assignment.id.startsWith(name+separator)&&/^\d+$/.test(assignment.id.slice(name.length+separator.length)));
    }):[];
    requireThat(owners.length<=1,'Existing heat-set assignment identity is ambiguous; rename its feature/assignment explicitly before editing.');
    if(!owners.length){kept.push(assignment);continue;}
    const id=owners[0].id,ids=existingByFeature.get(id)??new Set();ids.add(assignment.id);existingByFeature.set(id,ids);
  }
  const assignmentRequests=[...features.flatMap(f=>heatSetSlices(heatSetFeature(f),part,plan.process,
    {existingIds:existingByFeature.get(f.id)??new Set()})),...kept];
  return {geometry:plan.geometry,assignmentRequests};
}
