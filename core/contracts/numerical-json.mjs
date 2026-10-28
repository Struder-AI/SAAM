// One declared numerical observation profile. Generic JSON and Paath admission
// retain their existing rules; callers cannot request an arbitrary codec.
export const numericalEncoding='json-finite-number/1';
export const numericalTextSchema='saam-numerical-json-text/1';
const viewTextSchema='saam-studio-numerical-view-text/1';
export const sliceReceiverSchemas=Object.freeze({
  'saam-slice-prepared-fill/1':'layer-regions',
  'saam-slice-mapping-receiver/1':'slice-layout',
  'saam-slice-gap-receiver/1':'mapped-curves',
  'saam-slice-prepared-strokes/1':'deposition-intent'
});
export const isNumericalObservation=(typeId,schema)=>Object.hasOwn(sliceReceiverSchemas,schema)&&sliceReceiverSchemas[schema]===typeId||typeId==='flow-value'&&schema==='saam-slice-numerical-context/1';
export function numericalJsonProblem(value,path='$',seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return null;
  if(typeof value==='number')return Number.isFinite(value)?null:path+': nonfinite number';
  if(typeof value!=='object')return path+': '+typeof value;
  if(seen.has(value))return path+': cyclic value';
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return path+': native/non-JSON object';
  seen.add(value);
  // Same generic width cost: hidden/extra array keys require a key inventory.
  const keys=Reflect.ownKeys(value);
  if(Array.isArray(value)&&(keys.length!==value.length+1||keys.some((key,index)=>index<value.length?key!==String(index):key!=='length')))return path+': sparse array or additional array properties';
  for(const key of keys){
    if(Array.isArray(value)&&key==='length')continue;
    if(typeof key!=='string')return path+': symbol key';
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor.enumerable)return path+'.'+key+': non-enumerable property';
    if(!Object.hasOwn(descriptor,'value'))return path+'.'+key+': accessor';
    const problem=numericalJsonProblem(descriptor.value,path+'.'+key,seen);if(problem)return problem;
  }
  seen.delete(value);return null;
}
export function* numericalJsonChunks(value){
  if(typeof value==='string'){
    yield '"';
    for(let start=0;start<value.length;){let end=Math.min(value.length,start+8192);
      if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;
      if(end===start)end++;yield JSON.stringify(value.slice(start,end)).slice(1,-1);start=end;}
    yield '"';return;
  }
  if(value===null||typeof value!=='object'){yield Object.is(value,-0)?'-0':JSON.stringify(value);return;}
  if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* numericalJsonChunks(value[i]);}yield ']';return;}
  yield '{';let first=true;
  for(const key of Object.keys(value)){if(!first)yield ',';first=false;yield* numericalJsonChunks(key);yield ':';yield* numericalJsonChunks(value[key]);}yield '}';
}
export function numericalJsonText(value,indent=0){
  if(!indent)return [...numericalJsonChunks(value)].join('');
  const render=(value,depth)=>{
    if(value===null||typeof value!=='object')return numericalJsonText(value);
    const array=Array.isArray(value),keys=Object.keys(value);if(!keys.length)return array?'[]':'{}';
    const pad=' '.repeat(indent*(depth+1)),rows=keys.map(key=>pad+(array?'':JSON.stringify(key)+': ')+render(value[key],depth+1));
    return (array?'[':'{')+'\n'+rows.join(',\n')+'\n'+' '.repeat(indent*depth)+(array?']':'}');
  };
  return render(value,0);
}
async function textHash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const utf8Length=text=>new TextEncoder().encode(text).byteLength;
export function numericalTextValue(text,record){
  return {schema:numericalTextSchema,encoding:numericalEncoding,typeId:record.typeId,implementationSchema:record.implementationSchema,valueId:record.valueId,byteLength:record.byteLength,text};
}
export async function decodeNumericalRecord(record){
  const encoding=record.artifact?.encoding;
  if(encoding===undefined||encoding==='json'||encoding==='geometry-artifact/1')return record;
  if(encoding!==numericalEncoding)throw Error('Unknown retained numerical encoding.');
  const e=record.value;
  if(e?.schema!==numericalTextSchema||e.encoding!==numericalEncoding)throw Error('Unknown numerical text version.');
  if(!isNumericalObservation(record.typeId,record.implementationSchema)||e.typeId!==record.typeId||e.implementationSchema!==record.implementationSchema)throw Error('Unsupported numerical schema/profile.');
  if(typeof e.text!=='string'||e.valueId!==record.valueId||e.byteLength!==record.byteLength||utf8Length(e.text)!==record.byteLength||await textHash(e.text)!==record.valueId)throw Error('Numerical text identity mismatch.');
  const value=JSON.parse(e.text),problem=numericalJsonProblem(value);
  if(problem||value.schema!==record.implementationSchema)throw Error(problem??'Numerical payload schema mismatch.');
  return {...record,value};
}
const inputIds=inputs=>inputs.map(({observationId,valueId})=>({observationId,valueId}));
export async function numericalViewTransport(value,inputs){
  const problem=numericalJsonProblem(value);if(problem)throw Error('Numerical view unavailable: '+problem);
  const text=numericalJsonText(value);
  return {schema:viewTextSchema,encoding:numericalEncoding,inputs:inputIds(inputs),transportId:await textHash(text),byteLength:utf8Length(text),text};
}
export async function decodeNumericalView(value,selection){
  if(value?.kind&&!(value.kind==='slice-receiver'&&selection.valueEncoding===numericalEncoding))return value; // Existing ordinary/unavailable views stay supported.
  if(value?.schema!==viewTextSchema||value.encoding!==numericalEncoding)throw Error('Unknown numerical view version.');
  const expected=inputIds([selection,...selection.related]);
  if(JSON.stringify(value.inputs)!==JSON.stringify(expected))throw Error('Numerical view inputs changed.');
  if(typeof value.text!=='string'||utf8Length(value.text)!==value.byteLength||await textHash(value.text)!==value.transportId)throw Error('Numerical view transport changed.');
  const decoded=JSON.parse(value.text),problem=numericalJsonProblem(decoded);
  if(problem||decoded.kind!=='slice-receiver')throw Error(problem??'Unknown numerical view kind.');
  return decoded;
}
