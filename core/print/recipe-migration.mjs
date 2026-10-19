import {requireThat} from '../private/toolpath/numeric.mjs';
import {depositionAssignment,currentAssignmentTerms} from './assignment-records.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';

function legacyRimAssignment({id,part=null,filament=null,process=null,after=[],source=null,steps=[2],minFeatureMm=.4}){
  return ordinarySliceAssignment({id,part,filament,process,loops:steps,fillDensity:0,solidTop:0,solidBottom:0,
    surface:{kind:'slice',assignment:source},contact:{source},dependencies:{afterParts:[],beforeParts:[],after}});
}


// Renamed fields are read by their current names; both spellings together have no reading.
function migrateAssignmentTerms(assignment){
  const {assignment:current,conflicts:[conflict]}=currentAssignmentTerms(assignment);
  requireThat(!conflict,`Deprecated ${conflict?.[0]} field: ${assignment.id}.`);
  return structuredClone(current);
}

// One assignment in its current form, with what changed; throws when an old
// form has no automatic reading.
function currentAssignmentForm(assignment,index,assignments){
  const changes=[];
  let source=assignment;
  if(source.surface?.kind==='terminal'){
    const producer=assignments.find(item=>item.id===source.surface.assignment);
    requireThat(producer&&(!producer.construction&&!producer.join||producer.construction==='rim'||
      producer.construction==='sleeve'&&producer.endTransition==='level'&&!producer.join),
    `Deprecated terminal surface reference: ${assignment.id}.`);
    const surface={kind:'slice',assignment:source.surface.assignment};
    source={...source,surface};
    changes.push({path:`slices.assignments.${index}.surface`,assignment:assignment.id,before:assignment.surface,after:surface,meaning:'Prepared surface in declared sequence.'});
  }
  if(source.substrate?.kind==='discover'){
    source={...source,substrate:null};
    changes.push({path:`slices.assignments.${index}.substrate`,assignment:assignment.id,before:assignment.substrate,after:null,
      meaning:'Empty prerequisites leave placement to scheduling; no discovery opt-in.'});
  }
  const renamed=migrateAssignmentTerms(source),{construction,...legacy}=renamed;
  const deprecated=construction==='skin'||construction==='cladding'||['bridges','fronts'].includes(construction)?construction:
    construction==='sleeve'&&source.pattern&&Object.hasOwn(source.pattern,'tile')?'vase-cell':
    source.fillOrder?.kind==='fronts'||source.sliceOverrides?.some(layer=>layer.fillOrder?.kind==='fronts')?'wave-front':null;
  requireThat(!deprecated,`Deprecated ${deprecated} form: ${assignment.id}.`);
  const canonical=construction==='rim'?legacyRimAssignment(legacy):depositionAssignment(renamed);
  for(const key of new Set([...Object.keys(source),...Object.keys(canonical)]))if(JSON.stringify(source[key])!==JSON.stringify(canonical[key]))changes.push({path:`slices.assignments.${index}.${key}`,assignment:assignment.id,before:source[key]??null,after:canonical[key]??null,meaning:Object.hasOwn(source,key)?'Shared-construction form.':'Current shared default.'});
  return {assignment:changes.length?canonical:assignment,changes};
}

// Every assignment read in its current form when its recipe is read. Old
// construction forms are rewritten (one note each); one without an automatic
// reading stays as authored, is named in unread, and produces nothing.
export function currentAssignmentForms(plan){
  const authored=plan.slices?.assignments;
  if(!Array.isArray(authored))return {plan,changes:[],notes:[],unread:[],failures:[]};
  const changes=[],notes=[],unread=[],failures=[];
  const assignments=authored.map((assignment,index)=>{
    try{
      const read=currentAssignmentForm(assignment,index,authored);
      if(read.changes.length){changes.push(...read.changes);notes.push(`${assignment.id} is read in its current form (${[...new Set(read.changes.map(change=>change.path.split('.').slice(3).join('.')||change.to))].join(', ')}); the next save or migrate_bundle records it.`);}
      return read.assignment;
    }catch(error){
      failures.push({assignment:assignment?.id,message:error.message});unread.push(assignment?.id);notes.push(error.message);
      return assignment;
    }
  });
  return {plan:changes.length?{...plan,slices:{...plan.slices,assignments}}:plan,changes,notes,unread,failures};
}

// Geometry-producing support migrations are retired. Inactive flags alone
// are trivial to remove; active old forms reject before any geometry is built.
export function currentSupportForms(plan){
  const trees=plan.skills?.supports;
  requireThat(!trees?.enabled,`Deprecated tree-support form: ${(Array.isArray(trees?.assignments)?trees.assignments:[]).map(a=>a?.id).join(', ')||'supports'}.`);
  for(const a of plan.slices?.assignments??[]){
    requireThat(!(a?.preset==='support'&&a.within?.[0]?.kind==='support'),`Deprecated support-footprint form: ${a?.id}.`);
    if(a.construction||a.geometry||a.loops!==0||a.solidTop!==0||a.rotateFill!==false||a.process?.liftMm!==0||a.process?.retractMm!==0||a.within?.length!==1||a.within[0].kind!=='geometry')continue;
    const root=plan.geometry?.shape==='spatial'?plan.geometry.solid:plan.geometry,shape=a.part==null?root:root?.parts?.find(p=>p.id===a.part)?.geometry;
    requireThat(!(shape?.shape==='boolean'&&shape.operation==='union'&&shape.displayOperand===0&&Array.isArray(shape.operands)&&
      shape.operands.some((operand,i)=>i>0&&JSON.stringify(operand)===JSON.stringify(a.within[0].geometry))),`Deprecated embedded-support form: ${a.id}.`);
  }
  if(!Object.hasOwn(plan.skills??{},'supports'))return {plan,notes:[]};
  const {supports,...skills}=plan.skills;return {plan:{...plan,skills},notes:[]};
}
