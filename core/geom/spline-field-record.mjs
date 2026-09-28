import {createHash} from 'node:crypto';
import {validateSplineField} from './spline-field.mjs';
import {requireThat} from './tolerance.mjs';

export const SPLINE_FIELD_COMPILER='manifold-3d@3.5.3/level-set-linear/2';
export const splineFieldTemplate=()=>({shape:'spline-field',field:null,extraction:null,vertices:[],triangles:[],compiledHash:''});
export function splineFieldDigest({compiledHash,...content}){
  return createHash('sha256').update(JSON.stringify(content,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');
}
export function validateSplineFieldExtraction(extraction){
  requireThat(extraction&&Object.keys(extraction).sort().join()==='compiler,edgeMm,maxEvaluations','Unexpected spline field extraction fields.');
  requireThat([SPLINE_FIELD_COMPILER,'manifold-3d@3.5.3/level-set-linear/1'].includes(extraction.compiler),'Unsupported spline field compiler. Rebuild it with the spline_field tool.');
  requireThat(Number.isFinite(extraction.edgeMm)&&extraction.edgeMm>0,'Spline field extraction edgeMm must be positive.');
  requireThat(Number.isSafeInteger(extraction.maxEvaluations)&&extraction.maxEvaluations>0,'Spline field maxEvaluations must be a positive safe integer.');
}
export function validateSplineFieldRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(splineFieldTemplate()).sort().join(),'Unexpected spline field geometry fields.');
  validateSplineField(record.field);validateSplineFieldExtraction(record.extraction);
  requireThat(record.compiledHash===splineFieldDigest(record),'Spline field or mesh changed. Rebuild it with the spline_field tool.');
}
