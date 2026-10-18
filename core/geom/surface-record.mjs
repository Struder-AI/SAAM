// Native chart references retain the numerical factory inputs, never display
// meshes or evaluator closures. Preparation reuses the original operations.
import {requireThat} from './tolerance.mjs';
import {surfaceRegion} from './surface-region.mjs';
import {mappedSurface} from './surface-evaluation.mjs';
import {offsetSurfaceChart} from './offset-chart.mjs';
import {contactChart} from './contact-chart.mjs';
import {extendSurface} from './surface-extend.mjs';

export function numericalGeometryRecord(value){
  if(value===undefined)return undefined;
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){requireThat(Number.isFinite(value),'Native geometry reference contains non-finite data.');return value;}
  if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,numericalGeometryRecord);
  requireThat(value&&typeof value==='object','Native geometry reference requires numerical data.');
  const result={};
  for(const [key,child] of Object.entries(value)){
    // openNURBS lifetime handles accompany the identical numerical patches.
    if(key==='surfaces'&&Array.isArray(value.patches))continue;
    if(child!==undefined)result[key]=numericalGeometryRecord(child);
  }
  return result;
}
export function surfaceReferenceRecord(surface){
  if(surface.referenceRecord){
    const metadata=Object.fromEntries(['kind','domainU','domainV','breaksU','breaksV','periodicU','backend','sourceOperationIds','coverage','substrateAdaptation','contactGeometry','contactMetric']
      .filter(key=>surface[key]!==undefined).map(key=>[key,numericalGeometryRecord(surface[key])]));
    return {...numericalGeometryRecord(surface.referenceRecord),...metadata};
  }
  requireThat(typeof surface.at!=='function','Native chart producer must retain its numerical reference record.');
  return numericalGeometryRecord(surface);
}
const references=new WeakMap();
export function prepareSurfaceReference(record){
  if(references.has(record))return references.get(record);
  const data=reviveNumericalGeometry(record);
  const surface=constructReference(data);references.set(record,surface);return surface;
}
function constructReference(record){
  if(!record.representation)return record;
  if(record.representation==='tangent-extension')return extendSurface(record.patch,record.boundsUv);
  if(record.representation==='surface-region')return surfaceRegion(record.geometry,record.selection);
  if(record.representation==='mapped-surface')return mappedSurface(record.source,record.bounds,record.domain,{normalSide:record.normalSide,periodicU:record.periodicU});
  if(record.representation==='offset-chart')return offsetSurfaceChart(record.source.representation?prepareSurfaceReference(record.source):record.source,record.depthMm,
    {shell:record.geometry,selection:record.selection,tightness:record.tightness});
  if(record.representation==='contact-chart')return contactChart(prepareSurfaceReference(record.source),record.segments,{toleranceMm:record.toleranceMm});
  throw Error('Unknown native surface reference representation.');
}
function reviveNumericalGeometry(value){
  if(ArrayBuffer.isView(value))return value;
  if(Array.isArray(value))return value.map(reviveNumericalGeometry);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,child] of Object.entries(value))result[key]=Array.isArray(child)&&(key==='cp'||value.cp&&['knots','knotsU','knotsV'].includes(key))?Float64Array.from(child):reviveNumericalGeometry(child);
  return result;
}
