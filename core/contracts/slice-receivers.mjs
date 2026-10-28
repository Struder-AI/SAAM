// Owner-defined numerical representations of Slice's actual receiver read sets.
// These helpers neither observe work nor activate a capture policy.
import {createHash} from 'node:crypto';
import {jsonChunks} from '../json-chunks.mjs';
import {jsonProblem} from './observation-json.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';
import {sliceReceiverSchemas,numericalEncoding,numericalJsonProblem,numericalJsonChunks} from './numerical-json.mjs';

export {sliceReceiverSchemas};
const contextSchema='saam-slice-numerical-context/1';
const refSchema='saam-slice-context-reference/1';
const own=(value,key)=>Object.hasOwn(value??{},key);
function requireThat(condition,message){if(!condition)throw Error(message);}
function frozenCopy(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return Object.freeze(value.map(frozenCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,child])=>[key,frozenCopy(child)])));
}
function numerical(value,label){const problem=numericalJsonProblem(value);requireThat(!problem,label+': '+problem);return frozenCopy(value);}
export function sliceNumericalIdentity(value,{encoding='json'}={}){
  requireThat(['json',numericalEncoding].includes(encoding),'Unknown Slice numerical encoding.');
  const hash=createHash('sha256');let byteLength=0;
  for(const chunk of encoding===numericalEncoding?numericalJsonChunks(value):jsonChunks(value)){hash.update(chunk);byteLength+=Buffer.byteLength(chunk);}
  return {valueId:hash.digest('hex'),byteLength};
}
function reference(valueId){return Object.freeze({schema:refSchema,valueId});}
export function isSliceContextReference(value){return value?.schema===refSchema&&/^[a-f0-9]{64}$/.test(value.valueId??'')&&Object.keys(value).length===2;}
export function verifySliceNumericalContext(entry,expected,{encoding='json'}={}){
  requireThat(entry?.schema===contextSchema&&typeof entry.kind==='string'&&own(entry,'value'),'Unknown Slice numerical context.');
  requireThat(['json',numericalEncoding].includes(encoding),'Unknown Slice numerical encoding.');
  const problem=(encoding===numericalEncoding?numericalJsonProblem(entry):jsonProblem(entry));requireThat(!problem,'Invalid Slice numerical context: '+problem);
  const actual=sliceNumericalIdentity(entry,{encoding});
  requireThat(actual.valueId===expected,'Slice numerical context hash mismatch.');return entry;
}

// Large shared factory inputs are interned separately. Numerical records are
// rebuilt only from explicit verified references, never evaluator/native state.
export function createSliceNumericalContext(){
  const entries=new Map();
  function put(kind,value){
    const entry=Object.freeze({schema:contextSchema,kind,value:numerical(value,'Slice context '+kind)}),identity=sliceNumericalIdentity(entry,{encoding:numericalEncoding});
    if(!entries.has(identity.valueId))entries.set(identity.valueId,Object.freeze({...identity,encoding:numericalEncoding,entry}));
    return reference(identity.valueId);
  }
  function factory(record){
    if(record===null||typeof record!=='object')return record;
    if(Array.isArray(record))return record.map(factory);
    const result=Object.create(null);
    for(const [key,value] of Object.entries(record)){
      // These are numerical factory inputs; only whole shared source records
      // are interned, not every coordinate/point in their large arrays.
      result[key]=['source','geometry','patch'].includes(key)&&value&&typeof value==='object'
        ?put('reference-input',factory(value)):factory(value);
    }
    return result;
  }
  function surface(value){return put('surface',factory(surfaceReferenceRecord(value)));}
  function gap(value){
    requireThat(value&&typeof value==='object','Gap receiver needs its actual gap.');
    const record=Object.create(null);
    for(const [key,child] of Object.entries(value)){
      if(key!=='references'){record[key]=child;continue;}
      requireThat(Array.isArray(child),'Gap predecessor references must be an array.');
      record.references=child.map(predecessor=>{
        const {slice,frame,...fields}=predecessor;
        return {...fields,slice:surface(slice),...(frame?{frame:{...frame,base:surface(frame.base)}}:{})};
      });
    }
    return put('gap',record);
  }
  function receipt(value){
    const record={};
    for(const key of ['constructionReport','nextFillState'])if(value?.[key]!==undefined)record[key]=value[key];
    return put('fill-production-receipt',record);
  }
  return Object.freeze({surface,gap,receipt,put,
    entries:()=>Object.freeze([...entries.values()]),
    get(ref){requireThat(isSliceContextReference(ref),'Invalid Slice context reference.');const found=entries.get(ref.valueId);requireThat(found,'Slice numerical context is unavailable.');return verifySliceNumericalContext(found.entry,ref.valueId,{encoding:found.encoding});}
  });
}
export function resolveSliceNumericalContext(ref,lookup){
  requireThat(isSliceContextReference(ref),'Invalid Slice context reference.');const visiting=new Set(),resolved=new Map();
  function resolveValue(value){
    if(isSliceContextReference(value)){
      if(resolved.has(value.valueId))return resolved.get(value.valueId);
      requireThat(!visiting.has(value.valueId),'Cyclic Slice numerical context.');visiting.add(value.valueId);
      const found=lookup(value.valueId),entry=verifySliceNumericalContext(found?.entry??found,value.valueId,{encoding:found?.encoding??'json'}),result=resolveValue(entry.value);visiting.delete(value.valueId);resolved.set(value.valueId,result);return result;
    }
    if(Array.isArray(value))return value.map(resolveValue);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,resolveValue(child)]));
    return value;
  }
  return resolveValue(ref);
}
function identity(value,purpose){
  requireThat(value&&typeof value.assignmentId==='string'&&typeof value.stackId==='string'&&typeof value.workNodeKey==='string','Slice receiver needs assignment, stack and actual work-node identity.');
  for(const key of ['memberIndex','characterIndex','ordinal'])requireThat(Number.isSafeInteger(value[key])&&value[key]>=0,'Slice receiver needs native '+key+'.');
  requireThat(value.consumerPurpose===purpose,'Slice receiver consumer purpose mismatch.');return numerical(value,'Slice occurrence identity');
}
function optionalFields(value,keys){
  const result={},undefinedFields=[];
  for(const key of keys)if(own(value,key)){if(value[key]===undefined)undefinedFields.push(key);else result[key]=value[key];}
  return {...result,...(undefinedFields.length?{undefinedFields}:{})};
}
function receiver(schema,data,context,occurrence){return numerical({schema,identity:occurrence,receiver:data,context},'Slice receiver');}

export function encodePreparedFillReceiver({region,options,identity:occurrence,context}){
  requireThat(options?.preparedLayout,'Prepared fill receiver needs the actual supplied prepared layout.');
  const {walls,interior,solidRegion,sparseRegion}=options.preparedLayout;
  const fill=optionalFields(options,['widthMm','fillDensity','fillPattern','fillAngleDeg','patternAngleDeg','solidDensity','spacingFactor','sampleStepMm','phaseMm','direction','fillOrder','fillDirection','fillState']);
  if(options.layer)fill.layer=optionalFields(options.layer,['index','heightMm','speedMmS']);
  const refs={surface:context.surface(options.slice),layoutReference:context.surface(options.layoutReference===undefined?options.slice:options.layoutReference)};
  return receiver('saam-slice-prepared-fill/1',{region,preparedLayout:{walls,interior,solidRegion,sparseRegion},fill},refs,identity(occurrence,'fill-layout'));
}
export function encodeMappingReceiver({strokes,slice,options={},effectiveDefaults,productionReceipt,productionIdentity,identity:occurrence,context}){
  requireThat(['boundary-publication','deposition'].includes(occurrence?.consumerPurpose),'Mapping receiver needs its actual publication/deposition purpose.');
  requireThat(['walls','infill','fill'].includes(occurrence.group),'Mapping receiver needs its actual stroke group.');
  requireThat(effectiveDefaults&&typeof effectiveDefaults==='object','Mapping receiver needs explicit effective defaults.');
  const refs={surface:context.surface(slice),...(productionReceipt?{productionReceipt:context.receipt(productionReceipt)}:{})};
  const supplied={values:Object.create(null),undefinedFields:[]};
  for(const key of Reflect.ownKeys(options)){
    requireThat(typeof key==='string','Mapping options contain a symbol key.');const descriptor=Object.getOwnPropertyDescriptor(options,key);
    requireThat(descriptor.enumerable&&own(descriptor,'value'),'Mapping options contain a hidden property or accessor.');
    if(descriptor.value===undefined)supplied.undefinedFields.push(key);else supplied.values[key]=descriptor.value;
  }
  return receiver('saam-slice-mapping-receiver/1',{strokes,options:supplied,effectiveDefaults,...(productionIdentity?{productionIdentity}:{})},refs,identity(occurrence,occurrence.consumerPurpose));
}
export function encodeGapReceiver({curves,surface,gap,mappingInputIdentity,identity:occurrence,context}){
  if(mappingInputIdentity)requireThat(typeof mappingInputIdentity.observationId==='string'&&/^[a-f0-9]{64}$/.test(mappingInputIdentity.valueId??''),'Gap receiver mapping input must name its exact observation/hash.');
  return receiver('saam-slice-gap-receiver/1',{curves,...(mappingInputIdentity?{mappingInputIdentity}:{})},{surface:context.surface(surface),gap:context.gap(gap)},identity(occurrence,'gap-section'));
}
export function encodePreparedStrokeReceiver({deposited,identity:occurrence,context}){
  requireThat(deposited&&Array.isArray(deposited.strokes),'Prepared stroke receiver needs the actual deposited batch.');
  const {strokes,process,...receipt}=deposited;
  return receiver('saam-slice-prepared-strokes/1',{strokes,receipt},{process:context.put('resolved-process',process)},identity(occurrence,'work-assembly'));
}
