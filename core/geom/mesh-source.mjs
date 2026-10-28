// Admission of source-authored meshes; generated and validated geometry stays exact.
import {prepareMesh} from './mesh-repair.mjs';
import {spatialTemplate} from './spatial.mjs';
import {validateBooleanSolid} from './boolean-solid.mjs';

// Reduce source coordinates and faces once, before any expensive geometric
// validation. Changed connectivity uses the same demand-driven solid repair as
// explicit repair. Empty results keep their authoring record with no faces.
export function normalizeSourceMesh(value){
  const {clean,result:repaired}=prepareMesh(value,{maxHoleEdges:500,maxHoleDiameterMm:2}),report={...clean.resolutionMerge,removed:clean.removed,stitching:clean.stitching};
  if(clean.empty)return {geometry:{...value,vertices:[],triangles:[]},report:{...report,empty:true,...(value.source?{source:structuredClone(value.source)}:{})}};
  const solid= repaired.report;
  if(!report.mergedVertices&&!report.collapsedTriangles&&!clean.removed.degenerate&&!clean.removed.duplicates&&!clean.removed.unusedOrDuplicateVertices&&!clean.stitching.edges
    &&!solid.selfIntersectionsRepaired&&!solid.orientation.flippedFaces&&!solid.orientation.reversedOrientation&&!solid.holesFilled)return {geometry:value,report};
  if(sameMesh(repaired,value))return {geometry:value,report};
  return {geometry:{...value,vertices:repaired.vertices,triangles:repaired.triangles},
    report:{...report,solidRepair:repaired.report,...(!repaired.triangles.length?{empty:true,...(value.source?{source:structuredClone(value.source)}:{})}:{})}};
}
const indexedGeometry=geometry=>Array.isArray(geometry?.vertices)&&Array.isArray(geometry?.triangles);
function retainedMeshes(geometry,meshes){
  if(!geometry)return;
  if(indexedGeometry(geometry))meshes.push(geometry);
  else if(geometry.solid)retainedMeshes(geometry.solid,meshes);
  else if(geometry.shape==='assembly')for(const part of geometry.parts)retainedMeshes(part.geometry,meshes);
  else if(geometry.shape==='boolean')for(const operand of geometry.operands)retainedMeshes(operand,meshes);
}
function sameMesh(a,b){
  return a.vertices?.length===b.vertices?.length&&a.triangles?.length===b.triangles?.length
    &&a.vertices.every((p,i)=>p.every((v,k)=>v===b.vertices[i][k]))
    &&a.triangles.every((t,i)=>t.every((v,k)=>v===b.triangles[i][k]));
}
// Normalize only newly admitted mesh values. Existing exact arrays remain exact
// when wrapped, reordered or carried through a settings edit. Source metadata stays.
export function normalizeAuthoredGeometry(geometry,previous,prepared=[]){
  const admitted=[],reports=[];retainedMeshes(previous,admitted);
  for(const source of prepared)retainedMeshes(source,admitted);
  function normalize(value,path){
    if(!value)return value;
    if(value.solid||value.shape==='spatial'){const solid=normalize(value.solid,path+'/solid');return solid===value.solid?value:{...value,solid};}
    if(value.shape==='assembly'){
      const parts=value.parts.map(part=>{const geometry=normalize(part.geometry,path+'/parts/'+part.id);return geometry===part.geometry?part:geometry?{...part,geometry}:null;}).filter(Boolean);
      return parts.every((part,i)=>part===value.parts[i])&&parts.length===value.parts.length?value:{...value,parts};
    }
    if(value.shape==='boolean'){
      validateBooleanSolid(value);
      const normalized=value.operands.map((operand,i)=>normalize(operand,path+'/operands/'+i));
      if(normalized.every((operand,i)=>operand===value.operands[i]))return value;
      if(value.operation==='intersection'&&normalized.some(operand=>!operand)||value.operation==='difference'&&!normalized[0])return null;
      const operands=normalized.filter(Boolean);
      if(!operands.length)return null;
      if(operands.length===1)return operands[0];
      const selected=normalized[value.displayOperand];
      return {...value,operands,...(Object.hasOwn(value,'displayOperand')?{displayOperand:selected?operands.indexOf(selected):0}:{})};
    }
    if(!indexedGeometry(value)||admitted.some(mesh=>sameMesh(value,mesh)))return value;
    const normalized=normalizeSourceMesh(value);
    if(normalized.geometry===value)return value;
    reports.push({path,...normalized.report});
    return normalized.geometry;
  }
  return {geometry:normalize(geometry,'geometry')??spatialTemplate(),reports};
}
