// Existing surface charts share point, normal and first-derivative evaluation.
// Coordinates retain their native units; offsets are physical millimetres.
import {evaluate} from './nurbs.mjs';
import {surfaceDerivatives} from './surface-derivatives.mjs';
import {distance,requireThat,TOLERANCE} from './tolerance.mjs';
import {physicalSurfaceNormal} from './surface-frame.mjs';
import {prepareSurfaceReference,surfaceReferenceRecord} from './surface-record.mjs';
import {faceContainsUv} from './surface-trim.mjs';

const rings=new WeakMap();
function sleeveRing(layer,u){
  let ring=rings.get(layer);
  if(!ring){
    requireThat(layer.curves?.length===1&&layer.curves[0].closed,'Sleeve layers require one closed boundary loop.');
    const points=layer.curves[0].points,lengths=[0];
    for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[(i+1)%points.length]));
    requireThat(lengths.at(-1)>0,'Sleeve boundary collapsed.');
    ring={points,lengths};rings.set(layer,ring);
  }
  const {points,lengths}=ring,total=lengths.at(-1),d=((u%1)+1)%1*total;
  let i=1;while(i<lengths.length-1&&lengths[i]<=d)i++;
  const a=points[i-1],b=points[i%points.length],span=lengths[i]-lengths[i-1],t=(d-lengths[i-1])/span;
  return {point:a.map((x,k)=>x+(b[k]-x)*t),du:a.map((x,k)=>(b[k]-x)*total/span)};
}

export function evaluateSurface(surface,[u,v],normalMm=0){
  if(surface.representation)return evaluateSurface(prepareSurfaceReference(surface),[u,v],normalMm);
  let e;
  if(surface.cp||surface.kind==='patch')e=evaluate(surface.patch??surface,u,v);
  else if(surface.kind==='plane')e={point:surface.origin.map((x,k)=>x+u*surface.xAxis[k]+v*surface.yAxis[k]),normal:surface.normal,du:surface.xAxis,dv:surface.yAxis};
  else if(surface.kind==='sleeve-chart'){
    const layers=surface.layers;
    requireThat(layers?.length>=2,'A sleeve reference needs at least two boundary layers.');
    requireThat(v>=-TOLERANCE.parameter&&v<=layers.length-1+TOLERANCE.parameter,'Sleeve curve lies outside the along-coordinate domain.');
    const coordinate=Math.max(0,Math.min(layers.length-1,v)),i=Math.min(layers.length-2,Math.floor(coordinate)),t=coordinate-i;
    const a=sleeveRing(layers[i],u),b=sleeveRing(layers[i+1],u),du=a.du.map((x,k)=>x+t*(b.du[k]-x)),dv=b.point.map((x,k)=>x-a.point[k]);
    e={point:a.point.map((x,k)=>x+t*dv[k]),du,dv,normal:physicalSurfaceNormal(du,dv,[1,layers.length-1])};
  }else if(surface.kind==='slice-chart')return evaluateSurface(surface.slice,[u,v],normalMm);
  else {requireThat(typeof surface.at==='function','Unsupported surface chart.');e=surface.at(u,v);}
  requireThat(Number.isFinite(normalMm),'Surface normal offset must be finite.');
  requireThat(!normalMm||e.normal,'Surface has a singular tangent at this chart point.');
  return {...e,reference:e.point,point:normalMm?e.point.map((x,k)=>x+normalMm*e.normal[k]):e.point,u,v};
}

// Coverage is explicit for partial height references and bounded native charts.
export function surfaceChartCovers(surface,uv){
  if(surface.representation)return surfaceChartCovers(prepareSurfaceReference(surface),uv);
  if(surface.kind==='slice-chart')return surfaceChartCovers(surface.slice,uv);
  const native=surface.kind==='patch'?surface.patch:surface;
  if(native.cp&&native.trimLoops)return faceContainsUv(native,...uv);
  return [native.domainU,native.domainV].every((b,k)=>!b||uv[k]>=b[0]-TOLERANCE.parameter&&uv[k]<=b[1]+TOLERANCE.parameter)&&(!surface.at?.covers||surface.at.covers(...uv));
}
// An affine chart selection preserves native parameters and derivative units.
export function mappedSurface(surface,bounds,domain,{normalSide=1,periodicU=false}={}){
  const scale=bounds.map((b,k)=>(b[1]-b[0])/(domain[k][1]-domain[k][0]));
  const breaks=(knots,b,k)=>[domain[k][0],...new Set([...(knots??[])].filter(x=>x>b[0]&&x<b[1]).map(x=>domain[k][0]+(x-b[0])/scale[k])),domain[k][1]];
  const at=(u,v)=>{
    const coordinates=[u,v];
    requireThat(coordinates.every((x,k)=>{const t=(x-domain[k][0])/(domain[k][1]-domain[k][0]);return t>=-TOLERANCE.domainFraction&&t<=1+TOLERANCE.domainFraction;}),'Surface sample outside selected region.');
    const uv=coordinates.map((x,k)=>bounds[k][0]+Math.max(0,Math.min(domain[k][1]-domain[k][0],x-domain[k][0]))*scale[k]),e=evaluateSurface(surface,uv);
    requireThat(e.normal,'Surface has a singular tangent at this chart point.');
    return {...e,uv,normal:e.normal.map(x=>x*normalSide),du:e.du?.map(x=>x*scale[0]),dv:e.dv?.map(x=>x*scale[1])};
  };
  // Differential capability belongs to this evaluator's identity. A wrapper
  // replacing at cannot accidentally inherit derivatives of the old geometry.
  const prepared=surface.representation?prepareSurfaceReference(surface):surface,native=prepared.patch??prepared;
  at.covers=(u,v)=>surfaceChartCovers(surface,[u,v].map((x,k)=>bounds[k][0]+(x-domain[k][0])*scale[k]));
  if(native.cp||prepared.at?.nativeImage)at.nativeImage=chart=>{
    const coordinates=chart.map(uv=>uv.map((x,k)=>bounds[k][0]+(x-domain[k][0])*scale[k]));
    return native.cp?{surface:native,chart:coordinates}:prepared.at.nativeImage(coordinates);
  };
  const differential=native.cp?(u,v,options)=>surfaceDerivatives(native,u,v,options):prepared.at?.derivatives;
  if(differential)at.derivatives=(u,v,{normalMm=0,...options}={})=>{
    const coordinates=[u,v];
    requireThat(coordinates.every((x,k)=>x>=domain[k][0]-TOLERANCE.parameter&&x<=domain[k][1]+TOLERANCE.parameter),'Surface derivative outside selected region.');
    const uv=coordinates.map((x,k)=>bounds[k][0]+Math.max(0,Math.min(domain[k][1]-domain[k][0],x-domain[k][0]))*scale[k]);
    const e=differential(...uv,{...options,normalMm:normalMm*normalSide});
    return {...e,du:e.du.map(x=>x*scale[0]),dv:e.dv.map(x=>x*scale[1]),duu:e.duu.map(x=>x*scale[0]**2),
      duv:e.duv.map(x=>x*scale[0]*scale[1]),dvv:e.dvv.map(x=>x*scale[1]**2),normal:e.normal.map(x=>x*normalSide),
      uvOf:vector=>e.uvOf(vector).map((x,k)=>x/scale[k])};
  };
  return {at,source:surface,domainU:domain[0],domainV:domain[1],breaksU:breaks(native.knotsU??prepared.breaksU,bounds[0],0),breaksV:breaks(native.knotsV??prepared.breaksV,bounds[1],1),periodicU,
    referenceRecord:{representation:'mapped-surface',source:surfaceReferenceRecord(surface),bounds,domain,normalSide,periodicU}};
}

// A rigid translation preserves the chart, frames and numerical capabilities.
export function translatedSurface(surface,translation){
  requireThat(Array.isArray(translation)&&translation.length===3&&translation.every(Number.isFinite),'Surface translation needs finite XYZ.');
  const original=surface.representation?prepareSurfaceReference(surface):surface;
  const referenceRecord={representation:'translated-surface',source:surfaceReferenceRecord(original),translation};
  if(original.kind==='plane')return {...original,origin:original.origin.map((value,k)=>value+translation[k]),referenceRecord};
  const native=original.kind==='patch'?original.patch:original.cp?original:null;
  if(native){
    const cp=Float64Array.from(native.cp);
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=translation[k]*cp[i+3];
    const moved={...native,cp};return original.kind==='patch'?{...original,patch:moved,referenceRecord}:{...moved,referenceRecord};
  }
  const at=(u,v)=>{const e=evaluateSurface(original,[u,v]);return {...e,point:e.point.map((value,k)=>value+translation[k])};};
  at.covers=(u,v)=>surfaceChartCovers(original,[u,v]);
  if(original.at?.derivatives)at.derivatives=(u,v,options)=>{
    const e=original.at.derivatives(u,v,options);return {...e,point:e.point.map((value,k)=>value+translation[k])};
  };
  if(original.at?.nativeImage)at.nativeImage=chart=>{
    const image=original.at.nativeImage(chart);if(!image)return null;
    const cp=Float64Array.from(image.surface.cp);
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=translation[k]*cp[i+3];
    return {...image,surface:{...image.surface,cp}};
  };
  return {...original,at,referenceRecord};
}
