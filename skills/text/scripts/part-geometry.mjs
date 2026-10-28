// Text's part geometry: edit turns a request into the next features; build letters a base
// with those features. Part edits keeps the result and finds the part; text never reads
// the recipe.
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {compileText,textFeature} from './text.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const REQUEST_FIELDS=['feature','remove','standalone','toleranceMm','maxEdgeMm'];

async function savedFont(feature){
  if(!feature.fontPath)return feature;
  requireThat(isAbsolute(feature.fontPath),'Choose an absolute fontPath.');
  const info=await stat(feature.fontPath);requireThat(info.isFile(),'Font must be a regular file.');
  const bytes=await readFile(feature.fontPath),{fontPath:_path,postscriptName,...rest}=feature;
  return {...rest,font:{data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:postscriptName??null}};
}

async function edit({parameters,request},{dimensions}){
  requireThat(request&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k)),'Unknown text request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one feature to add/update, or remove its id.');
  requireThat(request.standalone===undefined||typeof request.standalone==='boolean','standalone must be a boolean.');
  requireThat(!request.standalone||!request.remove,'Cannot remove a feature while replacing the target with standalone text.');
  const standalone=request.standalone??parameters?.standalone??false,features=structuredClone(parameters?.features??[]);
  if(request.remove){
    const index=features.findIndex(f=>f.id===request.remove);requireThat(index>=0,'Text feature id not found.');features.splice(index,1);
  }else{
    // Updates merge feature settings; replace the complete reference/baseline.
    const feature=await savedFont(structuredClone(request.feature)),index=features.findIndex(f=>f.id===(feature.id??'text'));
    const next={...(index>=0?features[index]:{}),...feature};
    if(index>=0)features[index]=next;else features.push(next);
  }
  // Standalone text keeps its empty record: the reference body is not its material.
  if(!features.length&&!standalone)return {remove:true};
  return {parameters:{features:features.map(textFeature),toleranceMm:request.toleranceMm??parameters?.toleranceMm??dimensions.CHORD_TOLERANCE_MM,
    maxEdgeMm:request.maxEdgeMm??parameters?.maxEdgeMm??1,...(standalone?{standalone:true}:{})}};
}

const featureRow=f=>[f.id,(f.mode==='raised'?'Raised':'Recessed')+' “'+f.text+'” · '+f.depthMm+' mm'];
export const textLabel=features=>features.map(f=>f.text).filter(Boolean).join(' & ');
export const textRows=features=>features.map(featureRow);

async function build({base,parameters},Geometry){
  const {features,toleranceMm,maxEdgeMm,standalone=false}=parameters;
  if(!features.length)return {solid:{shape:'mesh',source:null,vertices:[],triangles:[]},materialParts:[],label:'',rows:[],notes:['The text leaves no material.']};
  const built=await compileText(base,features,{...Geometry,standalone,toleranceMm,maxEdgeMm});
  return {solid:built.solid,materialParts:built.materialParts,label:textLabel(built.features),rows:textRows(built.features),notes:built.notes};
}

// The part-geometry entry: a factory, as every extension entry is.
export const textPartGeometry=()=>Object.freeze({edit,build});
