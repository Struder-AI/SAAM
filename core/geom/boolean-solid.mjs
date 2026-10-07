// Solids combined one layer at a time. Every operand keeps its own native
// backend; the shared queries (query.mjs) section each operand and combine the
// loops with Clipper2, and find tops from the operands' crossings. A slicer
// needs only the layers, so no surface-surface intersection curve or boolean
// B-rep is built (core/region/README.md#layer-regions-and-several-solids).
import {requireThat} from './tolerance.mjs';

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
    requireThat(BOOLEAN_OPERAND_SHAPES.includes(operand?.shape)||Array.isArray(operand?.vertices)&&!operand.base,`Boolean operands are ${BOOLEAN_OPERAND_SHAPES.join(', ')} geometry.`);
  }
  return geometry;
}

// Presentation selects authored geometry without changing the manufacturing solid.
export function displayGeometry(geometry){
  if(geometry.shape!=='boolean')return geometry;
  validateBooleanSolid(geometry);
  if(Object.hasOwn(geometry,'displayOperand'))return displayGeometry(geometry.operands[geometry.displayOperand]);
  return {...geometry,operands:geometry.operands.map(displayGeometry)};
}

// Difference keeps the first operand's extent; intersection keeps the overlap.
export function booleanShell(operation,operands){
  const boxes=operands.map(o=>o.bounds);
  const bounds=operation==='union'?{min:[0,1,2].map(a=>Math.min(...boxes.map(b=>b.min[a]))),max:[0,1,2].map(a=>Math.max(...boxes.map(b=>b.max[a])))}
    :operation==='difference'?structuredClone(boxes[0])
    :{min:[0,1,2].map(a=>Math.max(...boxes.map(b=>b.min[a]))),max:[0,1,2].map(a=>Math.min(...boxes.map(b=>b.max[a])))};
  requireThat(bounds.min.every((v,a)=>v<bounds.max[a]),'Boolean intersection operands do not overlap.');
  return {kind:'boolean',operation,operands,bounds};
}
