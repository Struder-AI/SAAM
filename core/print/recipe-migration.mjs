import {requireThat} from '../private/toolpath/numeric.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
import {frontAssignment} from '../../skills/wave-overhangs/scripts/prepare.mjs';
import {rimAssignment} from '../../skills/thick-lip/scripts/prepare.mjs';
import {bridgeAssignment} from '../../skills/bridging/scripts/prepare.mjs';
import {depositionAssignment,currentAssignmentTerms} from './assignment-records.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';
import {closeMeshPatchToPlane} from '../geom/mesh-patch-solid.mjs';
import {STANDARD_SUPPORT,supportSlice,skinSlice,supportSolid,withSupportOperand,retiredTreeSolids,retiredFootprintSolids,solidInFrame} from '../../skills/standard-support/scripts/support-geometry.mjs';

import {advancedVaseRecordRuntime} from '../../skills/advanced-vase-wall/scripts/record.mjs';
const {validateSleevePattern}=advancedVaseRecordRuntime();

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
  const canonical=construction==='bridges'?bridgeAssignment({...legacy,process:{...legacy.process,firstLayerMm:legacy.process?.layerMm??process.layerMm}}):construction==='skin'?skinAssignment({...legacy,process:{...legacy.process,planarSpeedMmS:process.skinSpeedMmS,firstLayerSpeedMmS:process.skinSpeedMmS}}):construction==='fronts'?frontAssignment(legacy):construction==='rim'?rimAssignment(legacy):depositionAssignment(renamed);
  for(const key of new Set([...Object.keys(source),...Object.keys(canonical)]))if(JSON.stringify(source[key])!==JSON.stringify(canonical[key]))changes.push({path:`slices.assignments.${index}.${key}`,assignment:assignment.id,before:source[key]??null,after:canonical[key]??null,meaning:Object.hasOwn(source,key)?'Shared-construction form.':'Current shared default.'});
  return {assignment:changes.length?canonical:assignment,changes};
}

// Every assignment read in its current form when its recipe is read. Old
// construction forms are rewritten (one note each); one without an automatic
// reading stays as authored, is named in unread, and produces nothing.
export function currentAssignmentForms(plan){
  const authored=plan.slices?.assignments;
  if(!Array.isArray(authored))return {plan,changes:[],notes:[],unread:[]};
  const changes=[],notes=[],unread=[];
  const assignments=authored.map((assignment,index)=>{
    try{
      const read=currentAssignmentForm(assignment,index,plan.process);
      if(read.changes.length){changes.push(...read.changes);notes.push(`${assignment.id} is read in its current form (${[...new Set(read.changes.map(change=>change.path.split('.').slice(3).join('.')||change.to))].join(', ')}); the next save or migrate_bundle records it.`);}
      return read.assignment;
    }catch(error){
      unread.push(assignment?.id);notes.push(`${assignment?.id??'An assignment'} has an old form with no automatic reading, so it produces nothing: ${error.message}`);
      return assignment;
    }
  });
  return {plan:changes.length?{...plan,slices:{...plan.slices,assignments}}:plan,changes,notes,unread};
}

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const retiredFootprint=assignment=>assignment?.preset==='support'&&assignment.within?.[0]?.kind==='support';
// XY bounds of the vertices a geometry holds, for finding the component under a support.
function vertexBounds(geometry){
  const points=[geometry?.vertices,...(geometry?.operands??[]).map(operand=>vertexBounds(operand)?.corners)].filter(Array.isArray).flat();
  if(!points.length)return null;
  const axis=k=>points.map(p=>p[k]),min=[0,1].map(k=>Math.min(...axis(k))),max=[0,1].map(k=>Math.max(...axis(k)));
  return {min,max,corners:[min,max]};
}
// Supports {solids, contacts} in a geometry's frame join it as one hidden union
// operand; in an assembly each joins the component under its contacts (else
// the first), in that component's frame. -> {geometry, placed: components chosen}.
function joinSupports(geometry,supports){
  if(!geometry||!supports.length)return {geometry,placed:[]};
  if(geometry.shape==='spatial'){const joined=joinSupports(geometry.solid,supports);return {...joined,geometry:{...geometry,solid:joined.geometry}};}
  if(geometry.shape!=='assembly'||!Array.isArray(geometry.parts)||!geometry.parts.length)return {geometry:withSupportOperand(geometry,supportSolid(supports.flatMap(s=>s.solids))),placed:[]};
  const under=supports.map(({contacts})=>{
    const [x,y]=[0,1].map(k=>contacts.reduce((sum,p)=>sum+p[k],0)/contacts.length);
    return geometry.parts.findIndex(part=>{const b=vertexBounds(part.geometry);return b&&x>=b.min[0]+part.xMm&&x<=b.max[0]+part.xMm&&y>=b.min[1]+part.yMm&&y<=b.max[1]+part.yMm;});
  });
  const placed=[],parts=geometry.parts.map((part,i)=>{
    const held=supports.filter((_,n)=>Math.max(under[n],0)===i),origin=[part.xMm,part.yMm,part.zMm];
    if(!held.length)return part;
    const joined=joinSupports(part.geometry,held.map(({solids,contacts})=>({solids:solids.map(solid=>solidInFrame(solid,origin)),contacts:contacts.map(p=>p.map((v,k)=>v-origin[k]))})));
    placed.push(part.id+(i===0&&under.some(n=>n<0)?' (the first component; no component lies under some contacts)':''),...joined.placed.map(inner=>`${part.id}/${inner}`));
    return {...part,geometry:joined.geometry};
  });
  return {geometry:{...geometry,parts},placed};
}

// Retired supports read as standard supports (intent/toolpath.md, How standard
// supports are made): enabled skills.supports trees become one Slice claim,
// supports, so filament routes naming it still apply; each support-preset
// footprint becomes an ordinary claim and its -skin. Their solids, in the print's
// frame, join the part as hidden union operands. Standard settings replace the
// retired ones. A disabled skills.supports is dropped without a note.
export function currentSupportForms(plan){
  const authored=Array.isArray(plan.slices?.assignments)?plan.slices.assignments:[];
  if(!(isRecord(plan.skills)&&Object.hasOwn(plan.skills,'supports'))&&!authored.some(retiredFootprint))return {plan,notes:[]};
  const {supports:trees,...skills}=isRecord(plan.skills)?plan.skills:{},layerMm=plan.process?.layerMm;
  const {fillDensity,angleDeg,baseLayers,description}=STANDARD_SUPPORT,converted=[],details=[],joined=[];
  const standard=(id,solids,settings)=>ordinarySliceAssignment({...supportSlice({id,part:null,solid:supportSolid(solids),fillDensity,angleDeg,baseLayers,description}),...settings});
  const read=(id,work)=>{try{return work();}catch(error){details.push(`Support ${id} was not converted and produces nothing: ${error.message}`);return null;}};
  const assignments=authored.flatMap(assignment=>{
    if(!retiredFootprint(assignment))return [assignment];
    const skinMm=STANDARD_SUPPORT.skinLayers*(assignment.process?.layerMm??layerMm);
    const made=read(assignment.id,()=>retiredFootprintSolids(assignment.within[0],{closeMeshPatchToPlane},{skinMm:Number.isFinite(skinMm)&&skinMm>0?skinMm:0}));
    if(!made)return [];
    details.push(...made.notes.map(note=>`Support ${assignment.id}: ${note}`));joined.push(made);
    const solid=supportSolid(made.solids),skin=made.raised.length?[ordinarySliceAssignment(skinSlice({id:assignment.id,raised:made.raised,solid,angleDeg}))]:[];
    converted.push(`${assignment.id}${skin.length?` with ${assignment.id}-skin`:''}`);
    return [standard(assignment.id,made.solids,{filament:assignment.filament??null,process:{...(isRecord(assignment.process)?assignment.process:{}),liftMm:0,retractMm:0},
      ...(isRecord(assignment.dependencies)?{dependencies:assignment.dependencies}:{}),...(assignment.description?{description:assignment.description}:{})}),...skin];
  });
  const chordMm=Number.isFinite(trees?.treeChordMm)&&trees.treeChordMm>0?trees.treeChordMm:STANDARD_SUPPORT.chordMm;
  const grown=(trees?.enabled&&Array.isArray(trees.assignments)?trees.assignments:[]).flatMap(tree=>{
    const made=read(tree?.id,()=>retiredTreeSolids(tree,{chordMm}));
    if(made)details.push(...made.notes.map(note=>`Tree ${tree.id}: ${note}`));
    return made?[{...made,reason:tree.reason}]:[];
  });
  const id=authored.some(a=>a?.id==='supports')?'tree-supports':'supports',reasons=[...new Set(grown.map(tree=>tree.reason).filter(r=>typeof r==='string'&&r.trim()))];
  if(grown.length)converted.unshift(`${grown.length} tree${grown.length>1?'s':''} as ${id}`);
  const {geometry,placed}=joinSupports(plan.geometry,[...grown,...joined]);
  const current={...plan,...(isRecord(plan.skills)?{skills}:{}),...(Object.hasOwn(plan,'geometry')?{geometry}:{}),
    ...(isRecord(plan.slices)||grown.length?{slices:{...plan.slices,assignments:[...(grown.length?[standard(id,grown.flatMap(tree=>tree.solids),{description:reasons.join(' ')||description})]:[]),...assignments]}}:{})};
  if(!converted.length&&!details.length)return {plan:current,notes:[]};
  return {plan:current,notes:[[converted.length?`Supports converted to standard supports (sliced support solids joined to the part as hidden union operands): ${converted.join('; ')}. Each prints with no loops, one row direction, ${baseLayers} dense base layers and no hop or retraction; the retired loop, density and interface settings are not carried${placed.length?`; placed on component ${[...new Set(placed)].join(', ')}`:''}. The next save or migrate_bundle records them.`:'',...new Set(details)].filter(Boolean).join(' ')]};
}
