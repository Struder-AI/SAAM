// Native operands construct trimmed boundaries or retain proven disjoint unions.
// Sections query either representation directly; output conversion is separate.
import {requireThat} from './tolerance.mjs';
import {nativeSurfaceSolid,surfaceBoolean} from './surface-boolean.mjs';
import {separatingSurfacePlane} from './surface-support.mjs';

export const BOOLEAN_OPERATIONS=['union','difference','intersection'];
export const BOOLEAN_OPERAND_SHAPES=['spline','mesh','blob-field','boolean'];
export const booleanSolidTemplate=(geometry={})=>({shape:'boolean',operation:'union',operands:[],...(Object.hasOwn(geometry,'displayOperand')?{displayOperand:0}:{})});

// Structure only; the caller validates each operand by its own form's check.
export function validateBooleanSolid(geometry){
  requireThat(Object.keys(geometry).filter(key=>key!=='displayOperand').sort().join()==='operands,operation,shape','A boolean solid has shape, operation, operands and optional displayOperand.');
  requireThat(BOOLEAN_OPERATIONS.includes(geometry.operation),`Boolean operation is one of ${BOOLEAN_OPERATIONS.join(', ')}.`);
  requireThat(Array.isArray(geometry.operands)&&geometry.operands.length>=2,'A boolean solid needs at least two operands.');
  if(Object.hasOwn(geometry,'displayOperand'))requireThat(Number.isInteger(geometry.displayOperand)&&geometry.displayOperand>=0&&geometry.displayOperand<geometry.operands.length,'displayOperand must identify an existing operand.');
  for(const operand of geometry.operands){
    requireThat(BOOLEAN_OPERAND_SHAPES.includes(operand?.shape)||operand?.solid||Array.isArray(operand?.vertices)&&!operand.base,`Boolean operands are ${BOOLEAN_OPERAND_SHAPES.join(', ')} geometry.`);
  }
  return geometry;
}

// Presentation selects authored geometry without changing the manufacturing solid.
export function displayGeometry(geometry){
  if(geometry.shape!=='boolean')return geometry;
  validateBooleanSolid(geometry);
  if(Object.hasOwn(geometry,'displayOperand'))return displayGeometry(geometry.operands[geometry.displayOperand]);
  const operands=geometry.operands.map(displayGeometry);
  return operands.every((operand,i)=>operand===geometry.operands[i])?geometry:{...geometry,operands};
}

// Difference keeps the first operand's extent; intersection keeps the overlap,
// flat where the operands' boxes do not meet: no material, shown empty.
export function booleanShell(operation,operands,{composeDisjoint=false,...options}={}){
  const native=operands.length>=2&&operands.every(nativeSurfaceSolid);
  // A union with no common interior needs no face trimming for material queries.
  // Retain exact operands; explicit full-boundary operations still sew their faces.
  const composed=native&&composeDisjoint&&operation==='union'&&operands.every((a,i)=>operands.slice(i+1).every(b=>a.empty||b.empty||separatingSurfacePlane(a,b)));
  if(native&&!composed)return surfaceBoolean(operation,operands,options);
  const notes=[...new Set(operands.flatMap(operand=>operand.notes??[]))];
  const empty=operation==='union'?operands.every(operand=>operand.empty):operation==='difference'?Boolean(operands[0]?.empty):operands.some(operand=>operand.empty);
  if(empty)return {kind:'boolean',operation,operands,notes,empty:true,bounds:{min:[0,0,0],max:[0,0,0]}};
  const boxes=(operation==='union'?operands.filter(operand=>!operand.empty):operands).map(o=>o.bounds),overlap=[0,1,2].map(a=>Math.max(...boxes.map(b=>b.min[a])));
  const bounds=operation==='union'?{min:[0,1,2].map(a=>Math.min(...boxes.map(b=>b.min[a]))),max:[0,1,2].map(a=>Math.max(...boxes.map(b=>b.max[a])))}
    :operation==='difference'?structuredClone(boxes[0])
    :{min:overlap,max:[0,1,2].map(a=>Math.max(overlap[a],Math.min(...boxes.map(b=>b.max[a]))))};
  return {kind:'boolean',operation,operands,notes,empty:false,bounds};
}
