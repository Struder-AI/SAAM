import {validateBlobField} from './blob-field.mjs';
import {requireThat} from './tolerance.mjs';

export const BLOB_FIELD_COMPILER='saam/blob-marching-tetrahedra/1';
// Records keep the compiler that made their mesh. The mesh is the geometry, read
// and checked as any mesh whichever compiler made it; blob_field rebuilds with
// the current one.
export const blobFieldTemplate=()=>({shape:'blob-field',field:null,extraction:null,vertices:[],triangles:[]});
export function validateBlobFieldExtraction(extraction){
  requireThat(extraction&&Object.keys(extraction).sort().join()==='compiler,edgeMm','Unexpected blob field extraction fields.');
  requireThat(typeof extraction.compiler==='string'&&extraction.compiler.length>0,'Blob field extraction names its compiler.');
  requireThat(Number.isFinite(extraction.edgeMm)&&extraction.edgeMm>0,'Blob field extraction edgeMm must be positive.');
}
export function validateBlobFieldRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(blobFieldTemplate()).sort().join(),'Unexpected blob field geometry fields.');
  validateBlobField(record.field);validateBlobFieldExtraction(record.extraction);
}
