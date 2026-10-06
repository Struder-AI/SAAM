import {canonicalHash} from '../canonical-json.mjs';
import {validateBlobField} from './blob-field.mjs';
import {requireThat} from './tolerance.mjs';

export const BLOB_FIELD_COMPILER='saam/blob-marching-tetrahedra/1';
// Records keep the compiler that made their checked mesh; meshes from the
// earlier kernel extraction stay valid geometry.
const RECORDED_COMPILERS=[BLOB_FIELD_COMPILER,'manifold-3d@3.5.3/blob-level-set/1'];
export const blobFieldTemplate=()=>({shape:'blob-field',field:null,extraction:null,vertices:[],triangles:[],compiledHash:''});
export const blobFieldDigest=({compiledHash,...content})=>canonicalHash(content);
export function validateBlobFieldExtraction(extraction){
  requireThat(extraction&&Object.keys(extraction).sort().join()==='compiler,edgeMm','Unexpected blob field extraction fields.');
  requireThat(RECORDED_COMPILERS.includes(extraction.compiler),'Unsupported blob field compiler. Rebuild it with the blob_field tool.');
  requireThat(Number.isFinite(extraction.edgeMm)&&extraction.edgeMm>0,'Blob field extraction edgeMm must be positive.');
}
export function validateBlobFieldRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(blobFieldTemplate()).sort().join(),'Unexpected blob field geometry fields.');
  validateBlobField(record.field);validateBlobFieldExtraction(record.extraction);
  requireThat(record.compiledHash===blobFieldDigest(record),'Blob field or mesh changed. Rebuild it with the blob_field tool.');
}
