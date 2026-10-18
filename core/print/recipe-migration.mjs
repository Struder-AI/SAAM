import {requireThat} from '../private/toolpath/numeric.mjs';
import {depositionAssignment,currentAssignmentTerms} from './assignment-records.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';
import {closeMeshPatchToPlane} from '../geom/mesh-patch-solid.mjs';
import {STANDARD_SUPPORT,supportSlice,supportSolid,retiredTreeSolids,retiredFootprintSolids} from '../../skills/standard-support/scripts/support-geometry.mjs';

import {advancedVaseRecordRuntime} from '../../skills/advanced-vase-wall/scripts/record.mjs';
const {validateSleevePattern}=advancedVaseRecordRuntime();

// Read retired roof-finish records as ordinary Slice; new recipes author Slice directly.
const LEGACY_SKIN_DEFAULTS=Object.freeze({spacingFactor:1,layers:2,pitchMm:.2,strokeAngleDeg:0,sampleStepMm:.5,surveyStepMm:.5,maxAngleDegOverride:null});
function legacySkinAssignment({id,...options}){
  const a={part:null,filament:null,process:null,after:[],supportFrom:null,...LEGACY_SKIN_DEFAULTS,...options};
  requireThat(!Object.hasOwn(options,'normalMm'),'Use pitchMm for the target mean normal gap.');
  return ordinarySliceAssignment({id,part:a.part,filament:a.filament,process:{planarSpeedMmS:10,firstLayerSpeedMmS:10,...a.process},loops:0,fillDensity:1,solidTop:0,solidBottom:0,
    spacingFactor:a.spacingFactor,sampleStepMm:a.sampleStepMm,fillAnglesDeg:[a.strokeAngleDeg],rotateFill:false,
    surface:{kind:'roof',offsetMm:0},stack:{firstLayerMm:a.pitchMm,layerMm:a.pitchMm},
    within:[{kind:'surface-domain',loopsUv:null,fromLayer:-a.layers,toLayer:0,maxSlopeDeg:a.maxAngleDegOverride??90,sampleStepMm:a.surveyStepMm}],
    contact:{source:a.supportFrom},dependencies:{afterParts:[],beforeParts:[],after:a.after},description:'Roof slices with a target mean normal gap.'});
}

function legacyRimAssignment({id,part=null,filament=null,process=null,after=[],source=null,steps=[2],minFeatureMm=.4}){
  return ordinarySliceAssignment({id,part,filament,process,loops:steps,fillDensity:0,solidTop:0,solidBottom:0,
    surface:{kind:'terminal',assignment:source,minFeatureMm},contact:{source},dependencies:{afterParts:[],beforeParts:[],after}});
}


// A retired cell layout is read as identical explicit paths.
function explicitSleevePaths(pattern){
  const {tile,cellsPerTurn,courseRiseMm,repeats,tiltDeg}=pattern;
  requireThat(Number.isSafeInteger(cellsPerTurn)&&cellsPerTurn>0&&Number.isFinite(courseRiseMm)&&courseRiseMm>0&&Number.isFinite(tiltDeg),'Invalid legacy sleeve tile layout.');
  requireThat(tile?.points?.length>=2&&Number.isSafeInteger(cellsPerTurn*(tile.points.length-1)+1),'Legacy sleeve pattern exceeds the representable point count.');
  const at=(value,i)=>Array.isArray(value)?value[i]:value;
  const first=tile.points[0],last=tile.points.at(-1),height=tile.beadHeightMm;
  requireThat(first[0]===0&&last[0]===1&&first[1]===last[1]&&at(tile.offsetMm??0,0)===at(tile.offsetMm??0,tile.points.length-1)&&(!Array.isArray(height)||height[0]===height.at(-1)),'Legacy tile endpoints must agree before migration.');
  const points=[],offsetMm=[],beadHeightMm=[],angle=tiltDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const originOffset=at(tile.offsetMm??0,0),originHeight=first[1];
  for(let cell=0;cell<cellsPerTurn;cell++)for(let i=cell?1:0;i<tile.points.length;i++){
    const [u,height]=tile.points[i],phase=(cell+u)/cellsPerTurn,depth=at(tile.offsetMm??0,i)-originOffset,h=height-originHeight;
    points.push([phase,originHeight+depth*s+h*c+phase*courseRiseMm]);offsetMm.push(originOffset+depth*c-h*s);beadHeightMm.push(at(tile.beadHeightMm,i));
  }
  const expanded={paths:[{points,offsetMm,beadHeightMm}],advance:[1,courseRiseMm],repeats};
  validateSleevePattern(expanded);return expanded;
}

// Renamed fields are read by their current names; both spellings together have no reading.
function migrateAssignmentTerms(assignment){
  const {assignment:current,conflicts:[conflict]}=currentAssignmentTerms(assignment);
  requireThat(!conflict,`Both ${conflict?.[0]} and ${conflict?.[1]} are present; resolve the conflicting fields before migration.`);
  return structuredClone(current);
}

// One assignment in its current form, with what changed; throws when an old
// form has no automatic reading.
function currentAssignmentForm(assignment,index,process){
  const changes=[];
  let source=assignment;
  if(source.substrate?.kind==='discover'){
    source={...source,substrate:null};
    changes.push({path:`slices.assignments.${index}.substrate`,assignment:assignment.id,before:assignment.substrate,after:null,
      meaning:'Empty prerequisites leave placement to scheduling; no discovery opt-in.'});
  }
  if(assignment.construction==='sleeve'&&assignment.pattern&&Object.hasOwn(assignment.pattern,'tile')){
    source={...source,pattern:explicitSleevePaths(assignment.pattern)};
    changes.push({path:`slices.assignments.${index}.pattern`,before:assignment.pattern,after:source.pattern,meaning:'Expand legacy cell layout into identical explicit paths; no geometry, bead height or repetition change.'});
  }
  if(assignment.construction==='skin'&&Object.hasOwn(assignment,'normalMm')){
    requireThat(!Object.hasOwn(assignment,'pitchMm'),'Skin has both normalMm and pitchMm; choose one target normal gap.');
    const {normalMm,...retained}=assignment;source={...retained,pitchMm:normalMm};
    changes.push({path:`slices.assignments.${index}`,assignment:assignment.id,from:'normalMm',to:'pitchMm',value:normalMm,
      meaning:'Numeric value retained as target mean normal gap; translation is derived over the full reference, local normal gaps vary.'});
  }
  const renamed=migrateAssignmentTerms(source),{construction,...legacy}=renamed;
  requireThat(construction!=='cladding','Legacy cladding pose has no automatic reading: author normal-band Slice with optional derived pose and field tilt, then review.');
  requireThat(!['bridges','fronts'].includes(construction)&&source.fillOrder?.kind!=='fronts'&&!source.sliceOverrides?.some(layer=>layer.fillOrder?.kind==='fronts'),
    'Retired bridge/wave construction has no automatic geometric conversion. Select printed base and target edges with bridging or hole-transitions, then review. Saved toolpaths remain viewable.');
  const canonical=construction==='skin'?legacySkinAssignment({...legacy,process:{...legacy.process,planarSpeedMmS:process.skinSpeedMmS,firstLayerSpeedMmS:process.skinSpeedMmS}}):construction==='rim'?legacyRimAssignment(legacy):depositionAssignment(renamed);
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
      const read=currentAssignmentForm(assignment,index,plan.process);
      if(read.changes.length){changes.push(...read.changes);notes.push(`${assignment.id} is read in its current form (${[...new Set(read.changes.map(change=>change.path.split('.').slice(3).join('.')||change.to))].join(', ')}); the next save or migrate_bundle records it.`);}
      return read.assignment;
    }catch(error){
      failures.push({assignment:assignment?.id,message:error.message});unread.push(assignment?.id);notes.push(`${assignment?.id??'An assignment'} has an old form with no automatic reading, so it produces nothing: ${error.message}`);
      return assignment;
    }
  });
  return {plan:changes.length?{...plan,slices:{...plan.slices,assignments}}:plan,changes,notes,unread,failures};
}

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const retiredFootprint=assignment=>assignment?.preset==='support'&&assignment.within?.[0]?.kind==='support';
// Recognize the old support wrapper by both its Slice settings and an identical
// hidden union operand. Ordinary user geometry and similarly named skins stay put.
function independentSupportForms(plan){
  let geometry=plan.geometry;const converted=new Set();
  const assignments=(plan.slices?.assignments??[]).map(a=>{
    if(a.construction||a.geometry||a.loops!==0||a.solidTop!==0||a.rotateFill!==false||a.process?.liftMm!==0||a.process?.retractMm!==0||a.within?.length!==1||a.within[0].kind!=='geometry')return a;
    const root=geometry?.shape==='spatial'?geometry.solid:geometry,component=a.part==null?null:root?.parts?.find(p=>p.id===a.part),shape=component?.geometry??root,solid=a.within[0].geometry;
    if(shape?.shape!=='boolean'||shape.operation!=='union'||shape.displayOperand!==0)return a;
    const index=shape.operands.findIndex((operand,i)=>i>0&&JSON.stringify(operand)===JSON.stringify(solid));
    if(index<0)return a;
    const operands=shape.operands.filter((_,i)=>i!==index),replacement=operands.length===1?operands[0]:{...shape,operands};
    const changed=component?{...root,parts:root.parts.map(p=>p===component?{...p,geometry:replacement}:p)}:replacement;
    geometry=geometry.shape==='spatial'?{...geometry,solid:changed}:changed;converted.add(a.id);
    return {...a,geometry:solid,within:[]};
  }).filter(a=>![...converted].some(id=>a.id===`${id}-skin`&&a.description===`Solid underside over support ${id}.`));
  if(!converted.size)return {plan,notes:[]};
  return {plan:{...plan,geometry,slices:{...plan.slices,assignments}},notes:[`Support geometry separated from the part; redundant underside-skin assignments removed: ${[...converted].join(', ')}. The part's Slice settings own its underside.`]};
}

// Retired supports read as standard supports (intent/toolpath.md, How standard
// supports are made): enabled skills.supports trees become one Slice claim,
// supports, so filament routes naming it still apply; each support-preset
// footprint becomes an ordinary Slice of its independent solid in the print's
// frame. Standard settings replace the
// retired ones. A disabled skills.supports is dropped without a note.
export function currentSupportForms(plan){
  const independent=independentSupportForms(plan);plan=independent.plan;
  const authored=Array.isArray(plan.slices?.assignments)?plan.slices.assignments:[];
  if(!(isRecord(plan.skills)&&Object.hasOwn(plan.skills,'supports'))&&!authored.some(retiredFootprint))return independent;
  const {supports:trees,...skills}=isRecord(plan.skills)?plan.skills:{};
  const {fillDensity,angleDeg,baseLayers,description}=STANDARD_SUPPORT,converted=[],details=[];
  const standard=(id,solids,settings)=>ordinarySliceAssignment({...supportSlice({id,part:null,solid:supportSolid(solids),fillDensity,angleDeg,baseLayers,description}),...settings});
  const read=(id,work)=>{try{return work();}catch(error){details.push(`Support ${id} was not converted and produces nothing: ${error.message}`);return null;}};
  const assignments=authored.flatMap(assignment=>{
    if(!retiredFootprint(assignment))return [assignment];
    const made=read(assignment.id,()=>retiredFootprintSolids(assignment.within[0],{closeMeshPatchToPlane}));
    if(!made)return [];
    details.push(...made.notes.map(note=>`Support ${assignment.id}: ${note}`));
    converted.push(assignment.id);
    return [standard(assignment.id,made.solids,{filament:assignment.filament??null,process:{...(isRecord(assignment.process)?assignment.process:{}),liftMm:0,retractMm:0},
      ...(isRecord(assignment.dependencies)?{dependencies:assignment.dependencies}:{}),...(assignment.description?{description:assignment.description}:{})})];
  });
  const chordMm=Number.isFinite(trees?.treeChordMm)&&trees.treeChordMm>0?trees.treeChordMm:STANDARD_SUPPORT.chordMm;
  const grown=(trees?.enabled&&Array.isArray(trees.assignments)?trees.assignments:[]).flatMap(tree=>{
    const made=read(tree?.id,()=>retiredTreeSolids(tree,{chordMm}));
    if(made)details.push(...made.notes.map(note=>`Tree ${tree.id}: ${note}`));
    return made?[{...made,reason:tree.reason}]:[];
  });
  const id=authored.some(a=>a?.id==='supports')?'tree-supports':'supports',reasons=[...new Set(grown.map(tree=>tree.reason).filter(r=>typeof r==='string'&&r.trim()))];
  if(grown.length)converted.unshift(`${grown.length} tree${grown.length>1?'s':''} as ${id}`);
  const current={...plan,...(isRecord(plan.skills)?{skills}:{}),
    ...(isRecord(plan.slices)||grown.length?{slices:{...plan.slices,assignments:[...(grown.length?[standard(id,grown.flatMap(tree=>tree.solids),{description:reasons.join(' ')||description})]:[]),...assignments]}}:{})};
  if(!converted.length&&!details.length)return {plan:current,notes:independent.notes};
  return {plan:current,notes:[...independent.notes,[converted.length?`Supports converted to ordinary Slice assignments of independent support solids: ${converted.join('; ')}. Each prints with no loops, one row direction, ${baseLayers} dense base layers and no hop or retraction; the retired loop, density and interface settings are not carried. The next save or migrate_bundle records them.`:'',...new Set(details)].filter(Boolean).join(' ')]};
}
