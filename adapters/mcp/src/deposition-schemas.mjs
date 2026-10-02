import {GEOMETRY_SHAPES} from '../../../core/print/plan.mjs';
// Discoverable patch schemas. Named records let the existing SDK emit local
// references instead of repeated shapes; recipe validators still own completeness.
import {z} from 'zod';
import {FILL_PATTERNS} from '../../../core/region/fill-patterns.mjs';
const number=z.number().finite(),positive=number.positive(),names=z.array(z.string()),xyz=z.tuple([number,number,number]).meta({id:'saam.xyz'}),uv=z.tuple([number,number]).meta({id:'saam.uv'});
const weighted=z.union([xyz,z.tuple([number,number,number,positive])]).meta({id:'saam.weightedPoint'});
export const patchSchema=z.object({name:z.string(),degreeU:z.number().int().min(1),degreeV:z.number().int().min(1),controlPoints:z.array(z.array(weighted)),knotsU:z.array(number).nullable().optional(),knotsV:z.array(number).nullable().optional()}).describe('Named NURBS patch; control-net rows along U, points along V; optional full knot vectors.').meta({id:'saam.patch'});
export const geometrySchema=z.lazy(()=>z.object({shape:z.enum(GEOMETRY_SHAPES),patches:z.array(patchSchema).optional(),vertices:z.array(xyz).optional(),triangles:z.array(z.tuple([z.number().int(),z.number().int(),z.number().int()])).optional(),source:z.unknown().optional(),operation:z.enum(['union','difference','intersection']).optional(),operands:z.array(geometrySchema).optional(),parts:z.array(z.object({id:z.string(),geometry:geometrySchema,xMm:number,yMm:number,zMm:number})).optional()}).passthrough()).describe('Same authored geometry record as recipe geometry; derived mesh forms retain their feature/provenance fields.');
const blob=z.object({schema:z.literal('saam-blob-field/1'),points:z.array(z.object({positionMm:xyz,reachMm:positive,strength:number})),threshold:positive});
export const fieldSchema=z.lazy(()=>z.object({
  kind:z.enum(['periodic','noise','bumps','ramp','blob','solid-distance','transfer','add','multiply']).optional(),
  axis:xyz.describe('Nonzero sampling direction in selected frame.').optional(),periodMm:z.union([positive,xyz]).describe('Periodic scalar period; bumps XYZ lattice periods. Slice frame uses native UV units.').optional(),
  phaseRad:number.optional(),waveform:z.enum(['sine','triangle','square']).optional(),transitionFraction:number.min(0).max(.5).describe('Square transition width as fraction of cycle: default0.05 for displacement/tilt, zero for scalar channels.').optional(),cellMm:positive.optional(),seed:z.number().int().optional(),
  radiusMm:positive.optional(),originMm:xyz.optional(),fromMm:number.optional(),toMm:number.optional(),field:blob.optional(),
  geometry:geometrySchema.optional(),toleranceMm:positive.describe('Solid-distance tessellation tolerance, not exact native distance.').optional(),signed:z.boolean().optional(),
  source:fieldSchema.optional(),sources:z.array(fieldSchema).optional(),input:z.tuple([number,number]).describe('Increasing transfer input range; outside clamps.').optional(),output:z.tuple([number,number]).optional()
}).strict()).describe('periodic: axis,periodMm,phaseRad,waveform?; noise:cellMm,seed; bumps:periodMm XYZ,radiusMm,originMm; ramp:axis,fromMm,toMm; blob:field; solid-distance:geometry,toleranceMm,signed; transfer:source,input,output; add/multiply:sources.');
const modulationRecordSchema=z.object({id:z.string().optional(),assignments:names.nullable().optional(),roles:names.nullable().optional(),
  channel:z.enum(['displacement','flow','width','speed','tilt']).optional(),amplitude:number.describe('Displacement mm; tilt degrees; other channels multiply by 1+amplitude*field.').optional(),
  direction:z.union([xyz,z.enum(['lateral','stack'])]).optional(),frame:z.enum(['world','slice','curve']).describe('World XYZ; slice native UV+basis; curve arc length, normalized parameter, normal coordinate.').optional(),
  layers:z.object({from:z.number().int().nonnegative(),to:z.number().int().nonnegative()}).nullable().describe('Inclusive producer-family layer indices, zero based.').optional(),topN:z.number().int().positive().nullable().optional(),phasePerLayerRad:number.optional(),
  field:fieldSchema.optional(),sampleStepMm:positive.optional(),tolerance:positive.optional()
}).strict();
export const surfaceSchema=z.object({kind:z.enum(['horizontal','plane','roof','spline','patch','mesh-strip','terminal']).optional(),assignment:z.string().optional(),minFeatureMm:positive.optional(),origin:xyz.optional(),normal:xyz.optional(),xAxis:xyz.optional(),offsetMm:number.optional(),patch:z.union([patchSchema,z.string()]).optional(),part:z.string().nullable().optional(),periodicU:z.boolean().optional(),normalSide:z.union([z.literal(1),z.literal(-1)]).optional(),uvBounds:z.tuple([uv,uv]).optional(),rows:z.array(z.array(z.number().int())).optional()}).strict();
const process=z.object({...Object.fromEntries(['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','firstLayerSpeedMmS'].map(k=>[k,positive.optional()])),fanPercent:number.min(0).max(100).optional()}).strict();
const nurbs=z.object({degree:z.number().int().positive(),knots:z.array(number),controlPoints:z.array(z.union([uv,xyz])),weights:z.array(positive).optional()}).meta({id:'saam.nurbs'});
const profile=z.array(z.tuple([number,positive])).meta({id:'saam.profile'});
const reference=z.object({kind:z.enum(['patch','slice','sleeve']),part:z.string().nullable().optional(),name:z.string().optional(),assignment:z.string().optional(),index:z.number().int().optional()}).strict();
const curve=z.object({segmentMetadata:z.array(z.record(z.string(),z.unknown())).optional(),contact:z.object({source:z.string().nullable(),gapMm:number.nonnegative().nullable(),referenceZMm:number.nullable(),sampleStepMm:positive}).optional(),depositionAction:z.object({kind:z.literal('press'),depthMm:positive}).optional(),points:z.array(xyz).optional(),nurbs:nurbs.optional(),uv:z.object({reference,points:z.array(uv).optional(),nurbs:nurbs.optional(),normalMm:number.optional()}).optional(),closed:z.boolean(),role:z.string().optional(),beadWidthMm:positive.optional(),heightMm:positive.optional(),speedMmS:positive.optional(),flowMultiplier:positive.optional(),courses:z.array(z.number().int()).optional(),
  vary:z.object(Object.fromEntries(['beadWidthMm','heightMm','flowMultiplier','speedMmS'].map(k=>[k,profile.optional()]))).strict().optional(),widthRule:z.object({widthMm:positive,beadRangeMm:z.tuple([positive,positive]),spacingFactor:positive.optional(),initialNormal:xyz.optional()}).optional(),sampleStepMm:positive.optional(),toleranceMm:positive.optional()});
const volume=z.object({kind:z.enum(['slab','geometry','outline','support','surface-domain','normal-band']),fromMm:number.optional(),toMm:number.nullable().optional(),geometry:geometrySchema.optional(),footprint:z.array(z.array(uv)).optional(),contactZMm:number.optional(),topGapMm:number.optional(),xyGapMm:number.optional(),loopsUv:z.array(z.array(uv)).nullable().optional(),maxSlopeDeg:positive.max(90).optional(),sampleStepMm:positive.optional(),fromLayer:z.number().int().optional(),toLayer:z.number().int().optional()}).strict();
const values=z.union([number,z.array(number)]),sleevePath=z.object({points:z.array(uv),beadHeightMm:values,offsetMm:values.optional()});
const sleevePattern=z.object({paths:z.array(sleevePath),advance:uv,repeats:z.number().int().positive()}).strict();
const injectionPoint=z.object({point:xyz.describe('XYZ before recipe XY placement; no component transform.'),volumeMm3:positive.describe('Stationary deposited material volume in mm³.'),flowMm3S:positive.describe('Material flow rate, within selected material limit.'),holdSeconds:number.nonnegative().describe('Dwell after extrusion.'),approachMm:number.nonnegative().describe('Vertical nondepositing descent from this distance above the point.')}).strict();
const sliceRecordSchema=z.object({id:z.string().optional(),construction:z.enum(['sleeve','curves','inject']).optional(),part:z.string().nullable().optional(),preset:z.enum(['brim','support']).nullable().optional(),filament:z.number().int().nonnegative().nullable().optional(),process:process.nullable().optional(),after:names.optional(),
  points:z.array(injectionPoint).optional(),nozzleC:positive.nullable().describe('Inject operation temperature; null retains selected material setup, non-null restores setup afterward.').optional(),
  loops:z.union([z.number().int().nonnegative(),z.array(z.number().int().positive())]).optional(),fillDensity:number.optional(),fillPattern:z.enum(FILL_PATTERNS).optional(),fillAnglesDeg:z.array(number).optional(),rotateFill:z.boolean().optional(),solidTop:z.number().int().optional(),solidBottom:z.number().int().optional(),fillOverlap:number.optional(),spacingFactor:positive.optional(),sampleStepMm:positive.optional(),within:z.array(volume).optional(),surface:surfaceSchema.nullable().optional(),stack:z.object({firstLayerMm:positive.optional(),layerMm:positive.optional(),direction:z.union([xyz,z.literal('normal')]).describe('Default plane normal or mean normal; normal selects a parametric normal-band family.').optional()}).nullable().optional(),
  maxExcursionMm:positive.nullable().optional(),sequence:z.boolean().optional(),courseIds:names.nullable().optional(),curves:z.array(curve).optional(),repeat:z.union([z.object({count:z.number().int().positive().optional(),translation:xyz.optional()}),z.object({family:z.string().optional(),indices:z.array(z.number().int()).nullable().optional()})]).nullable().optional(),
  join:z.object({mode:z.literal('spiral'),levelEnd:z.boolean()}).nullable().optional(),fillOrder:z.union([z.object({kind:z.literal('fronts'),seedUv:z.array(z.array(uv)).nullable(),lineSpacingMm:positive,propagationStepMm:positive,toleranceMm:positive}),z.object({kind:z.literal('surface-cells'),directions:z.array(z.enum(['axial','circumferential','forward','reverse'])),toleranceMm:positive,offsetTightness:number.min(0).max(1)})]).nullable().optional(),contact:z.object({source:z.string().nullable()}).nullable().optional(),toolPose:z.object({alignToSliceNormal:z.boolean().default(false)}).strict().nullable().optional(),dependencies:z.object({afterParts:z.array(z.string().nullable()),beforeParts:z.array(z.string().nullable()),after:names}).optional(),description:z.string().optional(),
  zStartMm:number.optional(),zEndMm:number.nullable().optional(),endTransition:z.enum(['level','spiral']).optional(),pattern:sleevePattern.nullable().optional(),pathMode:z.enum(['continuous','segmented']).optional(),meshSleeve:z.object({fidelity:number,contactSide:z.enum(['inside','outside']),circumferentialControls:z.number().int(),heightControls:z.number().int(),detailToleranceMm:positive}).nullable().optional(),toleranceMm:positive.optional(),boundaryToleranceMm:positive.optional(),minFeatureMm:positive.optional(),sleeveToleranceMm:number.nonnegative().optional()
}).strict().describe('General assignment patch. Common factories fill defaults on add; edit merges objects and replaces arrays. Exact shared recipe validation follows.');

// Objects merge recursively, arrays replace completely. Mirror those semantics
// in the discovery schema without weakening each replacement array's records.
function objectPatch(schema,cache=new Map(),patch=true){
  if(cache.get(schema)?.has(patch))return cache.get(schema).get(patch);
  let result=schema;
  if(schema instanceof z.ZodLazy)result=z.lazy(()=>objectPatch(schema.unwrap(),cache,patch));
  else if(schema instanceof z.ZodObject){
    result=schema.extend(Object.fromEntries(Object.entries(schema.shape).map(([key,value])=>{const child=objectPatch(value,cache,patch);return [key,patch?child.optional():child];})));
    if(!(schema.def.catchall instanceof z.ZodUnknown))result=result.strict();
  }
  else if(schema instanceof z.ZodArray)result=z.array(objectPatch(schema.element,cache,false));
  else if(schema instanceof z.ZodOptional)result=objectPatch(schema.unwrap(),cache,patch).optional();
  else if(schema instanceof z.ZodNullable)result=objectPatch(schema.unwrap(),cache,patch).nullable();
  else if(schema instanceof z.ZodUnion)result=z.union(schema.options.map(option=>objectPatch(option,cache,patch)));
  if(schema.description)result=result.describe(schema.description);
  if(result!==schema&&schema.meta()?.id)result=result.meta({id:schema.meta().id+(patch?'Patch':'Record')});
  if(!cache.has(schema))cache.set(schema,new Map());cache.get(schema).set(patch,result);return result;
}
// One transformation shares record identities across both editors, preserving
// distinct complete-array records and recursively optional object patches.
const editSchemas=objectPatch(z.object({slice:sliceRecordSchema,modulation:modulationRecordSchema}));
export const slicePatchSchema=editSchemas.shape.slice.unwrap();
export const modulationPatchSchema=editSchemas.shape.modulation.unwrap();
export const draftFamilySchema=slicePatchSchema.pick({id:true,part:true,preset:true,process:true,within:true,surface:true,stack:true,sampleStepMm:true});
